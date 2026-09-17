export function formatBytes(n) {
  if (n == null || isNaN(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(2) : v < 100 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tiny DOM helper: el('div.cls#id', {attrs}, ...children)
export function el(spec, attrs, ...children) {
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  const [tag, ...rest] = spec.split(/(?=[.#])/);
  const node = document.createElement(tag || 'div');
  for (const r of rest) { if (r[0] === '.') node.classList.add(r.slice(1)); else if (r[0] === '#') node.id = r.slice(1); }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === false || v == null) continue;
    else if (k in node && k !== 'list') { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'download';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Decode bytes to text. Handles BOMs; falls back to windows-1252 when UTF-8 decoding produces many replacement chars.
export function decodeText(bytes, hintedCharset) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const charset = (hintedCharset || 'utf-8').toLowerCase();
  if (charset !== 'utf-8' && charset !== 'utf8') { try { return new TextDecoder(charset).decode(bytes); } catch { /* fall through */ } }
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (bytes.length > 0) {
    const sample = utf8.slice(0, 200_000);
    const bad = (sample.match(/�/g) || []).length;
    if (bad > 0 && bad / sample.length > 0.002) return new TextDecoder('windows-1252').decode(bytes);
  }
  return utf8;
}

// Heuristic: does this byte buffer look like text?
export function looksLikeText(bytes) {
  const n = Math.min(bytes.length, 8192);
  if (n === 0) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return true; // utf-16 bom
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return true;
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) control++;
  }
  return control / n < 0.02;
}

export function flattenObject(obj, prefix = '', out = {}, depth = 0) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || depth > 6 || obj instanceof Date) { out[prefix || 'value'] = obj; return out; }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && depth < 6) flattenObject(v, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}

// Turn an array of (possibly nested) objects into {columns, rows}.
export function objectsToTable(objects, { flatten = true, maxScan = 2000 } = {}) {
  const colSet = new Map();
  const flat = new Array(objects.length);
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    const f = flatten && o && typeof o === 'object' && !Array.isArray(o) ? flattenObject(o) : (o && typeof o === 'object' && !Array.isArray(o) ? o : { value: o });
    flat[i] = f;
    if (i < maxScan || colSet.size === 0) for (const k of Object.keys(f)) if (!colSet.has(k)) colSet.set(k, colSet.size);
  }
  const columns = [...colSet.keys()];
  const rows = flat.map(f => columns.map(c => f[c]));
  return { columns, rows };
}

export function cellToString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString();
  if (typeof v === 'object') { try { return JSON.stringify(v, jsonReplacer); } catch { return String(v); } }
  return String(v);
}

export function jsonReplacer(_k, v) {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  if (v instanceof Date) return v.toISOString();
  return v;
}

export function baseName(name) { return (name || '').split('/').pop() || name || ''; }

export function stripExt(name, ext) {
  return name && ext && name.toLowerCase().endsWith('.' + ext) ? name.slice(0, -(ext.length + 1)) : name;
}

export function extOf(name) {
  const b = baseName(name).toLowerCase();
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1) : '';
}

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
