/* left-nav file tree: render, expand/collapse, reveal */

import { $, esc, cssEsc } from './dom.js';
import { SVG_FOLDER, fileIcon } from './icons.js';
import { state } from './store.js';
import { openFile } from './viewer.js';

const treeEl = $('tree');
const fileCountEl = $('file-count');
const rootNameEl = $('root-name');
let fileCount = 0;

export async function loadTree() {
  const res = await fetch('/api/tree');
  const { root, tree } = await res.json();
  state.treeData = tree;
  state.rootName = root;
  rootNameEl.textContent = root;
  document.title = `${root} · projview`;
  renderTree();
}

// (Re)build the tree DOM. Indentation comes from nesting children inside
// .children containers (which carry the guide line).
export function renderTree() {
  fileCount = 0;
  treeEl.replaceChildren(...state.treeData.map(renderNode));
  fileCountEl.textContent = String(fileCount);
  markActive(state.currentPath);
}

function renderNode(node) {
  if (node.type === 'dir') return renderDir(node, node.children.map(renderNode));
  fileCount++;
  return renderFileRow(node);
}

function renderDir(node, kidEls) {
  const open = state.expanded.has(node.path);
  const wrap = document.createElement('div');
  const row = document.createElement('button');
  row.className = 'row dir';
  row.dataset.path = node.path;
  row.innerHTML =
    `<span class="twist">${open ? '▾' : '▸'}</span>` +
    `<span class="ico">${SVG_FOLDER}</span>` +
    `<span class="label">${esc(node.name)}</span>`;

  const kids = document.createElement('div');
  kids.className = 'children';
  kids.hidden = !open;
  for (const el of kidEls) kids.appendChild(el);

  row.addEventListener('click', () => {
    const nowOpen = kids.hidden;
    kids.hidden = !nowOpen;
    if (nowOpen) state.expanded.add(node.path); else state.expanded.delete(node.path);
    row.querySelector('.twist').textContent = nowOpen ? '▾' : '▸';
  });

  wrap.appendChild(row);
  wrap.appendChild(kids);
  return wrap;
}

function renderFileRow(node) {
  const row = document.createElement('button');
  row.className = 'row file' + (node.path === state.currentPath ? ' active' : '');
  row.dataset.path = node.path;
  row.innerHTML =
    `<span class="twist"></span>` +
    `<span class="ico ico-${node.ext === '.mmd' ? 'mmd' : 'md'}">${fileIcon(node.ext)}</span>` +
    `<span class="label">${esc(node.name)}</span>`;
  row.addEventListener('click', () => openFile(node.path));
  return row;
}

export function markActive(p) {
  for (const el of treeEl.querySelectorAll('.row.file.active')) el.classList.remove('active');
  if (!p) return;
  const el = treeEl.querySelector(`.row.file[data-path="${cssEsc(p)}"]`);
  if (el) el.classList.add('active');
}

// Expand every ancestor dir of a path. Returns true if anything changed.
function expandAncestors(p) {
  const parts = p.split('/');
  let changed = false;
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    if (!state.expanded.has(dir)) { state.expanded.add(dir); changed = true; }
  }
  return changed;
}

// Reveal a file in the nav: expand ancestors, re-mark active, scroll into view.
export function revealInTree(p) {
  if (!p) return;
  if (expandAncestors(p)) renderTree(); else markActive(p);
  const el = treeEl.querySelector(`.row.file[data-path="${cssEsc(p)}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// Reveal a directory (from a breadcrumb click): expand it + ancestors, scroll to it.
export function revealDir(dirPath) {
  expandAncestors(dirPath + '/x');   // expand dirPath and all its ancestors
  state.expanded.add(dirPath);
  renderTree();
  const el = treeEl.querySelector(`.row.dir[data-path="${cssEsc(dirPath)}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}
