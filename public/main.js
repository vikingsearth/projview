/* projview client entry - wires the modules and boots */

import { state } from './store.js';
import { loadTree } from './tree.js';
import { openFile } from './viewer.js';
import { connectEvents } from './live.js';

// side-effect modules: each attaches its own listeners on import
import './links.js';
import './toc.js';
import { runMermaid } from './mermaid.js';
import { onThemeChange } from './theme.js';
import './search.js';
import './comments.js';
import './editor.js';

// browser back / forward
window.addEventListener('hashchange', () => {
  const p = decodeURIComponent(location.hash.slice(1));
  if (p && p !== state.currentPath) openFile(p);   // guard prevents self-trigger loop
});

// light/dark flip: CSS follows on its own; diagrams are baked SVG, so redraw them
// in place (no re-fetch, no scroll jump, an open editor is left alone)
onThemeChange(() => runMermaid({ rerender: true }));

async function boot() {
  await loadTree();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) openFile(hash);   // openFile -> revealInTree expands ancestors
  connectEvents();
}

boot();
