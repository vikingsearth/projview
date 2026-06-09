/* pluggable persistence for the index, comments + usage.
 *
 * A Store persists three things so a re-spawn can warm-start and so comments /
 * usage survive a session:
 *   entries  - indexed files { path, name, ext, mtime, content }
 *   comments - notes on a file or a portion of it (see anchor model below)
 *   events   - usage signals { ts, type, file?, query?, count? }
 *
 * Backends:
 *   memory    - no disk persistence (ephemeral default; lives only this session)
 *   superlite - a JSON file
 *   lite      - sqlite via node:sqlite (built-in)
 *   custom    - a connection URL: sqlite://<file> or postgres://<...> (lazy `pg`)
 *
 * A comment's `anchor` is one of:
 *   { type: 'file' }                                  whole document
 *   { type: 'heading', id }                           a section (stable pv- id)
 *   { type: 'text', exact, prefix, suffix, section }  a quoted range (re-anchored
 *                                                      client-side; see 3c)
 * Everything above the store stays storage-agnostic.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

// node:sqlite is flagged "experimental" and emits a noisy warning on use; we
// opted into it deliberately, so quiet just that one notice (others pass through).
const _emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  if (typeof warning === 'string' && warning.includes('SQLite is an experimental feature')) return;
  return _emitWarning(warning, ...rest);
};

const HOME = path.join(os.homedir(), '.projview');
const CACHE_DIR = path.join(HOME, 'cache');         // retained (--persist)
const EPHEMERAL_DIR = path.join(HOME, 'ephemeral'); // cleaned up on close
const CONFIG_FILE = path.join(HOME, 'config.json'); // default flags

const keyFor = (root) => createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });
const redact = (url) => url.replace(/\/\/[^@/]*@/, '//***@');   // hide creds in logs

// Best-effort identity for comment authorship: git user.name, else OS username.
export function gitOrOsUser() {
  try { const n = execSync('git config user.name', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (n) return n; } catch { /* no git / no user.name */ }
  try { return os.userInfo().username || null; } catch { return null; }
}

// Normalize loose input into a full comment / event record (defaults + ids).
const newComment = (c) => ({
  id: c.id || randomUUID(),
  file: c.file,
  anchor: c.anchor || { type: 'file' },
  body: c.body,
  author: c.author ?? null,
  createdAt: c.createdAt || Date.now(),
  resolved: !!c.resolved
});
const newEvent = (e) => ({
  id: randomUUID(),
  ts: e.ts || Date.now(),
  type: e.type,
  file: e.file ?? null,
  query: e.query ?? null,
  count: e.count ?? null
});

// Aggregate raw events into something a human / agent can read at a glance.
function summarizeEvents(events) {
  const byType = {};
  const fileCounts = {};
  const searches = [];
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.file) fileCounts[e.file] = (fileCounts[e.file] || 0) + 1;
    if (e.type === 'search' && e.query) searches.push(e.query);
  }
  const topFiles = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file, count }));
  return { total: events.length, byType, topFiles, recentSearches: searches.slice(-10).reverse() };
}

function readConfigFile() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

// Resolve store config: CLI flags > env > ~/.projview/config.json > defaults.
export function resolveStoreConfig(flags = {}) {
  const env = process.env;
  const file = readConfigFile();
  const pick = (...vals) => vals.find((v) => v !== undefined);

  const url = pick(flags.storeUrl, env.PROJVIEW_STORE_URL, env.DATABASE_URL, file.storeUrl);
  const persist = pick(
    flags.persist,
    ['1', 'true'].includes(env.PROJVIEW_PERSIST) ? true : undefined,
    file.persist
  ) || false;
  let kind = pick(flags.store, env.PROJVIEW_STORE, file.store);
  if (!kind) kind = url ? 'custom' : persist ? 'lite' : 'memory';
  return { kind, url, persist };
}

export function createStore(config, root) {
  const cfg = config || { kind: 'memory' };
  switch (cfg.kind) {
    case 'memory': return memoryStore();
    case 'superlite': return superliteStore(root, cfg.persist);
    case 'lite': return sqliteAt(fileFor(root, cfg.persist, 'sqlite'), { cleanup: !cfg.persist });
    case 'custom': return customStore(cfg.url);
    default: throw new Error(`unknown store kind: ${cfg.kind}`);
  }
}

// True when a store keeps comments/usage across restarts. The CLI/server warn
// when it's false so a comment isn't silently lost on exit.
export function isPersistent(config) {
  const cfg = config || { kind: 'memory' };
  if (cfg.kind === 'memory') return false;
  if (cfg.kind === 'custom') return true;             // the user's own DB
  return !!cfg.persist;                                // superlite/lite: only with --persist
}

function fileFor(root, persist, ext) {
  const dir = persist ? CACHE_DIR : EPHEMERAL_DIR;
  ensureDir(dir);
  return path.join(dir, `${keyFor(root)}.${ext}`);
}

/* ---------- shared in-memory comment/event layer (memory + superlite) ---------- */

// Holds comments + events in memory; calls flush() after each mutation so a
// disk-backed wrapper (superlite) can persist. memory passes a no-op flush.
function inMemoryDocs(flush = async () => {}) {
  const comments = new Map();   // id -> comment
  const events = [];            // append-only (stable ref - never reassigned)
  return {
    comments,
    events,
    async addComment(c) {
      const comment = newComment(c);
      comments.set(comment.id, comment);
      await flush();
      return comment;
    },
    async listComments(file) {
      const all = [...comments.values()].sort((a, b) => a.createdAt - b.createdAt);
      return file ? all.filter((c) => c.file === file) : all;
    },
    async updateComment(id, patch) {
      const c = comments.get(id);
      if (!c) return null;
      Object.assign(c, patch, { id: c.id });   // id is immutable
      await flush();
      return c;
    },
    async deleteComment(id) {
      const ok = comments.delete(id);
      await flush();
      return ok;
    },
    async recordEvent(e) {
      events.push(newEvent(e));
      await flush();
    },
    async usageStats() { return summarizeEvents(events); }
  };
}

/* ---------- backends ---------- */

function memoryStore() {
  const docs = inMemoryDocs();
  return {
    kind: 'memory',
    async load() { return null; },
    async save() {},
    async update() {},
    async remove() {},
    addComment: docs.addComment,
    listComments: docs.listComments,
    updateComment: docs.updateComment,
    deleteComment: docs.deleteComment,
    recordEvent: docs.recordEvent,
    usageStats: docs.usageStats,
    async close() {},
    describe() { return 'in-memory (ephemeral - nothing persisted)'; }
  };
}

function superliteStore(root, persist) {
  const file = fileFor(root, persist, 'json');
  const entries = new Map();   // path -> entry
  let loaded = false;
  const flush = () => fsp.writeFile(file, JSON.stringify({
    builtAt: Date.now(),
    entries: [...entries.values()],
    comments: [...docs.comments.values()],
    events: docs.events
  }));
  const docs = inMemoryDocs(() => (loaded ? flush() : Promise.resolve()));
  const ensure = async () => {
    if (loaded) return;
    try {
      const d = JSON.parse(await fsp.readFile(file, 'utf8'));
      for (const e of d.entries || []) entries.set(e.path, e);
      for (const c of d.comments || []) docs.comments.set(c.id, c);
      for (const ev of d.events || []) docs.events.push(ev);
    } catch { /* fresh */ }
    loaded = true;
  };
  return {
    kind: 'superlite',
    file,
    async load() { await ensure(); return entries.size ? { entries: [...entries.values()] } : null; },
    async save(es) { await ensure(); entries.clear(); for (const e of es) entries.set(e.path, e); await flush(); },
    async update(entry) { await ensure(); entries.set(entry.path, entry); await flush(); },
    async remove(p) { await ensure(); entries.delete(p); await flush(); },
    async addComment(c) { await ensure(); return docs.addComment(c); },
    async listComments(f) { await ensure(); return docs.listComments(f); },
    async updateComment(id, patch) { await ensure(); return docs.updateComment(id, patch); },
    async deleteComment(id) { await ensure(); return docs.deleteComment(id); },
    async recordEvent(e) { await ensure(); return docs.recordEvent(e); },
    async usageStats() { await ensure(); return docs.usageStats(); },
    async close({ keep } = {}) {
      if (!persist && !keep) { try { await fsp.unlink(file); } catch { /* gone */ } }
    },
    describe() { return `superlite/json (${persist ? 'persisted' : 'ephemeral'}) ${file}`; }
  };
}

// sqlite-backed store at an explicit file. cleanup=true removes the file on close.
function sqliteAt(file, { cleanup }) {
  let db = null;
  const toComment = (r) => ({
    id: r.id, file: r.file, anchor: JSON.parse(r.anchor || '{"type":"file"}'),
    body: r.body, author: r.author, createdAt: r.createdAt, resolved: !!r.resolved
  });
  const open = async () => {
    if (db) return db;
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(file);
    db.exec('CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, name TEXT, ext TEXT, mtime REAL, content TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, file TEXT, anchor TEXT, body TEXT, author TEXT, createdAt REAL, resolved INTEGER)');
    db.exec('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ts REAL, type TEXT, file TEXT, query TEXT, count INTEGER)');
    return db;
  };
  const writeComment = (d, c) => d
    .prepare('INSERT OR REPLACE INTO comments (id, file, anchor, body, author, createdAt, resolved) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(c.id, c.file, JSON.stringify(c.anchor), c.body, c.author, c.createdAt, c.resolved ? 1 : 0);
  return {
    kind: 'lite',
    file,
    async load() {
      const d = await open();
      const rows = d.prepare('SELECT path, name, ext, mtime, content FROM files').all();
      return rows.length ? { entries: rows } : null;
    },
    async save(entries) {
      const d = await open();
      d.exec('BEGIN');
      d.exec('DELETE FROM files');
      const ins = d.prepare('INSERT OR REPLACE INTO files (path, name, ext, mtime, content) VALUES (?, ?, ?, ?, ?)');
      for (const e of entries) ins.run(e.path, e.name, e.ext, e.mtime, e.content);
      d.exec('COMMIT');
    },
    async update(entry) {
      const d = await open();
      d.prepare('INSERT OR REPLACE INTO files (path, name, ext, mtime, content) VALUES (?, ?, ?, ?, ?)')
        .run(entry.path, entry.name, entry.ext, entry.mtime, entry.content);
    },
    async remove(p) {
      const d = await open();
      d.prepare('DELETE FROM files WHERE path = ?').run(p);
    },
    async addComment(c) {
      const d = await open();
      const comment = newComment(c);
      writeComment(d, comment);
      return comment;
    },
    async listComments(file) {
      const d = await open();
      const rows = file
        ? d.prepare('SELECT * FROM comments WHERE file = ? ORDER BY createdAt').all(file)
        : d.prepare('SELECT * FROM comments ORDER BY createdAt').all();
      return rows.map(toComment);
    },
    async updateComment(id, patch) {
      const d = await open();
      const row = d.prepare('SELECT * FROM comments WHERE id = ?').get(id);
      if (!row) return null;
      const c = { ...toComment(row), ...patch, id };
      writeComment(d, c);
      return c;
    },
    async deleteComment(id) {
      const d = await open();
      return d.prepare('DELETE FROM comments WHERE id = ?').run(id).changes > 0;
    },
    async recordEvent(e) {
      const d = await open();
      const ev = newEvent(e);
      d.prepare('INSERT INTO events (id, ts, type, file, query, count) VALUES (?, ?, ?, ?, ?, ?)')
        .run(ev.id, ev.ts, ev.type, ev.file, ev.query, ev.count);
    },
    async usageStats() {
      const d = await open();
      return summarizeEvents(d.prepare('SELECT type, file, query FROM events').all());
    },
    async close({ keep } = {}) {
      if (db) { db.close(); db = null; }
      if (cleanup && !keep) { try { await fsp.unlink(file); } catch { /* gone */ } }
    },
    describe() { return `lite/sqlite (${cleanup ? 'ephemeral' : 'persisted'}) ${file}`; }
  };
}

// custom: a connection URL the user supplies (--store-url / DATABASE_URL).
function customStore(url) {
  if (!url) throw new Error('custom store needs a connection URL (--store-url or DATABASE_URL)');
  let proto;
  try { proto = new URL(url).protocol.replace(':', ''); } catch { throw new Error(`invalid store URL: ${url}`); }

  if (proto === 'sqlite' || proto === 'file') {
    const f = url.replace(/^sqlite:\/\/|^file:\/\/|^sqlite:/, '') || ':memory:';
    return sqliteAt(path.resolve(f), { cleanup: false });   // the user's own file - never delete
  }
  if (proto === 'postgres' || proto === 'postgresql') return postgresStore(url);
  throw new Error(`unsupported store URL scheme "${proto}://" - use sqlite:// or postgres://`);
}

function postgresStore(url) {
  let client = null;
  const toComment = (r) => ({
    id: r.id, file: r.file,
    anchor: typeof r.anchor === 'string' ? JSON.parse(r.anchor) : (r.anchor || { type: 'file' }),
    body: r.body, author: r.author, createdAt: Number(r.createdat), resolved: !!r.resolved
  });
  const open = async () => {
    if (client) return client;
    let pg;
    try { pg = (await import('pg')).default; }
    catch { throw new Error('the postgres store needs the "pg" package - run: npm i pg'); }
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('CREATE TABLE IF NOT EXISTS projview_files (path TEXT PRIMARY KEY, name TEXT, ext TEXT, mtime DOUBLE PRECISION, content TEXT)');
    await client.query('CREATE TABLE IF NOT EXISTS projview_comments (id TEXT PRIMARY KEY, file TEXT, anchor TEXT, body TEXT, author TEXT, createdat DOUBLE PRECISION, resolved BOOLEAN)');
    await client.query('CREATE TABLE IF NOT EXISTS projview_events (id TEXT PRIMARY KEY, ts DOUBLE PRECISION, type TEXT, file TEXT, query TEXT, count INTEGER)');
    return client;
  };
  const writeComment = (c) => client.query(
    'INSERT INTO projview_comments (id, file, anchor, body, author, createdat, resolved) VALUES ($1, $2, $3, $4, $5, $6, $7)' +
      ' ON CONFLICT (id) DO UPDATE SET file = $2, anchor = $3, body = $4, author = $5, createdat = $6, resolved = $7',
    [c.id, c.file, JSON.stringify(c.anchor), c.body, c.author, c.createdAt, c.resolved]
  );
  return {
    kind: 'custom',
    async load() {
      const c = await open();
      const { rows } = await c.query('SELECT path, name, ext, mtime, content FROM projview_files');
      return rows.length ? { entries: rows } : null;
    },
    async save(entries) {
      const c = await open();
      await c.query('BEGIN');
      await c.query('DELETE FROM projview_files');
      for (const e of entries) {
        await c.query(
          'INSERT INTO projview_files (path, name, ext, mtime, content) VALUES ($1, $2, $3, $4, $5)' +
            ' ON CONFLICT (path) DO UPDATE SET name = $2, ext = $3, mtime = $4, content = $5',
          [e.path, e.name, e.ext, e.mtime, e.content]
        );
      }
      await c.query('COMMIT');
    },
    async update(entry) {
      const c = await open();
      await c.query(
        'INSERT INTO projview_files (path, name, ext, mtime, content) VALUES ($1, $2, $3, $4, $5)' +
          ' ON CONFLICT (path) DO UPDATE SET name = $2, ext = $3, mtime = $4, content = $5',
        [entry.path, entry.name, entry.ext, entry.mtime, entry.content]
      );
    },
    async remove(p) {
      const c = await open();
      await c.query('DELETE FROM projview_files WHERE path = $1', [p]);
    },
    async addComment(c) {
      await open();
      const comment = newComment(c);
      await writeComment(comment);
      return comment;
    },
    async listComments(file) {
      const c = await open();
      const { rows } = file
        ? await c.query('SELECT * FROM projview_comments WHERE file = $1 ORDER BY createdat', [file])
        : await c.query('SELECT * FROM projview_comments ORDER BY createdat');
      return rows.map(toComment);
    },
    async updateComment(id, patch) {
      const c = await open();
      const { rows } = await c.query('SELECT * FROM projview_comments WHERE id = $1', [id]);
      if (!rows.length) return null;
      const merged = { ...toComment(rows[0]), ...patch, id };
      await writeComment(merged);
      return merged;
    },
    async deleteComment(id) {
      const c = await open();
      return (await c.query('DELETE FROM projview_comments WHERE id = $1', [id])).rowCount > 0;
    },
    async recordEvent(e) {
      const c = await open();
      const ev = newEvent(e);
      await c.query('INSERT INTO projview_events (id, ts, type, file, query, count) VALUES ($1, $2, $3, $4, $5, $6)',
        [ev.id, ev.ts, ev.type, ev.file, ev.query, ev.count]);
    },
    async usageStats() {
      const c = await open();
      const { rows } = await c.query('SELECT type, file, query FROM projview_events');
      return summarizeEvents(rows);
    },
    async close() { if (client) { await client.end(); client = null; } },   // never drop the user's tables
    describe() { return `custom/postgres ${redact(url)}`; }
  };
}
