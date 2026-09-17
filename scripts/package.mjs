// Zips ./dist into ./release/s3-any-viewer-<version>.zip, ready for "Load unpacked" sharing or Web Store upload.
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const files = {};
const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p) : (files[relative('dist', p).replace(/\\/g, '/')] = readFileSync(p)); } };
walk('dist');
mkdirSync('release', { recursive: true });
const out = `release/s3-any-viewer-${manifest.version}.zip`;
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`wrote ${out} (${Object.keys(files).length} files)`);
