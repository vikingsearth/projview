import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryTerms, findMatches, snippet } from '../public/findcore.js';

const spans = (text, q, limit) => findMatches(text, q, limit).map((m) => text.slice(m.start, m.end));

test('terms are lowercased, split on whitespace and deduped', () => {
  assert.deepEqual(queryTerms('  Live  RELOAD live '), ['live', 'reload']);
});

test('empty query or text matches nothing', () => {
  assert.deepEqual(findMatches('some text', ''), []);
  assert.deepEqual(findMatches('some text', '   '), []);
  assert.deepEqual(findMatches('', 'text'), []);
});

test('case-insensitive, every occurrence in order', () => {
  assert.deepEqual(spans('Mermaid, mermaid, MERMAID', 'mermaid'), ['Mermaid', 'mermaid', 'MERMAID']);
});

test('each term of a multi-term query matches on its own', () => {
  assert.deepEqual(spans('a broken thing, then a diagram, then broken again', 'broken diagram'),
    ['broken', 'diagram', 'broken']);
});

test('offsets point at the match', () => {
  assert.deepEqual(findMatches('one two', 'two'), [{ start: 4, end: 7 }]);
});

test('longer term wins an overlap', () => {
  assert.deepEqual(spans('the liver is alive', 'live liver'), ['liver', 'live']);
});

test('regex characters in the query are literal', () => {
  assert.deepEqual(spans('call foo.bar() then foobar', 'foo.bar()'), ['foo.bar()']);
  assert.deepEqual(spans('a [x] b', '[x]'), ['[x]']);
});

test('a match can span what were separate text nodes', () => {
  // the DOM layer joins text nodes before matching, so "live **reload**" is one string
  assert.deepEqual(spans('live ' + 'reload', 'reload'), ['reload']);
});

test('limit caps the number of matches', () => {
  assert.equal(findMatches('a a a a a', 'a', 3).length, 3);
});

test('snippet collapses whitespace and marks cut edges', () => {
  const text = 'x'.repeat(50) + ' the\n\n  needle  here ' + 'y'.repeat(50);
  const start = text.indexOf('needle');
  const s = snippet(text, start, start + 6, 10);
  assert.equal(s.match, 'needle');
  assert.ok(s.before.startsWith('…'));
  assert.ok(s.after.endsWith('…'));
  assert.ok(!/\s{2,}/.test(s.before) && !/\s{2,}/.test(s.after));
});

test('snippet has no ellipsis at the text edges', () => {
  const s = snippet('needle here', 0, 6);
  assert.deepEqual(s, { before: '', match: 'needle', after: ' here' });
});
