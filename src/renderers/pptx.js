// PowerPoint (.pptx) renderer. Rather than attempt pixel-perfect slides, it reads each slide's
// shapes in order and presents a readable card per slide: title, subtitle, text with bullet
// levels, tables, pictures and speaker notes. Built on fflate, which the bundle already has.
import { unzipSync, strFromU8 } from 'fflate';
import { el } from '../lib/util.js';

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };

export async function renderPptx(ctx) {
  const files = unzipSync(ctx.bytes);
  const xml = (path) => files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml') : null;
  const urls = [];

  const slidePaths = orderedSlides(files, xml);
  if (!slidePaths.length) throw new Error('No slides found in this presentation');

  const list = el('div.pptx-list');
  slidePaths.forEach((path, i) => list.appendChild(renderSlide(path, i + 1, files, xml, urls)));
  ctx.mount.appendChild(list);
  ctx.toolbar.append(el('span.tb-stat', `${slidePaths.length} slide${slidePaths.length === 1 ? '' : 's'} · text, tables and pictures; layout is not reproduced`));
  return { destroy: () => urls.forEach(u => URL.revokeObjectURL(u)) };
}

// Slide order comes from presentation.xml; fall back to the slide file numbers.
function orderedSlides(files, xml) {
  const pres = xml('ppt/presentation.xml');
  const rels = readRels(files, 'ppt/_rels/presentation.xml.rels', 'ppt/');
  if (pres) {
    const ids = [...pres.getElementsByTagNameNS(NS.p, 'sldId')];
    const paths = ids.map(s => rels.get(s.getAttributeNS(NS.r, 'id'))?.target).filter(p => p && files[p]);
    if (paths.length) return paths;
  }
  return Object.keys(files)
    .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
}

// Relationship id -> { target (absolute path in the package), type }.
function readRels(files, relsPath, baseDir) {
  const map = new Map();
  if (!files[relsPath]) return map;
  const doc = new DOMParser().parseFromString(strFromU8(files[relsPath]), 'application/xml');
  for (const r of doc.getElementsByTagName('Relationship')) {
    const mode = r.getAttribute('TargetMode');
    const target = r.getAttribute('Target') || '';
    map.set(r.getAttribute('Id'), {
      type: (r.getAttribute('Type') || '').split('/').pop(),
      target: mode === 'External' ? null : resolvePath(baseDir, target),
    });
  }
  return map;
}
function resolvePath(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir + target).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}

function renderSlide(path, num, files, xml, urls) {
  const doc = xml(path);
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const rels = readRels(files, `${dir}_rels/${path.slice(dir.length)}.rels`, dir);
  const card = el('section.pptx-slide', el('div.num', `Slide ${num}`));
  const body = el('div.body');
  const pictures = el('div.imgs');
  let title = null, subtitle = null;

  const tree = doc?.getElementsByTagNameNS(NS.p, 'spTree')[0];
  if (tree) walk(tree);

  function walk(parent) {
    for (const node of parent.children) {
      if (node.namespaceURI !== NS.p) continue;
      if (node.localName === 'grpSp') { walk(node); continue; }
      if (node.localName === 'sp') shape(node);
      else if (node.localName === 'pic') picture(node);
      else if (node.localName === 'graphicFrame') frame(node);
    }
  }

  function shape(sp) {
    const ph = sp.getElementsByTagNameNS(NS.p, 'ph')[0];
    const type = ph?.getAttribute('type') || '';
    const paras = paragraphs(sp);
    if (!paras.length) return;
    if (!title && (type === 'title' || type === 'ctrTitle')) { title = paras.map(p => p.text).join(' '); return; }
    if (!subtitle && type === 'subTitle') { subtitle = paras.map(p => p.text).join(' '); return; }
    if (['sldNum', 'dt', 'ftr'].includes(type)) return;            // slide chrome, not content
    const bulleted = type === 'body' || type === '' || type === 'obj';
    for (const p of paras) {
      const row = el('div.p', { className: bulleted && paras.length > 1 ? 'p bullet' : 'p' });
      row.style.marginLeft = `${p.level * 22}px`;
      for (const run of p.runs) {
        const s = el('span', run.text);
        if (run.b) s.style.fontWeight = '600';
        if (run.i) s.style.fontStyle = 'italic';
        if (run.u) s.style.textDecoration = 'underline';
        row.appendChild(s);
      }
      body.appendChild(row);
    }
  }

  function picture(pic) {
    const blip = pic.getElementsByTagNameNS(NS.a, 'blip')[0];
    const target = rels.get(blip?.getAttributeNS(NS.r, 'embed'))?.target;
    const bytes = target && files[target];
    if (!bytes) return;
    const ext = target.split('.').pop().toLowerCase();
    const mime = IMG_MIME[ext];
    if (!mime) { pictures.appendChild(el('span.ph', `[${ext.toUpperCase()} picture cannot be shown in a browser]`)); return; }
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    urls.push(url);
    const name = pic.getElementsByTagNameNS(NS.p, 'cNvPr')[0]?.getAttribute('descr') || '';
    pictures.appendChild(el('img', { src: url, alt: name }));   // already in memory, so no lazy loading
  }

  function frame(gf) {
    const tbl = gf.getElementsByTagNameNS(NS.a, 'tbl')[0];
    if (tbl) {
      const t = el('table');
      for (const tr of tbl.getElementsByTagNameNS(NS.a, 'tr')) {
        const row = el('tr');
        for (const tc of tr.getElementsByTagNameNS(NS.a, 'tc')) {
          const cell = el('td', paragraphs(tc).map(p => p.text).join('\n'));
          const span = Number(tc.getAttribute('gridSpan') || 1);
          if (span > 1) cell.colSpan = span;
          if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') continue;
          row.appendChild(cell);
        }
        t.appendChild(row);
      }
      body.appendChild(t);
      return;
    }
    const uri = gf.getElementsByTagNameNS(NS.a, 'graphicData')[0]?.getAttribute('uri') || '';
    if (uri.includes('chart')) body.appendChild(el('div.ph', '[chart]'));
    else if (uri.includes('diagram')) body.appendChild(el('div.ph', '[SmartArt diagram]'));
  }

  if (title) card.appendChild(el('h2', title));
  if (subtitle) card.appendChild(el('div.sub', subtitle));
  if (body.children.length) card.appendChild(body);
  if (pictures.children.length) card.appendChild(pictures);
  if (!title && !subtitle && !body.children.length && !pictures.children.length) card.appendChild(el('div.ph', '[no text or pictures on this slide]'));

  // Speaker notes
  const notesPath = [...rels.values()].find(r => r.type === 'notesSlide')?.target;
  const notes = notesPath && xml(notesPath);
  if (notes) {
    const text = [...notes.getElementsByTagNameNS(NS.p, 'sp')]
      .filter(sp => sp.getElementsByTagNameNS(NS.p, 'ph')[0]?.getAttribute('type') === 'body')
      .flatMap(sp => paragraphs(sp).map(p => p.text))
      .filter(Boolean);
    if (text.length) card.appendChild(el('details', el('summary', 'Speaker notes'), ...text.map(t => el('p', t))));
  }
  return card;
}

// a:p paragraphs inside a node: text runs with basic formatting and the bullet level.
function paragraphs(node) {
  const out = [];
  for (const p of node.getElementsByTagNameNS(NS.a, 'p')) {
    const runs = [];
    for (const child of p.children) {
      if (child.namespaceURI !== NS.a) continue;
      if (child.localName === 'r' || child.localName === 'fld') {
        const t = child.getElementsByTagNameNS(NS.a, 't')[0]?.textContent || '';
        const pr = child.getElementsByTagNameNS(NS.a, 'rPr')[0];
        if (t) runs.push({ text: t, b: pr?.getAttribute('b') === '1', i: pr?.getAttribute('i') === '1', u: !!pr?.getAttribute('u') && pr.getAttribute('u') !== 'none' });
      } else if (child.localName === 'br') runs.push({ text: '\n' });
    }
    const text = runs.map(r => r.text).join('').trim();
    if (!text) continue;
    const level = Number(p.getElementsByTagNameNS(NS.a, 'pPr')[0]?.getAttribute('lvl') || 0);
    out.push({ text, runs, level });
  }
  return out;
}
