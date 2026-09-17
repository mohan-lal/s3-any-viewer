import { el, formatBytes } from '../lib/util.js';
import { highlightInto } from './text.js';
import { makeTabs } from './json.js';

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  ico: 'image/x-icon', avif: 'image/avif', apng: 'image/apng', svg: 'image/svg+xml', pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/ogg',
};

function blobUrl(ctx, fallbackMime) {
  const ct = (ctx.contentType || '').split(';')[0];
  const mime = MIME_BY_EXT[ctx.ext] || (ct && ct !== 'application/octet-stream' && ct !== 'binary/octet-stream' ? ct : fallbackMime);
  const url = URL.createObjectURL(new Blob([ctx.bytes], { type: mime }));
  return { url, mime, revoke: () => URL.revokeObjectURL(url) };
}

export async function renderImage(ctx) {
  const { url, mime, revoke } = blobUrl(ctx, 'image/png');
  const wrap = el('div.media-wrap');
  const img = el('img', { src: url, alt: ctx.name });
  const info = el('span.tb-stat', `${mime} · ${formatBytes(ctx.bytes.length)}`);
  img.onload = () => { info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${mime} · ${formatBytes(ctx.bytes.length)}`; };
  img.onerror = () => { info.textContent = `Browser could not decode this image (${mime}).`; };
  const fit = el('button.tb-btn.on', { onclick: () => { wrap.classList.remove('actual'); fit.classList.add('on'); actual.classList.remove('on'); } }, 'Fit');
  const actual = el('button.tb-btn', { onclick: () => { wrap.classList.add('actual'); actual.classList.add('on'); fit.classList.remove('on'); } }, '100%');
  ctx.toolbar.append(el('div.tabs', fit, actual), info);
  wrap.appendChild(img);
  ctx.mount.appendChild(wrap);
  return { destroy: revoke };
}

export async function renderSvg(ctx) {
  const text = ctx.text();
  const tabs = makeTabs(['Image', 'Source'], show);
  ctx.toolbar.append(tabs.node);
  let url = null;
  function show(name) {
    ctx.mount.innerHTML = '';
    if (name === 'Image') {
      // <img> never runs scripts inside the SVG.
      url ??= URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      ctx.mount.appendChild(el('div.media-wrap', el('img', { src: url, alt: ctx.name })));
    } else highlightInto(ctx.mount, text, 'xml');
  }
  show('Image');
  return { destroy: () => url && URL.revokeObjectURL(url) };
}

export async function renderPdf(ctx) {
  const url = URL.createObjectURL(new Blob([ctx.bytes], { type: 'application/pdf' }));
  ctx.mount.appendChild(el('iframe.doc', { src: url, title: ctx.name }));
  ctx.toolbar.append(el('span.tb-stat', 'Rendered by the browser PDF viewer'));
  return { destroy: () => URL.revokeObjectURL(url) };
}

export async function renderVideo(ctx) {
  const { url, mime, revoke } = blobUrl(ctx, 'video/mp4');
  const v = el('video', { src: url, controls: true, autoplay: false });
  ctx.toolbar.append(el('span.tb-stat', mime));
  ctx.mount.appendChild(el('div.media-wrap', v));
  return { destroy: revoke };
}

export async function renderAudio(ctx) {
  const { url, mime, revoke } = blobUrl(ctx, 'audio/mpeg');
  ctx.toolbar.append(el('span.tb-stat', mime));
  ctx.mount.appendChild(el('div.media-wrap.audio', el('audio', { src: url, controls: true })));
  return { destroy: revoke };
}
