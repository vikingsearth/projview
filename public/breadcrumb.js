/* clickable path breadcrumb at the top of the viewer */

import { $ } from './dom.js';
import { state } from './store.js';
import { revealDir } from './tree.js';

const breadcrumbEl = $('breadcrumb');

export function renderBreadcrumb(p) {
  if (!p) { breadcrumbEl.hidden = true; return; }
  breadcrumbEl.hidden = false;
  const parts = p.split('/');
  const frag = document.createDocumentFragment();

  const root = document.createElement('span');
  root.className = 'crumb root';
  root.textContent = state.rootName;
  frag.appendChild(root);

  let acc = '';
  parts.forEach((seg, i) => {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '/';
    frag.appendChild(sep);

    acc = acc ? `${acc}/${seg}` : seg;
    const isFile = i === parts.length - 1;
    const crumb = document.createElement(isFile ? 'span' : 'button');
    crumb.className = 'crumb' + (isFile ? ' current' : ' dir');
    crumb.textContent = seg;
    if (!isFile) {
      const dirPath = acc;
      crumb.addEventListener('click', () => revealDir(dirPath));
    }
    frag.appendChild(crumb);
  });
  breadcrumbEl.replaceChildren(frag);
}
