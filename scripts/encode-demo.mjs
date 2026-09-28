// Composites demo/frames + storyboard.json into demo/s3-any-viewer-demo.mp4 using Chrome's
// WebCodecs encoder and mp4-muxer, so no ffmpeg install is needed.
//
// Optional background music: put a file at demo/music.mp3 (or pass --music=path). It is
// decoded, encoded to AAC and muxed in, trimmed to the video length with a short fade out.
import puppeteer from 'puppeteer-core';
import { startDemoServer, PORT } from './demo-server.mjs';
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, renameSync, statSync, copyFileSync } from 'node:fs';
import { build } from 'esbuild';
import { resolve, basename } from 'node:path';

const FPS = 30;
const XFADE_MS = 280;
const OUT_DIR = 'demo';
// 'fullbleed' keeps the UI at full size with the kinetic band over it; 'framed' floats a
// browser window on a gradient. Each writes its own file, so nothing is ever overwritten.
const STYLE = (process.argv.find(a => a.startsWith('--style='))?.slice(8)) || 'fullbleed';
if (!['fullbleed', 'framed'].includes(STYLE)) throw new Error(`unknown --style=${STYLE}`);
const OUT_NAME = (process.argv.find(a => a.startsWith('--out='))?.slice(6)) || `s3-any-viewer-demo-${STYLE}.mp4`;

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) throw new Error('Chrome not found; set CHROME_PATH');
if (!existsSync('demo/frames/storyboard.json')) throw new Error('run "npm run demo" first');

const musicArg = process.argv.find(a => a.startsWith('--music='))?.slice(8);
let music = musicArg || ['demo/music.mp3', 'demo/music.wav', 'demo/music.m4a'].find(p => existsSync(p));
if (music && !existsSync(music)) throw new Error(`music file not found: ${music}`);
if (music) { copyFileSync(music, 'demo/__music' + music.slice(music.lastIndexOf('.'))); music = '__music' + music.slice(music.lastIndexOf('.')); }

const board = JSON.parse(readFileSync('demo/frames/storyboard.json', 'utf8'));
const total = board.beats.reduce((s, b) => s + b.ms, 0);
console.log(`${board.beats.length} beats, ${(total / 1000).toFixed(1)}s at ${FPS}fps${music ? ', with music' : ', silent'}`);

await build({
  entryPoints: ['node_modules/mp4-muxer/build/mp4-muxer.mjs'],
  outfile: 'demo/mp4-muxer.js', bundle: true, format: 'iife', globalName: 'Mp4Muxer', logLevel: 'error',
});

const dl = resolve('demo/.dl');
rmSync(dl, { recursive: true, force: true });
mkdirSync(dl, { recursive: true });

const server = await startDemoServer();
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  page.on('console', m => { const t = m.text(); if (t.startsWith('[enc]')) console.log(t); });
  page.on('pageerror', e => console.log('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/console`, { waitUntil: 'domcontentloaded' });
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await page.addScriptTag({ url: `http://127.0.0.1:${PORT}/demo/mp4-muxer.js` });
  await page.addScriptTag({ url: `http://127.0.0.1:${PORT}/demo/compose.js` });

  const result = await page.evaluate(async (board, fps, xfadeMs, base, name, musicFile, style) => {
    if (!('VideoEncoder' in window)) return 'WebCodecs unavailable';
    const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
    const C = window.DemoCompose;
    const { width: W, height: H, beats } = board;
    const totalMs = beats.reduce((s, b) => s + b.ms, 0);
    const nFrames = Math.round(totalMs * fps / 1000);

    // ---- audio first, so the muxer knows the track exists ----
    let audio = null;
    if (musicFile) {
      const buf = await (await fetch(`${base}/demo/${musicFile}`)).arrayBuffer();
      const ac = new OfflineAudioContext(2, 48000 * Math.ceil(totalMs / 1000), 48000);
      const decoded = await ac.decodeAudioData(buf);
      const src = ac.createBufferSource();
      src.buffer = decoded;
      src.loop = decoded.duration < totalMs / 1000;     // loop short tracks
      const gain = ac.createGain();
      const endS = totalMs / 1000;
      gain.gain.setValueAtTime(0, 0);
      gain.gain.linearRampToValueAtTime(0.85, 0.8);      // fade in
      gain.gain.setValueAtTime(0.85, Math.max(1, endS - 2));
      gain.gain.linearRampToValueAtTime(0, endS);        // fade out
      src.connect(gain).connect(ac.destination);
      src.start(0);
      audio = await ac.startRendering();
    }

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H },
      ...(audio ? { audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 } } : {}),
      fastStart: 'in-memory',
    });

    let err = null;
    const venc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { err = 'video: ' + e.message; },
    });
    venc.configure({ codec: 'avc1.4d0028', width: W, height: H, bitrate: 3_000_000, framerate: fps });

    // ---- preload assets ----
    const icon = await createImageBitmap(await (await fetch(`${base}/icons/icon128.png`)).blob());
    const bmps = new Map();
    const need = new Set();
    for (const b of beats) for (const f of (b.frames || [])) need.add(f.f);
    let loaded = 0;
    for (const f of need) {
      bmps.set(f, await createImageBitmap(await (await fetch(`${base}/demo/frames/${f}`)).blob()));
      if (++loaded % 20 === 0) console.log(`[enc] loaded ${loaded}/${need.size}`);
    }

    // beat start times
    const starts = [];
    let acc = 0;
    for (const b of beats) { starts.push(acc); acc += b.ms; }

    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d', { alpha: false });
    const prev = new OffscreenCanvas(W, H);
    const pctx = prev.getContext('2d', { alpha: false });

    const full = style === 'fullbleed';
    function renderBeat(c, bi, tInBeat) {
      const b = beats[bi];
      C.backdrop(c, W, H);
      if (b.kind === 'ui') {
        let t = 0, pick = b.frames[0];
        for (const f of b.frames) { if (tInBeat >= t) pick = f; t += f.ms; }
        const bmp = bmps.get(pick.f);
        const p = tInBeat / Math.max(1, b.ms);
        if (bmp) (full ? C.drawStageFull : C.drawStage)(c, W, H, bmp, b.motion || 'none', p);
        (full ? C.drawKinetic : C.drawCaption)(c, W, H, b, tInBeat);
      } else {
        C.drawCard(c, W, H, b, tInBeat, icon);
      }
    }

    const dur = Math.round(1e6 / fps);
    for (let i = 0; i < nFrames; i++) {
      const tMs = i * 1000 / fps;
      let bi = 0;
      while (bi + 1 < beats.length && tMs >= starts[bi + 1]) bi++;
      const tIn = tMs - starts[bi];

      renderBeat(ctx, bi, tIn);
      // cross-fade from the tail of the previous beat
      if (bi > 0 && tIn < xfadeMs) {
        renderBeat(pctx, bi - 1, beats[bi - 1].ms - 1);
        ctx.save();
        ctx.globalAlpha = 1 - tIn / xfadeMs;
        ctx.drawImage(prev, 0, 0);
        ctx.restore();
        // redraw the incoming caption on top so text never double-exposes
        const b = beats[bi];
        if (b.kind === 'ui') (full ? C.drawKinetic : C.drawCaption)(ctx, W, H, b, tIn);
      }
      C.drawProgress(ctx, W, H, tMs / totalMs);

      const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: dur });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      if (venc.encodeQueueSize > 24) await new Promise(r => setTimeout(r, 6));
      if (i % 150 === 0) console.log(`[enc] frame ${i}/${nFrames}`);
      if (err) return err;
    }
    await venc.flush();

    // ---- audio track ----
    if (audio) {
      const aenc = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => { err = 'audio: ' + e.message; },
      });
      aenc.configure({ codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: 48000, bitrate: 160_000 });
      const CH = 1024;
      const L = audio.getChannelData(0), R = audio.getChannelData(1);
      const frames = Math.floor(audio.length / CH);
      for (let i = 0; i < frames; i++) {
        const inter = new Float32Array(CH * 2);
        for (let s = 0; s < CH; s++) { inter[s * 2] = L[i * CH + s]; inter[s * 2 + 1] = R[i * CH + s]; }
        aenc.encode(new AudioData({
          format: 'f32', sampleRate: 48000, numberOfFrames: CH, numberOfChannels: 2,
          timestamp: Math.round(i * CH * 1e6 / 48000), data: inter,
        }));
        if (aenc.encodeQueueSize > 32) await new Promise(r => setTimeout(r, 4));
        if (err) return err;
      }
      await aenc.flush();
    }

    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    return `ok ${(blob.size / 1048576).toFixed(1)} MB`;
  }, board, FPS, XFADE_MS, `http://127.0.0.1:${PORT}`, OUT_NAME, music, STYLE);

  if (!String(result).startsWith('ok')) throw new Error(String(result));

  for (let i = 0; i < 180; i++) {
    const files = readdirSync(dl).filter(f => f.endsWith('.mp4'));
    if (files.length && !readdirSync(dl).some(f => f.endsWith('.crdownload'))) {
      const dst = resolve(OUT_DIR, OUT_NAME);
      rmSync(dst, { force: true });
      renameSync(resolve(dl, files[0]), dst);
      console.log(`wrote ${dst} (${(statSync(dst).size / 1048576).toFixed(1)} MB, ${(total / 1000).toFixed(1)}s)`);
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
} finally {
  await browser.close();
  server.close();
  rmSync(dl, { recursive: true, force: true });
  for (const f of readdirSync('demo')) if (f.startsWith('__music')) rmSync(resolve('demo', f), { force: true });
}
