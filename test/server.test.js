import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, isLoopbackHost } from '../src/server.js';
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
