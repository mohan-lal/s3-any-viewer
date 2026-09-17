import { parquetMetadataAsync, parquetSchema, parquetReadObjects, asyncBufferFromUrl } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { el, objectsToTable, formatBytes } from '../lib/util.js';
import { renderTable } from '../lib/vtable.js';

const PAGE = 20_000;

export async function renderParquet(ctx) {
  let file;
  if (ctx.bytes) {
    const b = ctx.bytes;
    file = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  } else {
    // Remote mode: only the footer and requested row groups are fetched via HTTP Range.
    file = await asyncBufferFromUrl({ url: ctx.url, byteLength: ctx.size, requestInit: { credentials: 'omit' } });
  }

  ctx.showProgress('Reading Parquet metadata…');
  const meta = await parquetMetadataAsync(file);
  const schema = parquetSchema(meta);
  const numRows = Number(meta.num_rows);
  const columns = schema.children.map(c => c.element.name);

  // ---- info panel ----
  const infoToggle = el('button.tb-btn', { onclick: () => { info.hidden = !info.hidden; infoToggle.classList.toggle('on', !info.hidden); } }, 'Schema');
  const info = el('div.info-panel', { hidden: true },
    el('dl',
      el('dt', 'Rows'), el('dd', numRows.toLocaleString()),
      el('dt', 'Row groups'), el('dd', String(meta.row_groups.length)),
      el('dt', 'Columns'), el('dd', String(columns.length)),
      el('dt', 'Created by'), el('dd', meta.created_by || '-'),
      el('dt', 'Source'), el('dd', ctx.remote ? `remote (HTTP range reads, ${formatBytes(ctx.size)})` : `in memory (${formatBytes(ctx.bytes.length)})`),
      ...(meta.key_value_metadata || []).filter(kv => kv.key !== 'ARROW:schema').flatMap(kv => [el('dt', kv.key), el('dd', (kv.value || '').slice(0, 500))]),
    ),
    el('table', el('thead', el('tr', el('th', 'Column'), el('th', 'Physical type'), el('th', 'Logical / converted'), el('th', 'Repetition'), el('th', 'Codec'))),
      el('tbody', schema.children.map(c => {
        const e = c.element;
        const col = meta.row_groups[0]?.columns.find(cc => cc.meta_data?.path_in_schema?.[0] === e.name);
        return el('tr', el('td', e.name), el('td', e.type || (c.children?.length ? 'group' : '')), el('td', logicalName(e)), el('td', e.repetition_type || ''), el('td', col?.meta_data?.codec || ''));
      }))),
  );
  ctx.mount.append(info);

  // ---- rows ----
  const state = { loaded: 0, objects: [] };
  const stat = el('span.tb-stat');
  const moreBtn = el('button.tb-btn', { onclick: () => loadMore(PAGE) }, `Load next ${PAGE.toLocaleString()}`);
  const allBtn = el('button.tb-btn', { onclick: () => loadMore(numRows - state.loaded) }, 'Load all');
  ctx.toolbar.append(infoToggle, stat, moreBtn, allBtn);
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } });
  ctx.mount.appendChild(body);
  let api = null;

  async function loadMore(n) {
    if (state.loaded >= numRows) return;
    const rowStart = state.loaded, rowEnd = Math.min(numRows, rowStart + n);
    if (rowEnd - rowStart > 500_000 && !confirm(`Load ${(rowEnd - rowStart).toLocaleString()} rows into memory?`)) return;
    moreBtn.disabled = allBtn.disabled = true;
    ctx.showProgress(`Reading rows ${rowStart.toLocaleString()}–${rowEnd.toLocaleString()}…`);
    try {
      const rows = await parquetReadObjects({ file, metadata: meta, compressors, rowStart, rowEnd, utf8: true });
      state.objects.push(...rows);
      state.loaded = rowEnd;
    } catch (e) { ctx.hideProgress(); throw e; }
    ctx.hideProgress();
    api?.destroy();
    body.innerHTML = '';
    [...ctx.toolbar.querySelectorAll('.table-toolbar')].forEach(x => x.remove());
    const { columns: cols, rows: tableRows } = objectsToTable(state.objects, { flatten: true });
    api = renderTable(body, { columns: cols.length ? cols : columns, rows: tableRows, name: ctx.name, toolbar: ctx.toolbar });
    stat.textContent = `${state.loaded.toLocaleString()} of ${numRows.toLocaleString()} rows loaded`;
    const done = state.loaded >= numRows;
    moreBtn.disabled = allBtn.disabled = done;
    if (done) { moreBtn.textContent = 'All rows loaded'; }
  }
  try { await loadMore(PAGE); } catch (e) { ctx.hideProgress(); info.hidden = false; throw e; }
  return { destroy: () => api?.destroy() };
}

function logicalName(e) {
  if (e.logical_type) { const k = Object.keys(e.logical_type)[0]; const v = e.logical_type[k]; return k + (v && typeof v === 'object' && Object.keys(v).length ? ' ' + JSON.stringify(v) : ''); }
  return e.converted_type || '';
}
