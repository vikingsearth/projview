/* transient bottom toast for non-blocking notices */

import { $ } from './dom.js';

const toastEl = $('toast');
let toastTimer;

export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  void toastEl.offsetWidth;   // reflow so the transition replays on rapid repeats
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
