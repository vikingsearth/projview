import fs from 'node:fs';
import path from 'node:path';
import { CODE_LANGS } from '../public/codetypes.js';

// Directories we never descend into - noise or huge. Includes the dependency /
// build dirs of code ecosystems (python venv, .NET obj, cargo / maven target,
// CocoaPods), which would otherwise flood the tree with someone else's source.
const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage',
  '.cache', '.turbo', 'vendor', '.venv', '__pycache__',
  'venv', 'site-packages', 'obj', 'target', 'Pods', 'bower_components'
]);

// Docs + data types; code types (CODE_LANGS) are previewable too, unless turned off.
export const PREVIEWABLE_EXTS = new Set(['.md', '.mmd', '.json', '.yml', '.yaml']);

// Previewable by extension but machine-generated noise - huge, never read.
const IGNORED_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml']);
// Minified code bundles - one enormous line, unreadable as source. Code only:
// a one-line .min.json is exactly what the JSON view pretty-prints.
const MINIFIED = /\.min\.[^.]+$/i;

// True if a path segment should stop the walk (ignored name or any dot-dir).
export function isIgnoredDir(name) {
  return IGNORED_DIRS.has(name) || name.startsWith('.');
}

// True if any directory in a root-relative path is one the walk skips - so a
// file hidden from the tree can't be fetched by typing its path either.
export function isHiddenPath(relPath) {
  return relPath.split(/[\\/]/).slice(0, -1).some(isIgnoredDir);
}

// `code: false` leaves code files out (an exposed host serves docs + data only).
export function isPreviewable(filePath, { code = true } = {}) {
  const name = path.basename(filePath);
  if (IGNORED_FILES.has(name.toLowerCase())) return false;
  const ext = path.extname(name).toLowerCase();
  if (Object.hasOwn(CODE_LANGS, ext)) return code && !MINIFIED.test(name);
  return PREVIEWABLE_EXTS.has(ext);
}

// Dirs first, then files, each alphabetical (case-insensitive).
function byNameDirsFirst(a, b) {
  if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

// Recursively build a tree of only the dirs that (transitively) contain
// previewable files. Returns the root's children array.
export function buildTree(root, opts) {
  function walk(absDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes = [];
    for (const entry of entries.sort(byNameDirsFirst)) {
      const abs = path.join(absDir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name)) continue;
        const children = walk(abs);
        if (children.length) nodes.push({ name: entry.name, path: rel, type: 'dir', children });
      } else if (entry.isFile() && isPreviewable(entry.name, opts)) {
        nodes.push({ name: entry.name, path: rel, type: 'file', ext: path.extname(entry.name).toLowerCase() });
      }
    }
    return nodes;
  }
  return walk(root);
}

// Flat count of file nodes in a tree (for the boot summary).
export function countFiles(nodes) {
  return nodes.reduce((n, node) => n + (node.type === 'file' ? 1 : countFiles(node.children)), 0);
}
