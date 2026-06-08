import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIgnoredDir, isPreviewable, buildTree, countFiles } from '../src/walk.js';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');

test('isIgnoredDir flags noise dirs and dot-dirs', () => {
  assert.equal(isIgnoredDir('node_modules'), true);
  assert.equal(isIgnoredDir('.git'), true);
  assert.equal(isIgnoredDir('dist'), true);
  assert.equal(isIgnoredDir('src'), false);
  assert.equal(isIgnoredDir('docs'), false);
});

test('isPreviewable accepts only md/mmd (case-insensitive)', () => {
  assert.equal(isPreviewable('a.md'), true);
  assert.equal(isPreviewable('a.mmd'), true);
  assert.equal(isPreviewable('A.MD'), true);
  assert.equal(isPreviewable('a.txt'), false);
  assert.equal(isPreviewable('a.png'), false);
  assert.equal(isPreviewable('noext'), false);
});

test('buildTree indexes the docs fixtures (15 files)', () => {
  assert.equal(countFiles(buildTree(DOCS)), 15);
});

test('buildTree sorts dirs before files at each level', () => {
  const types = buildTree(DOCS).map((n) => n.type);
  const lastDir = types.lastIndexOf('dir');
  const firstFile = types.indexOf('file');
  assert.ok(lastDir < firstFile, 'all dirs come before files');
});

test('buildTree exposes nested paths with posix separators', () => {
  assert.match(JSON.stringify(buildTree(DOCS)), /edge-cases\/deep\/nested\/buried\.md/);
});

test('buildTree prunes directories with no previewable descendants', () => {
  const allNonEmpty = (nodes) =>
    nodes.every((n) => n.type === 'file' || (n.children.length > 0 && allNonEmpty(n.children)));
  assert.ok(allNonEmpty(buildTree(DOCS)));
});
