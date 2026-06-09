/* the document viewer: fetch + render a file, anchors, search highlight */

import { $, esc, cssEsc } from './dom.js';
import { state } from './store.js';
import { revealInTree } from './tree.js';
import { renderBreadcrumb } from './breadcrumb.js';
import { runMermaid } from './mermaid.js';
import { buildToc } from './toc.js';
import { toast } from './toast.js';
import { onFileRendered } from './comments.js';

const contentEl = $('content');
const viewerEl = $('viewer');

export async function openFile(p, fragment, highlight) {
  state.currentPath = p;
  location.hash = encodeURIComponent(p);
  revealInTree(p);
  renderBreadcrumb(p);

  let res;
  try {
    res = await fetch(`/api/file?p=${encodeURIComponent(p)}`);
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    showNotFound(p);
    return;
  }
  const { html } = await res.json();
  contentEl.innerHTML = html;
  await runMermaid();
  buildToc();
  onFileRendered(p);   // load + anchor + paint comments for this file
  if (fragment) scrollToFragment(fragment);
  else if (highlight) highlightInContent(highlight);
  else viewerEl.scrollTop = 0;
}

export function scrollToFragment(frag) {
  // headings are rendered with a "pv-" id prefix (collision-proof); try that
  // first, then fall back to a raw id and an already-prefixed value (TOC).
  const el = document.getElementById(`pv-${frag}`) || document.getElementById(frag);
  // instant, not smooth: smooth scrollIntoView is a no-op on this overflow container
  if (el) el.scrollIntoView({ block: 'start' });
  else toast(`no section "#${frag}" on this page`);
}

// Find the first occurrence of a search term in the rendered content, briefly
// highlight it, and scroll it into view. Used when opening from a content match.
function highlightInContent(term) {
  if (!term) { viewerEl.scrollTop = 0; return; }
  const t = term.trim().toLowerCase();
  const candidates = [t, ...t.split(/\s+/)].filter(Boolean);
  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const hay = node.nodeValue.toLowerCase();
    for (const needle of candidates) {
      const idx = hay.indexOf(needle);
      if (idx === -1) continue;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + needle.length);
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      try { range.surroundContents(mark); } catch { viewerEl.scrollTop = 0; return; }
      mark.scrollIntoView({ block: 'center' });
      setTimeout(() => {
        const parent = mark.parentNode;
        if (parent) { parent.replaceChild(document.createTextNode(mark.textContent), mark); parent.normalize(); }
      }, 3000);
      return;
    }
  }
  viewerEl.scrollTop = 0;   // nothing matched in the rendered text
}

function showNotFound(p) {
  contentEl.innerHTML =
    `<div class="empty-state"><div class="empty-emoji">🤷</div>` +
    `<p>can't find <code>${esc(p)}</code></p>` +
    `<p class="muted">the link may be broken, or the file was renamed / removed</p></div>`;
  buildToc();
  onFileRendered(null);   // no file -> hide the comments affordances
  toast(`not found: ${p}`);
}
