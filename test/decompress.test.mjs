// Transparent decompression: every supported wrapper must round-trip byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decompress } from '../src/lib/source.js';

const sample = new Uint8Array(readFileSync('fixtures/users.json'));
const same = (a, b) => assert.ok(Buffer.from(a).equals(Buffer.from(b)), `lengths ${a.length} vs ${b.length}`);

test('gzip round-trips', async () => same(await decompress(new Uint8Array(zlib.gzipSync(sample)), 'gzip'), sample));

test('zstd round-trips', { skip: !zlib.zstdCompressSync && 'needs Node 22.15+' }, async () => {
  same(await decompress(new Uint8Array(zlib.zstdCompressSync(sample)), 'zstd'), sample);
});

test('brotli round-trips (no size is stored in a .br file)', async () => {
  same(await decompress(new Uint8Array(zlib.brotliCompressSync(sample)), 'brotli'), sample);
});

test('brotli handles an empty file', async () => {
  same(await decompress(new Uint8Array(zlib.brotliCompressSync(new Uint8Array(0))), 'brotli'), new Uint8Array(0));
});

test('brotli handles a file far larger than the first buffer guess', async () => {
  // Highly compressible, so the output is many times the input and the buffer must grow repeatedly.
  const big = new Uint8Array(Buffer.from('timestamp=2026-09-28 level=INFO msg=ok\n'.repeat(250000)));
  const packed = new Uint8Array(zlib.brotliCompressSync(big, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }));
  assert.ok(big.length > packed.length * 40, 'fixture should compress heavily');
  same(await decompress(packed, 'brotli'), big);
});

test('brotli handles incompressible data spanning several meta-blocks', async () => {
  const noise = new Uint8Array(randomBytes(20 * 1024 * 1024));
  const packed = new Uint8Array(zlib.brotliCompressSync(noise, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } }));
  same(await decompress(packed, 'brotli'), noise);
});

test('the brotli wrapper leaves the library exactly as it found it', async () => {
  // Parquet pages use the same decoder with a known size; it must be untouched afterwards.
  const { decompressBrotli } = await import('hyparquet-compressors');
  const { BrotliOutput } = await import('hyparquet-compressors/src/brotli.streams.js');
  const before = BrotliOutput.prototype.write;
  const packed = new Uint8Array(zlib.brotliCompressSync(sample));
  await decompress(packed, 'brotli');
  assert.equal(BrotliOutput.prototype.write, before, 'write method was not restored');
  await assert.rejects(decompress(new Uint8Array([1, 2, 3, 4, 5]), 'brotli'));
  assert.equal(BrotliOutput.prototype.write, before, 'write method was not restored after an error');
  same(decompressBrotli(packed, sample.length), sample);
});
