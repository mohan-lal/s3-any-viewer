import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { el } from '../lib/util.js';
import { highlightInto } from './text.js';
import { makeTabs } from './json.js';

export async function renderMarkdown(ctx) {
  const text = ctx.text().replace(/^﻿/, '');
  const tabs = makeTabs(['Rendered', 'Source'], show);
  ctx.toolbar.append(tabs.node);
  function show(name) {
    ctx.mount.innerHTML = '';
    if (name === 'Rendered') {
      const html = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: false }), { USE_PROFILES: { html: true } });
      const body = el('div.markdown-body');
      body.innerHTML = html;
      body.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
      ctx.mount.appendChild(body);
    } else highlightInto(ctx.mount, text, 'markdown');
  }
  show('Rendered');
  return {};
}
