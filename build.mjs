// Build script: bundles the extension with esbuild into ./dist (load that folder as an unpacked extension).
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// ---------- static assets ----------
function copyStatic() {
  cpSync('src/manifest.json', `${outdir}/manifest.json`);
  cpSync('src/viewer/viewer.html', `${outdir}/viewer.html`);
  cpSync('src/viewer/viewer.css', `${outdir}/viewer.css`);
  cpSync('src/popup/popup.html', `${outdir}/popup.html`);
  cpSync('src/popup/popup.css', `${outdir}/popup.css`);
  cpSync('node_modules/highlight.js/styles/github.min.css', `${outdir}/hljs-light.css`);
  cpSync('node_modules/highlight.js/styles/github-dark.min.css', `${outdir}/hljs-dark.css`);
  mkdirSync(`${outdir}/icons`, { recursive: true });
  for (const size of [16, 32, 48, 128]) writeFileSync(`${outdir}/icons/icon${size}.png`, makeIcon(size));
}

// ---------- tiny PNG icon generator (no native deps) ----------
// Draws an orange rounded square with a white "table" glyph.
function makeIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const r = size * 0.22;
  const set = (x, y, rgba) => { const i = (y * size + x) * 4; px[i] = rgba[0]; px[i + 1] = rgba[1]; px[i + 2] = rgba[2]; px[i + 3] = rgba[3]; };
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x + 0.5, r), size - r), cy = Math.min(Math.max(y + 0.5, r), size - r);
    return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
  };
  const m = Math.max(1, Math.round(size * 0.2));       // margin of glyph
  const t = Math.max(1, Math.round(size * 0.08));      // line thickness
  const g0 = m, g1 = size - m;                          // glyph bounds
  const rowStep = (g1 - g0) / 3, colStep = (g1 - g0) / 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!inRounded(x, y)) { set(x, y, [0, 0, 0, 0]); continue; }
    let white = false;
    if (x >= g0 && x < g1 && y >= g0 && y < g1) {
      const onOuter = x < g0 + t || x >= g1 - t || y < g0 + t || y >= g1 - t;
      const onRow = [1, 2].some(k => Math.abs(y - (g0 + k * rowStep)) < t / 2 + 0.5);
      const onCol = [1, 2].some(k => Math.abs(x - (g0 + k * colStep)) < t / 2 + 0.5);
      const header = y < g0 + rowStep;                   // filled header band
      white = onOuter || onRow || onCol || header;
    }
    set(x, y, white ? [255, 255, 255, 255] : [255, 153, 0, 255]); // AWS orange
  }
  return encodePng(size, size, px);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return c ^ -1; }

// ---------- esbuild ----------
const common = {
  bundle: true,
  format: 'esm',
  target: ['chrome120'],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

const ctx = await esbuild.context({
  ...common,
  entryPoints: {
    background: 'src/background.js',
    viewer: 'src/viewer/viewer.js',
    popup: 'src/popup/popup.js',
  },
  outdir,
  splitting: false,
});

copyStatic();
if (watch) {
  await ctx.watch();
  console.log('watching... (static files are copied once; re-run for html/css changes)');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  const manifest = JSON.parse(readFileSync(`${outdir}/manifest.json`, 'utf8'));
  console.log(`built ${manifest.name} v${manifest.version} -> ./${outdir}`);
}
