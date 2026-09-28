// Word (.docx) renderer. docx-preview lays the document out as pages with its styles, tables,
// images, headers and footers. It is imported on demand, so its weight only lands when a
// Word file is actually opened.
import { el } from '../lib/util.js';

export async function renderDocx(ctx) {
  ctx.showProgress('Rendering document…');
  const { renderAsync } = await import('docx-preview');

  const scroller = el('div.docx-scroll');
  const styles = el('div');
  ctx.mount.append(styles, scroller);
  try {
    await renderAsync(new Blob([ctx.bytes]), scroller, styles, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: false,
      renderChanges: false,
      useBase64URL: true,          // images as data: URIs, nothing left behind in blob storage
      experimental: false,
    });
  } finally {
    ctx.hideProgress();
  }
  neutraliseLinks(scroller);

  const pages = scroller.querySelectorAll('section.docx').length;
  ctx.toolbar.append(el('span.tb-stat', `${pages} page${pages === 1 ? '' : 's'} · layout is approximate`));
  return {};
}

// Links in a document are untrusted: keep web and mail links (opened in a new tab), drop the rest.
function neutraliseLinks(root) {
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (/^(https?:|mailto:)/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    else if (!href.startsWith('#')) a.removeAttribute('href');
  }
  for (const node of root.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
  }
}
