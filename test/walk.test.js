import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIgnoredPath, isHiddenPath, isPreviewable, buildTree, countFiles } from '../src/walk.js';
const isIgnoredDir = (name, opts) => isIgnoredPath(name, opts);

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');

test('isIgnoredDir flags noise dirs and noise dot-dirs', () => {
  assert.equal(isIgnoredDir('node_modules'), true);
  assert.equal(isIgnoredDir('.git'), true);
  assert.equal(isIgnoredDir('.next'), true);
  assert.equal(isIgnoredDir('dist'), true);
  assert.equal(isIgnoredDir('src'), false);
  assert.equal(isIgnoredDir('docs'), false);
});

test('isPreviewable accepts md/mmd/json/yaml (case-insensitive)', () => {
  assert.equal(isPreviewable('a.md'), true);
  assert.equal(isPreviewable('a.mmd'), true);
  assert.equal(isPreviewable('A.MD'), true);
  assert.equal(isPreviewable('a.json'), true);
  assert.equal(isPreviewable('a.yml'), true);
  assert.equal(isPreviewable('A.YAML'), true);
  assert.equal(isPreviewable('a.txt'), false);
  assert.equal(isPreviewable('a.png'), false);
  assert.equal(isPreviewable('noext'), false);
});

test('isPreviewable accepts code files', () => {
  for (const f of ['a.cs', 'a.css', 'a.html', 'a.js', 'a.ts', 'a.tsx', 'a.py', 'A.GO']) assert.equal(isPreviewable(f), true, f);
});

test('isPreviewable skips minified bundles', () => {
  assert.equal(isPreviewable('vendor.min.js'), false);
  assert.equal(isPreviewable('site.min.css'), false);
  assert.equal(isPreviewable('admin.js'), true);
});

test('the minified skip is code-only - a one-line .min.json still pretty-prints', () => {
  for (const f of ['schema.min.json', 'values.min.yaml', 'notes.min.md']) assert.equal(isPreviewable(f), true, f);
});

test('isPreviewable with code off keeps docs + data, drops code', () => {
  assert.equal(isPreviewable('app.js', { code: false }), false);
  assert.equal(isPreviewable('a.md', { code: false }), true);
  assert.equal(isPreviewable('a.json', { code: false }), true);
});

test('isIgnoredDir skips code ecosystems\' dependency + build dirs', () => {
  for (const d of ['venv', 'site-packages', 'obj', 'target', 'Pods', 'bower_components']) assert.equal(isIgnoredDir(d), true, d);
  assert.equal(isIgnoredDir('bin'), false);   // node CLIs keep their source there
});

test('isPreviewable skips lockfiles', () => {
  assert.equal(isPreviewable('package-lock.json'), false);
  assert.equal(isPreviewable('sub/pnpm-lock.yaml'), false);
  assert.equal(isPreviewable('package.json'), true);
});

test('buildTree indexes the docs fixtures (25 files)', () => {
  assert.equal(countFiles(buildTree(DOCS)), 25);
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

test('dot-dirs are listed, except credential dirs - and all of them when hidden is off', () => {
  for (const d of ['.github', '.vscode', '.claude', '.devcontainer']) assert.equal(isIgnoredDir(d), false, d);
  for (const d of ['.ssh', '.aws', '.docker', '.kube', '.gnupg']) assert.equal(isIgnoredDir(d), true, d);
  assert.equal(isIgnoredDir('.github', { hidden: false }), true);
  assert.equal(isHiddenPath('.github/workflows/ci.yml'), false);
  assert.equal(isHiddenPath('.github/workflows/ci.yml', { hidden: false }), true);
});

test('.claude/worktrees is skipped - each one is a whole copy of the repo', () => {
  assert.equal(isHiddenPath('.claude/worktrees/x/README.md'), true);
  assert.equal(isHiddenPath('.claude/skills/x/SKILL.md'), false);
  assert.equal(isHiddenPath('docs/worktrees/a.md'), false);
});

test('known extensionless dotfiles are code; secret ones are not listed', () => {
  for (const f of ['.gitignore', '.editorconfig', '.prettierrc']) assert.equal(isPreviewable(f), true, f);
  for (const f of ['.env', '.npmrc', '.netrc', 'constructor']) assert.equal(isPreviewable(f), false, f);
  assert.equal(isPreviewable('.gitignore', { code: false }), false);
});
