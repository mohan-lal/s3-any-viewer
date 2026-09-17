import { el } from '../lib/util.js';
import { highlightInto } from './text.js';
import { makeTabs } from './json.js';

// HTML is previewed inside a fully sandboxed iframe: no scripts, no same-origin, no forms, no navigation.
export async function renderHtml(ctx) {
  const text = ctx.text();
  const tabs = makeTabs(['Preview', 'Source'], show);
  ctx.toolbar.append(tabs.node, el('span.tb-stat', 'sandboxed: scripts disabled, remote images blocked'));
  function show(name) {
    ctx.mount.innerHTML = '';
    if (name === 'Preview') {
      const frame = el('iframe.doc', { sandbox: '', referrerPolicy: 'no-referrer' });
      frame.srcdoc = text;
      ctx.mount.appendChild(frame);
    } else highlightInto(ctx.mount, text, 'xml');
  }
  show('Preview');
  return {};
}
