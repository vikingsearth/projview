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
