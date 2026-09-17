// Viewer orchestrator: load -> detect -> render, with format override, raw view and sub-documents (zip entries).
import { FORMATS } from '../lib/formats.js';
import { detectFormat } from '../lib/detect.js';
import { fetchBytes, probeSize, readLocalFile, decompress, nameFromUrl } from '../lib/source.js';
import { el, formatBytes, downloadBlob, copyText, decodeText, stripExt, extOf, baseName } from '../lib/util.js';
import { RENDERERS } from '../renderers/index.js';

const $ = (id) => document.getElementById(id);
const ui = {
  fileName: $('fileName'), filePath: $('filePath'), meta: $('meta'), formatSelect: $('formatSelect'),
  rawBtn: $('rawBtn'), reloadBtn: $('reloadBtn'), downloadBtn: $('downloadBtn'), copyBtn: $('copyBtn'),
  crumbs: $('crumbs'), toolbar: $('toolbar'), mount: $('mount'), progress: $('progress'), progressText: $('progressText'),
  progressBar: $('progressBar'), cancelBtn: $('cancelBtn'), drop: $('drop'), filePicker: $('filePicker'),
  status: $('status'), detectInfo: $('detectInfo'),
};

const LARGE_BYTES = 256 * 1024 * 1024;   // ask before fully loading anything bigger
const PARTIAL_BYTES = 64 * 1024 * 1024;  // "preview" size for huge text-ish objects
const PARQUET_RANGE_THRESHOLD = 32 * 1024 * 1024; // above this, read Parquet with range requests instead of full download

let current = null;       // { bytes, name, fullPath, contentType, url, size, partial, format, detected }
let stack = [];           // sub-documents (zip entries): [{ bytes, name, format }]
let activeRenderer = null;
let abort = null;

// ---------- format select ----------
for (const [key, f] of Object.entries(FORMATS)) {
  if (!f.renderer) continue;
  ui.formatSelect.appendChild(el('option', { value: key }, f.label.split(' (')[0]));
}
ui.formatSelect.addEventListener('change', () => renderCurrent(ui.formatSelect.value));
ui.rawBtn.addEventListener('click', () => {
  const on = ui.rawBtn.classList.toggle('on');
  renderCurrent(on ? 'text' : (ui.formatSelect.value || current.format), { raw: on });
});
ui.reloadBtn.addEventListener('click', () => { if (current?.url) open({ url: current.url }); });
ui.downloadBtn.addEventListener('click', () => {
  const d = top();
  if (d) downloadBlob(new Blob([d.bytes]), baseName(d.name));
});
ui.copyBtn.addEventListener('click', async () => {
  const d = top();
  if (!d) return;
  if (d.bytes.length > 50 * 1024 * 1024) { setStatus('Too large to copy (50 MB limit).'); return; }
  setStatus((await copyText(decodeText(d.bytes))) ? 'Copied to clipboard.' : 'Clipboard write failed.');
});
ui.cancelBtn.addEventListener('click', () => abort?.abort());

// ---------- local file ----------
ui.filePicker.addEventListener('change', () => { if (ui.filePicker.files[0]) openLocal(ui.filePicker.files[0]); });
for (const evName of ['dragenter', 'dragover']) document.addEventListener(evName, (e) => { e.preventDefault(); ui.drop.classList.add('over'); });
document.addEventListener('dragleave', () => ui.drop.classList.remove('over'));
document.addEventListener('drop', (e) => { e.preventDefault(); ui.drop.classList.remove('over'); const f = e.dataTransfer.files?.[0]; if (f) openLocal(f); });

function setStatus(msg) { ui.status.textContent = msg || ''; }
function showProgress(text, frac) {
  ui.progress.hidden = false;
  ui.progressText.textContent = text;
  ui.progressBar.style.width = frac == null ? '0%' : Math.round(frac * 100) + '%';
}
function hideProgress() { ui.progress.hidden = true; }
function showError(title, err) {
  hideProgress();
  ui.toolbar.innerHTML = '';
  ui.mount.replaceChildren(el('div.error', el('h3', title), el('pre', String(err?.stack || err?.message || err))));
  setStatus('Error');
}
function top() { return stack.length ? stack[stack.length - 1] : current; }

// ---------- entry ----------
async function boot() {
  const hash = location.hash.slice(1);
  const params = new URLSearchParams(hash.includes('=') && !/^u=https?:/.test(hash) ? hash : '');
  if (hash.startsWith('u=')) {
    let url = hash.slice(2);
    if (!/^https?:\/\//i.test(url)) { try { url = decodeURIComponent(url); } catch { /* keep */ } }
    // Keep the presigned URL out of the visible address bar / history as much as possible.
    history.replaceState(null, '', location.pathname);
    await open({ url });
  } else if (params.get('local') || hash === 'local=1') {
    hideProgress();
    ui.drop.hidden = false;
    ui.fileName.textContent = 'Open a local file';
    document.title = 'S3 Any Viewer';
  } else {
    hideProgress();
    ui.drop.hidden = false;
    ui.fileName.textContent = 'S3 Any Viewer';
  }
}
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#u=')) boot(); });

async function openLocal(file) {
  ui.drop.hidden = true;
  stack = [];
  showProgress(`Reading ${file.name}…`, 0);
  try {
    const res = await readLocalFile(file, (l, t) => showProgress(`Reading ${file.name}… ${formatBytes(l)} / ${formatBytes(t)}`, l / t));
    current = { ...res, name: file.name, fullPath: file.name, url: null, size: file.size };
    await afterLoad();
  } catch (e) { showError('Could not read file', e); }
}

async function open({ url }) {
  ui.drop.hidden = true;
  stack = [];
  abort?.abort();
  abort = new AbortController();
  const info = nameFromUrl(url);
  ui.fileName.textContent = info.name;
  ui.filePath.textContent = info.bucket ? `s3://${info.bucket}/${info.fullPath}` : url.split('?')[0];
  ui.filePath.title = ui.filePath.textContent;
  document.title = info.name;
  ui.meta.textContent = '';
  showProgress('Connecting…');
  try {
    const probe = await probeSize(url, abort.signal);
    const size = probe.size;
    const ext = extOf(info.name);

    // Big Parquet: don't download, read via HTTP ranges (footer + requested row groups only).
    if (ext === 'parquet' && probe.rangeOk && size != null && size > PARQUET_RANGE_THRESHOLD) {
      current = { bytes: null, name: info.name, fullPath: info.fullPath, url, size, contentType: probe.contentType, partial: false, remote: true };
      await afterLoad();
      return;
    }

    let rangeEnd;
    if (size != null && size > LARGE_BYTES) {
      const choice = await askLarge(size, probe.rangeOk);
      if (choice === 'cancel') { hideProgress(); ui.mount.replaceChildren(el('div.big-prompt', 'Cancelled.')); return; }
      if (choice === 'partial') rangeEnd = PARTIAL_BYTES;
    }
    showProgress('Fetching…', 0);
    const res = await fetchBytes(url, {
      signal: abort.signal, rangeEnd,
      onProgress: (l, t) => showProgress(`Fetching… ${formatBytes(l)}${t ? ' / ' + formatBytes(t) : ''}`, t ? l / t : null),
    });
    current = { ...res, name: info.name, fullPath: info.fullPath, url, size: res.total ?? res.bytes.length };
    await afterLoad();
  } catch (e) {
    if (e.name === 'AbortError') { hideProgress(); setStatus('Cancelled.'); return; }
    if (e instanceof TypeError && await showPermissionHelp(url)) return;
    showError('Could not load the object', e);
  }
}

// A TypeError from fetch() on a non-AWS origin almost always means the extension has no host permission
// for that site (the browser then blocks the cross-origin read). Offer to grant it and retry.
async function showPermissionHelp(url) {
  let origin, hostname;
  try { ({ origin, hostname } = new URL(url)); } catch { return false; }
  if (/(^|\.)amazonaws\.com(\.cn)?$/.test(hostname)) return false;
  const perms = typeof chrome !== 'undefined' && chrome.permissions;
  const origins = [`${origin}/*`];
  const granted = perms ? await chrome.permissions.contains({ origins }).catch(() => false) : false;
  hideProgress();
  ui.toolbar.innerHTML = '';
  const grantBtn = el('button.tb-btn.on', {
    onclick: async () => {
      const ok = await chrome.permissions.request({ origins }).catch(() => false);
      if (ok) open({ url }); else setStatus(`Access to ${hostname} was not granted.`);
    },
  }, `Grant access to ${hostname}`);
  ui.mount.replaceChildren(el('div.big-prompt',
    el('h3', granted ? `Could not reach ${hostname}` : `${hostname} is not an AWS host`),
    el('p', granted
      ? 'The site permission is already granted, so the request itself failed: the server may be offline, block cross-site reads, or the link may be broken. Try Reload.'
      : 'S3 Any Viewer only has permission for *.amazonaws.com by default. To read files from this site, grant it access. Chrome will ask you to confirm the exact origin, and you can revoke it any time from the extension\'s details page.'),
    el('div.row', perms && !granted ? grantBtn : null, el('button.tb-btn', { onclick: () => open({ url }) }, 'Retry')),
    !perms ? el('p.muted', 'Running outside the extension: the browser blocked the cross-origin request (CORS).') : null,
  ));
  setStatus(granted ? 'Fetch failed' : 'Permission needed');
  return true;
}

function askLarge(size, rangeOk) {
  hideProgress();
  return new Promise((resolve) => {
    const box = el('div.big-prompt',
      el('h3', `This object is ${formatBytes(size)}`),
      el('p', 'Loading it fully will use that much memory in this tab. For text-like formats (CSV, JSON lines, logs) a partial preview is usually enough.'),
      el('div.row',
        rangeOk && el('button.tb-btn.on', { onclick: () => resolve('partial') }, `Load first ${formatBytes(PARTIAL_BYTES)}`),
        el('button.tb-btn', { onclick: () => resolve('full') }, 'Load everything'),
        el('button.tb-btn', { onclick: () => resolve('cancel') }, 'Cancel'),
      ));
    ui.mount.replaceChildren(box);
  });
}

async function afterLoad() {
  // Unwrap compression layers (gzip/zstd/brotli), possibly nested (file.csv.gz).
  let bytes = current.bytes, name = current.name, detected = null, layers = [];
  if (bytes) {
    for (let i = 0; i < 3; i++) {
      detected = detectFormat({ name, contentType: current.contentType, bytes });
      if (detected.format !== 'gzip') break;
      showProgress(`Decompressing (${detected.compression})…`);
      try { bytes = await decompress(bytes, detected.compression); }
      catch (e) { showError(`Could not decompress (${detected.compression})`, e); return; }
      layers.push(detected.compression);
      name = stripExt(stripExt(stripExt(name, 'gz'), 'gzip'), detected.compression === 'zstd' ? 'zst' : 'br');
    }
  } else {
    detected = { format: 'parquet', ext: 'parquet', reason: 'ext (remote range reads)' };
  }
  current.bytes = bytes;
  current.innerName = name;
  current.detected = detected;
  current.format = detected.format;
  current.layers = layers;

  ui.meta.replaceChildren(...[
    el('span', 'Size ', el('b', formatBytes(current.size ?? bytes?.length))),
    layers.length ? el('span', 'Unpacked ', el('b', formatBytes(bytes.length)), ` (${layers.join(' > ')})`) : null,
    current.partial ? el('span', { style: { color: '#d97706' } }, 'PARTIAL PREVIEW') : null,
    current.contentType ? el('span', 'Type ', el('b', current.contentType.split(';')[0])) : null,
    current.lastModified ? el('span', 'Modified ', el('b', current.lastModified)) : null,
  ].filter(Boolean));
  ui.detectInfo.textContent = `Detected: ${current.format} (by ${detected.reason})${detected.unsupported ? ` - ${detected.unsupported} is not supported yet, showing hex` : ''}`;
  ui.formatSelect.value = current.format in RENDERERS ? current.format : 'hex';
  ui.rawBtn.classList.remove('on');
  await renderCurrent(current.format);
}

async function renderCurrent(format, { raw = false } = {}) {
  const doc = top();
  if (!doc) return;
  activeRenderer?.destroy?.();
  activeRenderer = null;
  ui.toolbar.innerHTML = '';
  ui.mount.innerHTML = '';
  hideProgress();
  const fn = RENDERERS[format] || RENDERERS.hex;
  const ctx = {
    bytes: doc.bytes, name: doc.innerName || doc.name, ext: extOf(doc.innerName || doc.name), format, raw,
    url: doc.url, size: doc.size, remote: !!doc.remote, partial: !!doc.partial, contentType: doc.contentType,
    unsupported: doc.detected?.unsupported,
    mount: ui.mount, toolbar: ui.toolbar,
    setStatus, showProgress, hideProgress,
    text: () => (doc._text ??= decodeText(doc.bytes)),
    openSub: (sub) => openSub(sub),
    rerender: (fmt) => renderCurrent(fmt || format),
  };
  setStatus(`Rendering as ${FORMATS[format]?.label || format}…`);
  try {
    activeRenderer = (await fn(ctx)) || null;
    if (ui.status.textContent.startsWith('Rendering')) setStatus('');
  } catch (e) {
    console.error(e);
    if (format !== 'text' && format !== 'hex' && doc.bytes) {
      setStatus(`Failed to render as ${format}: ${e.message}. Falling back.`);
      const fallback = ctx.bytes && looksTextish(ctx.bytes) ? 'text' : 'hex';
      ui.formatSelect.value = fallback;
      await renderCurrent(fallback);
      ui.mount.prepend(el('div.error', el('h3', `Could not render as ${FORMATS[format]?.label || format}`), el('pre', String(e.message || e))));
    } else showError(`Could not render as ${format}`, e);
  }
}
function looksTextish(bytes) { for (let i = 0; i < Math.min(bytes.length, 4096); i++) if (bytes[i] === 0) return false; return true; }

// ---------- sub documents (zip entries) ----------
async function openSub({ bytes, name }) {
  const detected = detectFormat({ name, bytes });
  let inner = bytes, innerName = name;
  if (detected.format === 'gzip') { try { inner = await decompress(bytes, detected.compression); innerName = stripExt(stripExt(name, 'gz'), 'zst'); } catch { /* keep raw */ } }
  const det2 = inner === bytes ? detected : detectFormat({ name: innerName, bytes: inner });
  stack.push({ bytes: inner, name, innerName, format: det2.format, detected: det2, size: inner.length });
  drawCrumbs();
  ui.formatSelect.value = det2.format in RENDERERS ? det2.format : 'hex';
  ui.detectInfo.textContent = `Detected: ${det2.format} (by ${det2.reason})`;
  await renderCurrent(det2.format);
}
function drawCrumbs() {
  ui.crumbs.hidden = stack.length === 0;
  ui.crumbs.replaceChildren(
    el('button.tb-btn', { onclick: () => popTo(0) }, baseName(current.name)),
    ...stack.map((s, i) => [el('span', '›'), i === stack.length - 1 ? el('b', s.name) : el('button.tb-btn', { onclick: () => popTo(i + 1) }, s.name)]).flat(),
  );
}
async function popTo(n) {
  stack = stack.slice(0, n);
  drawCrumbs();
  const d = top();
  ui.formatSelect.value = d.format in RENDERERS ? d.format : 'hex';
  await renderCurrent(d.format);
}

boot();
