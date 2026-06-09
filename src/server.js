import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';

import { buildTree, isIgnoredDir, isPreviewable } from './walk.js';
import { renderFile } from './render.js';
import { buildIndex, updateFile, removeFile, search } from './search.js';
import { createStore, gitOrOsUser } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
// vendored client libs (mermaid bundle, hljs theme) live in public/vendor/ and
// are served by the static handler below - no node_modules resolution needed.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendFile(res, filePath, type) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type || MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
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
  return ['127.0.0.1', '::1', 'localhost', ''].includes(host);
}

// Read + JSON-parse a request body, capped to guard against abuse.
// Resolves null on parse error or oversize (handler treats that as a 400).
function readBody(req, limit = 1_000_000) {
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

  function broadcast(event, payload) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload || {})}\n\n`;
    for (const res of sseClients) res.write(frame);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

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
      sendJson(res, { root: path.basename(root) || root, tree: buildTree(root), version: VERSION, writable: allowWrites });
      return;
    }

    // --- search (fuzzy filenames + full-text contents) ---
    if (pathname === '/api/search') {
      const q = url.searchParams.get('q') || '';
      const results = search(q);
      if (q.trim()) { try { await store.recordEvent({ type: 'search', query: q.trim(), count: results.files.length + results.content.length }); } catch { /* usage is best-effort */ } }
      sendJson(res, results);
      return;
    }

    // --- rendered file contents ---
    if (pathname === '/api/file') {
      const rel = url.searchParams.get('p') || '';
      const abs = resolveInRoot(root, rel);
      if (!abs || !isPreviewable(abs)) {
        sendJson(res, { error: 'invalid path' }, 400);
        return;
      }
      try {
        const content = await fsp.readFile(abs, 'utf8');
        try { await store.recordEvent({ type: 'view', file: rel }); } catch { /* usage is best-effort */ }
        sendJson(res, { path: rel, ext: path.extname(abs).toLowerCase(), html: renderFile(path.extname(abs).toLowerCase(), content) });
      } catch {
        sendJson(res, { error: 'not found' }, 404);
      }
      return;
    }

    // --- comments: list (GET) + create (POST) ---
    if (pathname === '/api/comments') {
      if (req.method === 'POST') {
        if (!allowWrites) return denyWrite(res);
        const body = await readBody(req);
        if (!body || !body.file || !body.body) { sendJson(res, { error: 'file and body are required' }, 400); return; }
        const c = await store.addComment({ file: body.file, body: body.body, anchor: body.anchor, author: body.author || localAuthor });
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
        if (typeof body.body === 'string') patch.body = body.body;
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
  });

  // --- file watcher -> live reload ---
  const store = createStore(storeConfig, root);
  const indexInfo = await buildIndex(root, store);   // load-or-build the search index

  // file watcher -> keep the in-memory index, the persisted store, AND the
  // browser in sync as files change during a session
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => p.split(path.sep).some(isIgnoredDir)
  });
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const touch = async (p, event) => {
    if (!isPreviewable(p)) return;
    const entry = await updateFile(rel(p));   // refresh in-memory index, get the entry
    if (entry) await store.update(entry);     // mirror the change into the store
    broadcast(event, { path: rel(p) });
  };
  watcher
    .on('change', (p) => touch(p, 'change'))
    .on('add', (p) => touch(p, 'tree'))
    .on('unlink', async (p) => {
      if (!isPreviewable(p)) return;
      removeFile(rel(p));
      await store.remove(rel(p));
      broadcast('tree');
    })
    .on('addDir', () => broadcast('tree'))
    .on('unlinkDir', () => broadcast('tree'));
  const listenPort = await listenWithRetry(server, port, host);

  const close = () => new Promise((resolve) => {
    watcher.close();
    for (const res of sseClients) res.end();
    Promise.resolve(store.close()).finally(() => server.close(() => resolve()));
  });

  return {
    server,
    port: listenPort,
    close,
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
