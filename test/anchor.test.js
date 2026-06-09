import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findQuote, commonPrefix, commonSuffix } from '../public/anchor.js';

test('findQuote: locates a unique phrase', () => {
  const text = 'the quick brown fox jumps over the lazy dog';
  assert.equal(findQuote(text, { exact: 'brown fox' }), text.indexOf('brown fox'));
});

test('findQuote: returns -1 when the text is gone (orphan)', () => {
  assert.equal(findQuote('hello world', { exact: 'goodbye moon' }), -1);
  assert.equal(findQuote('anything', { exact: '' }), -1);
});

test('findQuote: disambiguates repeated text by surrounding context', () => {
  const text = 'set the value. later on, set the value once more.';
  const first = text.indexOf('set the value');
  const second = text.indexOf('set the value', first + 1);
  assert.notEqual(first, second);
  // suffix ". later" can only follow the first occurrence
  assert.equal(findQuote(text, { exact: 'set the value', prefix: '', suffix: '. later' }), first);
  // prefix "later on, " can only precede the second
  assert.equal(findQuote(text, { exact: 'set the value', prefix: 'later on, ', suffix: ' once' }), second);
});

test('findQuote: falls back to the first match when context is unhelpful', () => {
  const text = 'foo foo foo';
  assert.equal(findQuote(text, { exact: 'foo', prefix: '', suffix: '' }), 0);
});

test('commonPrefix / commonSuffix count matching run lengths', () => {
  assert.equal(commonPrefix('abcde', 'abxyz'), 2);
  assert.equal(commonPrefix('', 'abc'), 0);
  assert.equal(commonSuffix('xxfoo', 'yyfoo'), 3);
  assert.equal(commonSuffix('abc', 'xbc'), 2);
});
