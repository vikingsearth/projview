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

/* ---------- zoom overlay (svg-pan-zoom: crisp vector zoom, pan, control bar) ---------- */

const svgPanZoom = window.svgPanZoom;   // UMD global from /vendor/svg-pan-zoom.min.js
let panzoom = null;                     // active instance, if any

function openZoom(svgHtml) {
  if (!svgHtml) return;
  zoomInnerEl.innerHTML = svgHtml;
  const svg = zoomInnerEl.querySelector('svg');
  if (!svg) return;

  // hand sizing to svg-pan-zoom: fill the stage and drop mermaid's max-width cap,
  // so zoom stays vector-crisp (no rasterised CSS-transform blur)
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.maxWidth = 'none';
  svg.style.width = '100%';
  svg.style.height = '100%';

  zoomEl.hidden = false;
  // wait two frames so the just-shown overlay is laid out before svg-pan-zoom
  // measures it - a single rAF fires too early and it inits on a 0-size stage
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (zoomEl.hidden || !svg.isConnected) return;   // closed again before we got here
    panzoom = svgPanZoom(svg, {
      zoomEnabled: true,
      panEnabled: true,
      controlIconsEnabled: true,   // built-in zoom in / out / reset / fit bar
      fit: true,
      center: true,
      minZoom: 0.2,
      maxZoom: 30,
      zoomScaleSensitivity: 0.3
    });
  }));
}

function closeZoom() {
  if (panzoom) { panzoom.destroy(); panzoom = null; }
  zoomEl.hidden = true;
  zoomInnerEl.innerHTML = '';
}

zoomEl.addEventListener('click', (e) => { if (e.target === zoomEl) closeZoom(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !zoomEl.hidden) closeZoom(); });
