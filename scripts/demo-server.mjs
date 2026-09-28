// Local fixture server for the demo recording: serves the mock S3 console and the sample
// objects. Objects are returned as application/octet-stream, the way S3 usually does, so the
// viewer's content sniffing is exercised for real. Not shipped with the extension.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

export const PORT = 8766;

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
const OBJECT_TYPE = 'application/octet-stream';

export function startDemoServer(port = PORT) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const path = decodeURIComponent(url.pathname);
      try {
        let file, type;
        const name = basename(path);
        if (path === '/' || path.startsWith('/console')) { file = 'demo/s3-console.html'; type = 'text/html'; }
        else if (path.startsWith('/demo/')) {
          // Keep sub-paths (demo/frames/0000.png), but never escape the folder.
          const rel = path.slice('/demo/'.length).replace(/\\/g, '/').split('/').filter(p => p && p !== '..').join('/');
          file = 'demo/' + rel; type = TYPES[extname(path)] || 'text/plain';
        }
        else if (path.startsWith('/icons/')) { file = 'dist/icons/' + name; type = 'image/png'; }
        else if (path.startsWith('/chunks/')) { file = 'dist/chunks/' + name; type = 'text/javascript'; }
        else if (/^\/(viewer|popup)\.(html|css|js)$|^\/hljs-(light|dark)\.css$/.test(path)) {
          // The built extension pages, served over http so the recorder can drive them.
          file = 'dist/' + name; type = TYPES[extname(path)] || 'text/plain';
        }
        else { file = join('fixtures', name); type = OBJECT_TYPE; }

        const s = await stat(file);
        const body = await readFile(file);
        const headers = {
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Last-Modified': s.mtime.toUTCString(),
          'Cache-Control': 'no-store',
        };
        // /nocors/<name> withholds the CORS header so the viewer's "allow this site" panel
        // can be shown for real during the recording.
        if (!path.startsWith('/nocors/')) headers['Access-Control-Allow-Origin'] = '*';
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        if (range) {
          const start = Number(range[1]);
          if (start >= body.length) { res.writeHead(416, { 'Content-Range': `bytes */${body.length}` }); res.end(); return; }
          const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
          res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
          res.end(body.subarray(start, end + 1));
          return;
        }
        res.writeHead(200, { ...headers, 'Content-Length': body.length });
        res.end(body);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  startDemoServer().then(() => console.log(`demo server on http://127.0.0.1:${PORT}/console`));
}
