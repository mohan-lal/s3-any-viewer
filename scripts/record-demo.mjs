// Captures clean UI screenshots of the real viewer and writes demo/frames/storyboard.json.
// All styling (gradient, browser frame, motion, captions, transitions) happens in
// scripts/encode-demo.mjs, so the look can be changed without re-recording.
//
//   npm run build && npm run fixtures && npm run demo && npm run demo:encode
//
// The viewer, the parsing and every pixel of UI are the real extension build. Two things are
// staged: the bucket listing is a local mock of the S3 console, and the object path in the
// viewer header is set to the s3:// form a real session shows.
import puppeteer from 'puppeteer-core';
import { startDemoServer, PORT } from './demo-server.mjs';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';

const W = 1280, H = 720;
const OUT = 'demo/frames';
const BASE = `http://127.0.0.1:${PORT}`;
const S3 = 's3://demo-analytics-bucket/exports/2026-09/';

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) throw new Error('Chrome not found; set CHROME_PATH');
if (!existsSync('dist/manifest.json')) throw new Error('run "npm run build" first');
if (!existsSync('fixtures/app.log')) throw new Error('run "npm run fixtures" first');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const beats = [];
let n = 0;

const server = await startDemoServer();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: W, height: H },
  args: [
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--force-color-profile=srgb',
    `--window-size=${W},${H + 88}`, '--window-position=-3000,0',
  ],
});

try {
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: W, height: H });

  const shot = async () => {
    const f = `${String(n++).padStart(4, '0')}.png`;
    await page.screenshot({ path: `${OUT}/${f}`, type: 'png' });
    return f;
  };

  /** Static beat: one screenshot held for `ms`. */
  async function ui(meta, ms) {
    beats.push({ kind: 'ui', ...meta, ms, frames: [{ f: await shot(), ms }] });
  }
  /** Live beat: capture while `run` executes, then pad to `ms`. */
  async function uiLive(meta, ms, run) {
    const frames = [];
    let done = false;
    const task = (async () => { try { await run(); } finally { done = true; } })();
    const t0 = Date.now();
    while (!done && Date.now() - t0 < ms + 6000) {
      const t = Date.now();
      frames.push({ f: await shot(), ms: 0 });
      frames[frames.length - 1].ms = Math.max(60, Date.now() - t);
    }
    await task;
    frames.push({ f: await shot(), ms: 0 });
    const used = frames.reduce((s, f) => s + f.ms, 0);
    frames[frames.length - 1].ms = Math.max(400, ms - used);
    beats.push({ kind: 'ui', ...meta, ms: frames.reduce((s, f) => s + f.ms, 0), frames });
  }
  const card = (meta, ms) => beats.push({ kind: 'card', ...meta, ms });

  const openViewer = async (key) => {
    await page.goto(`${BASE}/viewer.html?v=${Date.now()}#u=${BASE}/${key}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.getElementById('progress')?.hidden && document.getElementById('mount')?.children.length,
      { timeout: 30000 });
    await page.evaluate((p, k) => {
      const el = document.getElementById('filePath');
      if (el) { el.textContent = p + k; el.title = el.textContent; }
    }, S3, key);
    await sleep(300);
  };

  // ---------------- storyboard ----------------
  card({ style: 'title', title: 'S3 Any Viewer', sub: 'Read any file in your bucket. Right in the browser.' }, 3000);

  await page.goto(`${BASE}/console`, { waitUntil: 'load' });
  await ui({ kicker: 'The problem', title: 'Ten objects. Ten formats.', word: 'BUCKET', sub: 'Opening any of them means a download.', motion: 'zoomIn' }, 2500);

  await page.evaluate(() => window.__selectFile('users.csv'));
  await uiLive({ kicker: 'One click', title: 'Select a file. Hit Open.', word: 'OPEN', sub: 'Exactly what you do today.', motion: 'zoomRow' }, 2000,
    async () => { await sleep(600); });

  await openViewer('users.csv');
  await ui({ kicker: 'That is it', title: 'It opens. Formatted.', word: 'INSTANT', sub: 'No download. No access keys.', motion: 'zoomOut' }, 3000);

  await uiLive({ kicker: 'Tables', title: 'Filter as you type', word: 'FILTER', sub: 'Every column searched at once.', motion: 'zoomTop' }, 3500, async () => {
    const term = 'Hyderabad';
    for (let i = 1; i <= term.length; i++) {
      await page.evaluate((v) => { const i = document.querySelector('.table-toolbar input'); i.value = v; i.dispatchEvent(new Event('input')); }, term.slice(0, i));
      await sleep(65);
    }
    await sleep(800);
  });

  await uiLive({ kicker: 'Tables', title: 'Sort any column', word: 'SORT', sub: 'Click the header. Twice to reverse.', motion: 'none' }, 2500, async () => {
    await page.evaluate(() => { const i = document.querySelector('.table-toolbar input'); i.value = ''; i.dispatchEvent(new Event('input')); });
    await sleep(400);
    for (let k = 0; k < 2; k++) {
      await page.evaluate(() => document.querySelectorAll('table.vt thead th')[5].click());
      await sleep(450);
    }
  });

  await uiLive({ kicker: 'Tables', title: 'Take it with you', word: 'EXPORT', sub: 'CSV, TSV, JSON, clipboard.', motion: 'zoomRight' }, 2500, async () => {
    await page.evaluate(() => document.querySelector('.table-toolbar .tb-btn')?.click());
    await sleep(900);
  });
  await page.evaluate(() => document.querySelector('.menu')?.setAttribute('hidden', ''));

  await openViewer('users.parquet');
  await page.evaluate(() => [...document.querySelectorAll('#toolbar .tb-btn')].find(b => b.textContent === 'Schema')?.click());
  await ui({ kicker: 'Columnar', title: 'Parquet. With its schema.', word: 'PARQUET', sub: 'Big files read in parts, not downloaded whole.', motion: 'zoomIn' }, 3000);

  await openViewer('orders.json.gz');
  await ui({ kicker: 'Compressed', title: 'Gzipped? Unpacked.', word: 'UNZIP', sub: 'Format detected from the file. Nothing to choose.', motion: 'zoomOut' }, 3000);

  await openViewer('app.log');
  await ui({ kicker: 'Big files', title: '5 MB log. 60,000 lines.', word: 'BIG', sub: 'Opens instantly. Stays smooth.', motion: 'zoomIn' }, 2000);

  await uiLive({ kicker: 'Big files', title: 'Search. Highlighted.', word: 'SEARCH', sub: 'Jump between matches with Enter.', motion: 'zoomTop' }, 3500, async () => {
    const term = 'ERROR';
    for (let i = 1; i <= term.length; i++) {
      await page.evaluate((v) => { const i = document.querySelector('input.view-search'); i.value = v; i.dispatchEvent(new Event('input')); }, term.slice(0, i));
      await sleep(85);
    }
    await sleep(600);
    for (let k = 0; k < 3; k++) {
      await page.evaluate(() => document.querySelector('input.view-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      await sleep(300);
    }
  });

  card({
    style: 'tags', title: 'Opens just about anything',
    tags: ['CSV', 'TSV', 'any delimiter', 'JSON', 'JSON Lines', 'Parquet', 'Arrow', 'Excel', 'ODS',
      'XML', 'YAML', 'TOML', 'Markdown', 'HTML', 'logs', '40+ languages', 'PNG', 'JPEG', 'SVG',
      'PDF', 'video', 'audio', 'ZIP', 'gz · zst · br'],
    sub: 'Anything else becomes a hex dump. Never a silent download.',
  }, 4000);

  await openViewer('orders.xml');
  await ui({ kicker: 'Not just S3', title: 'Any site. Any link.', word: 'ANYWHERE', sub: 'Right-click → Open link in S3 Any Viewer.', motion: 'zoomOut' }, 3000);

  card({ style: 'rows', title: 'What it never touches', rows: ['AWS keys', 'Access keys', 'Session tokens', 'Cookies'], sub: 'Read in your tab. No analytics. No telemetry.' }, 4000);

  card({ style: 'end', title: 'S3 Any Viewer', sub: 'Stop downloading files just to look at them.', stores: ['Chrome Web Store', 'Microsoft Edge Add-ons'] }, 4000);

  const total = beats.reduce((s, b) => s + b.ms, 0);
  writeFileSync(`${OUT}/storyboard.json`, JSON.stringify({ width: W, height: H, beats }, null, 2));
  console.log(`captured ${n} screenshots across ${beats.length} beats -> ${OUT}`);
  console.log(`storyboard duration ${(total / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
  server.close();
}
