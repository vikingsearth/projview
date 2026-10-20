/* source editor: swap the rendered page for its raw text, save back to disk.
 * Loopback-only like comments (state.writable). Saves carry the mtime the file
 * had when it was opened, so a change made elsewhere is never silently clobbered. */

import { $, esc } from './dom.js';
import { state } from './store.js';
import { openFile } from './viewer.js';
import { toast } from './toast.js';

const contentEl = $('content');
const breadcrumbEl = $('breadcrumb');

let session = null;   // { path, mtime, original, crlf, textarea, noticeEl } while editing

export const isEditing = (p) => !!session && (p === undefined || session.path === p);
const isDirty = () => !!session && session.textarea.value !== session.original;

// Called by the viewer before it navigates away: false keeps the editor open.
export function confirmLeave() {
  if (!isDirty()) { session = null; document.body.classList.remove('editing'); return true; }
  if (!confirm('discard unsaved changes?')) return false;
  session = null;
  document.body.classList.remove('editing');
  return true;
}

// md / mmd render to something other than their source, so they get a raw view too.
export const hasRawView = (p) => /\.(md|mmd)$/i.test(p);

// Called after every render: the view switcher in the breadcrumb bar.
// md / mmd: rendered | raw | edit. json / yaml (already shown as source): edit.
// "edit" only where this client may write.
export function onFileShown(p) {
  if (!p) return;
  const views = [...(hasRawView(p) ? ['rendered', 'raw'] : []), ...(state.writable ? ['edit'] : [])];
  if (!views.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'view-switch';
  for (const v of views) {
    const btn = document.createElement('button');
    btn.dataset.view = v;
    btn.textContent = v;
    if (v === 'edit') btn.title = 'edit source (e)';
    btn.addEventListener('click', () => switchView(p, v));
    wrap.appendChild(btn);
  }
  breadcrumbEl.appendChild(wrap);
  markView(hasRawView(p) ? state.view : null);
}

function markView(v) {
  for (const b of breadcrumbEl.querySelectorAll('.view-switch button')) b.classList.toggle('on', b.dataset.view === v);
}

function switchView(p, v) {
  if (v === 'edit') { if (!session) startEditing(p); return; }
  if (session && !confirmLeave()) return;
  state.view = v;
  openFile(p);
}

// Live reload saw this file change while it was open in the editor.
export function onDiskChange() {
  if (!session) return;
  showNotice('this file changed on disk since you opened it', [
    ['reload', () => { session.original = session.textarea.value; startEditing(session.path); }],
    ['keep mine', () => hideNotice()]
  ]);
}

async function startEditing(p) {
  let data;
  try {
    const res = await fetch(`/api/source?p=${encodeURIComponent(p)}`);
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch {
    toast(`couldn't load ${p} for editing`);
    return;
  }
  const crlf = data.content.includes('\r\n');
  const text = crlf ? data.content.replace(/\r\n/g, '\n') : data.content;

  contentEl.innerHTML =
    `<div class="editor">` +
      `<div class="editor-bar">` +
        `<span class="editor-name">${esc(p.split('/').pop())}</span>` +
        `<span class="editor-dirty" hidden>unsaved</span>` +
        `<span class="editor-spacer"></span>` +
        `<span class="editor-hint">⌘S save · esc cancel</span>` +
        `<button class="editor-btn" data-act="cancel">cancel</button>` +
        `<button class="editor-btn primary" data-act="save">save</button>` +
      `</div>` +
      `<div class="editor-notice" hidden></div>` +
      `<textarea class="editor-text" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>` +
    `</div>`;
  const textarea = contentEl.querySelector('.editor-text');
  textarea.value = text;
  session = { path: p, mtime: data.mtime, original: text, crlf, textarea, noticeEl: contentEl.querySelector('.editor-notice') };
  document.body.classList.add('editing');
  markView('edit');

  const dirtyEl = contentEl.querySelector('.editor-dirty');
  textarea.addEventListener('input', () => { dirtyEl.hidden = !isDirty(); });
  textarea.addEventListener('keydown', onKey);
  contentEl.querySelector('[data-act="save"]').addEventListener('click', () => save());
  contentEl.querySelector('[data-act="cancel"]').addEventListener('click', cancel);
  textarea.focus();
  textarea.setSelectionRange(0, 0);
}

function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    // two spaces, never a tab character - YAML forbids tabs for indentation
    e.preventDefault();
    const ta = e.target;
    if (e.shiftKey) { dedentLine(ta); return; }
    ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
}

function dedentLine(ta) {
  const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  const strip = ta.value.slice(start, start + 2).match(/^ {1,2}/)?.[0].length || 0;
  if (!strip) return;
  const caret = ta.selectionStart;
  ta.setRangeText('', start, start + strip, 'preserve');
  ta.setSelectionRange(Math.max(start, caret - strip), Math.max(start, caret - strip));
  ta.dispatchEvent(new Event('input'));
}

async function save(force = false) {
  if (!session) return;
  const { path, crlf, textarea } = session;
  const content = crlf ? textarea.value.replace(/\n/g, '\r\n') : textarea.value;
  let res;
  try {
    res = await fetch('/api/source', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, content, mtime: session.mtime, force })
    });
  } catch {
    toast('save failed - is projview still running?');
    return;
  }
  if (res.status === 409) {
    showNotice('this file changed on disk since you opened it', [
      ['overwrite', () => save(true)],
      ['reload theirs', () => { session.original = session.textarea.value; startEditing(path); }]
    ]);
    return;
  }
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    toast(error || `save failed (${res.status})`);
    return;
  }
  session = null;
  document.body.classList.remove('editing');
  toast(`saved ${path.split('/').pop()}`);
  openFile(path);
}

function cancel() {
  if (!session) return;
  const p = session.path;
  if (confirmLeave()) openFile(p);
}

function showNotice(msg, actions) {
  const el = session.noticeEl;
  el.replaceChildren(document.createTextNode(msg));
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.className = 'editor-btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    el.appendChild(b);
  }
  el.hidden = false;
}

function hideNotice() { if (session) session.noticeEl.hidden = true; }

// "e" opens the editor on the current page, unless the user is typing somewhere
document.addEventListener('keydown', (e) => {
  if (e.key !== 'e' || e.metaKey || e.ctrlKey || e.altKey || session) return;
  if (e.target.closest?.('input, textarea, [contenteditable]') || !state.writable || !state.currentPath) return;
  if (!$('palette').hidden) return;
  e.preventDefault();
  startEditing(state.currentPath);
});

window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });
