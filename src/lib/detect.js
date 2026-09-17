// Format detection: magic bytes -> file extension -> content-type -> content sniffing -> hex fallback.
import { formatForExt } from './formats.js';
import { extOf, looksLikeText, decodeText } from './util.js';

const ascii = (s) => [...s].map(c => c.charCodeAt(0));
const MAGIC = [
  { fmt: 'gzip', comp: 'gzip', bytes: [0x1f, 0x8b] },
  { fmt: 'gzip', comp: 'zstd', bytes: [0x28, 0xb5, 0x2f, 0xfd] },
  { fmt: 'unsupported:bzip2', bytes: ascii('BZh') },
  { fmt: 'unsupported:xz', bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { fmt: 'unsupported:7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { fmt: 'unsupported:rar', bytes: ascii('Rar!') },
  { fmt: 'parquet', bytes: ascii('PAR1') },
  { fmt: 'arrow', bytes: ascii('ARROW1') },
  { fmt: 'unsupported:avro', bytes: [0x4f, 0x62, 0x6a, 0x01] },
  { fmt: 'unsupported:orc', bytes: ascii('ORC') },
  { fmt: 'unsupported:sqlite', bytes: ascii('SQLite format 3') },
  { fmt: 'pdf', bytes: ascii('%PDF') },
  { fmt: 'image', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { fmt: 'image', bytes: [0xff, 0xd8, 0xff] },
  { fmt: 'image', bytes: ascii('GIF8') },
  { fmt: 'image', bytes: ascii('BM') },
  { fmt: 'image', bytes: [0x00, 0x00, 0x01, 0x00] },
  { fmt: 'image', bytes: [0x49, 0x49, 0x2a, 0x00], note: 'tiff' },
  { fmt: 'image', bytes: [0x4d, 0x4d, 0x00, 0x2a], note: 'tiff' },
  { fmt: 'video', bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { fmt: 'audio', bytes: ascii('ID3') },
  { fmt: 'audio', bytes: ascii('fLaC') },
  { fmt: 'audio', bytes: ascii('OggS') },
  { fmt: 'ole', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }, // legacy xls/doc/ppt
  { fmt: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { fmt: 'zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
];

function matchMagic(bytes) {
  for (const m of MAGIC) {
    if (bytes.length < m.bytes.length) continue;
    let ok = true;
    for (let i = 0; i < m.bytes.length; i++) if (bytes[i] !== m.bytes[i]) { ok = false; break; }
    if (ok) return m;
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const kind = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === 'RIFF' && kind === 'WEBP') return { fmt: 'image' };
    if (riff === 'RIFF' && kind === 'WAVE') return { fmt: 'audio' };
    if (riff === 'RIFF' && kind === 'AVI ') return { fmt: 'video' };
    const ftyp = String.fromCharCode(...bytes.slice(4, 8));
    if (ftyp === 'ftyp') {
      const brand = String.fromCharCode(...bytes.slice(8, 12));
      if (/^(avif|avis|heic|heix|mif1)/.test(brand)) return { fmt: 'image' };
      if (/^M4A/.test(brand)) return { fmt: 'audio' };
      return { fmt: 'video' };
    }
  }
  return null;
}

const MIME_TO_FORMAT = [
  [/^text\/csv/, 'csv'], [/^text\/tab-separated/, 'csv'],
  [/json$/, 'json'], [/^application\/x-ndjson/, 'ndjson'], [/jsonl/, 'ndjson'],
  [/xml$/, 'xml'], [/^image\/svg/, 'svg'], [/yaml$/, 'yaml'], [/toml$/, 'toml'],
  [/^text\/markdown/, 'markdown'], [/^text\/html/, 'html'],
  [/parquet/, 'parquet'], [/arrow|feather/, 'arrow'],
  [/spreadsheet|ms-excel|opendocument\.spreadsheet/, 'xlsx'],
  [/^image\//, 'image'], [/^application\/pdf/, 'pdf'], [/^video\//, 'video'], [/^audio\//, 'audio'],
  [/zip$|java-archive/, 'zip'], [/gzip|zstd|x-brotli/, 'gzip'],
  [/^text\//, 'text'],
];

// Sniff textual content when name/mime give nothing decisive.
export function sniffText(text) {
  const head = text.slice(0, 64 * 1024).replace(/^﻿/, '');
  const trimmed = head.trimStart();
  if (!trimmed) return 'text';
  const c = trimmed[0];
  if (c === '{' || c === '[') {
    // JSON vs NDJSON: multiple lines each starting with '{' -> ndjson
    const lines = head.split(/\r?\n/).filter(l => l.trim());
    if (lines.length > 1 && lines.slice(0, 5).every(l => { const t = l.trim(); return t.startsWith('{') && t.endsWith('}'); })) {
      try { JSON.parse(lines[0]); return 'ndjson'; } catch { /* not ndjson */ }
    }
    try { JSON.parse(text.length < 5_000_000 ? text : head); return 'json'; } catch { if (text.length >= 5_000_000) return 'json'; }
  }
  if (trimmed.startsWith('<?xml') || /^<[A-Za-z][\w:.-]*[\s>\/]/.test(trimmed)) {
    if (/^<!doctype html|^<html/i.test(trimmed)) return 'html';
    if (/^<svg[\s>]/i.test(trimmed) || /<svg[\s>]/i.test(head.slice(0, 2000))) return 'svg';
    return 'xml';
  }
  if (/^<!doctype html|<html[\s>]/i.test(trimmed)) return 'html';
  if (/^---\s*$/m.test(head) && /^[\w-]+:\s/m.test(head)) return 'yaml';
  if (looksDelimited(head)) return 'csv';
  if (/^#{1,6}\s|^\*\*|^- \[|^\| .* \|$/m.test(head)) return 'markdown';
  return 'text';
}

export function looksDelimited(head) {
  const lines = head.split(/\r?\n/).filter(l => l.length).slice(0, 30);
  if (lines.length < 2) return false;
  for (const d of [',', '\t', '|', ';']) {
    const counts = lines.map(l => l.split(d).length - 1);
    const first = counts[0];
    if (first > 0 && counts.every(c => c === first)) return true;
    // Allow small variance for quoted fields
    if (first > 1 && counts.filter(c => c === first).length / counts.length > 0.8) return true;
  }
  return false;
}

/**
 * @param {{name?: string, contentType?: string, bytes: Uint8Array}} src
 * @returns {{ format: string, compression?: string, ext: string, reason: string, unsupported?: string }}
 */
export function detectFormat({ name = '', contentType = '', bytes }) {
  const ext = extOf(name);
  const mime = (contentType || '').split(';')[0].trim().toLowerCase();
  const magic = matchMagic(bytes);

  if (magic) {
    if (magic.fmt.startsWith('unsupported:')) return { format: 'hex', ext, reason: 'magic', unsupported: magic.fmt.split(':')[1] };
    if (magic.fmt === 'gzip') return { format: 'gzip', compression: magic.comp, ext, reason: 'magic' };
    if (magic.fmt === 'zip') {
      // OOXML / ODF spreadsheets and other zip-based containers.
      const byExt = formatForExt(ext);
      if (byExt === 'xlsx') return { format: 'xlsx', ext, reason: 'magic+ext' };
      if (byExt === 'zip') return { format: 'zip', ext, reason: 'magic' };
      if (['docx', 'pptx', 'odt', 'odp'].includes(ext)) return { format: 'zip', ext, reason: 'magic', unsupported: ext };
      return { format: 'zip', ext, reason: 'magic' };
    }
    if (magic.fmt === 'ole') return { format: 'xlsx', ext, reason: 'magic', note: ext === 'xls' ? undefined : 'OLE2 container: opened as legacy Excel' };
    if (magic.fmt === 'image' && magic.note === 'tiff') return { format: 'hex', ext, reason: 'magic', unsupported: 'tiff' };
    return { format: magic.fmt, ext, reason: 'magic' };
  }

  // Brotli has no magic; rely on extension.
  if (ext === 'br') return { format: 'gzip', compression: 'brotli', ext, reason: 'ext' };

  const byExt = formatForExt(ext);
  if (byExt && byExt !== 'gzip') {
    if (['csv', 'json', 'xml', 'text', 'code', 'ndjson', 'yaml', 'toml', 'markdown', 'html', 'svg'].includes(byExt) && !looksLikeText(bytes)) {
      return { format: 'hex', ext, reason: 'ext-but-binary' };
    }
    // Generic text extensions often hide structured data (exports named .txt/.dat/.out); let content win there.
    if (['txt', 'dat', 'text', 'out', 'lst'].includes(ext)) {
      const sniffed = sniffText(decodeText(bytes.subarray(0, Math.min(bytes.length, 256 * 1024))));
      if (['csv', 'json', 'ndjson', 'xml'].includes(sniffed)) return { format: sniffed, ext, reason: 'ext+sniff' };
    }
    return { format: byExt, ext, reason: 'ext' };
  }

  for (const [re, fmt] of MIME_TO_FORMAT) if (re.test(mime) && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') {
    if (fmt === 'text' || fmt === 'csv' || fmt === 'json') break; // generic text mimes -> sniff instead
    return { format: fmt, ext, reason: 'mime' };
  }

  if (looksLikeText(bytes)) {
    const text = decodeText(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
    return { format: sniffText(text), ext, reason: 'sniff' };
  }
  return { format: 'hex', ext, reason: 'fallback' };
}
