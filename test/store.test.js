import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStoreConfig, createStore } from '../src/store.js';
import { buildIndex, search } from '../src/search.js';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const tmpFile = (n) => path.join(os.tmpdir(), `projview-test-${n}-${process.pid}.sqlite`);

test('resolveStoreConfig: explicit flags win', () => {
  assert.equal(resolveStoreConfig({ store: 'superlite' }).kind, 'superlite');
  assert.equal(resolveStoreConfig({ storeUrl: 'postgres://h/db' }).url, 'postgres://h/db');
});

test('memory store persists nothing', async () => {
  const s = createStore({ kind: 'memory' }, DOCS);
  assert.equal(await s.load(), null);
  await s.save([{ path: 'a.md', name: 'a.md', ext: '.md', mtime: 1, content: 'x' }]);
  assert.equal(await s.load(), null); // still nothing
});

test('sqlite store round-trips entries', async () => {
  const file = tmpFile('roundtrip');
  const s = createStore({ kind: 'custom', url: `sqlite://${file}` }, DOCS);
  await s.save([{ path: 'a.md', name: 'a.md', ext: '.md', mtime: 42, content: 'hello' }]);
  const loaded = await s.load();
  assert.equal(loaded.entries.length, 1);
  assert.equal(loaded.entries[0].content, 'hello');
  assert.equal(loaded.entries[0].mtime, 42);
  await s.close();
  fs.rmSync(file, { force: true });
});

test('buildIndex warm-starts from a persisted store (reindex only changed)', async () => {
  const file = tmpFile('warm');
  const cfg = { kind: 'custom', url: `sqlite://${file}` };

  const cold = await buildIndex(DOCS, createStore(cfg, DOCS));
  assert.equal(cold.warm, false);
  assert.ok(cold.total > 0 && cold.reindexed === cold.total); // cold: read everything

  const warm = await buildIndex(DOCS, createStore(cfg, DOCS));
  assert.equal(warm.warm, true);
  assert.equal(warm.reindexed, 0); // nothing changed -> reused cache
  assert.equal(warm.total, cold.total);

  assert.ok(search('mermaid').content.length > 0); // search works over warm index
  fs.rmSync(file, { force: true });
});
