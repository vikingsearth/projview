/* pure in-file find helpers (no DOM) - importable by tests */

// Query -> distinct terms (compared case-insensitively), the same whitespace
// split the server search uses. Kept as typed: lowercasing can change a
// character (\u0130 -> i + U+0307) so it no longer matches under the i flag.
export function queryTerms(q) {
  const seen = new Set();
  return (q || '').split(/\s+/).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

// Every occurrence of any query term in `text`, as non-overlapping
// { start, end } offsets in document order. Longer terms win an overlap
// ("liver" over "live"). Stops after `limit` matches.
export function findMatches(text, q, limit = Infinity) {
  const terms = queryTerms(q).sort((a, b) => b.length - a.length);
  if (!terms.length || !text) return [];
  const re = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
  const out = [];
  let m;
  while (out.length < limit && (m = re.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// A one-line window around a match: whitespace collapsed, ellipses where cut.
export function snippet(text, start, end, radius = 30) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const flat = (s) => s.replace(/\s+/g, ' ');
  return {
    before: (from > 0 ? '…' : '') + flat(text.slice(from, start)).trimStart(),
    match: flat(text.slice(start, end)),
    after: flat(text.slice(end, to)).trimEnd() + (to < text.length ? '…' : '')
  };
}
