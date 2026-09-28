// Shared browser harness for the viewer tests.
//
// Drives the Chrome already installed on this machine (or CHROME_PATH) in headless mode with a
// brand-new temporary profile that is deleted afterwards. It never installs the extension and
// never touches your own Chrome profile: the built viewer page is served by scripts/serve.mjs
// with the extension's own Content-Security-Policy, exactly as during manual dev testing.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { startDevServer } from '../../scripts/serve.mjs';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => existsSync(p));

/** Starts the dev server, a second server that refuses cross-origin reads, and headless Chrome. */
export async function startEnv({ port }) {
  if (!CHROME) throw new Error('Chrome not found; set CHROME_PATH');
  const server = await startDevServer({ port });
  const foreign = await startDevServer({ port: port + 1, cors: false });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
      // CI runners (Ubuntu 24.04) block the sandbox's user namespaces; never needed locally.
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  });
  return {
    browser,
    base: `http://127.0.0.1:${port}`,
    foreign: `http://127.0.0.1:${port + 1}`,
    async close() { await browser.close(); server.close(); foreign.close(); },
  };
}

/** A viewer tab with helpers. Console errors, page errors and CSP violations are collected per open(). */
export async function newViewer(env) {
  const page = await env.browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`page error: ${e.message}`));
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });

  const v = {
    page, problems,
    url: (file, query = '') => /^https?:/.test(file) ? file : `${env.base}/fixtures/${file}${query}`,
    async open(file, { query = '', settle = true } = {}) {
      problems.length = 0;
      await page.goto(`${env.base}/viewer.html?n=${Date.now()}#u=${v.url(file, query)}`, { waitUntil: 'domcontentloaded' });
      if (settle) await v.settle();
    },
    async settle(timeout = 45000) {
      try {
        await page.waitForFunction(() => {
          const p = document.getElementById('progress'), s = document.getElementById('status'), m = document.getElementById('mount');
          return p && p.hidden && !s.textContent.startsWith('Rendering') && m.children.length > 0;
        }, { timeout, polling: 100 });
      } catch (e) {
        // Say what the page was showing, so a timeout can be told apart from a real hang.
        const state = await page.evaluate(() => ({
          url: location.href, readyState: document.readyState,
          progressHidden: document.getElementById('progress')?.hidden,
          progress: document.getElementById('progress')?.innerText,
          status: document.getElementById('status')?.textContent,
          mountChildren: document.getElementById('mount')?.children.length,
        })).catch(err => ({ unreachable: err.message }));
        e.message += `\npage state: ${JSON.stringify(state)}\nproblems: ${problems.join(' | ') || '(none)'}`;
        throw e;
      }
      await sleep(200);
    },
    view: () => page.$eval('#formatSelect', s => s.value),
    detected: () => page.$eval('#detectInfo', e => e.innerText),
    meta: () => page.$eval('#meta', e => e.innerText.replace(/\s+/g, ' ')),
    stat: () => page.$$eval('#toolbar .tb-stat', els => els.map(e => e.innerText).join(' | ')),
    status: () => page.$eval('#status', e => e.innerText),
    text: (sel) => page.$eval(sel, e => e.innerText).catch(() => null),
    count: (sel) => page.$$eval(sel, els => els.length),
    activeTab: () => page.$eval('.tabs button.on', b => b.textContent).catch(() => null),
    async tab(name) {
      await page.evaluate(n => [...document.querySelectorAll('.tabs button')].find(b => b.textContent === n).click(), name);
      await sleep(350);
    },
    async search(term, wait = 350) {
      await page.$eval('input.view-search', (i, t) => { i.value = t; i.dispatchEvent(new Event('input')); }, term);
      await sleep(wait);
    },
    async key(key, opts = {}) {
      await page.$eval('input.view-search', (i, k, o) => i.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: !!o.shift, bubbles: true })), key, opts);
      await sleep(80);
    },
    searchCount: () => page.$eval('.tb-stat.view-search', e => e.innerText).catch(() => ''),
    /** Waits until every <img> matching `sel` has decoded; returns their natural widths. */
    async imagesLoaded(sel, timeout = 10000) {
      await page.waitForFunction(s => [...document.querySelectorAll(s)].length > 0 &&
        [...document.querySelectorAll(s)].every(i => i.complete && i.naturalWidth > 0), { timeout, polling: 100 }, sel);
      return page.$$eval(sel, imgs => imgs.map(i => i.naturalWidth));
    },
    /**
     * Throws if anything went wrong in the page since the last open(). `expect` lists messages
     * that must appear (for example Chrome reporting a script it blocked); they are then not
     * counted as problems.
     */
    async assertClean({ expect = [] } = {}) {
      const csp = await page.evaluate(() => window.__csp || []);
      let all = [...problems, ...csp.map(c => `CSP violation: ${c}`)];
      for (const re of expect) {
        if (!all.some(m => re.test(m))) throw new Error(`expected a message matching ${re}, got:\n  ${all.join('\n  ') || '(none)'}`);
        all = all.filter(m => !re.test(m));
      }
      if (all.length) throw new Error(`page reported problems:\n  ${all.join('\n  ')}`);
    },
    /** Runs `action` and returns the downloaded file's path (inside a temp dir removed by cleanup()). */
    async download(action) {
      const dir = mkdtempSync(join(tmpdir(), 's3av-dl-'));
      const cleanup = () => rmSync(dir, { recursive: true, force: true });
      // Waits for Chrome's own "completed" event. Watching the folder is not enough: Chrome puts an
      // empty placeholder under the final name while the real bytes are still being written.
      const cdp = await page.browser().target().createCDPSession();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
      let name = null, timer;
      const finished = new Promise((resolve, reject) => {
        cdp.on('Browser.downloadWillBegin', e => { name = e.suggestedFilename; });
        cdp.on('Browser.downloadProgress', e => {
          if (e.state === 'completed') resolve();
          else if (e.state === 'canceled') reject(new Error('download was cancelled'));
        });
        timer = setTimeout(() => reject(new Error('no download arrived')), 30000);
      });
      finished.catch(() => {}); // reported below; avoids an unhandled rejection if action() throws first
      try {
        await action();
        await finished;
      } catch (e) { cleanup(); throw e; } finally { clearTimeout(timer); await cdp.detach().catch(() => {}); }
      const path = join(dir, name ?? readdirSync(dir)[0]);
      return { path, name: basename(path), cleanup };
    },
    close: () => page.close(),
  };
  return v;
}
