/* small monochrome inline icons (inherit currentColor) - shared by tree + palette */

import { codeLang } from './codetypes.js';

export const SVG_FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
export const SVG_FILE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;
export const SVG_DIAGRAM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><line x1="8.4" y1="10.7" x2="15.6" y2="6.3"/><line x1="8.4" y1="13.3" x2="15.6" y2="17.7"/></svg>`;

export const SVG_CODE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

export const SVG_DATA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>`;

// The client's one list of previewable types: ext -> kind (null if not previewable).
const KINDS = { '.md': 'md', '.mmd': 'mmd', '.json': 'data', '.yml': 'data', '.yaml': 'data' };
export const fileKind = (name) => KINDS[(name.match(/\.[^./]+$/)?.[0] || '').toLowerCase()] || (codeLang(name) ? 'code' : null);

export const fileIcon = (name) => ({ mmd: SVG_DIAGRAM, data: SVG_DATA, code: SVG_CODE }[fileKind(name)] || SVG_FILE);
