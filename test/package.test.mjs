// The built package: what "Load unpacked" and the stores would reject, and the security
// promises made in README, SECURITY.md and the store listing, checked against dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { unzipSync } from 'fflate';

const DIST = 'dist';
const manifest = JSON.parse(readFileSync(`${DIST}/manifest.json`, 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const files = (function walk(dir) {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [relative(DIST, p).replace(/\\/g, '/')]; });
})(DIST);
const exists = (p) => existsSync(join(DIST, p));

test('manifest is Manifest V3 with store-valid name, description and version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name.length <= 45, 'name over 45 characters');
  assert.ok(manifest.description.length <= 132, `description is ${manifest.description.length} characters; the store limit is 132`);
  assert.match(manifest.version, /^\d+(\.\d+){0,3}$/);
  assert.equal(manifest.version, pkg.version, 'manifest and package.json versions differ');
});

test('every file the manifest references exists', () => {
  const refs = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...manifest.web_accessible_resources.flatMap(r => r.resources),
  ];
  for (const r of refs) assert.ok(exists(r), `missing ${r}`);
});

test('icons are real PNGs', () => {
  for (const p of Object.values(manifest.icons)) {
    const b = readFileSync(join(DIST, p));
    assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${p} is not a PNG`);
  }
});

test('no path starts with an underscore (Chrome refuses to load these)', () => {
  const bad = files.filter(f => f.split('/').some(seg => seg.startsWith('_') && seg !== '_locales'));
  assert.deepEqual(bad, []);
});

test('every script and stylesheet the pages load exists', () => {
  for (const page of files.filter(f => f.endsWith('.html'))) {
    const html = readFileSync(join(DIST, page), 'utf8');
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
      if (/^(https?:|data:|mailto:)/.test(ref)) continue;
      assert.ok(exists(posix.join(posix.dirname(page), ref)), `${page} references missing ${ref}`);
    }
  }
});

test('every module import resolves, including lazily loaded chunks', () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    assert.ok(exists(file), `missing module ${file}`);
    // Libraries keep type-only references such as import("../src/types.js") inside doc
    // comments; drop block comments so only real imports are checked. esbuild writes real
    // imports with a .js extension.
    const src = readFileSync(join(DIST, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const specs = [...src.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+\.js)["']/g)].map(m => m[1]);
    for (const s of specs) visit(posix.normalize(posix.join(posix.dirname(file), s)));
  };
  for (const entry of ['background.js', 'viewer.js', 'popup.js']) visit(entry);
});

test('the service worker has no dynamic import (not allowed in service workers)', () => {
  const src = readFileSync(join(DIST, manifest.background.service_worker), 'utf8');
  assert.doesNotMatch(src, /\bimport\s*\(/);
});

test('permissions match what the listing and SECURITY.md promise', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['contextMenus', 'declarativeNetRequestWithHostAccess', 'storage']);
  const forbidden = ['cookies', 'tabs', 'history', 'downloads', 'identity', 'webRequest', 'webRequestBlocking', 'scripting',
    'nativeMessaging', 'declarativeNetRequest', 'declarativeNetRequestFeedback', 'clipboardRead', 'debugger', 'management'];
  for (const p of forbidden) assert.ok(!manifest.permissions.includes(p), `must not request ${p}`);
  assert.deepEqual(manifest.host_permissions, ['*://*.amazonaws.com/*', '*://*.amazonaws.com.cn/*']);
  assert.ok(!manifest.host_permissions.includes('<all_urls>'), '<all_urls> must stay optional');
  assert.equal(manifest.content_scripts, undefined, 'no content scripts');
});

test('the content security policy allows no remote or eval-style script', () => {
  const csp = manifest.content_security_policy.extension_pages;
  const scriptSrc = /script-src ([^;]+)/.exec(csp)[1].trim().split(/\s+/);
  assert.deepEqual(scriptSrc.sort(), ["'self'", "'wasm-unsafe-eval'"]);
  assert.doesNotMatch(csp, /https?:/);
});

test('the release zip contains exactly the built files', { skip: !existsSync(`release/s3-any-viewer-${manifest.version}.zip`) && 'run npm run package first' }, () => {
  const zip = unzipSync(readFileSync(`release/s3-any-viewer-${manifest.version}.zip`));
  assert.deepEqual(Object.keys(zip).sort(), [...files].sort());
});
