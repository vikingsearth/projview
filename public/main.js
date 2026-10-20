/* projview client entry - wires the modules and boots */

import { state } from './store.js';
import { loadTree } from './tree.js';
import { openFile } from './viewer.js';
import { connectEvents } from './live.js';

// side-effect modules: each attaches its own listeners on import
import './links.js';
import './toc.js';
import { lightScheme } from './mermaid.js';
import './search.js';
import './comments.js';

// browser back / forward
window.addEventListener('hashchange', () => {
  const p = decodeURIComponent(location.hash.slice(1));
  if (p && p !== state.currentPath) openFile(p);   // guard prevents self-trigger loop
});

// OS light/dark switch: CSS follows on its own; diagrams are baked SVG, so re-render
lightScheme.addEventListener('change', () => { if (state.currentPath) openFile(state.currentPath); });

async function boot() {
  await loadTree();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) openFile(hash);   // openFile -> revealInTree expands ancestors
  connectEvents();
}

boot();
