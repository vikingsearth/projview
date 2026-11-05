import fsp from 'node:fs/promises';

// Bytes sniffed for a NUL: text never has one, binary almost always does early.
const SNIFF_BYTES = 8000;

// A file's text, decoded by its BOM: UTF-16 (SSMS scripts, PowerShell 5.1
// output) as well as UTF-8. null for binary - a .ts that is really an MPEG-TS
// video segment, say - so callers show a notice instead of decoded garbage.
export async function readText(abs) {
  const buf = await fsp.readFile(abs);
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  if (buf.subarray(0, SNIFF_BYTES).includes(0)) return null;
  return buf.toString('utf8');
}

// Bytes for `text` in the encoding the file at `abs` already has (its BOM), so
// saving a UTF-16 file from the editor keeps it UTF-16. UTF-8 otherwise.
export async function encodeLike(abs, text) {
  let head = Buffer.alloc(0);
  try { const fh = await fsp.open(abs, 'r'); try { ({ buffer: head } = await fh.read(Buffer.alloc(2), 0, 2, 0)); } finally { await fh.close(); } } catch { /* new file */ }
  if (head[0] === 0xff && head[1] === 0xfe) return Buffer.concat([head, Buffer.from(text, 'utf16le')]);
  if (head[0] === 0xfe && head[1] === 0xff) return Buffer.concat([head, Buffer.from(text, 'utf16le').swap16()]);
  return Buffer.from(text, 'utf8');
}
