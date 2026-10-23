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
const LIMIT = 1000;   // matches painted per page; the palette lists fewer

let active = null;    // { q, path, ranges, index } while the pill is up

/* ---------- text <-> DOM ---------- */

// Flat text of the rendered content + where each text node starts in it.
// <style> / <script> text (mermaid SVGs carry a <style>) isn't page text.
function segments() {
  const segs = [];
  let text = '';
  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('style, script') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  let node;
  while ((node = walker.nextNode())) {
    segs.push({ node, start: text.length });
    text += node.nodeValue;
  }
  return { text, segs };
}

// Matches are in document order, so one forward pass maps them all to Ranges.
function toRanges(segs, matches) {
  const out = [];
  let i = 0;
  const at = (off) => {
    while (i < segs.length - 1 && off > segs[i].start + segs[i].node.nodeValue.length) i++;
    return { node: segs[i].node, offset: off - segs[i].start };
  };
  for (const m of matches) {
    const a = at(m.start);
    const b = at(m.end);
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
  const { text, segs } = segments();
  const heads = headingOffsets(segs);
  let h = -1;
  return findMatches(text, q, Math.min(limit, LIMIT)).map((m) => {
    while (h + 1 < heads.length && heads[h + 1].start <= m.start) h++;
    return { ...snippet(text, m.start, m.end), heading: h >= 0 ? heads[h].label : null };
  });
}

// Paint every match of q, jump to match `index`, show the pill. Returns the count.
export function findIn(q, index = 0) {
  const { text, segs } = segments();
  const ranges = toRanges(segs, findMatches(text, q, LIMIT));
  if (!ranges.length) { clearFind(); return 0; }
  active = { q, path: state.currentPath, ranges, index: Math.min(Math.max(0, index), ranges.length - 1) };
  show();
  return ranges.length;
}

export function clearFind() {
  active = null;
  if (HL) { CSS.highlights.delete('pv-find'); CSS.highlights.delete('pv-find-current'); }
  pillEl.hidden = true;
}

// The active query, so the palette can open pre-filled.
export const findQuery = () => active?.q || '';

// Called by the viewer after every render: the same file (live reload, raw /
// rendered switch) keeps its find; any other file drops it. True if it kept one.
export function onContentRendered() {
  if (!active) return false;
  if (active.path !== state.currentPath) { clearFind(); return false; }
  return findIn(active.q, active.index) > 0;
}

/* ---------- pill ---------- */

function show() {
  const { ranges, index, q } = active;
  if (HL) {
    CSS.highlights.set('pv-find', new Highlight(...ranges));
    CSS.highlights.set('pv-find-current', new Highlight(ranges[index]));
  }
  queryEl.textContent = q;
  countEl.textContent = `${index + 1}/${ranges.length}${ranges.length === LIMIT ? '+' : ''}`;
  pillEl.hidden = false;
  const r = ranges[index].getBoundingClientRect();
  const v = viewerEl.getBoundingClientRect();
  if (r.height || r.width) viewerEl.scrollTop += (r.top - v.top) - v.height / 2;
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
  else if (e.key === 'Enter' && !e.target.closest?.('a, button')) {   // a focused link / button keeps its enter
    e.preventDefault();
    step(e.shiftKey ? -1 : 1);
  }
}, true);
