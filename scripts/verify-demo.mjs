// Confirms the encoded demo decodes, and saves sample frames to demo/preview for review.
import puppeteer from 'puppeteer-core';
import { startDemoServer, PORT } from './demo-server.mjs';
import { existsSync, mkdirSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean).find(p => existsSync(p));

const TIMES = process.argv.slice(2).filter(a => !isNaN(+a)).map(Number);
const times = TIMES.length ? TIMES : [1.5, 5, 9, 14, 20, 26, 31, 36, 41, 44];
const dl = resolve('demo/.preview-dl');
const out = resolve('demo/preview');
rmSync(dl, { recursive: true, force: true }); mkdirSync(dl, { recursive: true });
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

const server = await startDemoServer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-first-run'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/console`, { waitUntil: 'domcontentloaded' });
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });

  const info = await page.evaluate(async (src, times) => {
    const v = document.createElement('video');
    v.src = src; v.muted = true;
    await new Promise((res, rej) => {
      v.onloadedmetadata = res;
      v.onerror = () => rej(new Error('decode failed'));
      setTimeout(() => rej(new Error('timeout')), 20000);
    });
    const seek = async (t) => {
      await new Promise(r => { v.onseeked = r; v.currentTime = t; });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 220));
    };
    const luma = [];
    for (const t of times) {
      await seek(t);
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      const small = c.getContext('2d').getImageData(0, 0, 64, 36).data;
      let sum = 0; for (let i = 0; i < small.length; i += 4) sum += small[i] + small[i + 1] + small[i + 2];
      luma.push({ t, avg: Math.round(sum / (small.length / 4) / 3) });
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `t${String(t).replace('.', '_')}.png`;
      document.body.appendChild(a); a.click();
      await new Promise(r => setTimeout(r, 350));
    }
    return { duration: +v.duration.toFixed(2), w: v.videoWidth, h: v.videoHeight, luma,
             audio: v.webkitAudioDecodedByteCount !== undefined ? v.webkitAudioDecodedByteCount : 'n/a' };
  }, `http://127.0.0.1:${PORT}/demo/s3-any-viewer-demo-fullbleed.mp4`, times);

  await new Promise(r => setTimeout(r, 1200));
  for (const f of readdirSync(dl)) renameSync(resolve(dl, f), resolve(out, f));
  console.log(`duration ${info.duration}s  ${info.w}x${info.h}`);
  console.log('sampled luma:', info.luma.map(l => `${l.t}s=${l.avg}`).join('  '));
  console.log(info.luma.every(l => l.avg > 2) ? 'all sampled frames have content' : 'BLANK FRAMES FOUND');
  console.log(`frames saved to ${out}`);
} finally {
  await browser.close(); server.close();
  rmSync(dl, { recursive: true, force: true });
}
