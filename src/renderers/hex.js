import { el, formatBytes } from '../lib/util.js';

const BPR = 16;   // bytes per row
const LINE_H = 20;
const UNSUPPORTED_NOTES = {
  avro: 'Avro container files are not decoded yet (planned). Showing raw bytes.',
  orc: 'ORC is not supported in the browser. Showing raw bytes.',
  sqlite: 'SQLite databases are not decoded yet (planned via sql.js). Showing raw bytes.',
  tiff: 'TIFF cannot be decoded by Chrome. Showing raw bytes.',
  bzip2: 'bzip2 decompression is not supported yet. Showing raw bytes.',
  xz: 'xz/lzma decompression is not supported yet. Showing raw bytes.',
  '7z': '7-Zip archives are not supported. Showing raw bytes.',
  rar: 'RAR archives are not supported. Showing raw bytes.',
  docx: 'Word documents are zip containers; open word/document.xml inside to read the text.',
  pptx: 'PowerPoint files are zip containers; open ppt/slides/*.xml inside.',
};

export async function renderHex(ctx) {
  const bytes = ctx.bytes || new Uint8Array();
  const rows = Math.ceil(bytes.length / BPR);
  ctx.toolbar.append(el('span.tb-stat', `${formatBytes(bytes.length)} · ${rows.toLocaleString()} rows of ${BPR} bytes`));
  if (ctx.unsupported) ctx.mount.appendChild(el('div.note', UNSUPPORTED_NOTES[ctx.unsupported] || `${ctx.unsupported}: not supported yet.`));
  const box = el('div.hex');
  const top = el('div'), body = el('div'), bot = el('div');
  box.append(top, body, bot);
  ctx.mount.appendChild(box);
  const hex = (b) => b.toString(16).padStart(2, '0');
  function draw() {
    const start = Math.max(0, Math.floor(box.scrollTop / LINE_H) - 5);
    const end = Math.min(rows, Math.ceil((box.scrollTop + box.clientHeight) / LINE_H) + 5);
    top.style.height = start * LINE_H + 'px';
    bot.style.height = Math.max(0, (rows - end) * LINE_H) + 'px';
    const frag = document.createDocumentFragment();
    for (let r = start; r < end; r++) {
      const off = r * BPR;
      const slice = bytes.subarray(off, off + BPR);
      let hx = '', asc = '';
      for (let i = 0; i < BPR; i++) {
        if (i < slice.length) { hx += hex(slice[i]) + (i === 7 ? '  ' : ' '); asc += slice[i] >= 32 && slice[i] < 127 ? String.fromCharCode(slice[i]) : '·'; }
        else hx += '   ' + (i === 7 ? ' ' : '');
      }
      frag.appendChild(el('div.line', el('span.off', off.toString(16).padStart(8, '0')), el('span', hx), el('span.asc', asc)));
    }
    body.replaceChildren(frag);
  }
  box.addEventListener('scroll', draw, { passive: true });
  new ResizeObserver(draw).observe(box);
  draw();
  return {};
}
