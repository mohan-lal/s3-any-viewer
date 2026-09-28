// Dev-only static server: serves ./dist (viewer) and ./fixtures (sample files) so the viewer page can be
// exercised in a normal tab without installing the extension. Not part of the extension.
// Also imported by the test suite, so tests run against exactly this server and its CSP.
//
//   node scripts/serve.mjs            http://localhost:8765/viewer.html
//
// Query flags on fixture URLs: ?ct=<type> overrides Content-Type, ?gz=1 serves the file gzipped,
// ?attachment=1 adds Content-Disposition: attachment, ?claimsize=<bytes> fakes a large object.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Same CSP the extension pages run under, so dev testing catches anything it would block.
const CSP = JSON.parse(readFileSync('src/manifest.json', 'utf8')).content_security_policy.extension_pages;

const roots = { '/fixtures/': 'fixtures', '/': 'dist' };
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json',
  '.csv': 'text/csv', '.xml': 'application/xml', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.md': 'text/markdown',
};

/**
 * @param {{ port?: number, cors?: boolean }} opts  cors:false omits Access-Control-Allow-Origin, so a
 *   viewer on another origin is refused, which is how the "allow this site" path gets tested.
 * @returns {Promise<import('node:http').Server>}
 */
export function startDevServer({ port = 8765, cors = true } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = null;
    for (const [prefix, dir] of Object.entries(roots)) {
      if (url.pathname.startsWith(prefix)) { file = join(dir, normalize(decodeURIComponent(url.pathname.slice(prefix.length)) || 'viewer.html')); break; }
    }
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('dir');
      let body = await readFile(file);
      const headers = { 'Content-Type': url.searchParams.get('ct') || types[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
      if (cors) headers['Access-Control-Allow-Origin'] = '*';
      if (extname(file) === '.html' && file.startsWith('dist')) headers['Content-Security-Policy'] = CSP;
      if (url.searchParams.get('gz')) { body = gzipSync(body); headers['Content-Type'] = 'application/octet-stream'; }
      if (url.searchParams.get('attachment')) headers['Content-Disposition'] = 'attachment';
      // ?claimsize=N reports a larger total size in range replies, so the "large object" prompt
      // can be tested without a file that size.
      const total = Number(url.searchParams.get('claimsize')) || body.length;
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start = Number(range[1]); const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': body.length });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}) });
      res.end('not found: ' + url.pathname);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8765);
  startDevServer({ port }).then(() => console.log(`dev server on http://localhost:${port}/viewer.html  (fixtures under /fixtures/)`));
}
