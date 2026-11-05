import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readText, encodeLike } from '../src/text.js';

const withFile = async (bytes, fn) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'projview-text-'));
  const f = path.join(dir, 'f');
  writeFileSync(f, bytes);
  try { await fn(f); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('readText decodes UTF-16 by its BOM (LE and BE)', async () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('SELECT 1;\r\nGO\r\n', 'utf16le')]);
  await withFile(le, async (f) => assert.equal(await readText(f), 'SELECT 1;\r\nGO\r\n'));
  const be = Buffer.from(Buffer.from('hi\n', 'utf16le')).swap16();
  await withFile(Buffer.concat([Buffer.from([0xfe, 0xff]), be]), async (f) => assert.equal(await readText(f), 'hi\n'));
});

test('readText reads plain UTF-8 as before', async () => {
  await withFile('let a = "é";\n', async (f) => assert.equal(await readText(f), 'let a = "é";\n'));
});

test('readText returns null for binary (a NUL in the first bytes)', async () => {
  await withFile(Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00, 0x00]), async (f) => assert.equal(await readText(f), null));
});

test('encodeLike keeps a file\'s UTF-16 encoding (LE and BE), UTF-8 otherwise', async () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('old', 'utf16le')]);
  await withFile(le, async (f) => {
    writeFileSync(f, await encodeLike(f, 'new é\n'));
    assert.equal(await readText(f), 'new é\n');
    assert.deepEqual([...(await import('node:fs')).readFileSync(f).subarray(0, 2)], [0xff, 0xfe]);
  });
  const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('old', 'utf16le').swap16()]);
  await withFile(be, async (f) => { writeFileSync(f, await encodeLike(f, 'hi')); assert.equal(await readText(f), 'hi'); });
  await withFile('plain', async (f) => assert.equal((await encodeLike(f, 'é')).toString('utf8'), 'é'));
});
