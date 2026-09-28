// Every supported format: the fixture opens in the right view, shows real content, and the page
// logs no errors and no CSP violations. Uses the built viewer in headless Chrome.
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { startEnv, newViewer, sleep } from './helpers/browser.mjs';

let env, v;
before(async () => { env = await startEnv({ port: 8790 }); });
after(async () => { await env?.close(); });

// Each format gets its own tab, as each S3 "Open" does. Reusing one tab let a slow page (Chrome's
// PDF viewer can take a while to let go of its frame) stall every navigation after it.
beforeEach(async () => { v = await newViewer(env); });
afterEach(async () => { await Promise.race([v?.close(), sleep(5000)]).catch(() => {}); });

const rows = () => v.count('table.vt tbody tr:not(.pad)');

// [fixture, query, expected view, content check]
const CASES = [
  // delimited text
  ['users.csv', '', 'csv', async () => { assert.match(await v.stat(), /5,000 rows × 8 cols/); assert.ok(await rows() > 10); }],
  ['users.psv', '', 'csv', async () => { assert.match(await v.stat(), /Delimiter: "\|".*5,000 rows × 8 cols/); }],
  ['users.tsv', '', 'csv', async () => { assert.match(await v.stat(), /Delimiter: TAB.*5,000 rows × 8 cols/); }],
  ['users-semicolon.txt', '', 'csv', async () => { assert.match(await v.stat(), /Delimiter: ";".*5,000 rows × 8 cols/); }],
  ['users-noext', '', 'csv', async () => { assert.match(await v.stat(), /5,000 rows × 8 cols/); }],
  ['users.csv', '?ct=application/octet-stream', 'csv', async () => { assert.match(await v.meta(), /application\/octet-stream/); }],
  // compression
  ['users.csv.gz', '', 'csv', async () => { assert.match(await v.meta(), /Unpacked .*\(gzip\)/); assert.match(await v.stat(), /5,000 rows/); }],
  ['users.csv.zst', '', 'csv', async () => { assert.match(await v.meta(), /\(zstd\)/); assert.match(await v.stat(), /5,000 rows/); }],
  ['users.json.br', '', 'json', async () => { assert.match(await v.meta(), /\(brotli\)/); }],
  ['orders.json.gz', '', 'json', async () => { assert.match(await v.meta(), /\(gzip\)/); }],
  ['users.json', '?gz=1', 'json', async () => { assert.match(await v.meta(), /\(gzip\)/); }],
  // structured text
  ['users.json', '', 'json', async () => { assert.equal(await v.activeTab(), 'Pretty'); assert.match(await v.stat(), /array · 500 items/); }],
  ['order.json', '', 'json', async () => { assert.equal(await v.activeTab(), 'Pretty'); assert.ok(await v.count('.code-wrap code.hljs')); }],
  ['config.json', '', 'json', async () => { assert.ok(await v.page.$eval('.tabs button:nth-child(3)', b => b.disabled), 'Table tab should be disabled for a non-tabular object'); }],
  ['events.ndjson', '', 'ndjson', async () => { assert.match(await v.stat(), /2,000 records/); assert.ok(await rows() > 10); }],
  ['orders.xml', '', 'xml', async () => { assert.match(await v.stat(), /root <orders> · 300 <order> rows/); }],
  ['pom.xml', '', 'xml', async () => { assert.match(await v.stat(), /root <project>/); }],
  ['deploy.yaml', '', 'yaml', async () => { assert.match(await v.stat(), /yaml parsed OK/); }],
  ['config.toml', '', 'toml', async () => { assert.match(await v.stat(), /toml parsed OK/); }],
  ['README.md', '', 'markdown', async () => {
    assert.equal(await v.text('.markdown-body h1'), 'Orders service');
    assert.equal(await v.count('.markdown-body script'), 0, 'script must be sanitised out');
  }],
  ['page.html', '', 'html', async () => {
    assert.equal(await v.page.$eval('iframe.doc', f => f.getAttribute('sandbox')), '', 'preview must be fully sandboxed');
  }, { expect: [/Blocked script execution in 'about:srcdoc'.*sandboxed/] }],   // the page's own script must be refused
  ['logo.svg', '', 'svg', async () => { assert.ok((await v.imagesLoaded('.media-wrap img'))[0] > 0); }],
  // text and code
  ['app.log', '', 'text', async () => { assert.match(await v.stat(), /60,000 lines/); assert.ok(await v.count('.vlines'), 'large logs use the virtual list'); }],
  ['notes.txt', '', 'text', async () => { assert.match(await v.text('.code-wrap'), /Plain text file\./); }],
  ['script.py', '', 'code', async () => { assert.match(await v.stat(), /python/); assert.ok(await v.count('.code-wrap code.hljs span') > 3); }],
  ['query.sql', '', 'code', async () => { assert.match(await v.stat(), /sql/); }],
  // columnar
  ['users.parquet', '', 'parquet', async () => { assert.match(await v.stat(), /5,000 of 5,000 rows loaded/); assert.ok(await rows() > 10); }],
  ['large.parquet', '', 'parquet', async () => {
    assert.match(await v.stat(), /20,000 of 400,000 rows loaded/);
    assert.match(await v.page.$eval('.info-panel', e => e.textContent), /remote \(HTTP range reads/);
    const fetched = await v.page.evaluate(() => performance.getEntriesByType('resource')
      .filter(r => r.name.includes('large.parquet')).reduce((s, r) => s + (r.encodedBodySize || 0), 0));
    assert.ok(fetched < 20 * 1048576, `read ${Math.round(fetched / 1048576)} MB of a 40 MB file; should read parts only`);
  }],
  ['users.arrow', '', 'arrow', async () => { assert.match(await v.stat(), /5,000 of 5,000 rows/); }],
  ['users.feather', '', 'arrow', async () => { assert.match(await v.stat(), /5,000 of 5,000 rows/); }],
  // spreadsheets
  ['users.xlsx', '', 'xlsx', async () => { assert.match(await v.stat(), /2 sheets.*1,000 rows × 8 cols/); }],
  ['users.xlsb', '', 'xlsx', async () => { assert.match(await v.stat(), /2 sheets.*1,000 rows × 8 cols/); }],
  ['users.xls', '', 'xlsx', async () => { assert.match(await v.stat(), /2 sheets.*1,000 rows × 8 cols/); }],
  ['users.ods', '', 'xlsx', async () => { assert.match(await v.stat(), /2 sheets.*1,000 rows × 8 cols/); }],
  // office documents
  ['report.docx', '', 'docx', async () => {
    assert.match(await v.stat(), /1 page/);
    assert.equal(await v.count('.docx-scroll table'), 1);
    assert.ok((await v.imagesLoaded('.docx-scroll img'))[0] > 0);
    assert.equal(await v.count('.docx-scroll a[href^="javascript:"]'), 0, 'hostile link must be neutralised');
    assert.equal(await v.page.$eval('.docx-scroll a[href^="https:"]', a => a.target), '_blank');
  }],
  ['report-docx-noext', '', 'docx', async () => { assert.match(await v.detected(), /magic\+contents/); }],
  ['real/sample-resume.docx', '', 'docx', async () => { assert.match(await v.text('section.docx'), /Jordan Smith/); }],
  ['deck.pptx', '', 'pptx', async () => {
    assert.equal(await v.count('.pptx-slide'), 3);
    assert.deepEqual(await v.page.$$eval('.pptx-slide h2', hs => hs.map(h => h.textContent)), ['S3 Any Viewer', 'What changed this quarter', 'Totals by city']);
    assert.equal(await v.count('.pptx-slide table'), 1);
    assert.equal(await v.count('.pptx-slide details'), 1, 'speaker notes');
    assert.ok((await v.imagesLoaded('.pptx-slide img'))[0] > 0);
  }],
  ['real/sample-presentation.pptx', '', 'pptx', async () => {
    assert.equal(await v.count('.pptx-slide'), 8);
    assert.ok((await v.imagesLoaded('.pptx-slide img'))[0] > 0);
    assert.match(await v.text('.pptx-list'), /\[chart\]/);
  }],
  ['legacy.doc', '', 'hex', async () => { assert.match(await v.text('#mount .note'), /Legacy Word \(\.doc\)/); }],
  // archives
  ['bundle.zip', '', 'zip', async () => { assert.equal(await v.count('.zip-list tr.file'), 4); }],
  ['notes.odt', '', 'zip', async () => { assert.match(await v.stat(), /odt documents are shown as their raw parts/); }],
  // media
  ['doc.pdf', '', 'pdf', async () => { assert.match(await v.page.$eval('iframe.doc', f => f.src), /^blob:/); }],
  ['icon.png', '', 'image', async () => { assert.equal((await v.imagesLoaded('.media-wrap img'))[0], 128); }],
  ['sample.jpg', '', 'image', async () => { assert.equal((await v.imagesLoaded('.media-wrap img'))[0], 48); }],
  ['sample.gif', '', 'image', async () => { assert.equal((await v.imagesLoaded('.media-wrap img'))[0], 1); }],
  ['sample.webp', '', 'image', async () => { assert.equal((await v.imagesLoaded('.media-wrap img'))[0], 48); }],
  ['clip.webm', '', 'video', async () => {
    await v.page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, { timeout: 10000 });
  }],
  ['tone.wav', '', 'audio', async () => {
    await v.page.waitForFunction(() => document.querySelector('audio')?.readyState >= 1, { timeout: 10000 });
    const d = await v.page.$eval('audio', a => a.duration);
    assert.ok(Math.abs(d - 0.5) < 0.05, `duration ${d}`);
  }],
  // everything else
  ['blob.bin', '', 'hex', async () => { assert.match(await v.stat(), /256 rows of 16 bytes/); }],
  ['data.avro', '', 'hex', async () => { assert.match(await v.text('#mount .note'), /Avro/); }],
];

describe('every format opens in the right view with real content', () => {
  for (const [file, query, view, check, clean = {}] of CASES) {
    const missing = !existsSync(`fixtures/${file}`);
    it(`${file}${query} → ${view}`, { skip: missing && 'fixture not present (real/ samples are local downloads)' }, async () => {
      await v.open(file, { query });
      assert.equal(await v.view(), view, `detected: ${await v.detected()}`);
      assert.equal(await v.count('#mount .error'), 0, await v.text('#mount .error') || '');
      await check();
      await v.assertClean(clean);
    });
  }
});
