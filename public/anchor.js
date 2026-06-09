/* text-quote re-anchoring - the pure part.
 *
 * findQuote() locates a {exact, prefix, suffix} selector in a flat string and
 * returns the best start offset, disambiguating repeated text by surrounding
 * context. It touches no DOM, so it's unit-testable directly (no jsdom). The
 * caller (comments.js) maps the offset back to a DOM Range. */

export const commonPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
export const commonSuffix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
};

// Best start offset of anchor.exact in `text`, or -1 if it isn't present.
// When `exact` repeats, the candidate whose surrounding text best matches
// prefix/suffix wins (ties -> earliest).
export function findQuote(text, anchor) {
  const exact = anchor.exact || '';
  if (!exact) return -1;
  const prefix = anchor.prefix || '';
  const suffix = anchor.suffix || '';
  let best = -1;
  let bestScore = -1;
  let idx = text.indexOf(exact);
  while (idx !== -1) {
    const before = text.slice(Math.max(0, idx - prefix.length), idx);
    const after = text.slice(idx + exact.length, idx + exact.length + suffix.length);
    const score = commonSuffix(before, prefix) + commonPrefix(after, suffix);
    if (score > bestScore) { bestScore = score; best = idx; }
    idx = text.indexOf(exact, idx + 1);
  }
  return best;
}
