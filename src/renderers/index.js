import { renderCsv } from './csv.js';
import { renderJson, renderNdjson } from './json.js';
import { renderXml } from './xml.js';
import { renderYaml, renderToml } from './yaml.js';
import { renderMarkdown } from './markdown.js';
import { renderHtml } from './html.js';
import { renderText } from './text.js';
import { renderParquet } from './parquet.js';
import { renderArrow } from './arrow.js';
import { renderXlsx } from './xlsx.js';
import { renderImage, renderSvg, renderPdf, renderVideo, renderAudio } from './media.js';
import { renderZip } from './zip.js';
import { renderHex } from './hex.js';

// format key -> async (ctx) => { destroy?() }
export const RENDERERS = {
  csv: renderCsv,
  json: renderJson,
  ndjson: renderNdjson,
  xml: renderXml,
  yaml: renderYaml,
  toml: renderToml,
  markdown: renderMarkdown,
  html: renderHtml,
  text: renderText,
  code: renderText,
  parquet: renderParquet,
  arrow: renderArrow,
  xlsx: renderXlsx,
  image: renderImage,
  svg: renderSvg,
  pdf: renderPdf,
  video: renderVideo,
  audio: renderAudio,
  zip: renderZip,
  hex: renderHex,
};
