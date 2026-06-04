import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderMermaid, renderFile } from '../src/render.js';

test('headings get slug ids', () => {
  assert.match(renderMarkdown('# Hello World'), /<h1[^>]*id="hello-world"/);
});

test('explicit {#id} wins and the literal is stripped from output', () => {
  const html = renderMarkdown('## Env Overrides {#env-overrides}');
  assert.match(html, /id="env-overrides"/);
  assert.doesNotMatch(html, /\{#env-overrides\}/);
});

test('duplicate heading text yields deduped ids', () => {
  const html = renderMarkdown('# Same\n\n# Same');
  assert.match(html, /id="same"/);
  assert.match(html, /id="same-1"/);
});

test('```mermaid fence becomes a .mermaid div, not a <pre>', () => {
  const html = renderMarkdown('```mermaid\nflowchart TD\n  A-->B\n```');
  assert.match(html, /<div class="mermaid">/);
  assert.doesNotMatch(html, /<pre/);
});

test('non-mermaid fences still render as highlighted code', () => {
  assert.match(renderMarkdown('```js\nconst x = 1;\n```'), /<pre class="hljs"/);
});

test('renderMermaid wraps content and escapes angle brackets', () => {
  assert.match(renderMermaid('graph TD'), /^<div class="mermaid">/);
  assert.match(renderMermaid('A --> B'), /--&gt; B/);
});

test('renderFile routes .mmd to the mermaid wrapper', () => {
  assert.equal(renderFile('.mmd', 'graph TD'), renderMermaid('graph TD'));
});
