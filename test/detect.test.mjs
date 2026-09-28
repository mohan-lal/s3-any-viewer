// Format detection: every fixture must be identified correctly, plus targeted edge cases.
// Pure Node, no browser. Run with `npm test` (fixtures are generated first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { detectFormat, sniffText } from '../src/lib/detect.js';

const fx = (name) => new Uint8Array(readFileSync(`fixtures/${name}`));
const detect = (name, contentType = '') => detectFormat({ name, contentType, bytes: fx(name) });

// fixture -> expected { format, compression?, unsupported? }
const EXPECT = {
  'users.csv': { format: 'csv' },
  'users.psv': { format: 'csv' },
  'users.tsv': { format: 'csv' },
  'users-semicolon.txt': { format: 'csv' },
  'users-noext': { format: 'csv' },
  'users.csv.gz': { format: 'gzip', compression: 'gzip' },
  'users.csv.zst': { format: 'gzip', compression: 'zstd' },
  'users.json.br': { format: 'gzip', compression: 'brotli' },
  'orders.json.gz': { format: 'gzip', compression: 'gzip' },
  'users.json': { format: 'json' },
  'order.json': { format: 'json' },
  'config.json': { format: 'json' },
  'events.ndjson': { format: 'ndjson' },
  'orders.xml': { format: 'xml' },
  'pom.xml': { format: 'xml' },
  'deploy.yaml': { format: 'yaml' },
  'config.toml': { format: 'toml' },
  'README.md': { format: 'markdown' },
  'page.html': { format: 'html' },
  'logo.svg': { format: 'svg' },
  'app.log': { format: 'text' },
  'notes.txt': { format: 'text' },
  'script.py': { format: 'code' },
  'query.sql': { format: 'code' },
  'users.parquet': { format: 'parquet' },
  'large.parquet': { format: 'parquet' },
  'users.arrow': { format: 'arrow' },
  'users.feather': { format: 'arrow' },
  'users.xlsx': { format: 'xlsx' },
  'users.xlsb': { format: 'xlsx' },
  'users.ods': { format: 'xlsx' },
  'users.xls': { format: 'xlsx' },
  'report.docx': { format: 'docx' },
  'report-docx-noext': { format: 'docx' },
  'deck.pptx': { format: 'pptx' },
  'real/sample-resume.docx': { format: 'docx' },
  'real/sample-presentation.pptx': { format: 'pptx' },
  'legacy.doc': { format: 'hex', unsupported: 'doc' },
  'bundle.zip': { format: 'zip' },
  'notes.odt': { format: 'zip', unsupported: 'odt' },
  'doc.pdf': { format: 'pdf' },
  'icon.png': { format: 'image' },
  'sample.jpg': { format: 'image' },
  'sample.gif': { format: 'image' },
  'sample.webp': { format: 'image' },
  'clip.webm': { format: 'video' },
  'tone.wav': { format: 'audio' },
  'blob.bin': { format: 'hex' },
  'data.avro': { format: 'hex', unsupported: 'avro' },
};

for (const [name, want] of Object.entries(EXPECT)) {
  test(`detects ${name} as ${want.format}${want.compression ? ` (${want.compression})` : ''}`, { skip: !existsSync(`fixtures/${name}`) && 'fixture not present (zstd needs Node 22.15+; real/ samples are local downloads)' }, () => {
    const got = detect(name);
    assert.equal(got.format, want.format);
    if (want.compression) assert.equal(got.compression, want.compression);
    assert.equal(got.unsupported, want.unsupported);
  });
}

test('a generic S3 content type does not override the extension', () => {
  assert.equal(detect('users.csv', 'application/octet-stream').format, 'csv');
  assert.equal(detect('users.json', 'binary/octet-stream').format, 'json');
});

test('office archives with no extension are identified from their entry names', () => {
  assert.equal(detectFormat({ name: 'report', bytes: fx('report.docx') }).format, 'docx');
  assert.equal(detectFormat({ name: 'deck', bytes: fx('deck.pptx') }).format, 'pptx');
  assert.equal(detectFormat({ name: 'book', bytes: fx('users.xlsx') }).format, 'xlsx');
  assert.equal(detectFormat({ name: 'archive', bytes: fx('bundle.zip') }).format, 'zip');
});

test('legacy OLE files are told apart by extension, then by stream name', () => {
  const ole = (stream) => {
    const b = new Uint8Array(4096);
    b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (stream) b.set(new Uint8Array(Buffer.from(stream, 'utf16le')), 1024);
    return b;
  };
  assert.deepEqual([detectFormat({ name: 'a.ppt', bytes: ole() }).format, detectFormat({ name: 'a.ppt', bytes: ole() }).unsupported], ['hex', 'ppt']);
  assert.equal(detectFormat({ name: 'a.xls', bytes: ole() }).format, 'xlsx');
  assert.equal(detectFormat({ name: 'noext', bytes: ole('PowerPoint Document') }).unsupported, 'ppt');
  assert.equal(detectFormat({ name: 'noext', bytes: ole('WordDocument') }).unsupported, 'doc');
  assert.equal(detectFormat({ name: 'noext', bytes: ole('Workbook') }).format, 'xlsx');
});

test('a text extension on binary content falls back to hex', () => {
  assert.equal(detectFormat({ name: 'fake.csv', bytes: fx('blob.bin') }).format, 'hex');
});

test('unsupported binary signatures are named', () => {
  const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4]);
  assert.equal(detectFormat({ name: 'scan.tif', bytes: tiff }).unsupported, 'tiff');
  const bz2 = new TextEncoder().encode('BZh91AY&SY');
  assert.equal(detectFormat({ name: 'x.bz2', bytes: bz2 }).unsupported, 'bzip2');
});

test('content type is used when there is no signature and no extension', () => {
  const junk = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(detectFormat({ name: 'object', contentType: 'application/vnd.apache.parquet', bytes: junk }).format, 'parquet');
});

test('text content is sniffed when name and type say nothing', () => {
  assert.equal(sniffText('{"a": 1, "b": [1, 2]}'), 'json');
  assert.equal(sniffText('{"a": 1}\n{"a": 2}\n{"a": 3}'), 'ndjson');
  assert.equal(sniffText('<?xml version="1.0"?><root/>'), 'xml');
  assert.equal(sniffText('<!doctype html><html><body>x</body></html>'), 'html');
  assert.equal(sniffText('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'svg');
  assert.equal(sniffText('---\nname: demo\nreplicas: 3\n'), 'yaml');
  assert.equal(sniffText('a,b,c\n1,2,3\n4,5,6\n'), 'csv');
  assert.equal(sniffText('a|b|c\n1|2|3\n4|5|6\n'), 'csv');
  assert.equal(sniffText('# Title\n\nSome prose here.\n'), 'markdown');
  assert.equal(sniffText('just a line of text\nand another'), 'text');
});
