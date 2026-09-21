import { el } from '../lib/util.js';
import { searchableText } from './text.js';
import { makeTabs } from './json.js';

// HTML is previewed inside a fully sandboxed iframe: no scripts, no same-origin, no forms, no navigation.
export async function renderHtml(ctx) {
  const text = ctx.text();
  const tabs = makeTabs(['Preview', 'Source'], show);
  ctx.toolbar.append(tabs.node, el('span.tb-stat', 'sandboxed: scripts disabled, remote images blocked'));
  let api = null;
  function show(name) {
    api?.destroy?.(); api = null;
    ctx.mount.innerHTML = '';
    [...ctx.toolbar.querySelectorAll('.view-search')].forEach(n => n.remove());
    if (name === 'Preview') {
      const frame = el('iframe.doc', { sandbox: '', referrerPolicy: 'no-referrer' });
      frame.srcdoc = text;
      ctx.mount.appendChild(frame);
    } else api = searchableText(ctx.mount, ctx.toolbar, text, 'xml');
  }
  show('Preview');
  return { destroy: () => api?.destroy?.() };
}
