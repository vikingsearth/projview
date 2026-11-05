import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildTree } from './walk.js';
import { jsonDisplayText } from './render.js';
import { createStore } from './store.js';
import { readText } from './text.js';

// Files read at once while indexing - past the open-files limit, reads fail (EMFILE).
const READ_CONCURRENCY = 64;

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

function addToIndex(rel, source, mtime = null) {
  // index JSON as displayed (re-indented) so snippet line numbers match the viewer
  const content = rel.toLowerCase().endsWith('.json') ? jsonDisplayText(source).text : source;
  index.set(rel, {
    path: rel, name: rel.split('/').pop(), content, lower: content.toLowerCase(), mtime,
    raw: content === source ? undefined : source   // kept only when it differs, for versions
  });
}

// The file's text as last indexed - i.e. before the change being handled now.
// The server turns it into a version when the file changes. null if never indexed.
export function indexedSource(rel) {
  const item = index.get(rel);
  return item ? { content: item.raw ?? item.content, mtime: item.mtime } : null;
}

// Build the index for `root`. With a persisted store, loads the cached entries
// and only re-reads files whose mtime changed (warm start); else reads them all.
// Returns the store + a small summary, so the caller can close it on shutdown.
// `opts` go to the walk (e.g. { code: false } on an exposed host).
export async function buildIndex(root, store, opts) {
  theRoot = root;
  index.clear();
  store = store || createStore({ kind: 'memory' }, root);

  const cached = await store.load();
  const cachedByPath = new Map((cached?.entries || []).map((e) => [e.path, e]));
  const files = flattenFiles(buildTree(root, opts));
  let reindexed = 0;

  const entries = await mapLimit(files, READ_CONCURRENCY, async (f) => {
    const abs = path.join(root, f.path);
    let mtime = 0;
    try { mtime = (await fsp.stat(abs)).mtimeMs; } catch { /* gone */ }
    const prev = cachedByPath.get(f.path);
    let content;
    if (prev && prev.mtime === mtime) {
      content = prev.content;                       // unchanged -> reuse cached
    } else {
      reindexed++;
      // a failed read is indexed empty, with mtime 0 so the next start retries it
      // rather than reusing '' as if it were the file's text
      try { content = (await readText(abs)) ?? ''; } catch { content = ''; mtime = 0; }
    }
    return { path: f.path, name: f.name, ext: f.ext, mtime, content };
  });

  for (const e of entries) addToIndex(e.path, e.content, e.mtime);
  await store.save(entries);
  return { store, total: entries.length, reindexed, warm: !!cached };
}

// Promise.all over `items`, but with at most `limit` of `fn` running at once.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Re-read one file into the in-memory index; return its store entry (or null).
export async function updateFile(rel) {
  if (!theRoot) return null;
  const abs = path.join(theRoot, rel);
  try {
    const [text, stat] = await Promise.all([readText(abs), fsp.stat(abs)]);
    const content = text ?? '';   // binary: nothing to search
    addToIndex(rel, content, stat.mtimeMs);
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

// The first `max` lines of a file that hold any of `terms`.
function snippetsFor(item, terms, max) {
  const lines = item.content.split(/\r?\n/);
  const snippets = [];
  for (let i = 0; i < lines.length && snippets.length < max; i++) {
    const ll = lines[i].toLowerCase();
    if (terms.some((t) => ll.includes(t))) snippets.push({ line: i + 1, text: lines[i].trim().slice(0, 160) });
  }
  return snippets;
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
  // Counted on the lowercased text (terms hold no whitespace, so never span a
  // line); snippets are cut only for the files that make the cut.
  const content = [];
  for (const item of index.values()) {
    if (!terms.every((t) => item.lower.includes(t))) continue;
    let freq = 0;
    for (const t of terms) {
      for (let idx = item.lower.indexOf(t); idx !== -1; idx = item.lower.indexOf(t, idx + t.length)) freq++;
    }
    const nameBonus = item.name.toLowerCase().includes(ql) ? 6 : 0;
    content.push({ path: item.path, name: item.name, score: freq + nameBonus, count: freq, item });
  }
  content.sort((a, b) => b.score - a.score);
  const top = content.slice(0, maxContent).map(({ item, ...hit }) => ({ ...hit, snippets: snippetsFor(item, terms, snippetsPerFile) }));

  return { query, files: files.slice(0, maxFiles), content: top };
}
