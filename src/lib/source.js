// Loading bytes from a URL (presigned S3 or anything else) or a local File, with progress.
import { decompressZstd, decompressBrotli } from 'hyparquet-compressors';

export class LoadAborted extends Error {}

/**
 * Fetch a URL fully into memory.
 * @param {string} url
 * @param {{ onProgress?: (loaded:number, total:number|null)=>void, signal?: AbortSignal, rangeEnd?: number }} opts
 */
export async function fetchBytes(url, { onProgress, signal, rangeEnd } = {}) {
  const headers = {};
  if (rangeEnd != null) headers.Range = `bytes=0-${rangeEnd - 1}`;
  const res = await fetch(url, { signal, headers, credentials: 'omit', cache: 'no-store' });
  if (!res.ok && res.status !== 206) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}${describeS3Error(body)}`);
  }
  const contentType = res.headers.get('content-type') || '';
  const totalHeader = res.headers.get('content-range')?.split('/')[1] || res.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;
  const lastModified = res.headers.get('last-modified') || '';
  const etag = res.headers.get('etag') || '';
  const disposition = res.headers.get('content-disposition') || '';

  const chunks = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.length;
    onProgress?.(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let off = 0; for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return { bytes, contentType, total, partial: res.status === 206 && total != null && loaded < total, lastModified, etag, disposition };
}

// Just the size, via a 1-byte range request (HEAD is not allowed on a GET-presigned URL).
export async function probeSize(url, signal) {
  try {
    const res = await fetch(url, { signal, headers: { Range: 'bytes=0-0' }, credentials: 'omit', cache: 'no-store' });
    if (res.status === 206) {
      const total = Number(res.headers.get('content-range')?.split('/')[1]);
      res.body?.cancel();
      return { size: isNaN(total) ? null : total, contentType: res.headers.get('content-type') || '', rangeOk: true };
    }
    if (res.ok) {
      const len = res.headers.get('content-length');
      res.body?.cancel();
      return { size: len ? Number(len) : null, contentType: res.headers.get('content-type') || '', rangeOk: false };
    }
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}${describeS3Error(body)}`);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw e;
  }
}

function describeS3Error(xml) {
  const code = /<Code>([^<]+)<\/Code>/.exec(xml)?.[1];
  const msg = /<Message>([^<]+)<\/Message>/.exec(xml)?.[1];
  if (!code) return '';
  const hints = {
    ExpiredToken: 'The presigned link has expired. Go back to the S3 console and click Open again.',
    AccessDenied: 'The presigned link is not valid for this request (expired, or signed for a different method).',
    NoSuchKey: 'The object does not exist.',
  };
  return ` - ${code}: ${msg || ''}${hints[code] ? ' ' + hints[code] : ''}`;
}

export function readLocalFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => onProgress?.(e.loaded, e.total);
    r.onerror = () => reject(r.error);
    r.onload = () => resolve({ bytes: new Uint8Array(r.result), contentType: file.type || '', total: file.size, partial: false, lastModified: new Date(file.lastModified).toUTCString() });
    r.readAsArrayBuffer(file);
  });
}

export async function decompress(bytes, compression) {
  if (compression === 'gzip' || compression === 'deflate') {
    const ds = new DecompressionStream(compression);
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (compression === 'zstd') return decompressZstd(bytes);
  if (compression === 'brotli') return decompressBrotli(bytes);
  throw new Error(`Unsupported compression: ${compression}`);
}

// Pull a human-readable object name out of an S3 URL (virtual-hosted or path-style).
export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const parts = path.split('/').filter(Boolean);
    const host = u.hostname;
    let bucket = null, key = parts.join('/');
    const m = /^(.+?)\.s3[.-]/.exec(host);
    if (m) bucket = m[1];
    else if (/^s3[.-]/.test(host) && parts.length > 1) { bucket = parts[0]; key = parts.slice(1).join('/'); }
    const cd = u.searchParams.get('response-content-disposition');
    const fn = cd && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
    return { bucket, key, name: fn ? decodeURIComponent(fn) : (key.split('/').pop() || host), fullPath: key };
  } catch {
    return { bucket: null, key: url, name: url.split('/').pop() || url, fullPath: url };
  }
}
