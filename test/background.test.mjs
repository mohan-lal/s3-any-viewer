// The service worker: which redirect rules it installs, how they treat real-shaped S3 URLs, and
// what the context menu does. Runs src/background.js against a stand-in chrome.* API, so it needs
// no browser. Only the final click in the real console is left to the manual checklist.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let seq = 0;
function stubChrome(stored = {}) {
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { (listeners[name] ??= []).push(fn); } });
  const calls = { badge: [], menus: [], permissionRequests: [], tabs: [] };
  let rules = [];
  const chrome = {
    runtime: { onInstalled: on('installed'), onStartup: on('startup'), onMessage: on('message'), getURL: (p) => `chrome-extension://testid/${p}` },
    storage: { sync: { get: async (defaults) => ({ ...defaults, ...stored }), set: async (o) => Object.assign(stored, o) }, onChanged: on('storageChanged') },
    declarativeNetRequest: {
      getDynamicRules: async () => rules,
      updateDynamicRules: async ({ removeRuleIds, addRules }) => { rules = rules.filter(r => !removeRuleIds.includes(r.id)).concat(addRules); },
    },
    action: { setBadgeText: async ({ text }) => { calls.badge.push(text); }, setBadgeBackgroundColor: async () => {} },
    contextMenus: { removeAll: (cb) => cb?.(), create: (o) => calls.menus.push(o), onClicked: on('menuClicked') },
    permissions: { contains: async () => false, request: async ({ origins }) => { calls.permissionRequests.push(origins); return true; } },
    tabs: { create: async ({ url }) => { calls.tabs.push(url); } },
  };
  return { chrome, calls, listeners, stored, rules: () => rules };
}
async function load(stored) {
  const s = stubChrome(stored);
  globalThis.chrome = s.chrome;
  await import(`../src/background.js?instance=${seq++}`);
  for (const fn of s.listeners.installed || []) await fn();
  return s;
}

// What Chrome would do with a top-level navigation, given the installed rules:
// the highest-priority matching rule wins; an allow rule leaves the URL alone.
function navigate(rules, url) {
  const hits = rules.filter(r => new RegExp(r.condition.regexFilter).test(url) && r.condition.resourceTypes.includes('main_frame'));
  if (!hits.length) return { action: 'none', url };
  const top = hits.sort((a, b) => b.priority - a.priority)[0];
  if (top.action.type === 'allow') return { action: 'allow', url };
  // Chrome's \0 means "the whole match"; JavaScript spells that $&. A function returns it literally.
  const sub = top.action.redirect.regexSubstitution.replace(/\\0/g, () => '$&');
  return { action: 'redirect', url: url.replace(new RegExp(top.condition.regexFilter), sub) };
}

const VIEWER = 'chrome-extension://testid/viewer.html#u=';
const SIGNED = 'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIAEXAMPLE%2F20260921%2Fap-south-1%2Fs3%2Faws4_request&X-Amz-Date=20260921T041500Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=9f1c2b7a';
const URLS = {
  consoleOpen: `https://demo-bucket.s3.ap-south-1.amazonaws.com/exports/users.csv?response-content-disposition=inline&${SIGNED}`,
  pathStyle: `https://s3.ap-south-1.amazonaws.com/demo-bucket/exports/users.csv?${SIGNED}`,
  consoleDownload: `https://demo-bucket.s3.ap-south-1.amazonaws.com/exports/users.csv?response-content-disposition=attachment%3B%20filename%3Dusers.csv&${SIGNED}`,
  china: `https://demo-bucket.s3.cn-north-1.amazonaws.com.cn/exports/users.csv?${SIGNED}`,
  publicUnsigned: 'https://demo-bucket.s3.amazonaws.com/exports/users.csv',
  plainHttp: `http://demo-bucket.s3.amazonaws.com/users.csv?${SIGNED}`,
  lookalikeHost: `https://amazonaws.com.evil.example/users.csv?${SIGNED}`,
  hostInQuery: `https://evil.example/?next=x.amazonaws.com/&${SIGNED}`,
};

test('default install: Open is redirected, Download is left alone', async () => {
  const s = await load();
  const rules = s.rules();
  assert.equal(rules.length, 3);
  assert.equal(navigate(rules, URLS.consoleOpen).action, 'redirect');
  assert.equal(navigate(rules, URLS.consoleOpen).url, VIEWER + URLS.consoleOpen);
  assert.equal(navigate(rules, URLS.pathStyle).action, 'redirect');
  assert.equal(navigate(rules, URLS.consoleDownload).action, 'allow');
  assert.equal(navigate(rules, URLS.china).action, 'redirect');
  assert.equal(s.calls.badge.at(-1), '');
});

test('only signed https S3 navigations are touched', async () => {
  const rules = (await load()).rules();
  for (const key of ['publicUnsigned', 'plainHttp', 'lookalikeHost', 'hostInQuery']) {
    assert.equal(navigate(rules, URLS[key]).action, 'none', key);
  }
});

test('rules act only on page navigations, never on page resources', async () => {
  for (const r of (await load()).rules()) assert.deepEqual(r.condition.resourceTypes, ['main_frame']);
});

test('interception turned off in the popup removes every rule', async () => {
  const s = await load({ interceptEnabled: false });
  assert.equal(s.rules().length, 0);
  assert.equal(navigate(s.rules(), URLS.consoleOpen).action, 'none');
  assert.equal(s.calls.badge.at(-1), 'off');
});

test('"also intercept Download" sends downloads to the viewer too', async () => {
  const rules = (await load({ interceptDownloads: true })).rules();
  assert.equal(navigate(rules, URLS.consoleDownload).action, 'redirect');
});

test('changing a setting re-applies the rules', async () => {
  const s = await load();
  assert.equal(s.rules().length, 3);
  s.stored.interceptEnabled = false;
  for (const fn of s.listeners.storageChanged) fn({ interceptEnabled: { newValue: false } }, 'sync');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(s.rules().length, 0);
});

test('the popup can ask for the rules to be re-applied', async () => {
  const s = await load();
  const reply = await new Promise(res => { for (const fn of s.listeners.message) fn({ type: 'applyRules' }, {}, res); });
  assert.deepEqual(reply, { ok: true });
});

test('context menu: a non-AWS link asks for that one site, then opens the viewer', async () => {
  const s = await load();
  assert.equal(s.calls.menus[0].id, 'open-in-viewer');
  const link = 'https://samplelib.com/docx/sample-resume.docx';
  for (const fn of s.listeners.menuClicked) await fn({ menuItemId: 'open-in-viewer', linkUrl: link });
  assert.deepEqual(s.calls.permissionRequests, [['https://samplelib.com/*']]);
  assert.equal(s.calls.tabs.at(-1), VIEWER + encodeURIComponent(link));
});

test('context menu: an AWS link opens directly without a permission prompt', async () => {
  const s = await load();
  for (const fn of s.listeners.menuClicked) await fn({ menuItemId: 'open-in-viewer', linkUrl: URLS.consoleOpen });
  assert.deepEqual(s.calls.permissionRequests, []);
  assert.equal(s.calls.tabs.at(-1), VIEWER + encodeURIComponent(URLS.consoleOpen));
});
