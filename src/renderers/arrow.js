import { tableFromIPC } from 'apache-arrow';
import { el } from '../lib/util.js';
import { renderTable } from '../lib/vtable.js';

const MAX_INITIAL = 200_000;

export async function renderArrow(ctx) {
  const table = tableFromIPC(ctx.bytes);
  const columns = table.schema.fields.map(f => f.name);
  const total = table.numRows;
  const stat = el('span.tb-stat');
  const infoToggle = el('button.tb-btn', { onclick: () => { info.hidden = !info.hidden; infoToggle.classList.toggle('on', !info.hidden); } }, 'Schema');
  const info = el('div.info-panel', { hidden: true },
    el('dl', el('dt', 'Rows'), el('dd', total.toLocaleString()), el('dt', 'Batches'), el('dd', String(table.batches.length))),
    el('table', el('thead', el('tr', el('th', 'Column'), el('th', 'Type'), el('th', 'Nullable'))),
      el('tbody', table.schema.fields.map(f => el('tr', el('td', f.name), el('td', String(f.type)), el('td', f.nullable ? 'yes' : 'no'))))));
  ctx.mount.appendChild(info);
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } });
  ctx.mount.appendChild(body);
  const allBtn = el('button.tb-btn', { onclick: () => draw(total) }, 'Load all');
  ctx.toolbar.append(infoToggle, stat, allBtn);
  let api = null;
  function draw(limit) {
    const n = Math.min(total, limit);
    const rows = new Array(n);
    const vectors = columns.map((_, i) => table.getChildAt(i));
    for (let r = 0; r < n; r++) rows[r] = vectors.map(v => normalize(v.get(r)));
    api?.destroy();
    body.innerHTML = '';
    [...ctx.toolbar.querySelectorAll('.table-toolbar')].forEach(x => x.remove());
    api = renderTable(body, { columns, rows, name: ctx.name, toolbar: ctx.toolbar });
    stat.textContent = `${n.toLocaleString()} of ${total.toLocaleString()} rows`;
    allBtn.disabled = n >= total;
  }
  draw(MAX_INITIAL);
  return { destroy: () => api?.destroy() };
}

function normalize(v) {
  if (v == null) return v;
  if (typeof v === 'object' && typeof v.toJSON === 'function' && !(v instanceof Date)) { try { return v.toJSON(); } catch { return String(v); } }
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  return v;
}
