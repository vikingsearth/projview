import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';

import { buildTree, isIgnoredDir, isPreviewable } from './walk.js';
import { renderFile } from './render.js';
import { buildIndex, updateFile, removeFile, search } from './search.js';
import { createStore } from './store.js';

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

export async function startServer(root, { port = 4321, host = '127.0.0.1', store: storeConfig } = {}) {
  const sseClients = new Set();

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
      sendJson(res, { root: path.basename(root) || root, tree: buildTree(root), version: VERSION });
      return;
    }

    // --- search (fuzzy filenames + full-text contents) ---
    if (pathname === '/api/search') {
      sendJson(res, search(url.searchParams.get('q') || ''));
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
        sendJson(res, { path: rel, ext: path.extname(abs).toLowerCase(), html: renderFile(path.extname(abs).toLowerCase(), content) });
      } catch {
        sendJson(res, { error: 'not found' }, 404);
      }
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
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => p.split(path.sep).some(isIgnoredDir)
  });
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  watcher
    .on('change', (p) => {
      if (!isPreviewable(p)) return;
      updateFile(rel(p));
      broadcast('change', { path: rel(p) });
    })
    .on('add', (p) => { if (isPreviewable(p)) { updateFile(rel(p)); broadcast('tree'); } })
    .on('unlink', (p) => { if (isPreviewable(p)) { removeFile(rel(p)); broadcast('tree'); } })
    .on('addDir', () => broadcast('tree'))
    .on('unlinkDir', () => broadcast('tree'));

  const store = createStore(storeConfig, root);
  const indexInfo = await buildIndex(root, store);   // load-or-build the search index
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
