import fs from 'node:fs';
import path from 'node:path';
import { CODE_LANGS, CODE_NAMES } from '../public/codetypes.js';

// Directories we never descend into - noise or huge. Includes the dependency /
// build dirs of code ecosystems (python venv, .NET obj, cargo / maven target,
// CocoaPods), which would otherwise flood the tree with someone else's source.
const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage',
  '.cache', '.turbo', 'vendor', '.venv', '__pycache__',
  'venv', 'site-packages', 'obj', 'target', 'pods', 'bower_components',
  // dot-dirs are listed (.github, .vscode, .claude, ...) except for VCS
  // internals, tool caches and build output
  '.git', '.hg', '.svn', '.next', '.nuxt', '.svelte-kit', '.output', '.parcel-cache',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.nox', '.gradle',
  '.terraform', '.yarn', '.pnpm-store', '.npm', '.idea', '.vs',
  // toolchain homes - thousands of files of someone else's code when the root is ~
  '.nvm', '.rustup', '.cargo', '.m2', '.pyenv', '.rbenv', '.sdkman', '.dotnet',
  '.nuget', '.deno', '.bun', '.local', '.oh-my-zsh', '.vscode-server', '.trash'
]);

// Dirs skipped only under a given parent - noise (extensions, plugin caches,
// worktrees that are whole copies of the repo) or secrets (gh's oauth token).
const IGNORED_UNDER = {
  '.claude': new Set(['worktrees', 'plugins']),
  '.vscode': new Set(['extensions']),
  '.cursor': new Set(['extensions']),
  '.config': new Set(['gh', 'gcloud'])
};

// Dot-dirs that hold credentials - never listed, so running projview at ~
// can't put an ssh key or a docker / kube / cloud token in the tree or index.
const SECRET_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.gcloud', '.docker', '.kube', '.password-store']);

// Docs + data types; code types (CODE_LANGS) are previewable too, unless turned off.
export const PREVIEWABLE_EXTS = new Set(['.md', '.mmd', '.json', '.yml', '.yaml']);

// Previewable by extension but machine-generated noise - huge, never read.
// .credentials.json is Claude Code's login store (~/.claude) - a secret, never listed.
const IGNORED_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', '.credentials.json']);
// Minified code bundles - one enormous line, unreadable as source. Code only:
// a one-line .min.json is exactly what the JSON view pretty-prints.
const MINIFIED = /\.min\.[^.]+$/i;

// True if segs[i] of a path is a directory the walk skips: an ignored or
// secret name, any dot-dir when `hidden` is off (an exposed host), or a name
// skipped under its parent (.claude/worktrees, .vscode/extensions, ...).
// Names compare lowercased (the sets are lowercase): on a case-insensitive
// filesystem (macOS, Windows) .config/GH and .Docker are the same dirs as
// .config/gh and .docker, and must be skipped the same.
// `root` (the served dir) gives the first segment its parent - so a root at
// ~/.config still skips gh/ - and a root inside a secret dir (~/.ssh, ~/.aws/sso)
// shows nothing at all.
function ignoredAt(segs, i, { hidden = true, root } = {}) {
  const name = segs[i].toLowerCase();
  if (IGNORED_DIRS.has(name) || SECRET_DIRS.has(name)) return true;
  if (!hidden && name.startsWith('.')) return true;
  const parent = i > 0 ? segs[i - 1].toLowerCase() : rootContext(root).parent;
  return Object.hasOwn(IGNORED_UNDER, parent) && IGNORED_UNDER[parent].has(name);
}

const rootContexts = new Map();
function rootContext(root) {
  if (!root) return { parent: '', secret: false };
  if (!rootContexts.has(root)) {
    const segs = path.resolve(root).split(/[\\/]/).filter(Boolean).map((s) => s.toLowerCase());
    rootContexts.set(root, { parent: segs.at(-1) || '', secret: segs.some((s) => SECRET_DIRS.has(s)) });
  }
  return rootContexts.get(root);
}

// True if any segment of a root-relative path is one the walk skips (the
// watcher's filter - it sees dirs and files alike).
export function isIgnoredPath(relPath, opts) {
  if (rootContext(opts?.root).secret) return true;
  const segs = relPath.split(/[\\/]/);
  return segs.some((_, i) => ignoredAt(segs, i, opts));
}

// True if any directory in a root-relative file path is one the walk skips -
// so a file hidden from the tree can't be fetched by typing its path either.
export function isHiddenPath(relPath, opts) {
  if (rootContext(opts?.root).secret) return true;
  const segs = relPath.split(/[\\/]/).slice(0, -1);
  return segs.some((_, i) => ignoredAt(segs, i, opts));
}

// `code: false` leaves code files out (an exposed host serves docs + data only);
// `hidden: false` leaves dotfiles out too (.secrets.yml in a plain dir).
export function isPreviewable(filePath, { code = true, hidden = true } = {}) {
  const name = path.basename(filePath);
  if (IGNORED_FILES.has(name.toLowerCase())) return false;
  if (!hidden && name.startsWith('.')) return false;
  if (Object.hasOwn(CODE_NAMES, name)) return code;   // .gitignore, .editorconfig, ...
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
  opts = { root, ...opts };
  if (rootContext(root).secret) return [];
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
        if (isIgnoredPath(rel, opts)) continue;
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
