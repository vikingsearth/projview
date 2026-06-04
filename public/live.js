/* live reload via server-sent events */

import { $ } from './dom.js';
import { state } from './store.js';
import { loadTree } from './tree.js';
import { openFile } from './viewer.js';

const liveStatusEl = $('live-status');

export function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('change', (e) => {
    const { path } = JSON.parse(e.data);
    if (path === state.currentPath) { pulse(); openFile(path); }
  });
  es.addEventListener('tree', async () => { pulse(); await loadTree(); });
  es.onerror = () => setLive(false);
  es.addEventListener('ready', () => setLive(true));
}

function setLive(on) {
  liveStatusEl.classList.toggle('off', !on);
  liveStatusEl.querySelector('.dot')?.classList.toggle('off', !on);
}

let pulseTimer;
function pulse() {
  liveStatusEl.classList.add('pulse');
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => liveStatusEl.classList.remove('pulse'), 600);
}
