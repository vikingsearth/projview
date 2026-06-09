/* comments: a right-side drawer + inline anchoring.
 *
 * Anchors come in three flavours (see src/store.js): whole-file, a heading
 * (section), or a text quote. Text quotes are re-anchored on every render via a
 * {exact, prefix, suffix} selector - if the text moved we re-find it, if it
 * vanished the comment is flagged "orphaned" (never lost). Highlights paint with
 * the CSS Custom Highlight API (no DOM mutation), so the TOC / search / mermaid
 * are untouched. Writes are hidden when the server says it isn't writable. */

import { $, esc } from './dom.js';
import { state } from './store.js';
import { toast } from './toast.js';
import { findQuote } from './anchor.js';

const contentEl = $('content');
const viewerEl = $('viewer');
const HL = typeof CSS !== 'undefined' && CSS.highlights;   // Custom Highlight API?

let current = [];          // comments for the current file
const ranges = new Map();  // id -> resolved Range (text anchors only)
let activeId = null;
let pending = null;        // { anchor, quote } while composing a new comment

/* ---------------- scaffold (built once) ---------------- */

const cre = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const FAB_ICON =
  `<svg class="cmt-fab-ico" viewBox="0 0 24 24" width="23" height="23" fill="none" aria-hidden="true">
     <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
     <circle cx="8" cy="10" r="1.05" fill="currentColor"/>
     <circle cx="12" cy="10" r="1.05" fill="currentColor"/>
     <circle cx="16" cy="10" r="1.05" fill="currentColor"/>
   </svg>`;
const fab = cre('button', 'cmt-fab', `${FAB_ICON}<span class="cmt-badge" hidden>0</span>`);
fab.title = 'comments';
fab.hidden = true;

const drawer = cre('aside', 'cmt-drawer');
drawer.hidden = true;
drawer.innerHTML =
  `<header class="cmt-drawer-head">
     <div><strong>comments</strong> <span class="cmt-file"></span></div>
     <div class="cmt-head-btns">
       <button class="cmt-add-file" title="note on the whole file">+ note</button>
       <button class="cmt-close" title="close">✕</button>
     </div>
   </header>
   <div class="cmt-composer-slot"></div>
   <div class="cmt-list"></div>`;

const chip = cre('button', 'cmt-selchip', '💬 comment');
chip.hidden = true;

document.body.append(fab, drawer, chip);

const listEl = drawer.querySelector('.cmt-list');
const composerSlot = drawer.querySelector('.cmt-composer-slot');
const fileEl = drawer.querySelector('.cmt-file');
const addFileBtn = drawer.querySelector('.cmt-add-file');

fab.addEventListener('click', () => toggleDrawer());
drawer.querySelector('.cmt-close').addEventListener('click', () => toggleDrawer(false));
addFileBtn.addEventListener('click', () => startCompose({ type: 'file' }, null));

/* ---------------- public entry points ---------------- */

// Called by the viewer after a file renders: load + anchor + paint + list.
export async function onFileRendered(path) {
  pending = null;
  activeId = null;
  if (!path) { fab.hidden = true; clearPaint(); return; }
  await loadComments(path);
  fileEl.textContent = path.split('/').pop();
  reanchor();
  renderComposer();
  renderList();
  addHeadingAffordances();
  fab.hidden = false;
}

// Called on an SSE 'comments' event: refresh data + markers without touching the
// document render or an open composer.
export async function refreshComments() {
  if (!state.currentPath) return;
  await loadComments(state.currentPath);
  reanchor();
  renderList();
}

/* ---------------- data ---------------- */

async function loadComments(path) {
  try {
    const res = await fetch(`/api/comments?file=${encodeURIComponent(path)}`);
    current = res.ok ? await res.json() : [];
  } catch { current = []; }
  updateBadge();
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) { toast(res.status === 403 ? 'comments are read-only here' : 'comment failed'); return null; }
  return res.json();
}

async function submitCompose(body) {
  if (!body.trim() || !pending) return;
  const created = await api('POST', '/api/comments', { file: state.currentPath, body: body.trim(), anchor: pending.anchor });
  if (!created) return;
  pending = null;
  await refreshComments();
  renderComposer();
  openComment(created.id);
}

async function setResolved(id, resolved) {
  const c = await api('PATCH', `/api/comments/${encodeURIComponent(id)}`, { resolved });
  if (c) await refreshComments();
}

async function remove(id) {
  const r = await api('DELETE', `/api/comments/${encodeURIComponent(id)}`);
  if (r) { if (activeId === id) activeId = null; await refreshComments(); }
}

/* ---------------- re-anchoring engine ---------------- */

// Flat text of the content + a map from string offset -> text node.
function segments() {
  const segs = [];
  let text = '';
  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    segs.push({ node, start: text.length });
    text += node.nodeValue;
  }
  return { text, segs };
}

function pointAt(segs, offset) {
  for (const s of segs) {
    if (offset <= s.start + s.node.nodeValue.length) return { node: s.node, offset: Math.max(0, offset - s.start) };
  }
  const last = segs[segs.length - 1];
  return last ? { node: last.node, offset: last.node.nodeValue.length } : null;
}

// Resolve a {exact, prefix, suffix} quote selector to a DOM Range (using the
// pure finder in anchor.js). Returns null if `exact` isn't present (orphan).
function resolveText(anchor, ctx) {
  const exact = anchor.exact || '';
  const best = exact ? findQuote(ctx.text, anchor) : -1;
  if (best === -1) return null;
  const a = pointAt(ctx.segs, best);
  const b = pointAt(ctx.segs, best + exact.length);
  if (!a || !b) return null;
  const range = document.createRange();
  try { range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset); } catch { return null; }
  return range;
}

function reanchor() {
  ranges.clear();
  const ctx = segments();
  for (const c of current) {
    c._orphan = false;
    if (c.anchor?.type === 'text') {
      const r = resolveText(c.anchor, ctx);
      if (r) ranges.set(c.id, r); else c._orphan = true;
    }
  }
  paint();
}

function paint() {
  if (!HL) return;
  CSS.highlights.set('pv-comment', new Highlight(...[...ranges.values()]));
  const act = activeId && ranges.get(activeId);
  CSS.highlights.set('pv-comment-active', act ? new Highlight(act) : new Highlight());
}
function clearPaint() { if (HL) { CSS.highlights.delete('pv-comment'); CSS.highlights.delete('pv-comment-active'); } ranges.clear(); }

/* ---------------- inline affordances ---------------- */

// Click inside the content: if it lands on a highlighted quote, open that comment.
contentEl.addEventListener('click', (e) => {
  if (!ranges.size || !document.caretRangeFromPoint) return;
  const caret = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!caret) return;
  for (const [id, r] of ranges) {
    try { if (r.isPointInRange(caret.startContainer, caret.startOffset)) { openComment(id); return; } } catch { /* different root */ }
  }
});

// A hover "💬" at the end of every heading -> comment on that section.
function addHeadingAffordances() {
  if (!state.writable) return;
  for (const h of contentEl.querySelectorAll('h1, h2, h3')) {
    if (!h.id || h.querySelector('.cmt-head-add')) continue;
    const label = h.textContent;
    const b = cre('button', 'cmt-head-add');           // text comes from CSS (keeps h.textContent clean)
    b.title = 'comment on this section';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); startCompose({ type: 'heading', id: h.id }, label); });
    h.appendChild(b);
  }
}

// Text selection -> a floating "comment" chip near the selection.
viewerEl.addEventListener('mouseup', () => {
  if (!state.writable) { chip.hidden = true; return; }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) { chip.hidden = true; return; }
  const range = sel.getRangeAt(0);
  if (!contentEl.contains(range.commonAncestorContainer)) { chip.hidden = true; return; }
  const rect = range.getBoundingClientRect();
  chip.style.top = `${Math.max(8, rect.top - 40)}px`;
  chip.style.left = `${rect.left}px`;
  chip.hidden = false;
});
chip.addEventListener('mousedown', (e) => e.preventDefault());   // don't clear the selection
chip.addEventListener('click', () => {
  const anchor = captureTextAnchor();
  chip.hidden = true;
  if (anchor) startCompose(anchor, anchor.exact);
  else toast('select some text first');
});
document.addEventListener('mousedown', (e) => { if (e.target !== chip && !chip.hidden) chip.hidden = true; });

function captureTextAnchor() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!contentEl.contains(range.commonAncestorContainer)) return null;
  const exact = sel.toString();
  const flat = contentEl.textContent;
  const pre = document.createRange();
  pre.setStart(contentEl, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const startOff = pre.toString().length;
  const endOff = startOff + exact.length;
  return {
    type: 'text',
    exact,
    prefix: flat.slice(Math.max(0, startOff - 32), startOff),
    suffix: flat.slice(endOff, endOff + 32),
    section: nearestHeadingId(range)
  };
}

function nearestHeadingId(range) {
  const top = range.getBoundingClientRect().top;
  let id = null;
  for (const h of contentEl.querySelectorAll('h1, h2, h3')) {
    if (!h.id) continue;
    if (h.getBoundingClientRect().top <= top) id = h.id; else break;
  }
  return id;
}

/* ---------------- composer + list ---------------- */

function startCompose(anchor, quote) {
  if (!state.writable) { toast('comments are read-only here'); return; }
  pending = { anchor, quote };
  toggleDrawer(true);
  renderComposer();
  const ta = composerSlot.querySelector('textarea');
  if (ta) ta.focus();
}

function renderComposer() {
  composerSlot.replaceChildren();
  if (!pending || !state.writable) return;
  const box = cre('div', 'cmt-composer');
  box.append(cre('div', 'cmt-anchor-chip', anchorLabel(pending.anchor, pending.quote)));
  const ta = cre('textarea');
  ta.placeholder = 'add a comment…';
  ta.rows = 3;
  const actions = cre('div', 'cmt-composer-actions');
  const save = cre('button', 'cmt-btn primary', 'comment');
  const cancel = cre('button', 'cmt-btn', 'cancel');
  save.addEventListener('click', () => submitCompose(ta.value));
  cancel.addEventListener('click', () => { pending = null; renderComposer(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitCompose(ta.value); });
  actions.append(save, cancel);
  box.append(ta, actions);
  composerSlot.append(box);
}

function renderList() {
  listEl.replaceChildren();
  if (!current.length) {
    listEl.append(cre('div', 'cmt-empty', '💭<br>no comments yet' + (state.writable ? '<br><small>select text, hover a heading, or “+ note”</small>' : '')));
    return;
  }
  for (const c of current) {
    const card = cre('div', 'cmt-card' + (c.resolved ? ' resolved' : '') + (c._orphan ? ' orphan' : '') + (c.id === activeId ? ' active' : ''));
    card.dataset.id = c.id;
    const meta = cre('div', 'cmt-meta',
      `<span class="cmt-author">${esc(c.author || 'anon')}</span><span class="cmt-time">${ago(c.createdAt)}</span>`);
    const chipEl = cre('div', 'cmt-anchor-chip' + (c._orphan ? ' orphan' : ''), anchorLabel(c.anchor) + (c._orphan ? ' · not found' : ''));
    const bodyEl = cre('div', 'cmt-body', esc(c.body).replace(/\n/g, '<br>'));
    card.append(meta, chipEl, bodyEl);
    if (state.writable) {
      const actions = cre('div', 'cmt-actions');
      const res = cre('button', 'cmt-link', c.resolved ? 'reopen' : 'resolve');
      const del = cre('button', 'cmt-link danger', 'delete');
      res.addEventListener('click', (e) => { e.stopPropagation(); setResolved(c.id, !c.resolved); });
      del.addEventListener('click', (e) => { e.stopPropagation(); remove(c.id); });
      actions.append(res, del);
      card.append(actions);
    }
    card.addEventListener('click', () => openComment(c.id));
    listEl.append(card);
  }
}

/* ---------------- navigation ---------------- */

function openComment(id) {
  activeId = id;
  toggleDrawer(true);
  paint();
  renderList();
  const card = listEl.querySelector(`.cmt-card[data-id="${CSS.escape(id)}"]`);
  if (card) card.scrollIntoView({ block: 'nearest' });
  const c = current.find((x) => x.id === id);
  if (c) jumpToAnchor(c);
}

function jumpToAnchor(c) {
  const a = c.anchor || {};
  if (a.type === 'text') {
    const r = ranges.get(c.id);
    if (r) { scrollRangeIntoView(r); return; }
    if (a.section) { document.getElementById(a.section)?.scrollIntoView({ block: 'start' }); return; }
    toast('original text not found - comment is orphaned');
  } else if (a.type === 'heading') {
    const el = document.getElementById(a.id);
    if (el) el.scrollIntoView({ block: 'start' }); else toast('section no longer exists');
  } else {
    viewerEl.scrollTop = 0;
  }
}

function scrollRangeIntoView(range) {
  const r = range.getBoundingClientRect();
  const v = viewerEl.getBoundingClientRect();
  if (r.height || r.width) viewerEl.scrollTop += (r.top - v.top) - 120;
}

/* ---------------- bits ---------------- */

function toggleDrawer(force) {
  const open = force === undefined ? drawer.hidden : force;
  drawer.hidden = !open;
  fab.classList.toggle('open', open);
}

function updateBadge() {
  const open = current.filter((c) => !c.resolved).length;
  const badge = fab.querySelector('.cmt-badge');
  badge.textContent = String(open);
  badge.hidden = open === 0;
}

function anchorLabel(a, quoteOverride) {
  if (!a) return 'file';
  if (a.type === 'file') return '📄 whole file';
  if (a.type === 'heading') {
    const el = document.getElementById(a.id);
    return '§ ' + (quoteOverride || (el ? el.textContent : a.id));
  }
  const q = (quoteOverride || a.exact || '').replace(/\s+/g, ' ').trim();
  return '“' + (q.length > 60 ? q.slice(0, 60) + '…' : q) + '”';
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
