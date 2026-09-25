import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>`;
      } catch { /* fall through */ }
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
  }
});

// Intercept ```mermaid fences -> emit a div the client lib renders.
// Everything else keeps the default (highlighted) fence rendering.
const defaultFence = md.renderer.rules.fence.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const info = tokens[idx].info.trim().toLowerCase();
  if (info === 'mermaid') {
    return `<div class="mermaid">${escapeHtml(tokens[idx].content)}</div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

// kebab-case slug from heading text, stripped of punctuation.
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

const EXPLICIT_ID = /\s*\{#([\w-]+)\}\s*$/;

// Give every heading a stable id so #fragment links can target it.
// Honors an explicit trailing {#id}, otherwise slugs the heading text.
md.core.ruler.push('heading_anchors', (state) => {
  const used = Object.create(null);
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    if (!inline || inline.type !== 'inline') continue;

    let id;
    const explicit = inline.content.match(EXPLICIT_ID);
    if (explicit) {
      id = explicit[1];
      inline.content = inline.content.replace(EXPLICIT_ID, '');
      // strip the visible {#id} from the rendered text token too
      const kids = inline.children || [];
      for (let j = kids.length - 1; j >= 0; j--) {
        if (kids[j].type === 'text' && EXPLICIT_ID.test(kids[j].content)) {
          kids[j].content = kids[j].content.replace(EXPLICIT_ID, '');
          break;
        }
      }
    } else {
      id = slugify(inline.content);
    }

    let unique = id;
    let n = 1;
    while (used[unique]) unique = `${id}-${n++}`;
    used[unique] = true;
    // prefix so heading ids can never collide with the app's own element ids
    // (e.g. a "## viewer" heading vs the <main id="viewer"> container)
    tokens[i].attrSet('id', `pv-${unique}`);
  }
});

export function renderMarkdown(content) {
  return md.render(content);
}

// A standalone .mmd file is one whole diagram.
export function renderMermaid(content) {
  return `<div class="mermaid">${escapeHtml(content)}</div>\n`;
}

// Re-indent JSON by walking its tokens rather than parse -> stringify, so the
// original literals survive untouched (big ints, 1.0, duplicate keys, key order).
// Assumes the input is already valid JSON (callers check with JSON.parse first).
export function formatJson(src, indent = 2) {
  const pad = (n) => '\n' + ' '.repeat(n * indent);
  let out = '';
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '{' || c === '[') {
      // keep empty containers compact: {} / []
      let j = i + 1;
      while (/\s/.test(src[j] || '')) j++;
      if (src[j] === (c === '{' ? '}' : ']')) { out += c + src[j]; i = j; continue; }
      out += c + pad(++depth);
    } else if (c === '}' || c === ']') {
      out += pad(--depth) + c;
    } else if (c === ',') {
      out += ',' + pad(depth);
    } else if (c === ':') {
      out += ': ';
    } else if (!/\s/.test(c)) {
      out += c;
    }
  }
  return out;
}

// Split highlight.js output into lines, closing + reopening any <span> that
// crosses a newline so each line is self-contained HTML.
function splitHighlightedLines(html) {
  const lines = [];
  const open = [];
  let cur = '';
  for (const m of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+/g)) {
    const tok = m[0];
    if (tok === '\n') {
      lines.push(cur + '</span>'.repeat(open.length));
      cur = open.join('');
    } else {
      if (tok.startsWith('<span')) open.push(tok);
      else if (tok === '</span>') open.pop();
      cur += tok;
    }
  }
  lines.push(cur + '</span>'.repeat(open.length));
  return lines;
}

const leadingIndent = (line) => line.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Big files skip syntax highlighting - hljs gets slow and nobody reads 2MB of JSON by colour.
const HIGHLIGHT_LIMIT = 2_000_000;

// A code view with line numbers and indent guides. Each line carries its
// indent depth (--i) so CSS can draw one guide per level (--step columns apart).
function renderCodeView(code, lang, note = '') {
  const raw = code.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rawLines = raw.split('\n');
  const html = raw.length <= HIGHLIGHT_LIMIT && hljs.getLanguage(lang)
    ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value
    : escapeHtml(raw);
  const lines = splitHighlightedLines(html);

  // blank lines borrow the shallower neighbour's indent so guides don't break
  const indents = rawLines.map((l) => (l.trim() ? leadingIndent(l) : -1));
  const step = indents.filter((n) => n > 0).reduce(gcd, 0);
  const next = new Array(indents.length);
  for (let i = indents.length - 1, n = 0; i >= 0; i--) next[i] = n = indents[i] === -1 ? n : indents[i];
  for (let i = 0, prev = 0; i < indents.length; i++) {
    if (indents[i] === -1) indents[i] = Math.min(prev, next[i]);
    else prev = indents[i];
  }
  const guideStep = step >= 2 && step <= 8 ? step : 2;

  const body = lines
    .map((l, i) => `<span class="cl" style="--i:${indents[i]}"><span class="lc">${l}</span></span>`)
    .join('');
  return `${note}<pre class="hljs code-view" data-lang="${lang}" style="--step:${guideStep}"><code>${body}</code></pre>\n`;
}

const notice = (msg) => `<div class="data-notice">${escapeHtml(msg)}</div>\n`;

// JSON: pretty-printed when valid; shown as-is (with a note) when it isn't -
// e.g. JSONC with comments, or a genuinely broken file.
export function renderJson(content) {
  try {
    JSON.parse(content);
  } catch (err) {
    if (!content.trim()) return renderCodeView('', 'json');
    return renderCodeView(content, 'json', notice(`not strict JSON, shown as-is - ${err.message}`));
  }
  return renderCodeView(formatJson(content), 'json');
}

// YAML: indentation is meaning, so it's shown exactly as written (highlighted,
// with guides) rather than re-serialised - which would also choke on Helm templates.
export function renderYaml(content) {
  return renderCodeView(content, 'yaml');
}

export function renderFile(ext, content) {
  if (ext === '.mmd') return renderMermaid(content);
  if (ext === '.json') return renderJson(content);
  if (ext === '.yml' || ext === '.yaml') return renderYaml(content);
  return renderMarkdown(content);
}
