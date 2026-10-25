/* projview cmd+K search palette - fuzzy filenames + full-text contents,
 * or (cmd+shift+K / tab) just the matches on the current page */

import { $, esc } from './dom.js';
import { state } from './store.js';
import { fileIcon as icon } from './icons.js';
import { openFile } from './viewer.js';
import { listMatches, findIn, findQuery, onRendered, LIMIT } from './find.js';
import { findMatches } from './findcore.js';

const paletteEl = $('palette');
const inputEl = $('palette-input');
const resultsEl = $('palette-results');
const openBtn = $('open-palette');
const scopeEl = $('palette-scope');

const SHOWN = 200;       // this-file rows listed (the pill still counts them all)

let selectable = [];     // flat list of openable results
let selected = 0;
let debounce;
let seq = 0;             // guards against out-of-order async results
let scope = 'all';       // 'all' files | this 'file'

/* ---------- open / close ---------- */

// this-file needs a rendered page: not before one opens, not over the editor or history
const canScopeFile = () =>
  !!state.currentPath && !document.body.classList.contains('editing') && !document.body.classList.contains('history');

function setScope(s) {
  scope = s === 'file' && canScopeFile() ? 'file' : 'all';
  scopeEl.textContent = scope === 'file' ? 'this file' : 'all files';
  scopeEl.classList.toggle('on', scope === 'file');
  scopeEl.disabled = !canScopeFile();
  scopeEl.title = !scopeEl.disabled ? 'switch scope (tab)'
    : state.currentPath ? 'not while editing or in history' : 'open a file to search within it';
  inputEl.placeholder = scope === 'file' ? 'search this file…' : 'search files + contents…';
}

function openPalette(s = 'all') {
  setScope(s);
  if (findQuery()) inputEl.value = findQuery();   // carry the page's active find over
  paletteEl.hidden = false;
  inputEl.focus();
  inputEl.select();
  if (inputEl.value.trim()) run();
  else showHint();
}
function closePalette() { paletteEl.hidden = true; }
function toggle(s) {
  if (paletteEl.hidden) openPalette(s);
  else if (s !== scope && canScopeFile()) { setScope(s); run(); }   // the other shortcut switches scope
  else closePalette();
}
function switchScope() {
  if (!canScopeFile()) return;
  setScope(scope === 'file' ? 'all' : 'file');
  run();
}

function showHint() {
  selectable = [];
  const what = scope === 'file' ? 'this file' : 'file names + contents';
  resultsEl.innerHTML = `<div class="palette-hint">type to search ${what}</div>`;
}

/* ---------- query ---------- */

async function run() {
  const q = inputEl.value.trim();
  if (!q) { showHint(); return; }
  const mySeq = ++seq;
  if (scope === 'file') { renderFile(q); return; }
  let data;
  try {
    data = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
  } catch {
    if (mySeq === seq) resultsEl.innerHTML = `<div class="palette-hint">search unavailable</div>`;
    return;
  }
  if (mySeq !== seq) return;   // a newer query superseded this one
  render(data, q);
}

function render(data, q) {
  selectable = [];
  let html = '';

  if (data.files.length) {
    html += `<div class="pg-head">files</div>`;
    for (const f of data.files) {
      const i = selectable.length;
      selectable.push({ type: 'file', path: f.path });
      html += row(i, icon(f.name), hl(f.name, q), dimPath(f.path), '');
    }
  }

  if (data.content.length) {
    html += `<div class="pg-head">in contents</div>`;
    for (const c of data.content) {
      const i = selectable.length;
      selectable.push({ type: 'content', path: c.path, term: q });
      const snips = c.snippets
        .map((s) => `<div class="snip"><span class="snip-ln">${s.line}</span>${hl(s.text, q)}</div>`)
        .join('');
      html += row(i, icon(c.name), hl(c.name, q), dimPath(c.path), snips, `${c.count}×`);
    }
  }

  if (!selectable.length) {
    resultsEl.innerHTML = `<div class="palette-hint">no matches for “${esc(q)}”</div>`;
    return;
  }
  resultsEl.innerHTML = html;
  selected = 0;
  paint();
  bindRows();
}

function renderFile(q) {
  const hits = listMatches(q);
  selectable = [];
  if (!hits.length) {
    resultsEl.innerHTML = `<div class="palette-hint">no matches for “${esc(q)}” in this file</div>`;
    return;
  }
  let html = '';
  let heading;
  for (const h of hits.slice(0, SHOWN)) {
    if (h.heading !== heading) {
      heading = h.heading;
      html += `<div class="pg-sec">${esc(heading || 'top of page')}</div>`;
    }
    const i = selectable.length;
    selectable.push({ type: 'hit', q, index: i });
    html += `<div class="presult" data-i="${i}"><div class="hit">${esc(h.before)}<mark>${esc(h.match)}</mark>${esc(h.after)}</div></div>`;
  }
  if (hits.length > SHOWN) {
    const more = `${hits.length - SHOWN}${hits.length === LIMIT ? '+' : ''}`;   // listMatches stops at LIMIT
    html += `<div class="palette-hint">+${more} more - step through them all on the page</div>`;
  }
  resultsEl.innerHTML = html;
  selected = 0;
  paint();
  bindRows();
}

function row(i, ic, name, path, extra, badge = '') {
  return (
    `<div class="presult" data-i="${i}">` +
    `<div class="pr-main"><span class="pr-ico">${ic}</span>` +
    `<span class="pr-name">${name}</span>` +
    (badge ? `<span class="pr-badge">${badge}</span>` : '') +
    `<span class="pr-path">${path}</span></div>` +
    extra +
    `</div>`
  );
}

function dimPath(p) {
  const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  return esc(dir);
}

/* ---------- selection / activation ---------- */

function paint() {
  const rows = resultsEl.querySelectorAll('.presult');
  rows.forEach((r, i) => r.classList.toggle('sel', i === selected));
  rows[selected]?.scrollIntoView({ block: 'nearest' });
}
function move(d) {
  if (!selectable.length) return;
  selected = (selected + d + selectable.length) % selectable.length;
  paint();
}
function activate(item) {
  if (!item) return;
  closePalette();
  if (item.type === 'hit') findIn(item.q, item.index);
  else if (item.type === 'content') openFile(item.path, null, item.term);
  else openFile(item.path);
}
function bindRows() {
  resultsEl.querySelectorAll('.presult').forEach((r) => {
    const i = Number(r.dataset.i);
    r.addEventListener('mousemove', () => { if (selected !== i) { selected = i; paint(); } });
    r.addEventListener('click', () => activate(selectable[i]));
  });
}

/* ---------- highlight helper ---------- */

// same matcher as the page, so the palette marks exactly what the page paints
function hl(text, q) {
  let out = '';
  let last = 0;
  for (const m of findMatches(text, q)) {
    out += esc(text.slice(last, m.start)) + `<mark>${esc(text.slice(m.start, m.end))}</mark>`;
    last = m.end;
  }
  return out + esc(text.slice(last));
}

/* ---------- wiring ---------- */

const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(e.shiftKey ? 'file' : 'all'); return; }
  if (!paletteEl.hidden && e.key === 'Escape') { closePalette(); return; }
  if (paletteEl.hidden && e.key === '/' && !isTyping(e.target)) { e.preventDefault(); openPalette(); }
});

inputEl.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(run, scope === 'file' ? 40 : 120);   // this-file is local: a shorter wait
});

// a this-file list holds match indexes; a re-render (live reload) remakes it
onRendered(() => { if (!paletteEl.hidden && scope === 'file') run(); });
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); activate(selectable[selected]); }
  else if (e.key === 'Tab') { e.preventDefault(); switchScope(); }
});

paletteEl.addEventListener('click', (e) => { if (e.target === paletteEl) closePalette(); });
openBtn.addEventListener('click', () => openPalette());
scopeEl.addEventListener('click', () => { switchScope(); inputEl.focus(); });
