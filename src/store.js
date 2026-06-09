/* pluggable persistence for the index.
 *
 * A Store persists indexed entries so a re-spawn can warm-start. Backends:
 *   memory    - no persistence (ephemeral default; nothing written)
 *   superlite - a JSON file
 *   lite      - sqlite via node:sqlite (built-in)
 *   custom    - a connection URL: sqlite://<file> or postgres://<...> (lazy `pg`)
 *
 * An entry is { path, name, ext, mtime, content }. Everything above the store
 * stays storage-agnostic - search still runs in memory over loaded entries.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

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

function fileFor(root, persist, ext) {
  const dir = persist ? CACHE_DIR : EPHEMERAL_DIR;
  ensureDir(dir);
  return path.join(dir, `${keyFor(root)}.${ext}`);
}

/* ---------- backends ---------- */

function memoryStore() {
  return {
    kind: 'memory',
    async load() { return null; },
    async save() {},
    async update() {},
    async remove() {},
    async close() {},
    describe() { return 'in-memory (ephemeral - nothing persisted)'; }
  };
}

function superliteStore(root, persist) {
  const file = fileFor(root, persist, 'json');
  let map = null;   // path -> entry, lazily loaded
  const ensure = async () => {
    if (map) return map;
    try {
      const d = JSON.parse(await fsp.readFile(file, 'utf8'));
      map = new Map((d.entries || []).map((e) => [e.path, e]));
    } catch { map = new Map(); }
    return map;
  };
  const flush = () => fsp.writeFile(file, JSON.stringify({ builtAt: Date.now(), entries: [...map.values()] }));
  return {
    kind: 'superlite',
    file,
    async load() {
      const m = await ensure();
      return m.size ? { entries: [...m.values()] } : null;
    },
    async save(entries) {
      map = new Map(entries.map((e) => [e.path, e]));
      await flush();
    },
    async update(entry) { (await ensure()).set(entry.path, entry); await flush(); },
    async remove(p) { (await ensure()).delete(p); await flush(); },
    async close({ keep } = {}) {
      if (!persist && !keep) { try { await fsp.unlink(file); } catch { /* gone */ } }
    },
    describe() { return `superlite/json (${persist ? 'persisted' : 'ephemeral'}) ${file}`; }
  };
}

// sqlite-backed store at an explicit file. cleanup=true removes the file on close.
function sqliteAt(file, { cleanup }) {
  let db = null;
  const open = async () => {
    if (db) return db;
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(file);
    db.exec('CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, name TEXT, ext TEXT, mtime REAL, content TEXT)');
    return db;
  };
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
  const open = async () => {
    if (client) return client;
    let pg;
    try { pg = (await import('pg')).default; }
    catch { throw new Error('the postgres store needs the "pg" package - run: npm i pg'); }
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query(
      'CREATE TABLE IF NOT EXISTS projview_files (path TEXT PRIMARY KEY, name TEXT, ext TEXT, mtime DOUBLE PRECISION, content TEXT)'
    );
    return client;
  };
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
    async close() { if (client) { await client.end(); client = null; } },   // never drop the user's table
    describe() { return `custom/postgres ${redact(url)}`; }
  };
}
