// Brotli for whole files.
//
// hyparquet-compressors' decoder was written for Parquet pages, where the decompressed size is
// always known up front. It grows its internal output buffer as it decodes, but then returns the
// array it allocated at the start, so with no size given (a standalone .br file stores none) the
// result is empty. This wraps the output's write method for the duration of one call to capture
// the output object, then returns exactly the bytes it holds. The decoder is fully synchronous,
// so the original method is back in place before any other code can run.
//
// This reaches into the library's internals; test/decompress.test.mjs fails if they change.
import { decompressBrotli } from 'hyparquet-compressors';
import { BrotliOutput } from 'hyparquet-compressors/src/brotli.streams.js';

const MAX_OUTPUT = 1024 * 1024 * 1024;   // refuse to inflate a file past 1 GB

export function brotliDecompress(input) {
  const original = BrotliOutput.prototype.write;
  let out = null;
  BrotliOutput.prototype.write = function (buf, count) {
    out = this;
    if (this.pos + count > MAX_OUTPUT) throw new Error('Decompressed size would exceed 1 GB; stopped to protect memory');
    return original.call(this, buf, count);
  };
  try {
    decompressBrotli(input, Math.max(65536, input.length * 4));   // an initial size only; it grows
  } finally {
    BrotliOutput.prototype.write = original;
  }
  return out ? out.buffer.slice(0, out.pos) : new Uint8Array(0);
}
