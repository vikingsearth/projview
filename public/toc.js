/* right-side table of contents (h1-h3) + scroll-spy + collapse */

import { $ } from './dom.js';
import { scrollToFragment } from './viewer.js';

const contentEl = $('content');
const viewerEl = $('viewer');
const tocListEl = $('toc-list');

let tocEntries = [];   // [{ id, el, link }]
let spyLock = 0;       // timestamp until which scroll-spy yields to a click

function setActive(current) {
  for (const entry of tocEntries) entry.link.classList.toggle('active', entry === current);
}

export function buildToc() {
  const headings = [...contentEl.querySelectorAll('h1, h2, h3')].filter((h) => h.id);
  tocEntries = [];
  if (!headings.length) {
    document.body.classList.add('toc-empty');
    tocListEl.replaceChildren();
    return;
  }
  document.body.classList.remove('toc-empty');
  const frag = document.createDocumentFragment();
  for (const h of headings) {
    const link = document.createElement('button');
    link.className = `toc-item lvl-${h.tagName.toLowerCase()}`;
    link.textContent = h.textContent;
    const entry = { id: h.id, el: h, link };
    link.addEventListener('click', () => {
      scrollToFragment(h.id);
      setActive(entry);                       // clicked item wins immediately
      spyLock = performance.now() + 700;      // and holds briefly against scroll-spy
    });
    frag.appendChild(link);
    tocEntries.push(entry);
  }
  tocListEl.replaceChildren(frag);
  updateScrollSpy();
}

function updateScrollSpy() {
  if (!tocEntries.length || performance.now() < spyLock) return;   // a recent click wins
  const top = viewerEl.scrollTop + 90;
  let current = tocEntries[0];
  for (const entry of tocEntries) {
    if (entry.el.offsetTop <= top) current = entry; else break;
  }
  setActive(current);
}

let spyRaf = 0;
viewerEl.addEventListener('scroll', () => {
  if (spyRaf) return;
  spyRaf = requestAnimationFrame(() => { spyRaf = 0; updateScrollSpy(); });
});

$('toc-collapse').addEventListener('click', () => document.body.classList.add('toc-collapsed'));
$('toc-reopen').addEventListener('click', () => document.body.classList.remove('toc-collapsed'));
