/* projview cmd+K search palette - fuzzy filenames + full-text contents */

import { $, esc } from './dom.js';
import { SVG_FILE, SVG_DIAGRAM } from './icons.js';
import { openFile } from './viewer.js';

const paletteEl = $('palette');
const inputEl = $('palette-input');
const resultsEl = $('palette-results');
const openBtn = $('open-palette');

const icon = (name) => (name.endsWith('.mmd') ? SVG_DIAGRAM : SVG_FILE);

let selectable = [];     // flat list of openable results
let selected = 0;
let debounce;
let seq = 0;             // guards against out-of-order async results

/* ---------- open / close ---------- */

function openPalette() {
  paletteEl.hidden = false;
  inputEl.focus();
  inputEl.select();
  if (inputEl.value.trim()) run();
  else showHint();
}
function closePalette() { paletteEl.hidden = true; }
function toggle() { paletteEl.hidden ? openPalette() : closePalette(); }

function showHint() {
  selectable = [];
  resultsEl.innerHTML = `<div class="palette-hint">type to search file names + contents</div>`;
}

/* ---------- query ---------- */

async function run() {
  const q = inputEl.value.trim();
  if (!q) { showHint(); return; }
  const mySeq = ++seq;
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
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  selectable = [];
  let html = '';

  if (data.files.length) {
    html += `<div class="pg-head">files</div>`;
    for (const f of data.files) {
      const i = selectable.length;
      selectable.push({ type: 'file', path: f.path });
      html += row(i, icon(f.name), hl(f.name, terms), dimPath(f.path), '');
    }
  }

  if (data.content.length) {
    html += `<div class="pg-head">in contents</div>`;
    for (const c of data.content) {
      const i = selectable.length;
      selectable.push({ type: 'content', path: c.path, term: q });
      const snips = c.snippets
        .map((s) => `<div class="snip"><span class="snip-ln">${s.line}</span>${hl(s.text, terms)}</div>`)
        .join('');
      html += row(i, icon(c.name), hl(c.name, terms), dimPath(c.path), snips, `${c.count}×`);
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
  if (item.type === 'content') openFile(item.path, null, item.term);
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

function hl(text, terms) {
  let out = esc(text);
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

/* ---------- wiring ---------- */

const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(); return; }
  if (!paletteEl.hidden && e.key === 'Escape') { closePalette(); return; }
  if (paletteEl.hidden && e.key === '/' && !isTyping(e.target)) { e.preventDefault(); openPalette(); }
});

inputEl.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 120); });
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); activate(selectable[selected]); }
});

paletteEl.addEventListener('click', (e) => { if (e.target === paletteEl) closePalette(); });
openBtn.addEventListener('click', openPalette);
