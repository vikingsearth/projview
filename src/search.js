import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildTree } from './walk.js';
import { createStore } from './store.js';

// In-memory index: relPath -> { path, name, content, lower }. Search always runs
// over this; a Store (optional, opt-in) just persists/warm-starts the entries.
const index = new Map();
let theRoot = null;

function flattenFiles(nodes, acc = []) {
  for (const n of nodes) {
    if (n.type === 'dir') flattenFiles(n.children, acc);
    else acc.push(n);
  }
  return acc;
}

function addToIndex(rel, content) {
  index.set(rel, { path: rel, name: rel.split('/').pop(), content, lower: content.toLowerCase() });
}

// Build the index for `root`. With a persisted store, loads the cached entries
// and only re-reads files whose mtime changed (warm start); else reads them all.
// Returns the store + a small summary, so the caller can close it on shutdown.
export async function buildIndex(root, store) {
  theRoot = root;
  index.clear();
  store = store || createStore({ kind: 'memory' }, root);

  const cached = await store.load();
  const cachedByPath = new Map((cached?.entries || []).map((e) => [e.path, e]));
  const files = flattenFiles(buildTree(root));
  let reindexed = 0;

  const entries = await Promise.all(files.map(async (f) => {
    const abs = path.join(root, f.path);
    let mtime = 0;
    try { mtime = (await fsp.stat(abs)).mtimeMs; } catch { /* gone */ }
    const prev = cachedByPath.get(f.path);
    let content;
    if (prev && prev.mtime === mtime) {
      content = prev.content;                       // unchanged -> reuse cached
    } else {
      reindexed++;
      try { content = await fsp.readFile(abs, 'utf8'); } catch { content = ''; }
    }
    return { path: f.path, name: f.name, ext: f.ext, mtime, content };
  }));

  for (const e of entries) addToIndex(e.path, e.content);
  await store.save(entries);
  return { store, total: entries.length, reindexed, warm: !!cached };
}

// Re-read one file into the in-memory index; return its store entry (or null).
export async function updateFile(rel) {
  if (!theRoot) return null;
  const abs = path.join(theRoot, rel);
  try {
    const [content, stat] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)]);
    addToIndex(rel, content);
    return { path: rel, name: rel.split('/').pop(), ext: path.extname(rel).toLowerCase(), mtime: stat.mtimeMs, content };
  } catch { return null; }
}

export function removeFile(rel) { index.delete(rel); }

// Subsequence fuzzy match. null if `q` isn't a subsequence of `text`, else a
// score where contiguous runs and word-boundary hits are rewarded.
export function fuzzyScore(text, q) {
  if (!q) return 0;
  let ti = 0, score = 0, run = 0, prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = -1;
    while (ti < text.length) { if (text[ti] === c) { found = ti; break; } ti++; }
    if (found === -1) return null;
    if (found === prev + 1) { run++; score += 4 + run; } else { run = 0; score += 1; }
    if (found === 0 || /[\/\-_. ]/.test(text[found - 1])) score += 5;   // word boundary
    prev = found;
    ti = found + 1;
  }
  if (text.includes(q)) score += 12;                                    // exact substring
  score += Math.max(0, 8 - Math.floor((text.length - q.length) / 4));   // prefer concise
  return score;
}

export function search(q, { maxFiles = 8, maxContent = 10, snippetsPerFile = 3 } = {}) {
  const query = (q || '').trim();
  if (!query) return { query: '', files: [], content: [] };
  const ql = query.toLowerCase();
  const terms = ql.split(/\s+/).filter(Boolean);

  // --- filename: fuzzy, ranked ---
  const files = [];
  for (const item of index.values()) {
    const s = fuzzyScore(item.name.toLowerCase(), ql);
    const sp = fuzzyScore(item.path.toLowerCase(), ql);
    const score = Math.max(s ?? -1, sp ?? -1);
    if (score >= 0) files.push({ path: item.path, name: item.name, score });
  }
  files.sort((a, b) => b.score - a.score);

  // --- contents: every term must appear (AND), ranked by frequency ---
  const content = [];
  for (const item of index.values()) {
    if (!terms.every((t) => item.lower.includes(t))) continue;
    const lines = item.content.split(/\r?\n/);
    const snippets = [];
    let freq = 0;
    for (let i = 0; i < lines.length; i++) {
      const ll = lines[i].toLowerCase();
      let lineHas = false;
      for (const t of terms) {
        let idx = 0;
        while ((idx = ll.indexOf(t, idx)) !== -1) { freq++; idx += t.length; lineHas = true; }
      }
      if (lineHas && snippets.length < snippetsPerFile) {
        snippets.push({ line: i + 1, text: lines[i].trim().slice(0, 160) });
      }
    }
    const nameBonus = item.name.toLowerCase().includes(ql) ? 6 : 0;
    content.push({ path: item.path, name: item.name, score: freq + nameBonus, count: freq, snippets });
  }
  content.sort((a, b) => b.score - a.score);

  return { query, files: files.slice(0, maxFiles), content: content.slice(0, maxContent) };
}
