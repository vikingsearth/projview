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
    tokens[i].attrSet('id', unique);
  }
});

export function renderMarkdown(content) {
  return md.render(content);
}

// A standalone .mmd file is one whole diagram.
export function renderMermaid(content) {
  return `<div class="mermaid">${escapeHtml(content)}</div>\n`;
}

export function renderFile(ext, content) {
  return ext === '.mmd' ? renderMermaid(content) : renderMarkdown(content);
}
