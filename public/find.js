/* in-file find: every match painted on the page + the hit pill ("q" 3/12 ↑ ↓ ✕).
 * Painted with the Custom Highlight API, so the rendered DOM is never touched -
 * hljs spans, mermaid SVGs, anchors and comment quotes all stay as they are. */

import { $ } from './dom.js';
import { state } from './store.js';
import { findMatches, snippet } from './findcore.js';

const contentEl = $('content');
const viewerEl = $('viewer');
const pillEl = $('find-pill');
const queryEl = $('find-query');
const countEl = $('find-count');

const HL = typeof CSS !== 'undefined' && CSS.highlights;   // Custom Highlight API?
export const LIMIT = 1000;   // matches painted per page; the palette lists fewer

let active = null;    // { q, path, ranges, index } while the pill is up
let cache = null;     // { text, segs, heads } for the page as rendered now
const renderHooks = [];

// any change to the page (a render, mermaid redrawing, comment buttons) drops the cache
new MutationObserver(() => { cache = null; })
  .observe(contentEl, { childList: true, subtree: true, characterData: true });

// Text in different blocks gets a newline between it, so a match never runs
// from one line / cell / label into the next. Raw and data views put each line
// in its own .cl span with nothing between them; svg <text> is a mermaid label.
const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote, dt, dd, div, .cl, text';

/* ---------- text <-> DOM ---------- */

// Flat text of the rendered content + where each text node starts in it.
// <style> / <script> text (mermaid SVGs carry a <style>) isn't page text.
// Query terms never contain whitespace, so no match crosses an added newline.
function segments() {
  const segs = [];
  let text = '';
  let block = null;
  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('style, script') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  let node;
  while ((node = walker.nextNode())) {
    const b = node.parentElement?.closest(BLOCK) || null;
    if (b !== block && text) text += '\n';
    block = b;
    segs.push({ node, start: text.length });
    text += node.nodeValue;
  }
  return { text, segs };
}

function pageText() {
  if (!cache) {
    const { text, segs } = segments();
    cache = { text, segs, heads: headingOffsets(segs) };
  }
  return cache;
}

// Matches are in document order, so one forward pass maps them all to Ranges.
function toRanges(segs, matches) {
  const out = [];
  let i = 0;
  // a start on a node boundary belongs to the next node (the one the match is
  // in); an end on one belongs to the node it closes
  const at = (off, start) => {
    while (i < segs.length - 1 && (start ? off >= segs[i + 1].start : off > segs[i].start + segs[i].node.nodeValue.length)) i++;
    return { node: segs[i].node, offset: off - segs[i].start };
  };
  for (const m of matches) {
    const a = at(m.start, true);
    const b = at(m.end, false);
    const r = document.createRange();
    try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); } catch { continue; }
    out.push(r);
  }
  return out;
}

// Headings (the ones the outline lists) as { start, label }, in document order.
function headingOffsets(segs) {
  const starts = new Map(segs.map((s) => [s.node, s.start]));
  const out = [];
  for (const h of contentEl.querySelectorAll('h1, h2, h3, [data-toc]')) {
    const first = document.createTreeWalker(h, NodeFilter.SHOW_TEXT).nextNode();
    if (first && starts.has(first)) out.push({ start: starts.get(first), label: (h.dataset.tocLabel || h.textContent).trim() });
  }
  return out;
}

/* ---------- api ---------- */

// Matches on the current page for the palette: a snippet + the nearest heading.
// Index i here is the same match as findIn(q, i).
export function listMatches(q, limit = LIMIT) {
  const { text, heads } = pageText();
  let h = -1;
  return findMatches(text, q, Math.min(limit, LIMIT)).map((m) => {
    while (h + 1 < heads.length && heads[h + 1].start <= m.start) h++;
    return { ...snippet(text, m.start, m.end), heading: h >= 0 ? heads[h].label : null };
  });
}

// Paint every match of q, jump to match `index`, show the pill. Returns the count.
export function findIn(q, index = 0, scroll = true) {
  const { text, segs } = pageText();
  const ranges = toRanges(segs, findMatches(text, q, LIMIT));
  if (!ranges.length) { clearFind(); return 0; }
  active = { q, path: state.currentPath, ranges, index: Math.min(Math.max(0, index), ranges.length - 1) };
  show(scroll);
  return ranges.length;
}

export function clearFind() {
  active = null;
  if (HL) { CSS.highlights.delete('pv-find'); CSS.highlights.delete('pv-find-current'); }
  pillEl.hidden = true;
}

// Re-find in place after the page changed without a render (the theme flip
// redraws mermaid SVGs): fresh ranges, same position, no scroll.
export function refreshFind() {
  if (active && active.path === state.currentPath) findIn(active.q, active.index, false);
}

// Run fn after every render (the palette refreshes a this-file list it is showing).
export const onRendered = (fn) => { renderHooks.push(fn); };

// The active query, so the palette can open pre-filled.
export const findQuery = () => active?.q || '';

// Called by the viewer after every render: the same file (live reload, raw /
// rendered switch) keeps its find; any other file drops it. True if it kept one.
export function onContentRendered() {
  cache = null;
  for (const fn of renderHooks) fn();
  if (!active) return false;
  if (active.path !== state.currentPath) { clearFind(); return false; }
  return findIn(active.q, active.index) > 0;
}

/* ---------- pill ---------- */

function show(scroll = true) {
  const { ranges, index, q } = active;
  if (HL) {
    CSS.highlights.set('pv-find', new Highlight(...ranges));
    CSS.highlights.set('pv-find-current', new Highlight(ranges[index]));
  }
  queryEl.textContent = q;
  countEl.textContent = `${index + 1}/${ranges.length}${ranges.length === LIMIT ? '+' : ''}`;
  pillEl.hidden = false;
  if (scroll) reveal(ranges[index]);
}

// Bring a match on screen: open any collapsed <details> around it, centre it
// in the viewer, and scroll a wide code block sideways to it.
function reveal(range) {
  const el = range.startContainer.parentElement;
  for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  const r = range.getBoundingClientRect();
  if (!r.height && !r.width) return;
  const v = viewerEl.getBoundingClientRect();
  viewerEl.scrollTop += (r.top - v.top) - v.height / 2;
  const pre = el.closest('pre');
  if (pre && pre.scrollWidth > pre.clientWidth) {
    const p = pre.getBoundingClientRect();
    pre.scrollLeft += (r.left - p.left) - p.width / 2;
  }
}

function step(d) {
  if (!active) return;
  // the editor or history view replaced the page under us
  if (!contentEl.contains(active.ranges[0].startContainer)) { clearFind(); return; }
  const n = active.ranges.length;
  active.index = (active.index + d + n) % n;
  show();
}

pillEl.addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'prev') step(-1);
  else if (act === 'next') step(1);
  else if (act === 'close') clearFind();
});

// capture phase: runs before the zoom / palette handlers close their overlays,
// so an esc meant for them doesn't also drop the find
window.addEventListener('keydown', (e) => {
  if (!active || pillEl.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('palette').hidden || !$('zoom').hidden) return;
  if (document.body.classList.contains('editing') || document.body.classList.contains('history')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'Escape') clearFind();
  // a focused control (link, button, <summary>, anything tabbable) keeps its enter
  else if (e.key === 'Enter' && !e.target.closest?.('a, button, summary, audio, video, [tabindex]')) {
    e.preventDefault();
    step(e.shiftKey ? -1 : 1);
  }
}, true);
