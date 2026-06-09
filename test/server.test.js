import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';
import { createStore } from '../src/store.js';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');

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
