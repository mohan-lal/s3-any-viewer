// Virtualized data table: sorting, filtering, column stats, export. Renders only visible rows.
import { el, cellToString, downloadBlob, copyText, jsonReplacer, debounce } from './util.js';

const ROW_H = 26;
const OVERSCAN = 12;

/**
 * @param {HTMLElement} mount
 * @param {{ columns: string[], rows: any[][], name?: string, toolbar?: HTMLElement, note?: string }} opts
 */
export function renderTable(mount, { columns, rows, name = 'data', toolbar, note }) {
  mount.innerHTML = '';
  const state = { sortCol: -1, sortDir: 1, filter: '', view: rows.map((_, i) => i), colWidths: measureWidths(columns, rows) };

  // ----- toolbar -----
  const filterInput = el('input.tb-input', { type: 'search', placeholder: 'Filter rows (substring, case-insensitive)...', spellcheck: false });
  const stats = el('span.tb-stat');
  const exportBtn = el('button.tb-btn', { title: 'Export the filtered/sorted rows' }, 'Export');
  const exportMenu = el('div.menu', { hidden: true },
    el('button', { onclick: () => doExport('csv') }, 'CSV'),
    el('button', { onclick: () => doExport('tsv') }, 'TSV'),
    el('button', { onclick: () => doExport('json') }, 'JSON (array of objects)'),
    el('button', { onclick: () => doExport('clipboard') }, 'Copy as TSV (paste into Excel)'),
  );
  exportBtn.onclick = () => { exportMenu.hidden = !exportMenu.hidden; };
  document.addEventListener('click', (e) => { if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) exportMenu.hidden = true; });
  const bar = el('div.table-toolbar', filterInput, stats, el('span.grow'), el('span.rel', exportBtn, exportMenu));
  (toolbar || mount).appendChild(bar);

  // ----- table skeleton -----
  const scroller = el('div.vt-scroller');
  const table = el('table.vt');
  const colgroup = el('colgroup', el('col', { style: { width: '56px' } }), columns.map((_, i) => el('col', { style: { width: state.colWidths[i] + 'px' } })));
  const thead = el('thead');
  const headRow = el('tr', el('th.vt-rownum', '#'));
  columns.forEach((c, i) => {
    const th = el('th', { title: `${c} - click to sort`, onclick: () => sortBy(i) }, el('span.th-label', c || `(col ${i + 1})`), el('span.sort-ind'));
    const grip = el('span.grip', { onmousedown: (e) => startResize(e, i) });
    th.appendChild(grip);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = el('tbody');
  const topPad = el('tr.pad', el('td', { colSpan: columns.length + 1 }));
  const botPad = el('tr.pad', el('td', { colSpan: columns.length + 1 }));
  table.append(colgroup, thead, tbody);
  scroller.appendChild(table);
  mount.appendChild(scroller);
  if (note) mount.appendChild(el('div.note', note));

  // Cell detail popover
  const detail = el('div.cell-detail', { hidden: true });
  const detailPre = el('pre');
  detail.append(el('div.cell-detail-bar', el('button.tb-btn', { onclick: () => copyText(detailPre.textContent) }, 'Copy'), el('span.grow'), el('button.tb-btn', { onclick: () => { detail.hidden = true; } }, 'Close')), detailPre);
  mount.appendChild(detail);

  let renderedStart = -1, renderedEnd = -1;
  function draw(force) {
    const total = state.view.length;
    const top = scroller.scrollTop;
    const height = scroller.clientHeight || 600;
    const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const end = Math.min(total, Math.ceil((top + height) / ROW_H) + OVERSCAN);
    if (!force && start === renderedStart && end === renderedEnd) return;
    renderedStart = start; renderedEnd = end;
    const frag = document.createDocumentFragment();
    topPad.firstChild.style.height = start * ROW_H + 'px';
    frag.appendChild(topPad);
    const q = state.filter.toLowerCase();
    for (let vi = start; vi < end; vi++) {
      const ri = state.view[vi];
      const row = rows[ri];
      const tr = el('tr', el('td.vt-rownum', String(ri + 1)));
      for (let ci = 0; ci < columns.length; ci++) {
        const v = row?.[ci];
        const s = cellToString(v);
        const td = el('td', { className: typeof v === 'number' || typeof v === 'bigint' ? 'num' : v == null ? 'null' : '' });
        td.textContent = s.length > 500 ? s.slice(0, 500) + '…' : s;
        if (v == null) td.textContent = v === null ? 'null' : '';
        if (q && s.toLowerCase().includes(q)) td.classList.add('hit');
        td.ondblclick = () => { detailPre.textContent = prettyValue(v); detail.hidden = false; };
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    botPad.firstChild.style.height = Math.max(0, (total - end) * ROW_H) + 'px';
    frag.appendChild(botPad);
    tbody.replaceChildren(frag);
  }
  scroller.addEventListener('scroll', () => draw(false), { passive: true });
  new ResizeObserver(() => draw(true)).observe(scroller);

  function updateStats() {
    const shown = state.view.length;
    stats.textContent = `${shown.toLocaleString()}${shown !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''} rows × ${columns.length} cols`;
  }

  function applyFilter() {
    const q = state.filter.toLowerCase();
    if (!q) state.view = rows.map((_, i) => i);
    else {
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        for (let c = 0; c < r.length; c++) { if (cellToString(r[c]).toLowerCase().includes(q)) { out.push(i); break; } }
      }
      state.view = out;
    }
    if (state.sortCol >= 0) applySort();
    updateStats();
    scroller.scrollTop = 0;
    draw(true);
  }
  filterInput.addEventListener('input', debounce(() => { state.filter = filterInput.value; applyFilter(); }, 150));

  function applySort() {
    const c = state.sortCol, d = state.sortDir;
    const numeric = isNumericColumn(c);
    state.view.sort((a, b) => {
      const va = rows[a][c], vb = rows[b][c];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (numeric) return (Number(va) - Number(vb)) * d;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * d;
    });
  }
  function isNumericColumn(c) {
    let n = 0, seen = 0;
    for (let i = 0; i < Math.min(rows.length, 500); i++) {
      const v = rows[i][c];
      if (v == null || v === '') continue;
      seen++;
      if (typeof v === 'number' || typeof v === 'bigint' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))) n++;
    }
    return seen > 0 && n / seen > 0.9;
  }
  function sortBy(i) {
    if (state.sortCol === i) state.sortDir = -state.sortDir; else { state.sortCol = i; state.sortDir = 1; }
    headRow.querySelectorAll('.sort-ind').forEach((s, k) => { s.textContent = k === i ? (state.sortDir > 0 ? ' ▲' : ' ▼') : ''; });
    applySort(); draw(true);
  }

  function startResize(e, i) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = state.colWidths[i];
    const col = colgroup.children[i + 1];
    const move = (ev) => { const w = Math.max(40, startW + ev.clientX - startX); state.colWidths[i] = w; col.style.width = w + 'px'; };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }

  function doExport(kind) {
    exportMenu.hidden = true;
    const viewRows = state.view.map(i => rows[i]);
    const base = name.replace(/\.[^.]+$/, '') || 'data';
    if (kind === 'json') {
      const objs = viewRows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
      downloadBlob(new Blob([JSON.stringify(objs, jsonReplacer, 2)], { type: 'application/json' }), base + '.json');
      return;
    }
    const delim = kind === 'csv' ? ',' : '\t';
    const esc = (s) => { s = cellToString(s); return kind === 'csv' && /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = [columns.map(esc).join(delim), ...viewRows.map(r => columns.map((_, i) => esc(r[i])).join(delim))].join('\n');
    if (kind === 'clipboard') { copyText(text); return; }
    downloadBlob(new Blob([text], { type: kind === 'csv' ? 'text/csv' : 'text/tab-separated-values' }), base + '.' + kind);
  }

  updateStats();
  draw(true);
  return { destroy() { mount.innerHTML = ''; bar.remove(); } };
}

function prettyValue(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) { try { return JSON.stringify(v, jsonReplacer, 2); } catch { /* ignore */ } }
  return cellToString(v);
}

function measureWidths(columns, rows) {
  const sample = Math.min(rows.length, 300);
  return columns.map((c, i) => {
    let max = Math.min(String(c || '').length, 40);
    for (let r = 0; r < sample; r++) { const s = cellToString(rows[r]?.[i]); if (s.length > max) max = Math.min(s.length, 60); }
    return Math.max(60, Math.min(480, max * 7.5 + 20));
  });
}
