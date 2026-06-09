import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'projview.js');
const run = (args) => execFileSync('node', [BIN, ...args], { encoding: 'utf8' });

let dbN = 0;
const tmpDb = () => path.join(os.tmpdir(), `projview-cli-${process.pid}-${dbN++}.sqlite`);

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

/* ---------- comments + usage CLI (Phase 3a) ---------- */

test('comment add -> comments round-trips via a sqlite store', () => {
  const db = tmpDb();
  const url = `sqlite://${db}`;
  const added = JSON.parse(run(['comment', 'add', 'README.md', 'a note', '--heading', 'pv-intro', '--author', 'claude', '--store-url', url, '--demo']));
  assert.ok(added.id);
  assert.equal(added.author, 'claude');
  assert.equal(added.anchor.type, 'heading');
  assert.equal(added.anchor.id, 'pv-intro');
  const list = JSON.parse(run(['comments', '--store-url', url, '--demo']));
  assert.equal(list.length, 1);
  assert.equal(list[0].body, 'a note');
  rmSync(db, { force: true });
});

test('comment resolve + rm mutate the stored comment', () => {
  const db = tmpDb();
  const url = `sqlite://${db}`;
  const id = JSON.parse(run(['comment', 'add', 'README.md', 'x', '--store-url', url, '--demo'])).id;
  assert.equal(JSON.parse(run(['comment', 'resolve', id, '--store-url', url, '--demo'])).resolved, true);
  assert.deepEqual(JSON.parse(run(['comment', 'rm', id, '--store-url', url, '--demo'])), { deleted: id });
  assert.equal(JSON.parse(run(['comments', '--store-url', url, '--demo'])).length, 0);
  rmSync(db, { force: true });
});

test('comment add without a persistent store warns on stderr', () => {
  const r = spawnSync('node', [BIN, 'comment', 'add', 'README.md', 'ephemeral', '--demo'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /will NOT be saved/);
});

test('usage subcommand emits aggregate stats (empty with no events)', () => {
  const db = tmpDb();
  const u = JSON.parse(run(['usage', '--store-url', `sqlite://${db}`, '--demo']));
  assert.equal(u.total, 0);
  assert.deepEqual(u.byType, {});
  rmSync(db, { force: true });
});
