import { el, objectsToTable, jsonReplacer, copyText } from '../lib/util.js';
import { renderTable } from '../lib/vtable.js';
import { searchableText } from './text.js';
import { makeSearchBar, highlightText } from '../lib/search.js';

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
    [...ctx.toolbar.querySelectorAll('.table-toolbar, .view-search')].forEach(n => n.remove());
    if (name === 'Tree') api = renderJsonTree(ctx.mount, value, ctx.toolbar);
    else if (name === 'Pretty') {
      const pretty = JSON.stringify(value, jsonReplacer, 2);
      api = searchableText(ctx.mount, ctx.toolbar, pretty, pretty.length < PRETTY_HL_LIMIT ? 'json' : null);
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
    [...ctx.toolbar.querySelectorAll('.table-toolbar, .view-search')].forEach(n => n.remove());
    if (name === 'Table') { const { columns, rows } = objectsToTable(objects); api = renderTable(ctx.mount, { columns, rows, name: ctx.name, toolbar: ctx.toolbar }); }
    else api = renderJsonTree(ctx.mount, objects, ctx.toolbar);
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

// ---------- tree ----------

const MAX_TREE_RESULTS = 1000;   // matches rendered in the filtered tree; the counter still reports the total
const MAX_INDEX_NODES = 2_000_000;

/**
 * Lazy JSON tree. When a toolbar is given, a search box is added that filters the tree to the
 * branches containing a match (searched over the parsed data, so collapsed and unrendered nodes
 * are found), auto-expands the paths to them and highlights the matched text.
 */
export function renderJsonTree(mount, value, toolbar = null) {
  const idle = buildTree(value, null);
  mount.appendChild(idle);
  if (!toolbar) return { destroy() {} };

  let index = null;          // built on first search
  let matches = [];          // [{ path, keyHit, valHit }], tree order, capped
  let total = 0;
  let cur = -1;
  let filtered = null;

  const bar = makeSearchBar({
    placeholder: 'Search keys and values…',
    onQuery(q) {
      if (!q) { matches = []; total = 0; cur = -1; filtered = null; bar.setCount('', false); mount.replaceChildren(idle); return; }
      index ??= buildIndex(value);
      const ql = q.toLowerCase();
      const all = [];
      for (const e of index.entries) {
        const keyHit = e.key != null && e.key.toLowerCase().includes(ql);
        const valHit = e.val != null && e.val.toLowerCase().includes(ql);
        if (keyHit || valHit) all.push({ path: e.path, keyHit, valHit });
      }
      total = all.length;
      matches = all.slice(0, MAX_TREE_RESULTS);
      cur = matches.length ? 0 : -1;
      filtered = buildTree(value, { q, matches });
      mount.replaceChildren(filtered);
      updateCount();
      markCurrent(true);
    },
    onStep(dir) {
      if (!matches.length) return;
      cur = (cur + dir + matches.length) % matches.length;
      updateCount();
      markCurrent(true);
    },
  });
  toolbar.append(...bar.nodes);

  function updateCount() {
    if (!total) { bar.setCount('No matches', false); return; }
    const shown = matches.length;
    const pos = `${(cur + 1).toLocaleString()} of ${shown.toLocaleString()}`;
    bar.setCount(shown < total
      ? `${shown.toLocaleString()} of ${total.toLocaleString()} matches shown · ${pos}${index.truncated ? ' · large document, search is partial' : ''}`
      : `${total.toLocaleString()} match${total === 1 ? '' : 'es'} · ${pos}`, true);
  }
  function markCurrent(scroll) {
    if (!filtered) return;
    filtered.querySelectorAll('.jrow.cur').forEach(r => r.classList.remove('cur'));
    filtered.querySelectorAll('mark.cur').forEach(m => m.classList.remove('cur'));
    const row = filtered.querySelector(`.jrow[data-mi="${cur}"]`);
    if (!row) return;
    row.classList.add('cur');
    row.querySelectorAll('mark').forEach(m => m.classList.add('cur'));
    if (scroll) row.scrollIntoView({ block: 'center' });
  }
  return { destroy: () => bar.nodes.forEach(n => n.remove()) };
}

// Flat index of every node: path, key text and primitive value text, in tree order.
function buildIndex(value) {
  const entries = [];
  let truncated = false;
  const walk = (v, path, key) => {
    if (entries.length >= MAX_INDEX_NODES) { truncated = true; return; }
    const isObj = v && typeof v === 'object' && !(v instanceof Date);
    entries.push({ path, key: key == null ? null : String(key), val: isObj ? null : primitiveText(v) });
    if (!isObj) return;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walk(v[i], path.concat(i), i); }
    else for (const k of Object.keys(v)) walk(v[k], path.concat(k), k);
  };
  walk(value, [], null);
  return { entries, truncated };
}
function primitiveText(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Build the tree DOM. With `search` = { q, matches }, only branches leading to a match are
 * rendered, fully expanded, with highlights; otherwise the lazy full tree is built.
 */
function buildTree(value, search) {
  const root = el('div.jtree');
  if (!search) root.appendChild(node(null, value, 0, true, null));
  else {
    // trie of matched paths: Map key -> { children: Map, hit: matchIndex|null }
    const trie = { children: new Map(), hit: null };
    search.matches.forEach((m, mi) => {
      let t = trie;
      for (const k of m.path) { if (!t.children.has(k)) t.children.set(k, { children: new Map(), hit: null }); t = t.children.get(k); }
      t.hit = mi;
    });
    root.appendChild(filteredNode(null, value, trie, 0, search));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const hidden = Object.keys(value).filter(k => !trie.children.has(k));
      if (hidden.length) root.appendChild(el('div.jhidden', `${hidden.length.toLocaleString()} key${hidden.length === 1 ? '' : 's'} without matches hidden: ${hidden.slice(0, 12).join(', ')}${hidden.length > 12 ? ', …' : ''}`));
    } else if (Array.isArray(value)) {
      const hidden = value.length - trie.children.size;
      if (hidden > 0) root.appendChild(el('div.jhidden', `${hidden.toLocaleString()} item${hidden === 1 ? '' : 's'} without matches hidden`));
    }
  }
  root.addEventListener('click', (e) => {
    const t = e.target.closest('.jtog, .jsum');
    if (t) { const row = t.closest('.jrow'); const ch = row.nextElementSibling; if (ch?.classList.contains('jchildren')) { ch.classList.toggle('closed'); row.querySelector('.jtog').textContent = ch.classList.contains('closed') ? '▸' : '▾'; row.querySelector('.jsum').hidden = !ch.classList.contains('closed'); } }
    const more = e.target.closest('.jmore');
    if (more) { const ch = more.parentElement; const from = Number(more.dataset.from); more.remove(); appendChildren(ch, JSON.parse(more.dataset.keys), more._parent, from, Number(more.dataset.depth)); }
  });
  return root;
}

// A node on a matched path. Containers expand only the children that are on the path.
function filteredNode(key, v, trie, depth, search) {
  const { q } = search;
  const isObj = v && typeof v === 'object' && !(v instanceof Date);
  const m = trie.hit != null ? search.matches[trie.hit] : null;
  const wrap = el('div.jn');
  const row = el('div.jrow');
  if (m) row.dataset.mi = String(trie.hit);
  const kq = m?.keyHit ? q : null;
  if (!isObj) {
    row.append(el('span.jtog', ' '), keyLabel(key, kq), valueLabel(v, m?.valHit ? q : null));
    wrap.appendChild(row);
    return wrap;
  }
  const keys = Array.isArray(v) ? null : Object.keys(v);
  const n = keys ? keys.length : v.length;
  if (trie.children.size === 0) {
    // Matched by key only, nothing below it matched: show it collapsed with a working toggle.
    return node(key, v, depth, false, kq, row);
  }
  row.append(el('span.jtog', '▾'), keyLabel(key, kq), el('span.jsum', { hidden: true }, Array.isArray(v) ? `[ ${n.toLocaleString()} items ]` : `{ ${n.toLocaleString()} keys }`));
  const ch = el('div.jchildren');
  const order = keys ? keys.filter(k => trie.children.has(k)) : [...trie.children.keys()].sort((a, b) => a - b);
  for (const k of order) ch.appendChild(filteredNode(k, v[k], trie.children.get(k), depth + 1, search));
  wrap.append(row, ch);
  return wrap;
}

// Lazy node used by the full tree (and for key-only matches in the filtered tree).
function node(key, v, depth, open, hlq = null, row = null) {
  const wrap = el('div.jn');
  const isObj = v && typeof v === 'object' && !(v instanceof Date);
  row ??= el('div.jrow');
  if (isObj) {
    const keys = Array.isArray(v) ? null : Object.keys(v);
    const n = keys ? keys.length : v.length;
    const expanded = open || (depth < 2 && n <= 50);
    row.append(el('span.jtog', expanded ? '▾' : '▸'), keyLabel(key, hlq), el('span.jsum', { hidden: expanded }, Array.isArray(v) ? `[ ${n.toLocaleString()} items ]` : `{ ${n.toLocaleString()} keys }`));
    const ch = el('div.jchildren', { className: expanded ? 'jchildren' : 'jchildren closed' });
    appendChildren(ch, keys, v, 0, depth + 1);
    wrap.append(row, ch);
  } else {
    row.append(el('span.jtog', ' '), keyLabel(key, hlq), valueLabel(v, null));
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
function keyLabel(key, hlq) {
  if (key == null) return el('span');
  const text = typeof key === 'number' ? String(key) : JSON.stringify(key);
  const k = el('span.jk');
  k.appendChild(hlq ? highlightText(text, hlq) : document.createTextNode(text));
  return el('span', k, ': ');
}
function valueLabel(v, hlq) {
  let cls, text, title = null;
  if (v === null) { cls = 'jnull'; text = 'null'; }
  else if (v === undefined) { cls = 'jnull'; text = 'undefined'; }
  else if (typeof v === 'string') { cls = 'js'; text = JSON.stringify(v.length > 2000 ? v.slice(0, 2000) + '…' : v); if (v.length > 200) title = v; }
  else if (typeof v === 'number' || typeof v === 'bigint') { cls = 'jnum'; text = String(v); }
  else if (typeof v === 'boolean') { cls = 'jb'; text = String(v); }
  else if (v instanceof Date) { cls = 'js'; text = v.toISOString(); }
  else { cls = ''; text = String(v); }
  const s = el('span', { className: cls, title });
  s.appendChild(hlq ? highlightText(text, hlq) : document.createTextNode(text));
  return s;
}
