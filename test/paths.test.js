import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelative } from '../public/paths.js';

test('same-dir link', () => {
  assert.equal(resolveRelative('guides/installation.md', 'configuration.md'), 'guides/configuration.md');
});

test('parent + sibling link', () => {
  assert.equal(resolveRelative('guides/installation.md', '../reference/api.md'), 'reference/api.md');
});

test('root-relative link from a root file', () => {
  assert.equal(resolveRelative('README.md', 'guides/installation.md'), 'guides/installation.md');
});

test('leading ./ is ignored', () => {
  assert.equal(resolveRelative('a/b.md', './c.md'), 'a/c.md');
});

test('deep ../ chain resolves to root', () => {
  assert.equal(resolveRelative('edge-cases/deep/nested/buried.md', '../../../README.md'), 'README.md');
});
