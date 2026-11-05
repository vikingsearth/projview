import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';

import { buildTree, isHiddenPath, isIgnoredPath, isPreviewable } from './walk.js';
import { renderFile, renderSource, renderBinary } from './render.js';
import { readText, encodeLike } from './text.js';
import { buildIndex, updateFile, removeFile, search, indexedSource } from './search.js';
import { createStore, gitOrOsUser, isPersistent, VERSION_LIMIT } from './store.js';
import { codeLang } from '../public/codetypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
// vendored client libs (mermaid bundle, hljs theme) live in public/vendor/ and
// are served by the static handler below - no node_modules resolution needed.

// Earlier versions above this size aren't kept (generated bundles, data dumps).
const VERSION_MAX_BYTES = 5_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

// The page renders markdown with raw HTML allowed, so a file can carry markup.
// No inline script runs and nothing loads from elsewhere: an <img onerror> or a
// javascript: link in a README stays inert instead of reaching /api/source.
// Inline styles stay allowed - the code view and mermaid set them.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:", "connect-src 'self'", "object-src 'none'", "frame-src 'none'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"
].join('; ');

function sendFile(res, filePath, type) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    const headers = { 'Content-Type': type || MIME[path.extname(filePath)] || 'application/octet-stream' };
    if (path.extname(filePath) === '.html') headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    res.end(data);
  });
}

// Why a new comment's body is unacceptable, or null. Strings only (a stored
// object would break the drawer for that file) and bounded sizes.
const COMMENT_MAX = 20_000;
const ANCHOR_TYPES = new Set(['text', 'heading', 'file']);
const ANCHOR_FIELDS = new Set(['exact', 'prefix', 'suffix', 'section', 'id']);
function commentError(b) {
  if (!b) return 'a JSON body is required';
  if (typeof b.file !== 'string' || !b.file) return 'file must be a path';
  if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > COMMENT_MAX) return `body must be 1-${COMMENT_MAX} characters`;
  if (b.author !== undefined && (typeof b.author !== 'string' || b.author.length > 200)) return 'author must be a short string';
  if (b.anchor != null) {
    const a = b.anchor;
    if (typeof a !== 'object' || Array.isArray(a) || !ANCHOR_TYPES.has(a.type)) return 'anchor must be a text, heading or file anchor';
    // the drawer calls string methods on these, so a number or object breaks it for the file
    for (const k of Object.keys(a)) if (k !== 'type' && (!ANCHOR_FIELDS.has(k) || (a[k] !== null && typeof a[k] !== 'string'))) return `anchor.${k} must be a known string field`;
    if (JSON.stringify(a).length > 4_000) return 'anchor is too large';
  }
  return null;
}

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(obj));
}

// Resolve a client-supplied relative path safely inside root.
function resolveInRoot(root, relPath) {
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

// Comment writes are allowed only when bound to loopback. A non-loopback bind
// (e.g. 0.0.0.0 on the launchpad / in Docker) is treated as exposed -> read-only.
export function isLoopbackHost(host) {
  return ['127.0.0.1', '::1', 'localhost'].includes(host);
}

// The Host header of a request that may write. A DNS-rebinding page reaches a
// loopback port under its own domain, so the bind address alone isn't enough.
export function isLoopbackHostHeader(hostHeader) {
  const name = (hostHeader || '').replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1').toLowerCase();
  return ['127.0.0.1', '::1', 'localhost'].includes(name) || name.endsWith('.localhost');
}

// Read + JSON-parse a request body, capped to guard against abuse.
// Resolves null on parse error, oversize, or a non-JSON content type (handler
// treats that as a 400) - a cross-site form or no-cors fetch can only send
// text/plain or form types, so requiring JSON keeps other sites from writing.
function readBody(req, limit = 1_000_000) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) { req.resume(); return Promise.resolve(null); }
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); resolve(null); return; }
      data += chunk;
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

export async function startServer(root, { port = 4321, host = '127.0.0.1', store: storeConfig } = {}) {
  const sseClients = new Set();
  const allowWrites = isLoopbackHost(host);   // comments are read-only on an exposed host
  const denyWrite = (res) => sendJson(res, { error: 'read-only: projview is exposed on a non-loopback host' }, 403);
  const localAuthor = gitOrOsUser();          // default author for UI-created comments
  // code and dot-dirs are shown on a local bind only: an exposed host serves docs
  // + data, so scripts, source and tool config (and the credentials they tend to
  // hold) stay off the network
  const walkOpts = { code: allowWrites, hidden: allowWrites };

  // A client path that may be read (or, behind the write guards, saved): inside
  // root, a previewable type, and not under a dir the tree hides. Else null.
  // Checked on the real path too, so a symlink named notes.md can't reach a file
  // outside the root (e.g. ~/.zshrc) - for reads, and above all for saves.
  const realRoot = fs.realpathSync(root);
  const editablePath = async (rel) => {
    const abs = resolveInRoot(root, rel || '');
    if (!abs || !isPreviewable(abs, walkOpts) || isHiddenPath(path.relative(root, abs), walkOpts)) return null;
    let real;
    try { real = await fsp.realpath(abs); } catch { return abs; }   // missing: the caller answers 404
    // the target must pass the same rules as the name: a notes.md symlink to
    // .env, a secret dir or (on an exposed host) code is refused like the target
    const realRel = path.relative(realRoot, real);
    if (!resolveInRoot(realRoot, realRel) || !isPreviewable(real, walkOpts) || isHiddenPath(realRel, walkOpts)) return null;
    return abs;
  };
  // Code files are view-only: judged on the file a save would really write, so a
  // symlink named notes.md can't reach app.js. A missing file falls back to its name.
  const isViewOnly = async (abs) => !!(codeLang(abs) || codeLang(await fsp.realpath(abs).catch(() => abs)));

  function broadcast(event, payload) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload || {})}\n\n`;
    for (const res of sseClients) res.write(frame);
  }

  // usage is recorded on a local bind only: on an exposed host it would grow
  // without bound and show one visitor's searches to the next
  const record = async (event) => {
    if (!allowWrites) return;
    try { await store.recordEvent(event); } catch { /* usage is best-effort */ }
  };

  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // a DNS-rebound page reaches a loopback port under its own domain and is
    // then same-origin: on a local bind every route - reads too - answers local
    // names only. (An exposed host is reached by its real name, and serves no
    // code, dot-dirs or writes.)
    if (allowWrites && !isLoopbackHostHeader(req.headers.host)) {
      sendJson(res, { error: 'projview answers local host names only' }, 403);
      return;
    }

    // --- live-reload stream ---
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write('event: ready\ndata: {}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // --- file tree ---
    if (pathname === '/api/tree') {
      sendJson(res, { root: path.basename(root) || root, tree: buildTree(root, walkOpts), version: VERSION, writable: allowWrites, persistent: isPersistent(storeConfig) });
      return;
    }

    // --- search (fuzzy filenames + full-text contents) ---
    if (pathname === '/api/search') {
      const q = url.searchParams.get('q') || '';
      const results = search(q);
      if (q.trim()) record({ type: 'search', query: q.trim(), count: results.files.length + results.content.length });
      sendJson(res, results);
      return;
    }

    // --- rendered file contents ---
    if (pathname === '/api/file') {
      const rel = url.searchParams.get('p') || '';
      const abs = await editablePath(rel);
      if (!abs) {
        sendJson(res, { error: 'invalid path' }, 400);
        return;
      }
      try {
        const content = await readText(abs);   // null: binary
        record({ type: 'view', file: rel });   // not awaited: usage never holds up a read
        const ext = path.extname(abs).toLowerCase();
        const raw = url.searchParams.get('view') === 'raw';   // md / mmd source instead of the render
        const html = content === null ? renderBinary() : raw ? renderSource(ext, content) : renderFile(ext, content, path.basename(abs));
        sendJson(res, { path: rel, ext, html });
      } catch {
        sendJson(res, { error: 'not found' }, 404);
      }
      return;
    }

    // --- live preview: render unsaved editor text (never touches disk) ---
    // the editor's endpoint, so local binds only: on an exposed host it was an
    // unauthenticated way to make the server render (and block on) any text
    if (pathname === '/api/preview' && req.method === 'POST') {
      if (!allowWrites) return denyWrite(res);
      const body = await readBody(req, 2_000_000);
      if (!body || typeof body.path !== 'string' || typeof body.content !== 'string' || !isPreviewable(body.path)) {
        sendJson(res, { error: 'path and content are required' }, 400);
        return;
      }
      sendJson(res, { html: renderFile(path.extname(body.path).toLowerCase(), body.content, path.basename(body.path)) });
      return;
    }

    // --- raw source: read (GET) + save (PUT) for the in-browser editor ---
    if (pathname === '/api/source') {
      if (req.method === 'PUT') {
        if (!allowWrites) return denyWrite(res);
        // a DNS-rebound page would arrive with its own Host; only a local name may write
        if (!isLoopbackHostHeader(req.headers.host)) { sendJson(res, { error: 'writes need a localhost Host header' }, 403); return; }
        const body = await readBody(req, 10_000_000);
        if (!body || typeof body.path !== 'string' || typeof body.content !== 'string') { sendJson(res, { error: 'path and content are required' }, 400); return; }
        const abs = await editablePath(body.path);
        if (!abs) { sendJson(res, { error: 'invalid path' }, 400); return; }
        if (await isViewOnly(abs)) { sendJson(res, { error: 'read-only: code files are view-only' }, 403); return; }
        let stat;
        try { stat = await fsp.stat(abs); } catch { sendJson(res, { error: 'not found' }, 404); return; }
        // optimistic concurrency: refuse to clobber a file that changed since it was opened
        if (!body.force && body.mtime !== stat.mtimeMs) { sendJson(res, { error: 'changed on disk', mtime: stat.mtimeMs }, 409); return; }
        try {
          await fsp.writeFile(abs, await encodeLike(abs, body.content));   // keeps a UTF-16 file UTF-16
          sendJson(res, { path: body.path, mtime: (await fsp.stat(abs)).mtimeMs });
        } catch (err) {
          sendJson(res, { error: `could not save: ${err.code || err.message}` }, 500);
        }
        return;
      }
      const rel = url.searchParams.get('p') || '';
      const abs = await editablePath(rel);
      if (!abs) { sendJson(res, { error: 'invalid path' }, 400); return; }
      try {
        const [content, stat] = await Promise.all([readText(abs), fsp.stat(abs)]);   // decoded like /api/file
        if (content === null) { sendJson(res, { error: 'binary file - not editable' }, 415); return; }
        sendJson(res, { path: rel, content, mtime: stat.mtimeMs });
      } catch {
        sendJson(res, { error: 'not found' }, 404);
      }
      return;
    }

    // --- earlier versions of a file: list (newest first) + fetch one ---
    // read-only everywhere; restoring goes through PUT /api/source and its guards
    if (pathname === '/api/versions') {
      const rel = url.searchParams.get('p') || '';
      if (!(await editablePath(rel))) { sendJson(res, { error: 'invalid path' }, 400); return; }
      sendJson(res, { path: rel, limit: VERSION_LIMIT, versions: await store.listVersions(rel) });
      return;
    }
    // ?render=1 adds the version rendered like its file, for the history pane -
    // server-side, so an exposed host (no /api/preview) can show history too
    if (pathname.startsWith('/api/versions/')) {
      const v = await store.getVersion(decodeURIComponent(pathname.slice('/api/versions/'.length)));
      if (!v || !(await editablePath(v.file))) { sendJson(res, { error: 'not found' }, 404); return; }
      if (url.searchParams.get('render') !== '1') { sendJson(res, v); return; }
      sendJson(res, { ...v, html: renderFile(path.extname(v.file).toLowerCase(), v.content, path.basename(v.file)) });
      return;
    }

    // --- comments: list (GET) + create (POST) ---
    if (pathname === '/api/comments') {
      if (req.method === 'POST') {
        if (!allowWrites) return denyWrite(res);
        const body = await readBody(req);
        const err = commentError(body);
        if (err) { sendJson(res, { error: err }, 400); return; }
        const target = await editablePath(body.file);
        if (!target || !(await fsp.stat(target).then((s) => s.isFile(), () => false))) { sendJson(res, { error: 'not a file projview shows' }, 400); return; }
        const c = await store.addComment({ file: body.file, body: body.body, anchor: body.anchor ?? null, author: body.author || localAuthor });
        broadcast('comments', { file: c.file });
        sendJson(res, c, 201);
        return;
      }
      sendJson(res, await store.listComments(url.searchParams.get('file') || undefined));
      return;
    }

    // --- a single comment by id: resolve/edit (PATCH) + delete (DELETE) ---
    if (pathname.startsWith('/api/comments/')) {
      const id = decodeURIComponent(pathname.slice('/api/comments/'.length));
      if (req.method === 'PATCH') {
        if (!allowWrites) return denyWrite(res);
        const body = await readBody(req);
        if (!body) { sendJson(res, { error: 'invalid body' }, 400); return; }
        const patch = {};
        if (typeof body.resolved === 'boolean') patch.resolved = body.resolved;
        if (typeof body.body === 'string') {
          if (!body.body.trim() || body.body.length > COMMENT_MAX) { sendJson(res, { error: `body must be 1-${COMMENT_MAX} characters` }, 400); return; }
          patch.body = body.body;
        }
        const c = await store.updateComment(id, patch);
        if (!c) { sendJson(res, { error: 'not found' }, 404); return; }
        broadcast('comments', { file: c.file });
        sendJson(res, c);
        return;
      }
      if (req.method === 'DELETE') {
        if (!allowWrites) return denyWrite(res);
        if (!(await store.deleteComment(id))) { sendJson(res, { error: 'not found' }, 404); return; }
        broadcast('comments', {});
        sendJson(res, { deleted: id });
        return;
      }
      sendJson(res, { error: 'use PATCH or DELETE' }, 405);
      return;
    }

    // --- usage stats ---
    if (pathname === '/api/usage') {
      if (!allowWrites) { sendJson(res, { error: 'usage is local-only' }, 403); return; }
      sendJson(res, await store.usageStats());
      return;
    }

    // --- static SPA assets (incl. /vendor/*) ---
    const assetName = pathname === '/' ? 'index.html' : pathname.slice(1);
    const assetPath = resolveInRoot(PUBLIC_DIR, assetName);
    if (assetPath && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
      sendFile(res, assetPath);
      return;
    }

    res.writeHead(404).end('Not found');
  };
  // one bad request (a store error, a body of the wrong shape) answers 500 -
  // it never takes the whole server down
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(`projview: ${req.method} ${req.url} failed - ${err?.message || err}`);
      if (!res.headersSent) sendJson(res, { error: 'internal error' }, 500);
      else res.end();
    });
  });

  // --- file watcher -> live reload ---
  const store = createStore(storeConfig, root);

  // file watcher -> keep the in-memory index, the persisted store, AND the
  // browser in sync as files change during a session. Started before the index
  // build so its initial scan (the slow part on big trees) overlaps it.
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    // judged relative to the root: a root that itself sits under a dot-dir
    // (~/.config/..., a worktree in .claude/) is still watched
    ignored: (p) => isIgnoredPath(path.relative(root, p), walkOpts)
  });
  // resolves once the scan is done; changes before then aren't seen. Not awaited
  // here so startup stays fast - tests (and anything that must not miss an
  // early change) wait on it via the returned `watching`.
  const watching = new Promise((resolve) => watcher.once('ready', resolve));
  const indexInfo = await buildIndex(root, store, walkOpts);   // load-or-build the search index
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  // keep text a change replaced (or a delete removed) as a version - any source
  // counts: projview's editor, an IDE, git, agents
  // (not code files: they're view-only, so there's nothing to restore to)
  const keepVersion = async (file, before) => {
    if (!before || Buffer.byteLength(before.content) > VERSION_MAX_BYTES || await isViewOnly(path.join(root, file))) return;
    try { await store.addVersion({ file, content: before.content, mtime: before.mtime }); } catch { /* versions are best-effort */ }
  };
  // `quiet`: a re-check - stay silent unless the text really moved on
  const touch = async (p, event, quiet = false) => {
    // same rule as the API: previewable, not hidden, real path inside the root
    // (a symlink to an outside file is neither indexed nor versioned)
    if (!(await editablePath(rel(p)))) return;
    const before = indexedSource(rel(p));     // the text this change replaces
    if (quiet && before && before.mtime === (await fsp.stat(p).catch(() => null))?.mtimeMs) return;
    const entry = await updateFile(rel(p));   // refresh in-memory index, get the entry
    const changed = !!entry && (!before || before.content !== entry.content);
    if (quiet && !changed) return;
    if (entry) await store.update(entry);     // mirror the change into the store
    if (entry && before && before.content !== entry.content) await keepVersion(rel(p), before);
    broadcast(event, { path: rel(p) });
  };
  const unlink = async (p) => {
    if (!isPreviewable(p)) return;
    await keepVersion(rel(p), indexedSource(rel(p)));   // a delete is a change too
    removeFile(rel(p));
    await store.remove(rel(p));
    broadcast('tree');
  };
  // one file's events run in order: concurrent handlers would read the same
  // "before" text, losing the in-between version of two quick changes
  const queues = new Map();
  const serial = (fn) => (p, ...args) => {
    const next = (queues.get(p) || Promise.resolve()).then(() => fn(p, ...args)).catch(() => {});
    queues.set(p, next);
    next.then(() => { if (queues.get(p) === next) queues.delete(p); });
  };
  // chokidar drops (not defers) a change landing within 50ms of the last one
  // it emitted for that path, so a quick second write - a save right after an
  // outside edit - was never seen: no index update, no version, no reload.
  // Re-check each changed file once that window has passed.
  const onChange = serial((p, quiet) => touch(p, 'change', quiet));
  const rechecks = new Map();
  const changed = (p) => {
    onChange(p);
    clearTimeout(rechecks.get(p));
    rechecks.set(p, setTimeout(() => { rechecks.delete(p); onChange(p, true); }, 80));
  };
  watcher
    .on('change', changed)
    .on('add', serial((p) => touch(p, 'tree')))
    .on('unlink', serial(unlink))
    .on('addDir', () => broadcast('tree'))
    .on('unlinkDir', () => broadcast('tree'));
  const listenPort = await listenWithRetry(server, port, host);

  const close = () => new Promise((resolve) => {
    watcher.close();
    for (const t of rechecks.values()) clearTimeout(t);
    for (const res of sseClients) res.end();
    Promise.resolve(store.close()).finally(() => server.close(() => resolve()));
  });

  return {
    server,
    port: listenPort,
    close,
    watching,
    writable: allowWrites,
    storeInfo: { describe: store.describe(), warm: indexInfo.warm, reindexed: indexInfo.reindexed, total: indexInfo.total }
  };
}

// Try `port`, then climb until one is free (give up after a sane range).
function listenWithRetry(server, port, host = '127.0.0.1', attempts = 20) {
  return new Promise((resolve, reject) => {
    let current = port;
    let left = attempts;
    const tryListen = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && left-- > 0) {
          current += 1;
          tryListen();
        } else {
          reject(err);
        }
      });
      server.listen(current, host, () => resolve(current));
    };
    tryListen();
  });
}
