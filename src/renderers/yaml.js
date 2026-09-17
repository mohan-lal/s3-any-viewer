import { load, loadAll } from 'js-yaml';
import { parse as parseToml } from 'smol-toml';
import { el } from '../lib/util.js';
import { highlightInto } from './text.js';
import { makeTabs, renderJsonTree } from './json.js';

function structured(ctx, lang, parse) {
  const text = ctx.text().replace(/^﻿/, '');
  let value, err = null;
  try { value = parse(text); } catch (e) { err = e.message; }
  const tabs = makeTabs(['Source', 'Tree'], show);
  if (err) tabs.disable('Tree');
  ctx.toolbar.append(tabs.node, el('span.tb-stat', err ? `parse error: ${err.split('\n')[0]}` : `${lang} parsed OK`));
  function show(name) {
    ctx.mount.innerHTML = '';
    if (name === 'Tree' && !err) renderJsonTree(ctx.mount, value);
    else highlightInto(ctx.mount, text, lang === 'toml' ? 'ini' : lang);
  }
  show('Source');
  return {};
}

export async function renderYaml(ctx) {
  return structured(ctx, 'yaml', (t) => { const docs = loadAll(t); return docs.length === 1 ? docs[0] : docs; });
}
export async function renderToml(ctx) {
  return structured(ctx, 'toml', parseToml);
}
