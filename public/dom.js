/* tiny DOM helpers shared across modules */

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function cssEsc(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/"/g, '\\"');
}
