/* live reload via server-sent events */

import { $ } from './dom.js';
import { state } from './store.js';
import { loadTree } from './tree.js';
import { openFile } from './viewer.js';
import { refreshComments } from './comments.js';

const versionEl = $('version');

export function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('change', (e) => {
    const { path } = JSON.parse(e.data);
    if (path === state.currentPath) { pulse(); openFile(path); }
  });
  es.addEventListener('tree', async () => { pulse(); await loadTree(); });
  es.addEventListener('comments', (e) => {
    const { file } = JSON.parse(e.data || '{}');
    if (!file || file === state.currentPath) refreshComments();
  });
}

// brief flash of the version line as live-reload feedback
let pulseTimer;
function pulse() {
  versionEl.classList.add('pulse');
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => versionEl.classList.remove('pulse'), 700);
}
