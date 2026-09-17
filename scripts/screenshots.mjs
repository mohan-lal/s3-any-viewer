// Renders store assets into ./store/assets using the locally installed Chrome (or Edge):
//   - five 1280x800 screenshots of the viewer showing fixture files, each with a caption banner
//   - 440x280 small promo tile and 1400x560 marquee tile
//   - a copy of the 128px icon
// Requires: npm run build && npm run fixtures. Starts its own copy of the dev server on port 8766.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8766;
const OUT = 'store/assets';
const BASE = `http://localhost:${PORT}`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = CHROME_CANDIDATES.find(p => existsSync(p));
if (!executablePath) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
for (const f of ['dist/viewer.html', 'fixtures/users.csv', 'fixtures/users.parquet']) if (!existsSync(f)) throw new Error(`${f} missing - run "npm run build" and "npm run fixtures" first`);
mkdirSync(OUT, { recursive: true });

const ICON_B64 = readFileSync('dist/icons/icon128.png').toString('base64');
const ICON_SRC = `data:image/png;base64,${ICON_B64}`;

// ---------- scenes ----------
// `s3Path` replaces the localhost fixture path in the viewer header with the s3:// path a real session shows.
const SCENES = [
  {
    file: 'screenshot-1-csv.png', fixture: 'users.csv?ct=application/octet-stream', s3Path: 's3://analytics-exports/customers/2026-09/users.csv',
    title: 'Click "Open" in the S3 console. Read the file, don\'t download it.',
    sub: 'CSV with any delimiter becomes a sortable, filterable table. Even when S3 serves it as application/octet-stream.',
    async act(frame) { await frame.evaluate(() => { const i = document.querySelector('.table-toolbar input'); i.value = 'Hyderabad'; i.dispatchEvent(new Event('input')); }); await sleep(500); },
  },
  {
    file: 'screenshot-2-parquet.png', fixture: 'users.parquet', s3Path: 's3://data-lake/silver/customers/part-00000.parquet',
    title: 'Parquet, Arrow and Feather, straight from the bucket.',
    sub: 'Schema panel, paged rows, and HTTP range reads for large files so you never download the whole object.',
    async act(frame) { await frame.evaluate(() => [...document.querySelectorAll('#toolbar .tb-btn')].find(b => b.textContent === 'Schema')?.click()); await sleep(300); },
  },
  {
    file: 'screenshot-3-json.png', fixture: 'order.json', s3Path: 's3://orders-archive/2026/09/14/ORD-2026-000418.json',
    title: 'JSON as a tree, pretty print, or table.',
    sub: 'NDJSON, GeoJSON and {data: [...]} envelopes are recognised too. Copy pretty or minified in one click.',
    async act() {},
  },
  {
    file: 'screenshot-4-xlsx.png', fixture: 'users.xlsx', s3Path: 's3://finance-reports/monthly/2026-09/customers.xlsx',
    title: 'Excel and OpenDocument workbooks with sheet tabs.',
    sub: 'XLSX, XLSM, XLSB, XLS and ODS. Sort, filter, resize, inspect a cell, export to CSV or JSON.',
    async act(frame) { await frame.evaluate(() => { const ths = document.querySelectorAll('table.vt thead th'); ths[5].click(); ths[5].click(); }); await sleep(300); },
  },
  {
    file: 'screenshot-5-log.png', fixture: 'app.log', s3Path: 's3://app-logs/orders-api/2026/09/17/app.log',
    title: 'Multi-megabyte logs with grep, no download.',
    sub: 'Virtualized viewer handles hundreds of thousands of lines. Also gzip, zstd and brotli unwrapped automatically.',
    async act(frame) { await frame.evaluate(() => { const i = document.querySelector('#toolbar input[type=search]'); i.value = 'ERROR'; i.dispatchEvent(new Event('input')); }); await sleep(700); },
  },
];

const frameHtml = ({ title, sub, url }) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1280px;height:800px;overflow:hidden;background:#0b1220;font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif}
  .banner{height:128px;box-sizing:border-box;padding:24px 40px 0;display:flex;gap:20px;align-items:flex-start;color:#f8fafc;background:linear-gradient(135deg,#0b1220 0%,#111c33 100%)}
  .banner img{width:56px;height:56px;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.4);flex:none;margin-top:2px}
  h1{margin:0;font-size:27px;font-weight:600;letter-spacing:-.01em;line-height:1.2}
  p{margin:8px 0 0;font-size:15.5px;color:#cbd5e1;line-height:1.35;max-width:1100px}
  .accent{color:#ff9900}
  .shot{position:absolute;left:0;top:128px;width:1280px;height:672px;background:#fff;border-top:3px solid #ff9900}
  iframe{border:0;width:1280px;height:669px;display:block}
</style></head><body>
  <div class="banner"><img src="${ICON_SRC}" alt=""><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div></div>
  <div class="shot"><iframe src="${url}"></iframe></div>
</body></html>`;

const tileHtml = (w, h, big) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;background:linear-gradient(135deg,#0b1220 0%,#152238 60%,#1c2b47 100%);color:#f8fafc}
  .wrap{position:absolute;inset:0;display:flex;align-items:center;gap:${big ? 44 : 22}px;padding:0 ${big ? 90 : 28}px;box-sizing:border-box}
  img{width:${big ? 200 : 96}px;height:${big ? 200 : 96}px;border-radius:${big ? 44 : 22}px;box-shadow:0 14px 40px rgba(0,0,0,.45);flex:none}
  h1{margin:0;font-size:${big ? 64 : 30}px;font-weight:700;letter-spacing:-.02em;line-height:1.05}
  p{margin:${big ? 18 : 8}px 0 0;font-size:${big ? 28 : 14.5}px;color:#cbd5e1;line-height:1.3}
  .tags{margin-top:${big ? 26 : 12}px;display:flex;flex-wrap:wrap;gap:${big ? 10 : 5}px}
  .tags span{font-size:${big ? 17 : 10.5}px;padding:${big ? '6px 14px' : '2px 8px'};border-radius:999px;background:rgba(255,153,0,.16);color:#ffb84d;border:1px solid rgba(255,153,0,.35)}
</style></head><body><div class="wrap"><img src="${ICON_SRC}" alt=""><div>
  <h1>S3 Any Viewer</h1>
  <p>Open any S3 object in the browser, formatted. No AWS keys.</p>
  <div class="tags">${['CSV', 'JSON', 'Parquet', 'Excel', 'XML', 'YAML', 'PDF', 'Images', 'ZIP', 'Logs'].map(t => `<span>${t}</span>`).join('')}</div>
</div></div></body></html>`;

function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- run ----------
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
try {
  await waitForServer(`${BASE}/viewer.html`);
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb', '--force-device-scale-factor=1', '--no-first-run'] });
  try {
    for (const scene of SCENES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      const viewerUrl = `${BASE}/viewer.html#u=${BASE}/fixtures/${scene.fixture}`;
      await page.setContent(frameHtml({ ...scene, url: viewerUrl }), { waitUntil: 'load' });
      const frame = await page.waitForFrame(f => f.url().startsWith(`${BASE}/viewer.html`), { timeout: 15000 });
      await frame.waitForFunction(() => document.getElementById('progress')?.hidden && document.getElementById('mount')?.children.length > 0 && !document.getElementById('status').textContent.startsWith('Rendering'), { timeout: 20000 });
      await sleep(300);
      if (scene.s3Path) await frame.evaluate((p) => { const n = document.getElementById('filePath'); n.textContent = p; n.title = p; }, scene.s3Path);
      await scene.act(frame);
      await page.screenshot({ path: `${OUT}/${scene.file}`, type: 'png' });
      console.log('wrote', `${OUT}/${scene.file}`);
      await page.close();
    }
    for (const [file, w, h, big] of [['promo-small-440x280.png', 440, 280, false], ['promo-marquee-1400x560.png', 1400, 560, true]]) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.setContent(tileHtml(w, h, big), { waitUntil: 'load' });
      await page.screenshot({ path: `${OUT}/${file}`, type: 'png' });
      console.log('wrote', `${OUT}/${file}`);
      await page.close();
    }
  } finally { await browser.close(); }
  copyFileSync('dist/icons/icon128.png', `${OUT}/icon-128.png`);
  console.log('wrote', `${OUT}/icon-128.png`);
} finally { server.kill(); }

async function waitForServer(url) {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ } await sleep(100); }
  throw new Error('dev server did not start');
}
