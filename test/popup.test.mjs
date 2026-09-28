// The toolbar popup, loaded from the build with a stand-in chrome.* API that records what it is
// asked to do. The real popup only exists inside the installed extension; this checks its logic.
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startEnv, sleep } from './helpers/browser.mjs';
import { FORMAT_LABELS } from '../src/lib/formats.js';

let env, page;
const problems = [];

before(async () => {
  env = await startEnv({ port: 8794 });
  page = await env.browser.newPage();
  // Failed requests are tracked by URL instead of by console text, so the browser's automatic
  // favicon.ico request (made for any http page, never inside the extension) can be ignored
  // while any other missing file still fails the test.
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('pageerror', e => problems.push(e.message));
  await page.evaluateOnNewDocument(() => {
    const calls = { set: [], messages: [], permissionRequests: [], tabs: [], closed: 0 };
    window.__calls = calls;
    const stub = {
      storage: { sync: {
        get: async (defaults) => ({ ...defaults, interceptEnabled: true, interceptDownloads: false }),
        set: async (o) => { calls.set.push(o); },
      } },
      runtime: { sendMessage: async (m) => { calls.messages.push(m); return { ok: true }; }, getURL: (p) => `chrome-extension://testid/${p}` },
      permissions: { request: async ({ origins }) => { calls.permissionRequests.push(origins); return true; } },
      tabs: { create: async ({ url }) => { calls.tabs.push(url); } },
    };
    Object.defineProperty(window, 'chrome', { value: stub, configurable: true, writable: true });
    window.close = () => { calls.closed++; };
  });
});
after(async () => { await env?.close(); });

async function openPopup() {
  problems.length = 0;
  await page.goto(`${env.base}/popup.html?n=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#formats span').length > 0, { timeout: 10000 });
}
const calls = () => page.evaluate(() => window.__calls);
async function submitUrl(url) {
  await page.$eval('#urlInput', (i, u) => { i.value = u; }, url);
  await page.$eval('#urlForm', f => f.requestSubmit());
  await sleep(200);
}

it('lists every supported format', async () => {
  await openPopup();
  const shown = await page.$$eval('#formats span', s => s.map(x => x.textContent));
  assert.deepEqual(shown, FORMAT_LABELS);
  assert.deepEqual(problems, []);
});

it('shows the stored settings, and saving one re-applies the rules', async () => {
  await openPopup();
  assert.equal(await page.$eval('#interceptEnabled', c => c.checked), true);
  assert.equal(await page.$eval('#interceptDownloads', c => c.checked), false);
  await page.$eval('#interceptEnabled', c => { c.checked = false; c.dispatchEvent(new Event('change')); });
  await sleep(200);
  const c = await calls();
  assert.deepEqual(c.set.at(-1), { interceptEnabled: false });
  assert.deepEqual(c.messages.at(-1), { type: 'applyRules' });
  assert.equal(await page.$eval('#status', s => s.textContent), 'Saved.');
  assert.deepEqual(problems, []);
});

it('opening a non-AWS URL asks for that one site first', async () => {
  await openPopup();
  const url = 'https://samplelib.com/docx/sample-resume.docx';
  await submitUrl(url);
  const c = await calls();
  assert.deepEqual(c.permissionRequests.at(-1), ['https://samplelib.com/*']);
  assert.equal(c.tabs.at(-1), `chrome-extension://testid/viewer.html#u=${encodeURIComponent(url)}`);
  assert.deepEqual(problems, []);
});

it('opening an AWS URL goes straight to the viewer', async () => {
  await openPopup();
  const before = (await calls()).permissionRequests.length;
  const url = 'https://demo-bucket.s3.ap-south-1.amazonaws.com/users.csv?X-Amz-Signature=abc';
  await submitUrl(url);
  const c = await calls();
  assert.equal(c.permissionRequests.length, before, 'no permission prompt for AWS');
  assert.equal(c.tabs.at(-1), `chrome-extension://testid/viewer.html#u=${encodeURIComponent(url)}`);
  assert.deepEqual(problems, []);
});

it('"Choose file" opens the viewer ready for a local file', async () => {
  await openPopup();
  await page.$eval('#openLocal', b => b.click());
  await sleep(200);
  assert.equal((await calls()).tabs.at(-1), 'chrome-extension://testid/viewer.html#local=1');
  assert.deepEqual(problems, []);
});
