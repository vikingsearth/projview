import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderMermaid, renderFile, formatJson, renderJson, renderYaml, LINE_LIMIT } from '../src/render.js';

test('headings get slug ids (pv- prefixed to avoid collisions)', () => {
  assert.match(renderMarkdown('# Hello World'), /<h1[^>]*id="pv-hello-world"/);
});

test('explicit {#id} wins and the literal is stripped from output', () => {
  const html = renderMarkdown('## Env Overrides {#env-overrides}');
  assert.match(html, /id="pv-env-overrides"/);
  assert.doesNotMatch(html, /\{#env-overrides\}/);
});

test('duplicate heading text yields deduped ids', () => {
  const html = renderMarkdown('# Same\n\n# Same');
  assert.match(html, /id="pv-same"/);
  assert.match(html, /id="pv-same-1"/);
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

test('formatJson re-indents without touching literals or strings', () => {
  const out = formatJson('{"a":[1,{}],"n":12345678901234567890,"s":"x,:{y","e":[]}');
  assert.equal(out, '{\n  "a": [\n    1,\n    {}\n  ],\n  "n": 12345678901234567890,\n  "s": "x,:{y",\n  "e": []\n}');
});

test('formatJson handles escaped quotes inside strings', () => {
  assert.equal(formatJson('{"q":"a\\"b,c"}'), '{\n  "q": "a\\"b,c"\n}');
});

test('renderJson pretty-prints valid JSON into a numbered code view', () => {
  const html = renderJson('{"a":{"b":1}}');
  assert.match(html, /<pre class="hljs code-view" data-lang="json"/);
  assert.equal((html.match(/class="cl"/g) || []).length, 5);   // one span per line
  assert.match(html, /style="--i:4"/);                          // "b" is two levels deep
  assert.doesNotMatch(html, /data-notice/);
});

test('renderJson shows invalid JSON as-is with a notice', () => {
  const html = renderJson('{ // jsonc\n "a": 1 }');
  assert.match(html, /class="data-notice">not strict JSON/);
  assert.match(html, /jsonc/);
});

test('renderYaml keeps the source indentation and detects the indent step', () => {
  const html = renderYaml('a:\n    b: 1\n    c:\n        - x\n');
  assert.match(html, /data-lang="yaml" style="--step:4"/);
  assert.match(html, /style="--i:8"/);
});

test('code view lines are self-contained when a span crosses a newline', () => {
  const html = renderYaml('k: |\n  one\n  two\n');
  const lines = html.replace(/<\/code><\/pre>\n$/, '').split('<span class="cl"').slice(1);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(1 + (line.match(/<span/g) || []).length, (line.match(/<\/span>/g) || []).length);
  }
});

test('renderFile routes .json / .yml / .yaml to the code view', () => {
  for (const ext of ['.json', '.yml', '.yaml']) assert.match(renderFile(ext, '{}'), /code-view/);
});

test('renderJson pretty-prints valid JSON that starts with a BOM', () => {
  const html = renderJson('\uFEFF{"a":1}');
  assert.doesNotMatch(html, /data-notice/);
  assert.equal((html.match(/class="cl"/g) || []).length, 3);
});

test('indent step ignores a stray odd-indented line', () => {
  const yaml = 'a:\n    b:\n        c: 1\n    run: |\n       odd three-space line\n    d: 2\n';
  assert.match(renderYaml(yaml), /style="--step:4"/);
});

test('files past the line limit render only the head, with a notice', () => {
  const html = renderYaml(Array.from({ length: LINE_LIMIT + 5 }, (_, i) => `k${i}: v`).join('\n'));
  assert.equal((html.match(/class="cl"/g) || []).length, LINE_LIMIT);
  assert.match(html, /data-notice">showing the first 50,000 of 50,005 lines/);
});
