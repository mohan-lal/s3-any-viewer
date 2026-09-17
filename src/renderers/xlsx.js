import * as XLSX from 'xlsx';
import { el } from '../lib/util.js';
import { renderTable } from '../lib/vtable.js';

export async function renderXlsx(ctx) {
  ctx.showProgress('Parsing workbook…');
  const wb = XLSX.read(ctx.bytes, { type: 'array', cellDates: true, dense: true });
  ctx.hideProgress();
  const names = wb.SheetNames;
  if (!names.length) throw new Error('Workbook has no sheets');

  const sheetSel = el('select.tb-input', names.map(n => el('option', { value: n }, n)));
  const headerCb = el('input', { type: 'checkbox', checked: true });
  const stat = el('span.tb-stat');
  ctx.toolbar.append(el('label.ctl', 'Sheet ', sheetSel), el('label.ctl', headerCb, ' First row is header'), stat);
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } });
  ctx.mount.appendChild(body);
  let api = null;

  function draw() {
    const ws = wb.Sheets[sheetSel.value];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    let columns, rows;
    const width = Math.max(0, ...aoa.slice(0, 500).map(r => r.length));
    if (headerCb.checked && aoa.length) { columns = Array.from({ length: width }, (_, i) => aoa[0][i] != null && aoa[0][i] !== '' ? String(aoa[0][i]) : XLSX.utils.encode_col(i)); rows = aoa.slice(1); }
    else { columns = Array.from({ length: width }, (_, i) => XLSX.utils.encode_col(i)); rows = aoa; }
    for (const r of rows) if (r.length < width) r.length = width;
    api?.destroy();
    body.innerHTML = '';
    [...ctx.toolbar.querySelectorAll('.table-toolbar')].forEach(x => x.remove());
    api = renderTable(body, { columns, rows, name: `${ctx.name}-${sheetSel.value}`, toolbar: ctx.toolbar });
    stat.textContent = `${names.length} sheet${names.length > 1 ? 's' : ''} · range ${ws['!ref'] || 'empty'}`;
  }
  sheetSel.onchange = draw;
  headerCb.onchange = draw;
  draw();
  return { destroy: () => api?.destroy() };
}
