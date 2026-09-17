import { el, objectsToTable, jsonReplacer, copyText } from '../lib/util.js';
import { renderTable } from '../lib/vtable.js';
import { highlightInto } from './text.js';

const PRETTY_HL_LIMIT = 1.5 * 1024 * 1024;
const PAGE = 100; // children shown per "more" click in the tree

export async function renderJson(ctx) {
  const text = ctx.text();
  let value;
  try { value = JSON.parse(text.replace(/^﻿/, '')); }
  catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }

  const tabs = makeTabs(['Tree', 'Pretty', 'Table'], show);
  ctx.toolbar.append(tabs.node, el('span.tb-stat', describe(value)), el('span.grow'),
    el('button.tb-btn', { onclick: () => copyText(JSON.stringify(value, jsonReplacer, 2)) }, 'Copy pretty'),
    el('button.tb-btn', { onclick: () => copyText(JSON.stringify(value, jsonReplacer)) }, 'Copy minified'));

  const tableable = asObjects(value);
  if (!tableable) tabs.disable('Table');
  let api = null;
  function show(name) {
    api?.destroy?.(); api = null;
    ctx.mount.innerHTML = '';
    [...ctx.toolbar.querySelectorAll('.table-toolbar')].forEach(n => n.remove());
    if (name === 'Tree') renderJsonTree(ctx.mount, value);
    else if (name === 'Pretty') {
      const pretty = JSON.stringify(value, jsonReplacer, 2);
      highlightInto(ctx.mount, pretty, pretty.length < PRETTY_HL_LIMIT ? 'json' : null);
    } else if (name === 'Table' && tableable) {
      const { columns, rows } = objectsToTable(tableable);
      api = renderTable(ctx.mount, { columns, rows, name: ctx.name, toolbar: ctx.toolbar });
    }
  }
  show(tableable && Array.isArray(value) && value.length > 1 ? 'Table' : 'Tree');
  return { destroy: () => api?.destroy?.() };
}

export async function renderNdjson(ctx) {
  const text = ctx.text();
  const lines = text.split(/\r?\n/);
  const objects = []; const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    try { objects.push(JSON.parse(l)); } catch (e) { errors.push(`line ${i + 1}: ${e.message}`); }
  }
  if (!objects.length) throw new Error(`No JSON objects found. ${errors[0] || ''}`);
  const tabs = makeTabs(['Table', 'Tree'], show);
  ctx.toolbar.append(tabs.node, el('span.tb-stat', `${objects.length.toLocaleString()} records${errors.length ? `, ${errors.length} bad lines` : ''}${ctx.partial ? ' (partial preview)' : ''}`));
  let api = null;
  function show(name) {
    api?.destroy?.(); api = null;
    ctx.mount.innerHTML = '';
    [...ctx.toolbar.querySelectorAll('.table-toolbar')].forEach(n => n.remove());
    if (name === 'Table') { const { columns, rows } = objectsToTable(objects); api = renderTable(ctx.mount, { columns, rows, name: ctx.name, toolbar: ctx.toolbar }); }
    else renderJsonTree(ctx.mount, objects);
  }
  show('Table');
  return { destroy: () => api?.destroy?.() };
}

// ---------- helpers ----------
export function makeTabs(names, onChange) {
  const node = el('div.tabs');
  const btns = new Map();
  for (const n of names) {
    const b = el('button', { onclick: () => { select(n); onChange(n); } }, n);
    btns.set(n, b); node.appendChild(b);
  }
  function select(n) { for (const [k, b] of btns) b.classList.toggle('on', k === n); }
  select(names[0]);
  return { node, select, disable(n) { const b = btns.get(n); if (b) { b.disabled = true; b.style.opacity = .4; } } };
}

// Array of objects, or object-of-objects (keyed rows) -> array of objects; otherwise null.
function asObjects(v) {
  if (Array.isArray(v)) {
    if (v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) return v;
    if (v.length && v.every(x => x === null || typeof x !== 'object')) return v.map(x => ({ value: x }));
    return null;
  }
  if (v && typeof v === 'object') {
    const vals = Object.values(v);
    if (vals.length > 1 && vals.every(x => x && typeof x === 'object' && !Array.isArray(x))) return Object.entries(v).map(([k, x]) => ({ _key: k, ...x }));
    // Common envelope shapes: { data: [...] }, { items: [...] }, { results: [...] }, { Records: [...] }
    for (const k of ['data', 'items', 'results', 'records', 'Records', 'rows', 'value', 'hits', 'entries', 'Items', 'Contents']) {
      if (Array.isArray(v[k])) { const r = asObjects(v[k]); if (r) return r; }
    }
  }
  return null;
}

function describe(v) {
  if (Array.isArray(v)) return `array · ${v.length.toLocaleString()} items`;
  if (v && typeof v === 'object') return `object · ${Object.keys(v).length.toLocaleString()} keys`;
  return typeof v;
}

export function renderJsonTree(mount, value) {
  const root = el('div.jtree');
  root.appendChild(node(null, value, 0, true));
  root.addEventListener('click', (e) => {
    const t = e.target.closest('.jtog, .jsum');
    if (t) { const row = t.closest('.jrow'); const ch = row.nextElementSibling; if (ch?.classList.contains('jchildren')) { ch.classList.toggle('closed'); row.querySelector('.jtog').textContent = ch.classList.contains('closed') ? '▸' : '▾'; row.querySelector('.jsum').hidden = !ch.classList.contains('closed'); } }
    const more = e.target.closest('.jmore');
    if (more) { const ch = more.parentElement; const from = Number(more.dataset.from); more.remove(); appendChildren(ch, JSON.parse(more.dataset.keys), more._parent, from, Number(more.dataset.depth)); }
  });
  mount.appendChild(root);
  return root;
}

function node(key, v, depth, open) {
  const wrap = el('div.jn');
  const isObj = v && typeof v === 'object' && !(v instanceof Date);
  const row = el('div.jrow');
  if (isObj) {
    const keys = Array.isArray(v) ? null : Object.keys(v);
    const n = keys ? keys.length : v.length;
    const expanded = open || (depth < 2 && n <= 50);
    row.append(el('span.jtog', expanded ? '▾' : '▸'), keyLabel(key), el('span.jsum', { hidden: expanded }, Array.isArray(v) ? `[ ${n.toLocaleString()} items ]` : `{ ${n.toLocaleString()} keys }`));
    const ch = el('div.jchildren', { className: expanded ? 'jchildren' : 'jchildren closed' });
    appendChildren(ch, keys, v, 0, depth + 1);
    wrap.append(row, ch);
  } else {
    row.append(el('span.jtog', ' '), keyLabel(key), valueLabel(v));
    wrap.appendChild(row);
  }
  return wrap;
}
function appendChildren(ch, keys, v, from, depth) {
  const n = keys ? keys.length : v.length;
  const to = Math.min(n, from + PAGE);
  const frag = document.createDocumentFragment();
  for (let i = from; i < to; i++) { const k = keys ? keys[i] : i; frag.appendChild(node(k, v[k], depth, false)); }
  if (to < n) { const more = el('div.jmore', { dataset: { from: to, depth, keys: JSON.stringify(keys) } }, `… ${(n - to).toLocaleString()} more (show next ${Math.min(PAGE, n - to)})`); more._parent = v; frag.appendChild(more); }
  ch.appendChild(frag);
}
function keyLabel(key) { return key == null ? el('span') : el('span', el('span.jk', typeof key === 'number' ? String(key) : JSON.stringify(key)), ': '); }
function valueLabel(v) {
  if (v === null) return el('span.jnull', 'null');
  if (v === undefined) return el('span.jnull', 'undefined');
  if (typeof v === 'string') return el('span.js', { title: v.length > 200 ? v : null }, JSON.stringify(v.length > 2000 ? v.slice(0, 2000) + '…' : v));
  if (typeof v === 'number' || typeof v === 'bigint') return el('span.jnum', String(v));
  if (typeof v === 'boolean') return el('span.jb', String(v));
  if (v instanceof Date) return el('span.js', v.toISOString());
  return el('span', String(v));
}
