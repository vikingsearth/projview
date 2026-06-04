import fs from 'node:fs';
import path from 'node:path';

// Directories we never descend into - noise or huge.
const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage',
  '.cache', '.turbo', 'vendor', '.venv', '__pycache__'
]);

export const PREVIEWABLE_EXTS = new Set(['.md', '.mmd']);

// True if a path segment should stop the walk (ignored name or any dot-dir).
export function isIgnoredDir(name) {
  return IGNORED_DIRS.has(name) || name.startsWith('.');
}

export function isPreviewable(filePath) {
  return PREVIEWABLE_EXTS.has(path.extname(filePath).toLowerCase());
}

// Dirs first, then files, each alphabetical (case-insensitive).
function byNameDirsFirst(a, b) {
  if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

// Recursively build a tree of only the dirs that (transitively) contain
// previewable files. Returns the root's children array.
export function buildTree(root) {
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
      } else if (entry.isFile() && isPreviewable(entry.name)) {
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
