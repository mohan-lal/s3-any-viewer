// Load-time benchmark: the version live on the Chrome Web Store against this build.
//
//   npm run bench          (also runs automatically after a passing `npm test`)
//
// The live version number is asked from the Web Store's update server (nothing is downloaded),
// and that version's zip is taken from ./release. Both builds open the same files in the same
// headless Chrome (fresh temporary profile, extension never installed), alternating, and the
// median of several loads is reported. It only reports and never fails the run, since timings
// depend on how busy the machine is. Local only: skipped on CI, where shared machines are too
// noisy to compare. Set SKIP_BENCH=1 to skip it locally.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { unzipSync } from 'fflate';
import puppeteer from 'puppeteer-core';
import { CHROME } from '../test/helpers/browser.mjs';

const EXTENSION_ID = 'embhbifddhjedfffkoapiakkabjlhdjf';
const CACHE = '.bench';
const RUNS = 3;
const PORT = 8798;

// Files timed on every run: one or more per format, plus two JSON files at the sizes where the
// text view does the most work (just under the virtual-list threshold, and very large).
const FILES = [
  'users.csv', 'users.tsv', 'users.csv.gz', 'users.json', 'order.json', 'orders.json.gz', 'big-container.json',
  'bench:json-20k-lines.json', 'bench:json-38mb.json', 'events.ndjson', 'deploy.yaml', 'config.toml', 'orders.xml',
  'app.log', 'script.py', 'README.md', 'users.parquet', 'large.parquet', 'users.arrow', 'users.xlsx', 'bundle.zip',
  'report.docx', 'deck.pptx', 'doc.pdf', 'icon.png',
];
// A difference counts only when it is both this large and this proportion of the live time.
const MIN_MS = 50, MIN_RATIO = 0.2;

const paint = process.stdout.isTTY ? (c, s) => `\x1b[${c}m${s}\x1b[0m` : (_, s) => s;
const red = s => paint(31, s), green = s => paint(32, s), yellow = s => paint(33, s), dim = s => paint(2, s), bold = s => paint(1, s);

async function main() {
  if (process.env.CI) return console.log('benchmark runs locally only; skipped on CI');
  if (process.env.SKIP_BENCH) return console.log('benchmark skipped (SKIP_BENCH is set)');
  if (!CHROME) return console.log('benchmark skipped: Chrome not found (set CHROME_PATH)');
  if (!existsSync('dist/manifest.json')) return console.log('benchmark skipped: no build in dist (run npm run build)');
  const current = JSON.parse(readFileSync('dist/manifest.json', 'utf8')).version;

  const live = await liveBuild(current);
  if (!live) return;
  makeBenchFixtures();

  const builds = { live: live.dir, new: 'dist' };
  const server = await serve(builds);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
  const started = Date.now();
  const rows = [];
  try {
    console.log(`\n${bold(`▶ load time: live ${live.version}`)} ${dim(`(${live.source})`)} ${bold(`vs this build ${current}`)}`);
    if (live.version === current) console.log(yellow(`  note: this build has the same version as the live one, so its zip in ./release was just rebuilt from your current code.\n  Bump the version in src/manifest.json when starting new work, so the live zip is kept.`));
    for (const f of ['users.csv', 'users.json']) for (const b of Object.keys(builds)) await load(browser, b, f).catch(() => {}); // warm-up

    for (const file of FILES) {
      const t = { live: [], new: [] }, view = {};
      let error = null;
      for (let i = 0; i < RUNS && !error; i++) {
        for (const b of Object.keys(builds)) {
          try { const r = await load(browser, b, file); t[b].push(r.ms); view[b] = r.view; }
          catch (e) { error = `${b} build: ${e.message.split('\n')[0]}`; break; }
        }
      }
      const name = file.replace(/^bench:/, '');
      if (error) { rows.push({ name, error }); console.log(`  ${yellow('?')} ${name.padEnd(22)} ${yellow(`not timed: ${error}`)}`); continue; }
      const a = median(t.live), b = median(t.new), diff = b - a;
      const verdict = Math.abs(diff) >= MIN_MS && Math.abs(diff) / a >= MIN_RATIO ? (diff > 0 ? 'slower' : 'faster') : 'same';
      const row = { name, a, b, diff, verdict, viewLive: view.live, viewNew: view.new, viewChanged: view.live !== view.new };
      rows.push(row);
      console.log(line(row));
    }
  } finally {
    await browser.close();
    server.close();
  }

  const n = v => rows.filter(r => r.verdict === v).length;
  const viewChanged = rows.filter(r => r.viewChanged).length, notTimed = rows.filter(r => r.error).length;
  console.log(`${bold('▶ load time')} ${dim(`median of ${RUNS} loads per file; "slower" and "faster" mean at least ${MIN_MS} ms and ${MIN_RATIO * 100}% apart`)}`);
  console.log(`ℹ live ${live.version}`);
  console.log(`ℹ new ${current}`);
  console.log(`ℹ files ${rows.length}`);
  console.log(`ℹ ${n('slower') ? red(`slower ${n('slower')}`) : 'slower 0'}`);
  console.log(`ℹ ${n('faster') ? green(`faster ${n('faster')}`) : 'faster 0'}`);
  console.log(`ℹ same ${n('same')}`);
  console.log(`ℹ ${viewChanged ? yellow(`opens in a different view ${viewChanged}`) : 'opens in a different view 0'}`);
  if (notTimed) console.log(`ℹ ${yellow(`not timed ${notTimed}`)}`);
  console.log(`ℹ duration_ms ${Date.now() - started}`);
  if (n('slower')) {
    console.log(`\n${red('slower than live:')}`);
    for (const r of rows.filter(r => r.verdict === 'slower')) console.log(line(r));
  }
  writeReport(rows, live, current);
}

function line(r) {
  const mark = r.verdict === 'slower' ? red('▲') : r.verdict === 'faster' ? green('▼') : dim('=');
  const d = `${r.diff > 0 ? '+' : ''}${r.diff} ms`.padStart(10);
  const diff = r.verdict === 'slower' ? red(d) : r.verdict === 'faster' ? green(d) : dim(d);
  const verdict = r.verdict === 'slower' ? red('slower') : r.verdict === 'faster' ? green('faster') : dim('same  ');
  const view = r.viewChanged ? yellow(`${r.viewLive} → ${r.viewNew}`) : dim(r.viewNew);
  return `  ${mark} ${r.name.padEnd(22)} ${`${r.a} ms`.padStart(8)} → ${`${r.b} ms`.padStart(8)} ${diff}  ${verdict}  ${view}`;
}

/** The live version's zip from ./release, unzipped into .bench/live. */
async function liveBuild(current) {
  const zips = existsSync('release') ? readdirSync('release').map(f => /^s3-any-viewer-(\d+\.\d+\.\d+)\.zip$/.exec(f)?.[1]).filter(Boolean) : [];
  let version, source;
  try {
    version = await storeVersion();
    source = 'Chrome Web Store';
  } catch (e) {
    // Offline: the newest zip older than this build is the best guess at what is live.
    version = zips.filter(v => cmp(v, current) < 0).sort(cmp).at(-1);
    source = `Web Store unreachable (${e.message}); newest earlier zip`;
    if (!version) { console.log(`benchmark skipped: could not reach the Web Store (${e.message}) and no earlier zip in ./release`); return null; }
  }
  const zip = join('release', `s3-any-viewer-${version}.zip`);
  if (!existsSync(zip)) {
    console.log(`benchmark skipped: live version is ${version} but ${zip} is not on this machine`);
    return null;
  }
  const dir = join(CACHE, 'live');
  rmSync(dir, { recursive: true, force: true });
  for (const [name, data] of Object.entries(unzipSync(readFileSync(zip)))) {
    if (name.endsWith('/')) continue;
    const out = normalize(join(dir, name));
    if (!out.startsWith(normalize(dir) + sep)) continue; // never write outside the folder
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  return { dir, version, source: `${source}, ${zip}` };
}

/** Asks the Web Store's update server which version is live. Only the version number is read. */
async function storeVersion() {
  const url = `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=140.0.0.0&x=id%3D${EXTENSION_ID}%26v%3D0.0.0%26uc`;
  const xml = await (await fetch(url, { signal: AbortSignal.timeout(10000) })).text();
  const v = /<updatecheck[^>]*\sversion="(\d+\.\d+\.\d+)"/.exec(xml)?.[1];
  if (!v) throw new Error('no version in the store reply');
  return v;
}

const cmp = (x, y) => { const a = x.split('.').map(Number), b = y.split('.').map(Number); return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; };

/** JSON sizes that are only interesting for timing, so they are not in the test fixtures. */
function makeBenchFixtures() {
  const dir = join(CACHE, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const records = n => Array.from({ length: n }, (_, i) => ({
    id: i, name: `user${i}`, email: `u${i}@example.com`, city: ['Chennai', 'Pune', 'Delhi'][i % 3],
    amount: i * 1.5, tags: ['a', 'b'], address: { line: `street ${i}`, zip: 600000 + i },
  }));
  // 1,330 records pretty-print to 19,952 lines: the most the text view draws in full, with colours.
  if (!existsSync(join(dir, 'json-20k-lines.json'))) writeFileSync(join(dir, 'json-20k-lines.json'), JSON.stringify(records(1330)));
  if (!existsSync(join(dir, 'json-38mb.json'))) writeFileSync(join(dir, 'json-38mb.json'), JSON.stringify(records(250000)));
}

/** Serves each build under /<name>/ with its own CSP, the test fixtures, and the benchmark files. */
function serve(builds) {
  const csp = Object.fromEntries(Object.entries(builds).map(([b, dir]) =>
    [b, JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).content_security_policy?.extension_pages]));
  const roots = { ...Object.fromEntries(Object.entries(builds).map(([b, dir]) => [`/${b}/`, dir])), '/fixtures/': 'fixtures', '/bench/': join(CACHE, 'fixtures') };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.csv': 'text/csv', '.xml': 'application/xml', '.pdf': 'application/pdf' };
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const [prefix, dir] = Object.entries(roots).find(([p]) => u.pathname.startsWith(p)) || [];
    try {
      const file = normalize(join(dir, decodeURIComponent(u.pathname.slice(prefix.length))));
      if (!file.startsWith(normalize(dir) + sep)) throw new Error('outside root');
      const body = await readFile(file);
      const h = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
      const build = prefix.slice(1, -1);
      if (extname(file) === '.html' && csp[build]) h['Content-Security-Policy'] = csp[build];
      const r = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (r) {
        const s = +r[1], e = r[2] ? Math.min(+r[2], body.length - 1) : body.length - 1;
        res.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e}/${body.length}`, 'Content-Length': e - s + 1 });
        return res.end(body.subarray(s, e + 1));
      }
      res.writeHead(200, { ...h, 'Content-Length': body.length });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

/** Opens one file in a fresh tab and times it until the view is drawn. */
async function load(browser, build, file) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 800 });
    const src = file.startsWith('bench:') ? `bench/${file.slice(6)}` : `fixtures/${file}`;
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${PORT}/${build}/viewer.html#u=http://127.0.0.1:${PORT}/${src}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => {
      const p = document.getElementById('progress'), s = document.getElementById('status'), m = document.getElementById('mount');
      return p && p.hidden && !s.textContent.startsWith('Rendering') && m.children.length > 0;
    }, { timeout: 60000, polling: 10 });
    const ms = Date.now() - t0;
    const format = await page.$eval('#formatSelect', s => s.value).catch(() => '?');
    const tab = await page.$eval('.tabs button.on', b => b.textContent).catch(() => '');
    return { ms, view: tab ? `${format}/${tab}` : format };
  } finally {
    await page.close().catch(() => {});
  }
}

const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** A Markdown copy of the results in .bench/report.md. */
function writeReport(rows, live, current) {
  const mark = { slower: '🔴 slower', faster: '🟢 faster', same: 'same' };
  const md = [
    `# Load time: live ${live.version} vs this build ${current}`, '',
    `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · median of ${RUNS} loads per file in headless Chrome · "slower" and "faster" mean at least ${MIN_MS} ms and ${MIN_RATIO * 100}% apart`, '',
    '| File | Live | New | Difference | | View |', '|---|--:|--:|--:|---|---|',
    ...rows.map(r => r.error
      ? `| ${r.name} | | | | ⚠️ not timed | ${r.error} |`
      : `| ${r.name} | ${r.a} ms | ${r.b} ms | ${r.diff > 0 ? '+' : ''}${r.diff} ms | ${mark[r.verdict]} | ${r.viewChanged ? `🟡 ${r.viewLive} → ${r.viewNew}` : r.viewNew} |`),
    '',
  ].join('\n');
  writeFileSync(join(CACHE, 'report.md'), md);
  console.log(dim(`\nreport saved to ${join(CACHE, 'report.md')}`));
}

main().catch(e => console.log(`benchmark skipped: ${e.message}`));
