/* pure path helpers (no DOM) - importable by tests */

// Resolve an href relative to the directory of `fromFile` (both posix-style,
// repo-root-relative). Handles '.', '..', and bare names.
export function resolveRelative(fromFile, href) {
  const baseDir = fromFile && fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const parts = baseDir ? baseDir.split('/') : [];
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}
