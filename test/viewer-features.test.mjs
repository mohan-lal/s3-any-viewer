// Every feature and option of the viewer, driven the way a person would use it.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { startEnv, newViewer, sleep } from './helpers/browser.mjs';

let env, v;
before(async () => {
  env = await startEnv({ port: 8792 });
  await env.browser.defaultBrowserContext().overridePermissions(env.base, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  v = await newViewer(env);
});
after(async () => { await v?.close(); await env?.close(); });

const tableRows = () => v.count('table.vt tbody tr:not(.pad)');
const cell = (row, col) => v.page.$eval(`table.vt tbody tr:not(.pad):nth-child(${row + 1}) td:nth-child(${col + 1})`, td => td.textContent).catch(() => null);
const headers = () => v.page.$$eval('table.vt thead th', ths => ths.slice(1).map(t => t.querySelector('.th-label').textContent));
// Windows' clipboard stores text with CRLF line endings; compare content, not line endings.
const clipboard = async () => { await v.page.bringToFront(); return (await v.page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'); };
const click = (sel) => v.page.$eval(sel, e => e.click());
const selectOption = async (sel, value) => { await v.page.$eval(sel, (s, val) => { s.value = val; s.dispatchEvent(new Event('change')); }, value); await sleep(400); };
const tableFilter = async (text) => { await v.page.$eval('.table-toolbar input', (i, t) => { i.value = t; i.dispatchEvent(new Event('input')); }, text); await sleep(400); };

describe('tables', () => {
  it('filter narrows rows across every column and highlights matches', async () => {
    await v.open('users.csv');
    await tableFilter('Hyderabad');
    assert.match(await v.stat(), /833 of 5,000 rows/);
    assert.ok(await v.count('td.hit') > 0);
    await tableFilter('');
    assert.match(await v.stat(), /5,000 rows × 8 cols/);
    await v.assertClean();
  });

  it('sorts a numeric column ascending, then descending', async () => {
    await v.open('users.csv');
    await click('table.vt thead th:nth-child(6)');   // amount
    await sleep(300);
    const a1 = Number(await cell(1, 5)), a2 = Number(await cell(2, 5));
    assert.ok(a1 <= a2, `ascending: ${a1} then ${a2}`);
    await click('table.vt thead th:nth-child(6)');
    await sleep(300);
    const d1 = Number(await cell(1, 5)), d2 = Number(await cell(2, 5));
    assert.ok(d1 >= d2, `descending: ${d1} then ${d2}`);
    assert.equal(await v.text('table.vt thead th:nth-child(6) .sort-ind'), ' ▼');
    await v.assertClean();
  });

  it('header toggle turns the first row into data', async () => {
    await v.open('users.csv');
    await v.page.$eval('#toolbar input[type=checkbox]', c => { c.checked = false; c.dispatchEvent(new Event('change')); });
    await sleep(400);
    assert.deepEqual((await headers()).slice(0, 3), ['col1', 'col2', 'col3']);
    assert.match(await v.stat(), /5,001 rows/);
    await v.assertClean();
  });

  it('delimiter can be overridden, including a custom one', async () => {
    await v.open('users.psv');
    await selectOption('#toolbar select', ',');
    assert.ok((await headers()).length < 8, 'wrong delimiter should not split into 8 columns');
    await selectOption('#toolbar select', 'custom');
    await v.page.$eval('#toolbar input[type=text]', i => { i.value = '|'; i.dispatchEvent(new Event('input')); });
    await sleep(400);
    assert.equal((await headers()).length, 8);
    await v.assertClean();
  });

  it('double-clicking a cell shows its full value', async () => {
    await v.open('users.csv');
    await v.page.$eval('table.vt tbody tr:not(.pad):nth-child(2) td:nth-child(4)', td => td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await sleep(200);
    assert.equal(await v.page.$eval('.cell-detail', d => d.hidden), false);
    assert.match(await v.text('.cell-detail pre'), /@example\.com/);
    await v.assertClean();
  });

  it('exports the filtered rows as CSV and JSON', async () => {
    await v.open('users.csv');
    await tableFilter('Hyderabad');
    await click('.table-toolbar .tb-btn');
    assert.equal(await v.count('.menu button'), 4);
    const csv = await v.download(() => v.page.$$eval('.menu button', bs => bs.find(b => b.textContent === 'CSV').click()));
    const lines = readFileSync(csv.path, 'utf8').trim().split('\n');
    csv.cleanup();
    assert.equal(lines[0], 'id,name,email,city,amount,active,signup,note');
    assert.equal(lines.length, 834);
    await click('.table-toolbar .tb-btn');
    const json = await v.download(() => v.page.$$eval('.menu button', bs => bs.find(b => b.textContent.startsWith('JSON')).click()));
    const arr = JSON.parse(readFileSync(json.path, 'utf8'));
    json.cleanup();
    assert.equal(arr.length, 833);
    assert.equal(arr[0].city, 'Hyderabad');
    await v.assertClean();
  });

  it('spreadsheet sheets can be switched and the header toggled', async () => {
    await v.open('users.xlsx');
    await selectOption('#toolbar select.tb-input', 'Summary');
    assert.deepEqual(await headers(), ['City', 'Customers', 'Total', 'Average']);
    assert.equal(await tableRows(), 6);
    await v.page.$eval('#toolbar input[type=checkbox]', c => { c.checked = false; c.dispatchEvent(new Event('change')); });
    await sleep(400);
    assert.deepEqual(await headers(), ['A', 'B', 'C', 'D']);
    await v.assertClean();
  });

  it('parquet schema panel toggles, and a large file pages in more rows', async () => {
    await v.open('users.parquet');
    await v.page.$$eval('#toolbar .tb-btn', bs => bs.find(b => b.textContent === 'Schema').click());
    assert.equal(await v.page.$eval('.info-panel', p => p.hidden), false);
    assert.equal(await v.page.$$eval('#toolbar .tb-btn', bs => bs.find(b => b.textContent === 'Load all').disabled), true);
    await v.open('large.parquet');
    await v.page.$$eval('#toolbar .tb-btn', bs => bs.find(b => b.textContent.startsWith('Load next')).click());
    await v.settle();
    assert.match(await v.stat(), /40,000 of 400,000 rows loaded/);
    await v.assertClean();
  });
});

describe('viewer controls', () => {
  it('format override re-renders, and an impossible format falls back with a message', async () => {
    await v.open('users.csv');
    await selectOption('#formatSelect', 'text');
    assert.ok(await v.count('.code-wrap, .vlines'));
    await selectOption('#formatSelect', 'json');
    assert.match(await v.text('#mount .error'), /Could not render as JSON/);
    assert.equal(await v.view(), 'text');
    await v.assertClean();
  });

  it('Raw shows the plain text and toggles back', async () => {
    await v.open('order.json');
    await click('#rawBtn');
    await sleep(300);
    assert.ok(await v.page.$eval('#rawBtn', b => b.classList.contains('on')));
    assert.equal(await v.count('.tabs'), 0, 'raw view has no JSON tabs');
    await click('#rawBtn');
    await sleep(300);
    assert.equal(await v.activeTab(), 'Pretty');
    await v.assertClean();
  });

  it('Download saves the original bytes, even for a compressed file', async () => {
    await v.open('users.csv.gz');
    const d = await v.download(() => click('#downloadBtn'));
    const got = readFileSync(d.path);
    d.cleanup();
    assert.equal(d.name, 'users.csv.gz');
    assert.ok(got.equals(readFileSync('fixtures/users.csv.gz')), `saved ${got.length} bytes; the object is ${statSync('fixtures/users.csv.gz').size}`);
    await v.assertClean();
  });

  it('Download works for a large Parquet file that was read in parts', async () => {
    await v.open('large.parquet');
    const d = await v.download(() => click('#downloadBtn'));
    const size = statSync(d.path).size;
    d.cleanup();
    assert.equal(size, statSync('fixtures/large.parquet').size);
    await v.assertClean();
  });

  it('Copy puts the decoded text on the clipboard', async () => {
    await v.open('users.csv.gz');
    await click('#copyBtn');
    await sleep(300);
    assert.equal(await v.status(), 'Copied to clipboard.');
    assert.equal(await clipboard(), readFileSync('fixtures/users.csv', 'utf8'));
    await v.assertClean();
  });

  it('Copy on a file with no loaded bytes says so instead of failing', async () => {
    await v.open('large.parquet');
    await click('#copyBtn');
    await sleep(200);
    assert.match(await v.status(), /Nothing to copy/);
    await v.assertClean();
  });

  it('Reload fetches and renders again', async () => {
    await v.open('users.csv');
    await click('#reloadBtn');
    await v.settle();
    assert.match(await v.stat(), /5,000 rows × 8 cols/);
    await v.assertClean();
  });
});

describe('JSON', () => {
  it('opens in Pretty with tabs Pretty, Tree, Table, one search box per view', async () => {
    await v.open('order.json');
    assert.deepEqual(await v.page.$$eval('.tabs button', bs => bs.map(b => b.textContent)), ['Pretty', 'Tree', 'Table']);
    assert.equal(await v.activeTab(), 'Pretty');
    for (const t of ['Tree', 'Table', 'Pretty']) {
      await v.tab(t);
      assert.equal(await v.activeTab(), t);
      assert.ok(await v.count('input.view-search, .table-toolbar input') === 1, `${t}: exactly one search box`);
    }
    await v.assertClean();
  });

  it('Copy pretty and Copy minified', async () => {
    await v.open('config.json');
    const value = JSON.parse(readFileSync('fixtures/config.json', 'utf8'));
    await v.page.$$eval('#toolbar .tb-btn', bs => bs.find(b => b.textContent === 'Copy minified').click());
    assert.equal(await clipboard(), JSON.stringify(value));
    await v.page.$$eval('#toolbar .tb-btn', bs => bs.find(b => b.textContent === 'Copy pretty').click());
    assert.equal(await clipboard(), JSON.stringify(value, null, 2));
    await v.assertClean();
  });

  it('tree: matching an object key shows everything inside it, nested objects included', async () => {
    await v.open('order.json');
    await v.tab('Tree');
    await v.search('customer');
    const rows = await v.page.$$eval('.jtree .jrow', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    for (const want of ['"name": "Priya Raman"', '"tier": "gold"', '"city": "Chennai"', '"postalCode": "600086"']) {
      assert.ok(rows.includes(want), `missing ${want}`);
    }
    await v.assertClean();
  });

  it('tree: matching a list key shows every item with its fields', async () => {
    await v.open('order.json');
    await v.tab('Tree');
    await v.search('items');
    const text = await v.text('.jtree');
    for (const want of ['BK-1042', 'EL-2210', 'ST-0031', 'space grey']) assert.match(text, new RegExp(want));
    await v.assertClean();
  });

  it('tree: a value match narrows to its path only', async () => {
    await v.open('order.json');
    await v.tab('Tree');
    await v.search('chennai');
    const rows = await v.page.$$eval('.jtree .jrow', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    assert.ok(rows.includes('"city": "Chennai"'));
    assert.ok(!rows.some(r => r.includes('Priya Raman')), 'sibling values must not be shown');
    await v.assertClean();
  });

  it('tree: array positions are not matched as keys', async () => {
    await v.open('users.json');
    await v.tab('Tree');
    await v.search('1');
    const first = await v.page.$eval('.jtree .jn .jn', n => n.innerText);
    assert.doesNotMatch(first, /"city"/, 'item 0 should list only fields whose values contain "1"');
    await v.assertClean();
  });

  it('tree: expanding a huge matched container stays within the row budget', async () => {
    await v.open('big-container.json');
    await v.tab('Tree');
    const t0 = Date.now();
    await v.search('data', 600);
    assert.ok(await v.count('.jtree .jrow') <= 4100, 'row budget exceeded');
    assert.match(await v.text('.jtree'), /more not shown/);
    // The row count above is the real budget check. This only catches a hang, so it is generous
    // enough for a busy machine (typically ~2 s, measured 6 s under load).
    assert.ok(Date.now() - t0 < 20000, 'search took too long');
    await v.assertClean();
  });

  it('search navigation: Enter, Shift+Enter, wrap-around and Escape', async () => {
    await v.open('order.json');
    await v.tab('Tree');
    await v.search('at');
    const total = Number((await v.searchCount()).match(/(\d+) match/)[1]);
    assert.match(await v.searchCount(), /1 of/);
    await v.key('Enter');
    assert.match(await v.searchCount(), / 2 of /);
    await v.key('Enter', { shift: true });
    await v.key('Enter', { shift: true });
    assert.match(await v.searchCount(), new RegExp(` ${total} of `), 'Shift+Enter from the first match wraps to the last');
    assert.equal(await v.count('.jrow.cur'), 1);
    await v.key('Escape');
    assert.equal(await v.page.$eval('input.view-search', i => i.value), '');
    await v.assertClean();
  });

  it('pretty: a matching line brings its block, and Show nested turns that off', async () => {
    await v.open('order.json');
    await v.search('customer');
    assert.match(await v.searchCount(), /1 matching line \(\+12 nested\)/);
    await v.page.$eval('#toolbar label.view-search input', c => { c.checked = false; c.dispatchEvent(new Event('change')); });
    await sleep(300);
    assert.match(await v.searchCount(), /^1 matching line ·/);
    assert.equal(await v.count('.vlines .line'), 1);
    await v.assertClean();
  });

  it('NDJSON tree search', async () => {
    await v.open('events.ndjson');
    await v.tab('Tree');
    await v.search('pune');
    assert.match(await v.searchCount(), /333 matches/);
    await v.assertClean();
  });
});

describe('text views', () => {
  it('large log: search, highlights, navigation; wrap is disabled for virtualised files', async () => {
    await v.open('app.log');
    assert.equal(await v.page.$eval('#toolbar input[type=checkbox]', c => c.disabled), true);
    const t0 = Date.now();
    await v.search('ERROR', 500);
    assert.ok(Date.now() - t0 < 3000);
    assert.match(await v.searchCount(), /15,000 matching lines/);
    assert.ok(await v.count('.vlines mark') > 5);
    await v.key('Enter');
    assert.match(await v.searchCount(), / 2 of 15,000/);
    assert.equal(await v.count('.vlines .line.cur'), 1);
    await v.assertClean();
  });

  // Virtual lists resize a spacer above the visible rows as you scroll. With the browser's
  // scroll anchoring on, that made the view keep scrolling by itself after one wheel turn.
  for (const [label, file, sel, search] of [
    ['large JSON in Pretty', 'big-container.json', '.vlines'],
    ['large log', 'app.log', '.vlines'],
    ['search results', 'app.log', '.vlines', 'ERROR'],
    ['hex view', 'blob.bin', '.hex'],
    ['table', 'users.csv', '.vt-scroller'],
  ]) {
    it(`${label}: the mouse wheel scrolls only as far as it is turned`, async () => {
      await v.open(file);
      if (search) await v.search(search, 500);
      const box = await v.page.$(sel);
      const r = await box.boundingBox();
      await v.page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      for (let n = 0; n < 4; n++) { await v.page.mouse.wheel({ deltaY: 120 }); await sleep(60); }
      await sleep(300);
      const after = await v.page.$eval(sel, b => b.scrollTop);
      await sleep(1000);
      const later = await v.page.$eval(sel, b => b.scrollTop);
      assert.equal(later, after, `kept scrolling on its own: ${after} → ${later}`);
      assert.ok(Math.abs(after - 480) <= 40, `four wheel notches should scroll about 480 px, scrolled ${after}`);
      await v.assertClean();
    });
  }

  it('small code file: wrap toggles, and clearing a search restores syntax colours', async () => {
    await v.open('script.py');
    await v.page.$eval('#toolbar input[type=checkbox]', c => { c.checked = true; c.dispatchEvent(new Event('change')); });
    assert.ok(await v.page.$eval('.code-wrap', w => w.classList.contains('wrap')));
    await v.search('json');
    assert.match(await v.searchCount(), /3 matching lines/);
    await v.search('');
    assert.ok(await v.count('.code-wrap code.hljs span') > 3);
    assert.ok(await v.page.$eval('.code-wrap', w => w.classList.contains('wrap')), 'wrap setting survives a search');
    await v.assertClean();
  });

  it('YAML: source search brings the block, the tree finds keys', async () => {
    await v.open('deploy.yaml');
    await v.search('containers');
    assert.match(await v.searchCount(), /1 matching line \(\+6 nested\)/);
    await v.tab('Tree');
    await v.search('replicas');
    assert.match(await v.text('.jtree'), /"replicas": 3/);
    await v.assertClean();
  });

  it('XML: table of repeating elements, and a matching element brings its children', async () => {
    await v.open('orders.xml');
    await v.tab('Table');
    assert.match(await v.stat(), /300 rows/);
    await v.tab('Pretty');
    await v.search('order id="7"');
    assert.match(await v.searchCount(), /1 matching line \(\+\d+ nested\)/);
    assert.match(await v.text('.vlines'), /<\/order>/);
    await v.assertClean();
  });

  it('Markdown: source tab is searchable', async () => {
    await v.open('README.md');
    await v.tab('Source');
    await v.search('item');
    assert.match(await v.searchCount(), /2 matching lines/);
    await v.assertClean();
  });
});

describe('archives and media', () => {
  it('ZIP: filter entries, open a nested compressed file, return by breadcrumb', async () => {
    await v.open('bundle.zip');
    await v.page.$eval('#toolbar input.tb-input', i => { i.value = 'csv'; i.dispatchEvent(new Event('input')); });
    assert.equal(await v.count('.zip-list tr.file'), 2);
    await v.page.$$eval('.zip-list td.name', tds => tds.find(t => t.textContent === 'nested/users.csv.gz').click());
    await v.settle();
    assert.equal(await v.view(), 'csv');
    assert.match(await v.stat(), /Delimiter: "\|".*5,000 rows/);
    assert.match(await v.text('#crumbs'), /bundle\.zip.*nested\/users\.csv\.gz/s);
    await click('#crumbs button');
    await v.settle();
    assert.equal(await v.view(), 'zip');
    await v.assertClean();
  });

  it('images: Fit and 100% zoom', async () => {
    await v.open('icon.png');
    await v.page.$$eval('#toolbar .tabs .tb-btn', bs => bs.find(b => b.textContent === '100%').click());
    assert.ok(await v.page.$eval('.media-wrap', w => w.classList.contains('actual')));
    await v.page.$$eval('#toolbar .tabs .tb-btn', bs => bs.find(b => b.textContent === 'Fit').click());
    assert.ok(!(await v.page.$eval('.media-wrap', w => w.classList.contains('actual'))));
    await v.assertClean();
  });

  it('Word renderer loads only when a Word file is opened', async () => {
    await v.open('users.csv');
    const before = await v.page.evaluate(() => performance.getEntriesByType('resource').some(r => r.name.includes('docx-preview')));
    assert.equal(before, false, 'CSV must not load the Word renderer');
    await v.open('report.docx');
    const after = await v.page.evaluate(() => performance.getEntriesByType('resource').some(r => r.name.includes('docx-preview')));
    assert.equal(after, true);
    await v.assertClean();
  });
});

describe('errors, limits and local files', () => {
  it('a missing object shows a readable error, not a crash', async () => {
    await v.open('does-not-exist.csv');
    assert.match(await v.text('#mount .error'), /HTTP 404/);
    assert.equal(await v.status(), 'Error');
    await v.assertClean({ expect: [/404/] });
  });

  it('a site that refuses cross-origin reads gets the "allow access" panel', async () => {
    await v.open(`${env.foreign}/fixtures/users.csv`);
    assert.equal(await v.text('.big-prompt h3'), 'Allow access to 127.0.0.1?');
    assert.match(await v.text('.big-prompt'), /Running outside the extension/);
    await v.assertClean({ expect: [/CORS|Access-Control-Allow-Origin|Failed to load resource/] });
  });

  it('a very large object asks first, and a partial preview is marked as such', async () => {
    await v.open('users.csv', { query: '?claimsize=300000000' });
    assert.match(await v.text('.big-prompt h3'), /This object is 286 MB/);
    await v.page.$$eval('.big-prompt button', bs => bs.find(b => b.textContent.startsWith('Load first')).click());
    await v.settle();
    assert.match(await v.meta(), /PARTIAL PREVIEW/);
    assert.equal(await v.view(), 'csv');
    await v.assertClean();
  });

  it('cancelling a very large object stops cleanly', async () => {
    await v.open('users.csv', { query: '?claimsize=300000000' });
    await v.page.$$eval('.big-prompt button', bs => bs.find(b => b.textContent === 'Cancel').click());
    await sleep(300);
    assert.equal(await v.text('.big-prompt'), 'Cancelled.');
    await v.assertClean();
  });

  it('a server that rejects the one-byte size probe still opens the file', { todo: 'known gap: probe falls over on 416, see CHANGELOG' }, async () => {
    // Needs a server that answers Range requests with 416; not yet fixed in the viewer.
  });

  it('opening a local file from disk', async () => {
    // A fresh tab, as the popup's "Choose file" opens; only changing the # would not reload the page.
    await v.page.goto(`${env.base}/viewer.html?n=${Date.now()}#local=1`);
    await sleep(300);
    assert.equal(await v.page.$eval('#drop', d => d.hidden), false);
    const input = await v.page.$('#filePicker');
    await input.uploadFile('fixtures/users.csv');
    await v.settle();
    assert.equal(await v.view(), 'csv');
    assert.match(await v.stat(), /5,000 rows × 8 cols/);
    await v.assertClean();
  });
});
