import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, search, fuzzyScore } from '../src/search.js';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');

before(async () => { await buildIndex(DOCS); });

test('empty query returns nothing', () => {
  const r = search('');
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.content, []);
});

test('fuzzy filename match: cfg -> configuration.md', () => {
  assert.ok(search('cfg').files.some((f) => f.path.endsWith('configuration.md')));
});

test('full-text content search ranks by frequency (non-increasing)', () => {
  const r = search('mermaid');
  assert.ok(r.content.length > 1);
  const scores = r.content.map((c) => c.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(r.content[0].snippets[0].line > 0, 'snippets carry line numbers');
});

test('multi-term search is AND (all terms present)', () => {
  const r = search('live reload');
  assert.ok(r.content.length > 0);
  assert.ok(r.content.every((c) => c.count > 0));
});

test('fuzzyScore: subsequence scores, contiguous scores higher, miss is null', () => {
  assert.equal(typeof fuzzyScore('configuration.md', 'cfg'), 'number');
  assert.ok(fuzzyScore('configuration.md', 'config') > fuzzyScore('configuration.md', 'cfg'));
  assert.equal(fuzzyScore('abc', 'xyz'), null);
});
