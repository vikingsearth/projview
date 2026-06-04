/* mermaid rendering (per-diagram, with error cards) + zoom overlay */

import { $, esc } from './dom.js';

const mermaid = window.mermaid;   // UMD global, loaded via classic <script> before this module
const contentEl = $('content');
const zoomEl = $('zoom');
const zoomInnerEl = $('zoom-inner');

let mermaidSeq = 0;               // unique id source for mermaid.render

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  suppressErrorRendering: true   // we render our own error card; don't inject the default bomb
});

// Render each .mermaid block individually so one bad diagram can't kill the rest.
export async function runMermaid() {
  const nodes = [...contentEl.querySelectorAll('.mermaid')];
  for (const node of nodes) {
    const src = node.textContent.trim();
    try {
      const { svg, bindFunctions } = await mermaid.render(`pv-mmd-${++mermaidSeq}`, src);
      node.innerHTML = svg;
      bindFunctions?.(node);
      node.classList.add('rendered');
      node.title = 'click to zoom';
      node.addEventListener('click', () => openZoom(node.querySelector('svg')?.outerHTML || ''));
    } catch (err) {
      node.classList.add('mermaid-error');
      node.innerHTML =
        `<div class="diagram-error"><strong>⚠ diagram failed to render</strong>` +
        `<pre class="err-msg">${esc(String(err && err.message ? err.message : err))}</pre>` +
        `<details><summary>source</summary><pre>${esc(src)}</pre></details></div>`;
    }
  }
}

/* ---------- zoom overlay ---------- */

let zoomState = { scale: 1, x: 0, y: 0 };
let zoomDrag = null;

function applyZoom() {
  zoomInnerEl.style.transform =
    `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.scale})`;
}
function openZoom(svgHtml) {
  if (!svgHtml) return;
  zoomInnerEl.innerHTML = svgHtml;
  zoomState = { scale: 1, x: 0, y: 0 };
  applyZoom();
  zoomEl.hidden = false;
}
function closeZoom() { zoomEl.hidden = true; zoomInnerEl.innerHTML = ''; }

zoomEl.addEventListener('click', (e) => { if (e.target === zoomEl) closeZoom(); });
zoomEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomState.scale = Math.min(8, Math.max(0.3, zoomState.scale * factor));
  applyZoom();
}, { passive: false });
zoomInnerEl.addEventListener('pointerdown', (e) => {
  zoomDrag = { x: e.clientX, y: e.clientY, ox: zoomState.x, oy: zoomState.y };
  zoomInnerEl.setPointerCapture(e.pointerId);
});
zoomInnerEl.addEventListener('pointermove', (e) => {
  if (!zoomDrag) return;
  zoomState.x = zoomDrag.ox + (e.clientX - zoomDrag.x);
  zoomState.y = zoomDrag.oy + (e.clientY - zoomDrag.y);
  applyZoom();
});
zoomInnerEl.addEventListener('pointerup', () => { zoomDrag = null; });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !zoomEl.hidden) closeZoom(); });
