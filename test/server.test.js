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
  for (const h of ['127.0.0.1', '::1', 'localhost']) assert.equal(isLoopbackHost(h), true);
  for (const h of ['0.0.0.0', '192.168.1.10', '::', '']) assert.equal(isLoopbackHost(h), false);   // '' binds every interface
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

test('/api/file refuses files under dirs the tree hides (secret / noise dot-dirs, node_modules)', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'projview-hidden-'));
  for (const [rel, body] of [['.ssh/creds.json', '{"token":"x"}'], ['.git/x.json', '{}'], ['node_modules/pkg/package.json', '{}'], ['ok.json', '{}'], ['.github/ci.yml', 'on: push\n']]) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  const { port, close } = await startServer(root, { port: 41750, host: '127.0.0.1', store: { kind: 'memory' } });
  const status = async (p) => (await fetch(`http://127.0.0.1:${port}/api/file?p=${encodeURIComponent(p)}`)).status;
  try {
    assert.equal(await status('ok.json'), 200);
    assert.equal(await status('.ssh/creds.json'), 400);
    assert.equal(await status('.git/x.json'), 400);
    assert.equal(await status('.github/ci.yml'), 200);
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
  const base = mkdtempSync(path.join(os.tmpdir(), 'projview-src-'));
  const root = opts.under ? path.join(base, opts.under) : base;   // e.g. a root inside a dot-dir
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  const srv = await startServer(root, { port: opts.port, host: opts.host || '127.0.0.1', store: { kind: 'memory' } });
  try { await fn({ root, port: srv.port, watching: srv.watching }); } finally { await srv.close(); rmSync(base, { recursive: true, force: true }); }
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
  await withRoot({ 'ok.md': 'x', 'notes.txt': 'x', '.ssh/creds.json': '{}' }, async ({ port }) => {
    for (const p of ['notes.txt', '.ssh/creds.json', '../escape.md', 'missing/../../x.md']) {
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
    assert.equal((await fetch(`${base}/api/versions?p=notes.txt`)).status, 400);
    assert.equal((await fetch(`${base}/api/versions/nope`)).status, 404);
  }, { port: 41830 });
});

test('JSON versions keep the raw text, not the re-indented view', async () => {
  await withRoot({ 'cfg.json': '{"a":1,"n":12345678901234567890}' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    await watching;
    writeFileSync(path.join(root, 'cfg.json'), '{"a":2}');
    const list = await until(async () => { const r = await jget(`${base}/api/versions?p=cfg.json`); return r.versions.length ? r : null; });
    assert.ok(list);
    assert.equal((await jget(`${base}/api/versions/${list.versions[0].id}`)).content, '{"a":1,"n":12345678901234567890}');
  }, { port: 41860 });
});

test('deleting a file keeps its last text as a version', async () => {
  await withRoot({ 'gone.md': 'last words\n' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    await watching;
    rmSync(path.join(root, 'gone.md'));
    const list = await until(async () => { const r = await jget(`${base}/api/versions?p=gone.md`); return r.versions.length ? r : null; });
    assert.ok(list, 'the deleted text is in history');
    assert.equal((await jget(`${base}/api/versions/${list.versions[0].id}`)).content, 'last words\n');
  }, { port: 41870 });
});

test('a root under a dot-dir is still watched', async () => {
  await withRoot({ 'doc.md': 'one\n' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    await watching;
    writeFileSync(path.join(root, 'doc.md'), 'two\n');
    const list = await until(async () => { const r = await jget(`${base}/api/versions?p=doc.md`); return r.versions.length ? r : null; });
    assert.ok(list, 'a change under a root inside a dot-dir is seen');
    assert.equal((await jget(`${base}/api/versions/${list.versions[0].id}`)).content, 'one\n');
  }, { port: 41890, under: '.hidden/docs' });
});

test('a second write inside the watcher\'s 50ms change throttle is still seen', async () => {
  await withRoot({ 'doc.md': 'v1\n' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    await watching;
    writeFileSync(path.join(root, 'doc.md'), 'v2\n');
    // as soon as the first change is handled, write again: chokidar drops this one
    const end = Date.now() + 4000;
    while (Date.now() < end && !(await jget(`${base}/api/versions?p=doc.md`)).versions.length) await new Promise((r) => setTimeout(r, 2));
    writeFileSync(path.join(root, 'doc.md'), 'v3\n');
    const list = await until(async () => { const r = await jget(`${base}/api/versions?p=doc.md`); return r.versions.length >= 2 ? r : null; });
    assert.ok(list, 'the quick second write was picked up');
    const texts = await Promise.all(list.versions.map(async (v) => (await jget(`${base}/api/versions/${v.id}`)).content));
    assert.deepEqual(texts, ['v2\n', 'v1\n']);
    assert.match((await jget(`${base}/api/search?q=v3`)).content[0]?.path || '', /doc\.md/);
  }, { port: 41895 });
});

test('back-to-back changes keep every in-between version, once each', async () => {
  await withRoot({ 'doc.md': 'v1\n' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    await watching;
    for (const v of ['v2\n', 'v3\n', 'v4\n']) {
      writeFileSync(path.join(root, 'doc.md'), v);
      await new Promise((r) => setTimeout(r, 250));   // distinct change events, still close together
    }
    const list = await until(async () => { const r = await jget(`${base}/api/versions?p=doc.md`); return r.versions.length >= 3 ? r : null; });
    assert.ok(list, 'three versions recorded');
    const texts = await Promise.all(list.versions.map(async (v) => (await jget(`${base}/api/versions/${v.id}`)).content));
    assert.deepEqual(texts, ['v3\n', 'v2\n', 'v1\n']);
  }, { port: 41880 });
});

test('code files are view-only: shown as source, saves refused, no versions kept', async () => {
  await withRoot({ 'app.js': 'let a = 1;\n' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    const { html } = await jget(`${base}/api/file?p=app.js`);
    assert.match(html, /data-lang="javascript"/);

    const { mtime } = await jget(`${base}/api/source?p=app.js`);
    for (const body of [{ path: 'app.js', content: 'pwned', mtime }, { path: 'app.js', content: 'pwned', force: true }]) {
      assert.equal((await rawPut(port, body)).status, 403);
    }
    assert.equal(readFileSync(path.join(root, 'app.js'), 'utf8'), 'let a = 1;\n');

    await watching;
    writeFileSync(path.join(root, 'app.js'), 'let a = 2;\n');   // an outside edit still live-reloads...
    const updated = await until(async () => (await jget(`${base}/api/search?q=a%20%3D%202`)).content.length);
    assert.ok(updated, 'the change reached the search index');
    assert.deepEqual((await jget(`${base}/api/versions?p=app.js`)).versions, []);   // ...but keeps no version
  }, { port: 41900 });
});

test('a symlink with a doc name can\'t save through to a code file', async () => {
  await withRoot({ 'app.js': 'let a = 1;\n' }, async ({ root, port }) => {
    symlinkSync('app.js', path.join(root, 'alias.md'));
    assert.equal((await rawPut(port, { path: 'alias.md', content: 'pwned', force: true })).status, 403);
    assert.equal(readFileSync(path.join(root, 'app.js'), 'utf8'), 'let a = 1;\n');
  }, { port: 41910 });
});

test('an exposed host serves docs + data but no code', async () => {
  await withRoot({ 'doc.md': '# hi\n', 'cfg.json': '{}', 'deploy.sh': 'export TOKEN=secret\n', '.github/ci.yml': 'on: push\n' }, async ({ port }) => {
    const base = `http://127.0.0.1:${port}`;
    const names = (await jget(`${base}/api/tree`)).tree.map((n) => n.name);
    assert.deepEqual(names.sort(), ['cfg.json', 'doc.md']);
    assert.equal((await fetch(`${base}/api/file?p=deploy.sh`)).status, 400);
    assert.equal((await fetch(`${base}/api/source?p=deploy.sh`)).status, 400);
    assert.equal((await jget(`${base}/api/search?q=secret`)).content.length, 0);
    assert.equal((await fetch(`${base}/api/file?p=cfg.json`)).status, 200);
    assert.equal((await fetch(`${base}/api/file?p=.github/ci.yml`)).status, 400);   // no dot-dirs either
  }, { port: 41920, host: '0.0.0.0' });
});

test('binary files show a notice; UTF-16 files are decoded and searchable', async () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('SELECT name FROM players;\r\n', 'utf16le')]);
  await withRoot({ 'seg.ts': Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00]), 'q.sql': utf16 }, async ({ port }) => {
    const base = `http://127.0.0.1:${port}`;
    assert.match((await jget(`${base}/api/file?p=seg.ts`)).html, /binary file - not shown/);
    const { html } = await jget(`${base}/api/file?p=q.sql`);
    assert.match(html, /hljs-keyword">SELECT/);
    assert.doesNotMatch(html, /\u0000/);
    assert.equal((await jget(`${base}/api/search?q=players`)).content[0]?.path, 'q.sql');
  }, { port: 41930 });
});

test('dot-dirs and known dotfiles are listed and shown locally, and live-reload', async () => {
  await withRoot({ '.github/workflows/ci.yml': 'on: push\n', '.gitignore': 'node_modules\n', '.env': 'TOKEN=x\n' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    const names = (await jget(`${base}/api/tree`)).tree.map((n) => n.name).sort();
    assert.deepEqual(names, ['.github', '.gitignore']);   // .env never listed
    assert.match((await jget(`${base}/api/file?p=.gitignore`)).html, /data-lang="plaintext"/);   // code view, not markdown
    await watching;
    writeFileSync(path.join(root, '.github/workflows/ci.yml'), 'on: pull_request\n');
    const hit = await until(async () => (await jget(`${base}/api/search?q=pull_request`)).content.length);
    assert.ok(hit, 'a change inside a dot-dir reaches the index');
  }, { port: 41940 });
});

/* ---------- security hardening (v1.3.1) ---------- */

// raw request with a chosen Host / content type (fetch can't forge Host)
function rawReq(port, { method = 'GET', path: p = '/', host = `127.0.0.1:${port}`, type, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host };
    if (type) headers['content-type'] = type;
    if (body !== undefined) headers['content-length'] = Buffer.byteLength(body);
    const req = http.request({ port, host: '127.0.0.1', method, path: p, headers }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('the page ships a CSP that allows no inline script', async () => {
  await withRoot({ 'a.md': '# a\n' }, async ({ port }) => {
    const res = await rawReq(port);
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
    assert.doesNotMatch(res.headers['content-security-policy'], /script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(res.body, /<script>/);   // every script is a file
  }, { port: 41950 });
});

test('a local bind answers local host names only - reads too (DNS rebinding)', async () => {
  await withRoot({ 'a.md': '# a\n', 'app.js': 'secret()\n' }, async ({ port }) => {
    for (const p of ['/api/file?p=a.md', '/api/source?p=app.js', '/api/tree', '/api/search?q=secret', '/api/comments'])
      assert.equal((await rawReq(port, { path: p, host: `evil.example:${port}` })).status, 403, p);
    const post = await rawReq(port, { method: 'POST', path: '/api/comments', host: `evil.example:${port}`, type: 'application/json', body: '{"file":"a.md","body":"x"}' });
    assert.equal(post.status, 403);
    assert.equal((await rawReq(port, { path: '/api/file?p=a.md', host: `localhost:${port}` })).status, 200);
  }, { port: 41960 });
});

test('comment writes need a JSON body of the right shape - and a bad one never crashes the server', async () => {
  await withRoot({ 'a.md': '# a\n' }, async ({ port }) => {
    const post = (body, type = 'application/json') => rawReq(port, { method: 'POST', path: '/api/comments', type, body: JSON.stringify(body) });
    assert.equal((await post({ file: 'a.md', body: 'x' }, 'text/plain')).status, 400);   // a cross-site form / no-cors fetch
    assert.equal((await post({ file: { x: 1 }, body: 'x' })).status, 400);
    assert.equal((await post({ file: 'a.md', body: { x: 1 } })).status, 400);
    assert.equal((await post({ file: 'nope.txt', body: 'x' })).status, 400);
    assert.equal((await post({ file: 'a.md', body: 'x', anchor: 'str' })).status, 400);
    assert.equal((await post({ file: 'a.md', body: 'fine' })).status, 201);
    assert.equal((await rawReq(port, { path: '/api/tree' })).status, 200);   // still up
  }, { port: 41970 });
});

test('secret and noise dirs are skipped whatever their case', async () => {
  await withRoot({ '.config/GH/hosts.yml': 'token: x\n', '.Docker/config.json': '{"auths":{}}' }, async ({ port }) => {
    for (const p of ['.config/GH/hosts.yml', '.Docker/config.json'])
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/source?p=${encodeURIComponent(p)}`)).status, 400, p);
  }, { port: 41980 });
});

test('a symlink is held to its target\'s rules: no .env, and no code or dot-dirs on an exposed host', async () => {
  await withRoot({ '.env': 'API_KEY=x\n', 'app.js': 'x()\n', 'ok.md': '# ok\n' }, async ({ root, port }) => {
    symlinkSync('.env', path.join(root, 'leak.md'));
    symlinkSync('app.js', path.join(root, 'code.md'));
    const status = async (p) => (await fetch(`http://127.0.0.1:${port}/api/file?p=${p}`)).status;
    assert.equal(await status('leak.md'), 400);
    assert.equal(await status('code.md'), 400);
    assert.equal(await status('ok.md'), 200);
  }, { port: 41990, host: '0.0.0.0' });
});

test('an exposed host neither previews, records usage nor shows it', async () => {
  await withRoot({ 'a.md': '# a\n' }, async ({ port }) => {
    const base = `http://127.0.0.1:${port}`;
    const prev = await fetch(`${base}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'x.md', content: '# hi' }) });
    assert.equal(prev.status, 403);
    await fetch(`${base}/api/search?q=a`);
    assert.equal((await fetch(`${base}/api/usage`)).status, 403);
  }, { port: 42000, host: '0.0.0.0' });
});

test('the editor reads UTF-16 files decoded, and refuses binary ones', async () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# héllo\n', 'utf16le')]);
  await withRoot({ 'u.md': utf16, 'b.md': Buffer.from([0x23, 0x00, 0x01]) }, async ({ port }) => {
    assert.equal((await jget(`http://127.0.0.1:${port}/api/source?p=u.md`)).content, '# héllo\n');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/source?p=b.md`)).status, 415);
  }, { port: 42010 });
});

test('history renders versions server-side, so an exposed host can show them', async () => {
  await withRoot({ 'doc.md': '# one\n' }, async ({ root, port, watching }) => {
    const base = `http://127.0.0.1:${port}`;
    await watching;
    writeFileSync(path.join(root, 'doc.md'), '# two\n');
    const list = await until(async () => { const r = await jget(`${base}/api/versions?p=doc.md`); return r.versions.length ? r : null; });
    assert.ok(list, 'a version appears');
    const v = await jget(`${base}/api/versions/${list.versions[0].id}?render=1`);
    assert.match(v.html, /<h1[^>]*>one<\/h1>/);
    assert.equal((await fetch(`${base}/api/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"path":"x.md","content":"x"}' })).status, 403);
  }, { port: 42020, host: '0.0.0.0' });
});

test('a comment needs an existing file and an anchor of known string fields', async () => {
  await withRoot({ 'a.md': '# a\n' }, async ({ root, port }) => {
    symlinkSync('gone.md', path.join(root, 'dangling.md'));
    const post = (body) => rawReq(port, { method: 'POST', path: '/api/comments', type: 'application/json', body: JSON.stringify(body) });
    assert.equal((await post({ file: 'nope.md', body: 'x' })).status, 400);
    assert.equal((await post({ file: 'dangling.md', body: 'x' })).status, 400);
    assert.equal((await post({ file: 'a.md', body: 'x', anchor: { type: 'text', exact: 5 } })).status, 400);
    assert.equal((await post({ file: 'a.md', body: 'x', anchor: { type: 'heading', id: { x: 1 } } })).status, 400);
    assert.equal((await post({ file: 'a.md', body: 'x', anchor: { type: 'weird' } })).status, 400);
    assert.equal((await post({ file: 'a.md', body: 'x', anchor: { type: 'text', exact: 'a', prefix: '', suffix: '', section: null } })).status, 201);   // no heading above
  }, { port: 42030 });
});

test('every response says nosniff + no-referrer; an exposed host serves no dotfiles', async () => {
  await withRoot({ 'docs/.secrets.yml': 'tok: x\n', 'ok.md': '# ok\n' }, async ({ port }) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/file?p=ok.md`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/file?p=docs/.secrets.yml`)).status, 400);
    assert.equal((await jget(`http://127.0.0.1:${port}/api/search?q=tok`)).content.length, 0);
  }, { port: 42040, host: '0.0.0.0' });
});

test('writes need exactly application/json; malformed %-escapes answer 400', async () => {
  await withRoot({ 'a.md': '# a\n' }, async ({ port }) => {
    const post = (type) => rawReq(port, { method: 'POST', path: '/api/comments', type, body: '{"file":"a.md","body":"x"}' });
    assert.equal((await post('application/json-patch+json')).status, 400);
    assert.equal((await post('application/json, text/plain')).status, 400);
    assert.equal((await post('Application/JSON; charset=utf-8')).status, 201);
    assert.equal((await rawReq(port, { path: '/api/versions/%E0' })).status, 400);
    assert.equal((await rawReq(port, { method: 'DELETE', path: '/api/comments/%E0%A4%A' })).status, 400);
  }, { port: 42050 });
});
