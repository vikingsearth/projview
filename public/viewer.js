/* the document viewer: fetch + render a file, anchors, hand-off to in-file find */

import { $, esc, cssEsc } from './dom.js';
import { state } from './store.js';
import { revealInTree } from './tree.js';
import { renderBreadcrumb } from './breadcrumb.js';
import { runMermaid } from './mermaid.js';
import { buildToc } from './toc.js';
import { toast } from './toast.js';
import { onFileRendered } from './comments.js';
import { isEditing, confirmLeave, onFileShown, hasRawView } from './editor.js';
import { leaveHistory } from './history.js';
import { findIn, clearFind, onContentRendered } from './find.js';

const contentEl = $('content');
const viewerEl = $('viewer');

export async function openFile(p, fragment, highlight) {
  // leaving an editor with unsaved changes needs a yes; on no, put the URL back
  if (isEditing() && !confirmLeave()) {
    location.hash = encodeURIComponent(state.currentPath);
    return;
  }
  leaveHistory();
  state.currentPath = p;
  location.hash = encodeURIComponent(p);
  revealInTree(p);
  renderBreadcrumb(p);

  const raw = state.view === 'raw' && hasRawView(p);
  let res;
  try {
    res = await fetch(`/api/file?p=${encodeURIComponent(p)}${raw ? '&view=raw' : ''}`);
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
  // comments quote the rendered text, so they live in the rendered view only
  onFileRendered(raw ? null : p);
  onFileShown(p);      // rendered / raw / edit switcher
  // a content search hit lands with every match painted + the pill; a re-render
  // of the same file (live reload, raw / rendered) keeps the find it had
  const found = onContentRendered();
  if (fragment) scrollToFragment(fragment);
  else if (highlight) { if (!findIn(highlight)) viewerEl.scrollTop = 0; }
  else if (!found) viewerEl.scrollTop = 0;
}

export function scrollToFragment(frag) {
  // headings are rendered with a "pv-" id prefix (collision-proof); try that
  // first, then fall back to a raw id and an already-prefixed value (TOC).
  const el = document.getElementById(`pv-${frag}`) || document.getElementById(frag);
  // instant, not smooth: smooth scrollIntoView is a no-op on this overflow container
  if (el) el.scrollIntoView({ block: 'start' });
  else toast(`no section "#${frag}" on this page`);
}

function showNotFound(p) {
  contentEl.innerHTML =
    `<div class="empty-state">` +
    `<p>can't find <code>${esc(p)}</code></p>` +
    `<p class="muted">the link may be broken, or the file was renamed / removed</p></div>`;
  buildToc();
  clearFind();
  onFileRendered(null);   // no file -> hide the comments affordances
  toast(`not found: ${p}`);
}
