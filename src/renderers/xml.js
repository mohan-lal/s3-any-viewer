import { el, objectsToTable } from '../lib/util.js';
import { renderTable } from '../lib/vtable.js';
import { highlightInto } from './text.js';
import { makeTabs } from './json.js';

const PRETTY_LIMIT = 8 * 1024 * 1024;

export async function renderXml(ctx) {
  const text = ctx.text().replace(/^﻿/, '');
  let doc = null, parseError = null;
  if (text.length < PRETTY_LIMIT) {
    doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) { parseError = err.textContent.trim().split('\n')[0]; doc = null; }
  }
  const rows = doc ? repeatingChildrenAsRows(doc.documentElement) : null;
  const tabs = makeTabs(['Pretty', 'Raw', 'Table'], show);
  if (!rows) tabs.disable('Table');
  ctx.toolbar.append(tabs.node, el('span.tb-stat', doc ? `root <${doc.documentElement.tagName}>${rows ? ` · ${rows.count.toLocaleString()} <${rows.tag}> rows` : ''}` : parseError ? `not well-formed: ${parseError}` : 'too large to pretty-print'));
  let api = null;
  function show(name) {
    api?.destroy?.(); api = null;
    ctx.mount.innerHTML = '';
    [...ctx.toolbar.querySelectorAll('.table-toolbar')].forEach(n => n.remove());
    if (name === 'Pretty' && doc) highlightInto(ctx.mount, prettyXml(doc), 'xml');
    else if (name === 'Table' && rows) api = renderTable(ctx.mount, { columns: rows.columns, rows: rows.rows, name: ctx.name, toolbar: ctx.toolbar });
    else highlightInto(ctx.mount, text, 'xml');
  }
  show(doc ? 'Pretty' : 'Raw');
  return { destroy: () => api?.destroy?.() };
}

export function prettyXml(doc) {
  const out = [];
  const decl = doc.firstChild?.nodeType === 7 ? null : null;
  if (/^<\?xml/.test(new XMLSerializer().serializeToString(doc).slice(0, 5))) { /* declaration is re-emitted by serializer below */ }
  const walk = (node, depth) => {
    const pad = '  '.repeat(depth);
    switch (node.nodeType) {
      case 1: { // element
        const attrs = [...node.attributes].map(a => ` ${a.name}="${esc(a.value)}"`).join('');
        const kids = [...node.childNodes].filter(n => !(n.nodeType === 3 && !n.nodeValue.trim()));
        if (!kids.length) { out.push(`${pad}<${node.tagName}${attrs}/>`); return; }
        if (kids.length === 1 && kids[0].nodeType === 3) { out.push(`${pad}<${node.tagName}${attrs}>${esc(kids[0].nodeValue.trim())}</${node.tagName}>`); return; }
        out.push(`${pad}<${node.tagName}${attrs}>`);
        for (const k of kids) walk(k, depth + 1);
        out.push(`${pad}</${node.tagName}>`);
        return;
      }
      case 3: out.push(pad + esc(node.nodeValue.trim())); return;
      case 4: out.push(`${pad}<![CDATA[${node.nodeValue}]]>`); return;
      case 7: out.push(`${pad}<?${node.target} ${node.data}?>`); return;
      case 8: out.push(`${pad}<!--${node.nodeValue}-->`); return;
      case 9: for (const k of node.childNodes) walk(k, depth); return;
      case 10: out.push(`${pad}<!DOCTYPE ${node.name}>`); return;
    }
  };
  const declMatch = /^<\?xml[^>]*\?>/.exec(new XMLSerializer().serializeToString(doc));
  if (declMatch) out.push(declMatch[0]);
  walk(doc, 0);
  return out.join('\n');
}
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// If the root (or its single container child) holds many same-named children, present them as rows.
function repeatingChildrenAsRows(root) {
  let container = root;
  for (let i = 0; i < 3; i++) {
    const kids = [...container.children];
    if (kids.length < 2) { if (kids.length === 1) { container = kids[0]; continue; } return null; }
    const tag = kids[0].tagName;
    if (kids.filter(k => k.tagName === tag).length / kids.length < 0.9) return null;
    const objs = kids.filter(k => k.tagName === tag).map(elementToObject);
    const { columns, rows } = objectsToTable(objs);
    return { tag, count: objs.length, columns, rows };
  }
  return null;
}
function elementToObject(e) {
  const o = {};
  for (const a of e.attributes) o['@' + a.name] = a.value;
  const kids = [...e.children];
  if (!kids.length) { const t = e.textContent.trim(); if (Object.keys(o).length) o['#text'] = t; else return t; return o; }
  for (const k of kids) {
    const v = elementToObject(k);
    if (k.tagName in o) { if (!Array.isArray(o[k.tagName])) o[k.tagName] = [o[k.tagName]]; o[k.tagName].push(v); }
    else o[k.tagName] = v;
  }
  return o;
}
