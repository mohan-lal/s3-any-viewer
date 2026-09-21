import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { el } from '../lib/util.js';
import { searchableText } from './text.js';
import { makeTabs } from './json.js';

export async function renderMarkdown(ctx) {
  const text = ctx.text().replace(/^﻿/, '');
  const tabs = makeTabs(['Rendered', 'Source'], show);
  ctx.toolbar.append(tabs.node);
  let api = null;
  function show(name) {
    api?.destroy?.(); api = null;
    ctx.mount.innerHTML = '';
    [...ctx.toolbar.querySelectorAll('.view-search')].forEach(n => n.remove());
    if (name === 'Rendered') {
      const html = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: false }), { USE_PROFILES: { html: true } });
      const body = el('div.markdown-body');
      body.innerHTML = html;
      body.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
      ctx.mount.appendChild(body);
    } else api = searchableText(ctx.mount, ctx.toolbar, text, 'markdown');
  }
  show('Rendered');
  return { destroy: () => api?.destroy?.() };
}
