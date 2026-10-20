/* history view: the file's earlier versions (newest first), each viewable as the
 * file would render, and restorable. Versions are kept by the server whenever a
 * file changes - from projview's editor or anywhere else. Restoring is an
 * ordinary save, so the text it replaces becomes a version too. */

import { $, esc } from './dom.js';
import { state } from './store.js';
import { openFile } from './viewer.js';
import { runMermaid } from './mermaid.js';
import { toast } from './toast.js';

const contentEl = $('content');

let open = null;   // { path, selected, mtime } while the history view is showing - mtime of the file as shown

export const isHistory = (p) => !!open && (p === undefined || open.path === p);

// The viewer calls this before rendering anything else.
export function leaveHistory() {
  open = null;
  document.body.classList.remove('history');
}

export async function showHistory(p) {
  open = { path: p, selected: 'current' };
  document.body.classList.add('history');
  await refreshHistory();
}

// Re-list (live reload calls this when the file changes while history is open).
export async function refreshHistory() {
  if (!open) return;
  const p = open.path;
  let data, mtime = null;
  try {
    const [res, src] = await Promise.all([
      fetch(`/api/versions?p=${encodeURIComponent(p)}`),
      state.writable ? fetch(`/api/source?p=${encodeURIComponent(p)}`) : null
    ]);
    if (!res.ok) throw new Error();
    data = await res.json();
    if (src?.ok) ({ mtime } = await src.json());
  } catch {
    toast(`couldn't load history for ${p}`);
    return;
  }
  if (!isHistory(p)) return;
  open.mtime = mtime;   // restore checks the file is still what "current" showed
  const keep = state.persistent ? 'kept across runs' : 'kept until projview stops';
  const rows = [{ id: 'current', label: 'current', when: null }, ...data.versions.map((v) => { const when = v.mtime ?? v.replacedAt; return { id: v.id, label: clock(when), sub: ago(when), when, size: v.size }; })];
  if (!rows.some((r) => r.id === open.selected)) open.selected = 'current';

  contentEl.innerHTML =
    `<div class="history-view">` +
      `<div class="history-bar">` +
        `<span class="history-name">${esc(p.split('/').pop())}</span>` +
        `<span class="history-hint">last ${data.limit} earlier versions · ${keep}</span>` +
      `</div>` +
      `<div class="history-panes">` +
        `<div class="history-list" aria-label="versions">` +
          rows.map((r) =>
            `<button class="history-item" data-id="${esc(r.id)}"${r.when ? ` title="${esc(new Date(r.when).toLocaleString())}"` : ''}>` +
              `<span class="hi-label">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>` +
              (r.size != null ? `<span class="hi-size">${fmtSize(r.size)}</span>` : '') +
            `</button>`).join('') +
          (data.versions.length ? '' : `<p class="history-empty">no earlier versions yet - they appear here as the file changes</p>`) +
        `</div>` +
        `<div class="history-pane">` +
          `<div class="history-pane-bar"></div>` +
          `<div class="history-preview markdown-body"></div>` +
        `</div>` +
      `</div>` +
    `</div>`;
  for (const b of contentEl.querySelectorAll('.history-item')) b.addEventListener('click', () => select(b.dataset.id));
  await select(open.selected);
}

async function select(id) {
  if (!open) return;
  const p = open.path;
  open.selected = id;
  for (const b of contentEl.querySelectorAll('.history-item')) {
    if (b.dataset.id === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  }
  const bar = contentEl.querySelector('.history-pane-bar');
  const preview = contentEl.querySelector('.history-preview');

  let html, version = null;
  try {
    if (id === 'current') {
      ({ html } = await (await fetch(`/api/file?p=${encodeURIComponent(p)}`)).json());
    } else {
      version = await (await fetch(`/api/versions/${encodeURIComponent(id)}`)).json();
      ({ html } = await (await fetch('/api/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: p, content: version.content })
      })).json());
    }
  } catch {
    toast('couldn’t load that version');
    return;
  }
  if (!isHistory(p) || open.selected !== id) return;   // moved on while loading

  bar.replaceChildren();
  const label = document.createElement('span');
  label.textContent = version ? `version from ${new Date(version.mtime ?? version.replacedAt).toLocaleString()}` : 'the file as it is now';
  bar.appendChild(label);
  if (version && state.writable) {
    const btn = document.createElement('button');
    btn.className = 'editor-btn primary';
    btn.textContent = 'restore this version';
    btn.addEventListener('click', () => restore(p, version));
    bar.appendChild(btn);
  }
  preview.innerHTML = html;
  await runMermaid();
}

async function restore(p, version) {
  if (!confirm('restore this version? the current text is kept in history, so this can be undone.')) return;
  try {
    // the mtime from when history loaded: if the file changed since, the save is
    // refused (409) instead of overwriting a change the user never saw
    const res = await fetch('/api/source', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: p, content: version.content, mtime: open?.mtime })
    });
    if (res.status === 409) {
      toast('the file changed since you opened history - check the new list and try again');
      refreshHistory();
      return;
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
  } catch (err) {
    toast(`restore failed - ${err.message}`);
    return;
  }
  toast('restored - the replaced text is in history');
  openFile(p);
}

// 14:02:31 today, else a short date + time
function clock(ts) {
  const d = new Date(ts);
  const today = d.toDateString() === new Date().toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
