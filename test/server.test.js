import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startServer, isLoopbackHost, isLoopbackHostHeader } from '../src/server.js';
import { createStore } from '../src/store.js';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const jget = async (u, opts) => (await fetch(u, opts)).json();

test('server records view + search events into the store (the usage producer)', async () => {
  const db = path.join(os.tmpdir(), `projview-srv-${process.pid}.sqlite`);
  const url = `sqlite://${db}`;
  const { port, close } = await startServer(DOCS, { port: 41730, host: '127.0.0.1', store: { kind: 'custom', url } });
  const base = `http://127.0.0.1:${port}`;

  await fetch(`${base}/api/search?q=mermaid`);   // -> a 'search' event
  await fetch(`${base}/api/file?p=README.md`);    // -> a 'view' event
  await close();                                   // server's connection closed; events are committed

  // read back from a fresh connection to the same DB
  const probe = createStore({ kind: 'custom', url }, DOCS);
  const u = await probe.usageStats();
  await probe.close();
  rmSync(db, { force: true });

  assert.equal(u.total, 2);
  assert.equal(u.byType.search, 1);
  assert.equal(u.byType.view, 1);
  assert.deepEqual(u.recentSearches, ['mermaid']);
  assert.equal(u.topFiles[0].file, 'README.md');
});

/* ---------- comment HTTP endpoints (Phase 3b) ---------- */

test('isLoopbackHost gates writes to local binds', () => {
  for (const h of ['127.0.0.1', '::1', 'localhost', '']) assert.equal(isLoopbackHost(h), true);
  for (const h of ['0.0.0.0', '192.168.1.10', '::']) assert.equal(isLoopbackHost(h), false);
});

test('comment endpoints: POST/GET/PATCH/DELETE lifecycle over HTTP', async () => {
  const db = path.join(os.tmpdir(), `projview-srv-c-${process.pid}.sqlite`);
  const { port, close, writable } = await startServer(DOCS, { port: 41740, host: '127.0.0.1', store: { kind: 'custom', url: `sqlite://${db}` } });
  const base = `http://127.0.0.1:${port}`;
  assert.equal(writable, true);
  assert.equal((await jget(`${base}/api/tree`)).writable, true);   // tree advertises it

  const post = (body) => jget(`${base}/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const created = await post({ file: 'README.md', body: 'http note', anchor: { type: 'heading', id: 'pv-overview' }, author: 'claude' });
  assert.ok(created.id);
  assert.equal(created.author, 'claude');

  const list = await jget(`${base}/api/comments?file=README.md`);
  assert.equal(list.length, 1);
  assert.equal(list[0].body, 'http note');

  const patched = await jget(`${base}/api/comments/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved: true }) });
  assert.equal(patched.resolved, true);

  assert.equal((await fetch(`${base}/api/comments/${created.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await jget(`${base}/api/comments`)).length, 0);

  assert.equal((await fetch(`${base}/api/comments/nope`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${base}/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);

  await close();
  rmSync(db, { force: true });
});

test('GET /api/usage returns the aggregate shape over HTTP', async () => {
  const db = path.join(os.tmpdir(), `projview-srv-u-${process.pid}.sqlite`);
  const { port, close } = await startServer(DOCS, { port: 41750, host: '127.0.0.1', store: { kind: 'custom', url: `sqlite://${db}` } });
  await fetch(`http://127.0.0.1:${port}/api/search?q=mermaid`);
  const u = await jget(`http://127.0.0.1:${port}/api/usage`);
  assert.equal(u.byType.search, 1);
  assert.deepEqual(u.recentSearches, ['mermaid']);
  await close();
  rmSync(db, { force: true });
});

test('POST without an author defaults to the git/OS user (not anonymous)', async () => {
  const db = path.join(os.tmpdir(), `projview-srv-a-${process.pid}.sqlite`);
  const { port, close } = await startServer(DOCS, { port: 41760, host: '127.0.0.1', store: { kind: 'custom', url: `sqlite://${db}` } });
  const c = await jget(`http://127.0.0.1:${port}/api/comments`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file: 'README.md', body: 'no author given' })
  });
  assert.ok(typeof c.author === 'string' && c.author.length > 0);   // server filled it in
  await close();
  rmSync(db, { force: true });
});

test('/api/file refuses files under dirs the tree hides (dot-dirs, node_modules)', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'projview-hidden-'));
  for (const [rel, body] of [['.secret/creds.json', '{"token":"x"}'], ['node_modules/pkg/package.json', '{}'], ['ok.json', '{}']]) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  const { port, close } = await startServer(root, { port: 41750, host: '127.0.0.1', store: { kind: 'memory' } });
  const status = async (p) => (await fetch(`http://127.0.0.1:${port}/api/file?p=${encodeURIComponent(p)}`)).status;
  try {
    assert.equal(await status('ok.json'), 200);
    assert.equal(await status('.secret/creds.json'), 400);
    assert.equal(await status('node_modules/pkg/package.json'), 400);
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---------- source editor endpoint ---------- */

test('isLoopbackHostHeader accepts local names only', () => {
  for (const h of ['localhost:4321', '127.0.0.1:4321', '[::1]:4321', 'localhost', 'docs.localhost:80']) assert.equal(isLoopbackHostHeader(h), true, h);
  for (const h of ['evil.example:4321', '192.168.1.10:4321', '', undefined, 'localhost.evil.example']) assert.equal(isLoopbackHostHeader(h), false, String(h));
});

// raw request so the Host header can be forged (fetch won't let us set it)
function rawPut(port, body, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ port, host: '127.0.0.1', method: 'PUT', path: '/api/source',
      headers: { host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function withRoot(files, fn, opts = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'projview-src-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  const srv = await startServer(root, { port: opts.port, host: opts.host || '127.0.0.1', store: { kind: 'memory' } });
  try { await fn({ root, port: srv.port, watching: srv.watching }); } finally { await srv.close(); rmSync(root, { recursive: true, force: true }); }
}

test('GET /api/source returns the raw text and its mtime', async () => {
  await withRoot({ 'a.yaml': 'k: v\n' }, async ({ port }) => {
    const r = await jget(`http://127.0.0.1:${port}/api/source?p=a.yaml`);
    assert.equal(r.content, 'k: v\n');
    assert.equal(typeof r.mtime, 'number');
  }, { port: 41760 });
});

test('PUT /api/source saves when the mtime matches, refuses a stale one, and force overrides', async () => {
  await withRoot({ 'doc.md': '# old\n' }, async ({ root, port }) => {
    const { mtime } = await jget(`http://127.0.0.1:${port}/api/source?p=doc.md`);
    const saved = await rawPut(port, { path: 'doc.md', content: '# new\n', mtime });
    assert.equal(saved.status, 200);
    assert.equal(readFileSync(path.join(root, 'doc.md'), 'utf8'), '# new\n');

    const stale = await rawPut(port, { path: 'doc.md', content: '# lost\n', mtime });   // mtime from before the save
    assert.equal(stale.status, 409);
    assert.equal(readFileSync(path.join(root, 'doc.md'), 'utf8'), '# new\n');

    const forced = await rawPut(port, { path: 'doc.md', content: '# forced\n', mtime, force: true });
    assert.equal(forced.status, 200);
    assert.equal(readFileSync(path.join(root, 'doc.md'), 'utf8'), '# forced\n');
  }, { port: 41770 });
});

test('PUT /api/source refuses paths outside what the viewer shows', async () => {
  await withRoot({ 'ok.md': 'x', 'notes.txt': 'x', '.secret/creds.json': '{}' }, async ({ port }) => {
    for (const p of ['notes.txt', '.secret/creds.json', '../escape.md', 'missing/../../x.md']) {
      const r = await rawPut(port, { path: p, content: 'pwned', force: true });
      assert.equal(r.status, 400, p);
    }
    assert.equal((await rawPut(port, { path: 'gone.md', content: 'x', force: true })).status, 404);
  }, { port: 41780 });
});

test('PUT /api/source refuses a non-local Host header (DNS rebinding)', async () => {
  await withRoot({ 'doc.md': 'x' }, async ({ root, port }) => {
    const r = await rawPut(port, { path: 'doc.md', content: 'pwned', force: true }, `evil.example:${port}`);
    assert.equal(r.status, 403);
    assert.equal(readFileSync(path.join(root, 'doc.md'), 'utf8'), 'x');
  }, { port: 41790 });
});

test('PUT /api/source is read-only when bound to a non-loopback host', async () => {
  await withRoot({ 'doc.md': 'x' }, async ({ root, port }) => {
    const r = await rawPut(port, { path: 'doc.md', content: 'pwned', force: true });
    assert.equal(r.status, 403);
    assert.equal(readFileSync(path.join(root, 'doc.md'), 'utf8'), 'x');
  }, { port: 41800, host: '0.0.0.0' });
});

test('GET /api/file?view=raw returns the source view instead of the render', async () => {
  await withRoot({ 'doc.md': '# Hi\n' }, async ({ port }) => {
    const rendered = await jget(`http://127.0.0.1:${port}/api/file?p=doc.md`);
    const raw = await jget(`http://127.0.0.1:${port}/api/file?p=doc.md&view=raw`);
    assert.match(rendered.html, /<h1/);
    assert.match(raw.html, /code-view/);
    assert.match(raw.html, /# Hi/);
  }, { port: 41810 });
});

test('POST /api/preview renders unsaved text without touching the file', async () => {
  await withRoot({ 'doc.md': '# on disk\n' }, async ({ root, port }) => {
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r = await (await post({ path: 'doc.md', content: '# Draft\n\n- one\n' })).json();
    assert.match(r.html, /<h1[^>]*>Draft<\/h1>/);
    assert.match(r.html, /<li>one<\/li>/);
    assert.equal(readFileSync(path.join(root, 'doc.md'), 'utf8'), '# on disk\n');
    assert.equal((await post({ path: 'notes.txt', content: 'x' })).status, 400);
  }, { port: 41820 });
});

test('a symlink inside the root that points outside it can be neither read nor saved', async () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), 'projview-outside-'));
  writeFileSync(path.join(outside, 'secret.md'), 'keep out');
  await withRoot({ 'ok.md': 'x' }, async ({ root, port }) => {
    symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'notes.md'));
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/file?p=notes.md`)).status, 400);
    assert.equal((await fetch(`${base}/api/source?p=notes.md`)).status, 400);
    assert.equal((await rawPut(port, { path: 'notes.md', content: 'pwned', force: true })).status, 400);
    assert.equal(readFileSync(path.join(outside, 'secret.md'), 'utf8'), 'keep out');
  }, { port: 41840 });
  rmSync(outside, { recursive: true, force: true });
});

test('a symlink that stays inside the root still works', async () => {
  await withRoot({ 'real.md': '# real' }, async ({ root, port }) => {
    symlinkSync(path.join(root, 'real.md'), path.join(root, 'alias.md'));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/file?p=alias.md`)).status, 200);
  }, { port: 41850 });
});

/* ---------- versions ---------- */

const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 50)); }
};

test('a change on disk keeps the replaced text as a version; restore goes through /api/source', async () => {
  await withRoot({ 'doc.md': 'one\n' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    await watching;   // an edit before the watcher's initial scan finishes isn't seen
    assert.deepEqual((await jget(`${base}/api/versions?p=doc.md`)).versions, []);

    writeFileSync(path.join(root, 'doc.md'), 'two\n');   // an edit made outside projview
    const list = await until(async () => { const r = await jget(`${base}/api/versions?p=doc.md`); return r.versions.length ? r : null; });
    assert.ok(list, 'a version appears after the change');
    assert.equal(list.limit, 5);
    const v = await jget(`${base}/api/versions/${list.versions[0].id}`);
    assert.equal(v.content, 'one\n');
    assert.equal(v.file, 'doc.md');

    // restore = an ordinary save of the old text, which itself versions "two"
    const { mtime } = await jget(`${base}/api/source?p=doc.md`);
    assert.equal((await rawPut(port, { path: 'doc.md', content: v.content, mtime })).status, 200);
    assert.equal(readFileSync(path.join(root, 'doc.md'), 'utf8'), 'one\n');
    const after = await until(async () => { const r = await jget(`${base}/api/versions?p=doc.md`); return r.versions.length === 2 ? r : null; });
    assert.ok(after, 'restoring kept the text it replaced');
    assert.equal((await jget(`${base}/api/versions/${after.versions[0].id}`)).content, 'two\n');

    assert.equal((await fetch(`${base}/api/versions?p=../x.md`)).status, 400);
    assert.equal((await fetch(`${base}/api/versions/nope`)).status, 404);
  }, { port: 41830 });
});
