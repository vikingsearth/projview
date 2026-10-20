/* light / dark theme: the user's choice (system / light / dark) resolved to
 * data-theme="light|dark" on <html>, which the CSS keys off. The inline script
 * in index.html applies the same resolution before first paint. */

import { $ } from './dom.js';

const KEY = 'pv-theme';
const PREFS = ['system', 'light', 'dark'];
const osLight = matchMedia('(prefers-color-scheme: light)');
const listeners = new Set();
const btn = $('theme-toggle');

const ICONS = {
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
};

function readPref() {
  try { const p = localStorage.getItem(KEY); return PREFS.includes(p) ? p : 'system'; } catch { return 'system'; }
}
function writePref(p) {
  try { localStorage.setItem(KEY, p); } catch { /* private window etc. - choice lasts this page only */ }
}

let pref = readPref();

export const currentTheme = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

// Diagrams are baked SVG, so their owners re-render when the theme flips.
export function onThemeChange(fn) { listeners.add(fn); }

function apply() {
  const before = currentTheme();
  const theme = pref === 'system' ? (osLight.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = theme;
  btn.innerHTML = ICONS[pref];
  btn.title = `theme: ${pref} (click to change)`;
  if (theme !== before) for (const fn of listeners) fn(theme);
}

btn.addEventListener('click', () => {
  pref = PREFS[(PREFS.indexOf(pref) + 1) % PREFS.length];
  writePref(pref);
  apply();
});
osLight.addEventListener('change', () => { if (pref === 'system') apply(); });

apply();
