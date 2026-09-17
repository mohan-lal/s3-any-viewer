import { unzipSync } from 'fflate';
import { el, formatBytes } from '../lib/util.js';

export async function renderZip(ctx) {
  // First pass: list entries without inflating anything.
  const entries = [];
  unzipSync(ctx.bytes, { filter: (f) => { entries.push({ name: f.name, size: f.originalSize, compressed: f.size, compression: f.compression }); return false; } });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter(e => !e.name.endsWith('/'));
  ctx.toolbar.append(el('span.tb-stat', `${files.length.toLocaleString()} files · ${formatBytes(files.reduce((s, e) => s + (e.size || 0), 0))} uncompressed${ctx.unsupported ? ` · ${ctx.unsupported} documents are shown as their raw parts` : ''}`));

  const filter = el('input.tb-input', { type: 'search', placeholder: 'Filter entries…' });
  ctx.toolbar.appendChild(filter);

  const tbody = el('tbody');
  const table = el('table', el('thead', el('tr', el('th', 'Name'), el('th', 'Size'), el('th', 'Compressed'), el('th', 'Method'))), tbody);
  const list = el('div.zip-list', table);
  ctx.mount.appendChild(list);

  function draw() {
    const q = filter.value.toLowerCase();
    const frag = document.createDocumentFragment();
    for (const e of entries) {
      if (q && !e.name.toLowerCase().includes(q)) continue;
      const isDir = e.name.endsWith('/');
      const tr = el('tr', { className: isDir ? 'dir' : 'file' },
        el('td.name', isDir ? '📁 ' + e.name : e.name),
        el('td.num', isDir ? '' : formatBytes(e.size)),
        el('td.num', isDir ? '' : formatBytes(e.compressed)),
        el('td', isDir ? '' : e.compression === 0 ? 'store' : e.compression === 8 ? 'deflate' : `method ${e.compression}`));
      if (!isDir) tr.querySelector('td.name').onclick = () => openEntry(e);
      frag.appendChild(tr);
    }
    tbody.replaceChildren(frag);
  }
  function openEntry(e) {
    if (e.compression !== 0 && e.compression !== 8) { ctx.setStatus(`Cannot inflate "${e.name}": unsupported method ${e.compression}`); return; }
    try {
      const out = unzipSync(ctx.bytes, { filter: (f) => f.name === e.name });
      const bytes = out[e.name];
      if (!bytes) throw new Error('entry not found');
      ctx.openSub({ bytes, name: e.name });
    } catch (err) { ctx.setStatus(`Failed to extract "${e.name}": ${err.message}`); }
  }
  filter.oninput = draw;
  draw();
  return {};
}
