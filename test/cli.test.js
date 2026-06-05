import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'projview.js');
const run = (args) => execFileSync('node', [BIN, ...args], { encoding: 'utf8' });

test('--version prints the package.json version and exits', () => {
  const expected = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.equal(run(['--version']).trim(), expected);
  assert.equal(run(['-v']).trim(), expected);
});

test('--help prints usage', () => {
  assert.match(run(['--help']), /usage:/);
});

test('an unknown flag errors out (instead of starting a server)', () => {
  assert.throws(
    () => run(['--bogus']),
    (err) => err.status === 1 && /unknown option/.test(String(err.stderr))
  );
});

test('search subcommand emits ranked JSON results', () => {
  const out = JSON.parse(run(['search', 'mermaid', '--demo']));
  assert.equal(out.query, 'mermaid');
  assert.ok(Array.isArray(out.content) && out.content.length > 0);
  assert.ok(out.content[0].snippets[0].line > 0);   // snippets carry line numbers
});

test('tree subcommand emits JSON tree with a file count', () => {
  const out = JSON.parse(run(['tree', '--demo']));
  assert.ok(Array.isArray(out.tree) && out.tree.length > 0);
  assert.ok(out.files > 0);
});

test('search with no query exits non-zero', () => {
  assert.throws(() => run(['search']), (err) => err.status === 1);
});
