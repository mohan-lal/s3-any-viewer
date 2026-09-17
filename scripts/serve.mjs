// Dev-only static server: serves ./dist (viewer) and ./fixtures (sample files) so the viewer page can be
// exercised in a normal tab without installing the extension. Not part of the extension.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const port = Number(process.env.PORT || 8765);
const roots = { '/fixtures/': 'fixtures', '/': 'dist' };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.csv': 'text/csv', '.xml': 'application/xml', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = null;
  for (const [prefix, dir] of Object.entries(roots)) {
    if (url.pathname.startsWith(prefix)) { file = join(dir, normalize(decodeURIComponent(url.pathname.slice(prefix.length)) || 'viewer.html')); break; }
  }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('dir');
    let body = await readFile(file);
    const headers = { 'Content-Type': url.searchParams.get('ct') || types[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (url.searchParams.get('gz')) { body = gzipSync(body); headers['Content-Type'] = 'application/octet-stream'; }
    if (url.searchParams.get('attachment')) headers['Content-Disposition'] = 'attachment';
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]); const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found: ' + url.pathname);
  }
}).listen(port, () => console.log(`dev server on http://localhost:${port}/viewer.html  (fixtures under /fixtures/)`));
