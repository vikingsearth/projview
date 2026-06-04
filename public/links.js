/* in-app link routing for clicks inside rendered content */

import { $ } from './dom.js';
import { state } from './store.js';
import { resolveRelative } from './paths.js';
import { openFile, scrollToFragment } from './viewer.js';
import { toast } from './toast.js';

const contentEl = $('content');

contentEl.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href) return;

  // external / protocol links -> new tab, keep projview alive
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
    e.preventDefault();
    window.open(href, '_blank', 'noopener');
    return;
  }

  e.preventDefault();
  if (href.startsWith('#')) { scrollToFragment(href.slice(1)); return; }   // same-doc anchor

  const [pathPart, frag] = href.split('#');
  const target = resolveRelative(state.currentPath, pathPart);
  if (/\.(md|mmd)$/i.test(target)) openFile(target, frag);
  else toast(`can't preview "${pathPart}" - only .md / .mmd for now`);
});
