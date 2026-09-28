/* Draws every output frame: gradient backdrop, browser-window frame around the captured UI,
   slow zoom/pan, kinetic captions, full-screen cards, progress bar and cross-fades.
   Runs in the page during encoding. */
(function () {
  const ACCENT = '#ff9900';
  const INK = '#ffffff';
  const DIM = '#c9d4e3';
  const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;

  // Static on purpose: an animated backdrop changes every pixel every frame and multiplies
  // the encoded size for a gradient nobody looks at.
  function backdrop(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0b1220');
    g.addColorStop(0.55, '#111c33');
    g.addColorStop(1, '#16213a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const bloom = (cx, cy, r, a) => {
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, `rgba(255,153,0,${a})`);
      rg.addColorStop(1, 'rgba(255,153,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    };
    bloom(W * 0.12, H * 0.16, W * 0.5, 0.11);
    bloom(W * 0.90, H * 0.92, W * 0.45, 0.07);
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));   // a pill radius must not exceed the box
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Motion presets: [scale, cx, cy] where cx/cy are the focal point in 0..1 of the shot.
  // The window is wider than 16:9, so the crop always loses some height. Keep the focal point
  // high enough that it clamps to the top edge: the file name and toolbar must never be cut,
  // and losing rows off the bottom of a long table costs nothing.
  const MOTION = {
    none:      { from: [1.00, 0.50, 0.30], to: [1.00, 0.50, 0.30] },
    zoomIn:    { from: [1.00, 0.50, 0.30], to: [1.05, 0.50, 0.31] },
    zoomOut:   { from: [1.05, 0.50, 0.31], to: [1.00, 0.50, 0.30] },
    zoomTop:   { from: [1.00, 0.50, 0.26], to: [1.06, 0.50, 0.24] },
    zoomRow:   { from: [1.00, 0.48, 0.31], to: [1.06, 0.45, 0.30] },
    zoomRight: { from: [1.00, 0.56, 0.28], to: [1.06, 0.62, 0.27] },
  };

  /** Full-bleed UI: the screenshot fills the canvas, with only a gentle drift. Nothing is
      cropped at scale 1, so the UI stays as readable as the raw capture. */
  function drawStageFull(ctx, W, H, bmp, motion, t) {
    const m = MOTION[motion] || MOTION.none;
    const k = easeOut(clamp01(t));
    const scale = 1 + ((m.from[0] - 1) + ((m.to[0] - 1) - (m.from[0] - 1)) * k) * 0.6;
    const cx = m.from[1] + (m.to[1] - m.from[1]) * k;
    const cw = bmp.width / scale, ch = bmp.height / scale;
    let sx = cx * bmp.width - cw / 2;
    let sy = (bmp.height - ch) * 0.18;                 // drift from just below the top
    sx = Math.max(0, Math.min(bmp.width - cw, sx));
    ctx.drawImage(bmp, sx, sy, cw, ch, 0, 0, W, H);
  }

  /** The captured UI inside a browser window frame, scaled and panned. */
  function drawStage(ctx, W, H, bmp, motion, t) {
    const m = MOTION[motion] || MOTION.none;
    const k = easeOut(clamp01(t));
    const scale = m.from[0] + (m.to[0] - m.from[0]) * k;
    const cx = m.from[1] + (m.to[1] - m.from[1]) * k;
    const cy = m.from[2] + (m.to[2] - m.from[2]) * k;

    // window geometry
    const pad = 46, capH = 30;
    const fw = W - pad * 2;
    const fh = H - pad * 2 - 84;               // leave room for captions
    const fx = pad, fy = pad - 8;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 42;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#0d1424';
    roundRect(ctx, fx, fy, fw, fh, 14);
    ctx.fill();
    ctx.restore();

    // title bar
    ctx.save();
    roundRect(ctx, fx, fy, fw, fh, 14);
    ctx.clip();
    ctx.fillStyle = '#1b2740';
    ctx.fillRect(fx, fy, fw, capH);
    const dots = ['#ff5f57', '#febc2e', '#28c840'];
    dots.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(fx + 20 + i * 17, fy + capH / 2, 5.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,.34)';
    roundRect(ctx, fx + 96, fy + 8, fw - 150, capH - 16, 7);
    ctx.fill();

    // the screenshot, cropped to the focal point
    const vw = fw, vh = fh - capH;
    const sw = bmp.width / scale, sh = bmp.height / scale;
    const ar = vw / vh;
    let cw = sw, ch = sw / ar;
    if (ch > sh) { ch = sh; cw = sh * ar; }
    let sx = cx * bmp.width - cw / 2;
    let sy = cy * bmp.height - ch / 2;
    sx = Math.max(0, Math.min(bmp.width - cw, sx));
    sy = Math.max(0, Math.min(bmp.height - ch, sy));
    ctx.drawImage(bmp, sx, sy, cw, ch, fx, fy + capH, vw, vh);
    ctx.restore();

    // hairline
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    roundRect(ctx, fx + .5, fy + .5, fw - 1, fh - 1, 14);
    ctx.stroke();
  }

  function fitText(ctx, text, max, size, weight) {
    let s = size;
    for (;;) {
      ctx.font = `${weight} ${s}px ${FONT}`;
      if (ctx.measureText(text).width <= max || s <= 16) return s;
      s -= 2;
    }
  }

  function wrap(ctx, text, max) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** Kinetic band: a scrim, an oversized ghost word, accent rules and the headline.
      Used by the full-bleed style, where text sits over the UI rather than beneath it. */
  function drawKinetic(ctx, W, H, b, tMs) {
    if (!b.title && !b.sub) return;
    const bandTop = H - 210;
    const anim = (d, dur) => easeOut(clamp01((tMs - d) / dur));

    const g = ctx.createLinearGradient(0, bandTop - 40, 0, H);
    g.addColorStop(0, 'rgba(8,12,22,0)');
    g.addColorStop(0.34, 'rgba(8,12,22,.72)');
    g.addColorStop(0.58, 'rgba(8,12,22,.93)');
    g.addColorStop(1, 'rgba(8,12,22,.99)');
    ctx.fillStyle = g;
    ctx.fillRect(0, bandTop - 40, W, H - bandTop + 40);

    // oversized ghost word, drifting slowly, deliberately bleeding off both edges
    if (b.word) {
      const a = anim(0, 600);
      ctx.save();
      ctx.globalAlpha = 0.10 * a;
      ctx.font = `700 168px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(b.word, W / 2 + (1 - a) * 40, H - 84);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    const x = 70, baseY = H - 92;
    if (b.kicker) {
      const a = anim(60, 260);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `700 13px ${FONT}`;
      ctx.letterSpacing = '3px';
      ctx.fillStyle = ACCENT;
      ctx.fillText(b.kicker.toUpperCase(), x, baseY - 40);
      ctx.letterSpacing = '0px';
      const w = ctx.measureText(b.kicker.toUpperCase()).width;
      ctx.fillRect(x, baseY - 32, w * a, 3);           // accent rule wipes in
      ctx.restore();
    }
    if (b.title) {
      const a = anim(120, 340);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate((1 - a) * -28, 0);
      const size = fitText(ctx, b.title, W - 140, 46, 700);
      ctx.font = `700 ${size}px ${FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(b.title, x, baseY);
      ctx.restore();
    }
    if (b.sub) {
      const a = anim(260, 340);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate((1 - a) * -18, 0);
      ctx.font = `400 19px ${FONT}`;
      ctx.fillStyle = DIM;
      ctx.fillText(b.sub, x, baseY + 32);
      ctx.restore();
    }
  }

  /** Kinetic caption: staggered slide-and-fade entrance. */
  function drawCaption(ctx, W, H, b, tMs) {
    if (!b.title && !b.sub) return;
    const baseY = H - 104;
    const x = 66;
    const maxW = W - 132;
    const anim = (delay, dur) => easeOut(clamp01((tMs - delay) / dur));

    if (b.kicker) {
      const a = anim(0, 260);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(0, (1 - a) * 12);
      ctx.font = `600 13px ${FONT}`;
      ctx.letterSpacing = '2.4px';
      ctx.fillStyle = ACCENT;
      ctx.fillText(b.kicker.toUpperCase(), x, baseY - 34);
      ctx.letterSpacing = '0px';
      ctx.restore();
    }
    if (b.title) {
      const a = anim(90, 320);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(0, (1 - a) * 26);
      const size = fitText(ctx, b.title, maxW, 40, 700);
      ctx.font = `700 ${size}px ${FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(b.title, x, baseY);
      ctx.restore();
    }
    if (b.sub) {
      const a = anim(210, 320);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(0, (1 - a) * 16);
      ctx.font = `400 18px ${FONT}`;
      ctx.fillStyle = DIM;
      ctx.fillText(b.sub, x, baseY + 30);
      ctx.restore();
    }
  }

  function drawCard(ctx, W, H, b, tMs, icon) {
    const anim = (delay, dur) => easeOut(clamp01((tMs - delay) / dur));
    ctx.textAlign = 'center';
    const cx = W / 2;

    if (b.style === 'title' || b.style === 'end') {
      const a0 = anim(0, 420);
      if (icon) {
        const s = 108 * (0.86 + 0.14 * a0);
        ctx.save();
        ctx.globalAlpha = a0;
        ctx.shadowColor = 'rgba(255,153,0,.35)'; ctx.shadowBlur = 40;
        ctx.drawImage(icon, cx - s / 2, H * 0.27 - s / 2, s, s);
        ctx.restore();
      }
      const a1 = anim(140, 380);
      ctx.save();
      ctx.globalAlpha = a1;
      ctx.translate(0, (1 - a1) * 22);
      ctx.font = `700 60px ${FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(b.title, cx, H * 0.53);
      ctx.restore();

      const a2 = anim(280, 380);
      ctx.save();
      ctx.globalAlpha = a2;
      ctx.translate(0, (1 - a2) * 14);
      ctx.font = `400 21px ${FONT}`;
      ctx.fillStyle = DIM;
      ctx.fillText(b.sub, cx, H * 0.53 + 44);
      ctx.restore();

      if (b.stores) {
        const a3 = anim(420, 380);
        ctx.save();
        ctx.globalAlpha = a3;
        ctx.translate(0, (1 - a3) * 14);
        ctx.font = `500 19px ${FONT}`;
        const gap = 18;
        const ws = b.stores.map(s => ctx.measureText(s).width + 44);
        let tx = cx - (ws.reduce((a, b2) => a + b2, 0) + gap * (ws.length - 1)) / 2;
        b.stores.forEach((s, i) => {
          ctx.fillStyle = 'rgba(255,255,255,.07)';
          roundRect(ctx, tx, H * 0.70, ws[i], 46, 12);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.18)';
          ctx.stroke();
          ctx.fillStyle = INK;
          ctx.fillText(s, tx + ws[i] / 2, H * 0.70 + 30);
          tx += ws[i] + gap;
        });
        ctx.restore();
      }
      ctx.textAlign = 'left';
      return;
    }

    // heading shared by tags/rows cards
    const a1 = anim(0, 360);
    ctx.save();
    ctx.globalAlpha = a1;
    ctx.translate(0, (1 - a1) * 20);
    ctx.font = `700 44px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(b.title, cx, b.style === 'tags' ? 150 : 170);
    ctx.restore();

    if (b.style === 'tags') {
      ctx.font = `500 19px ${FONT}`;
      const gapX = 11, gapY = 13, padX = 19, hgt = 40, maxW = W - 180;
      const rows = [[]];
      let rw = 0;
      for (const t of b.tags) {
        const w = ctx.measureText(t).width + padX * 2;
        if (rw + w > maxW && rows[rows.length - 1].length) { rows.push([]); rw = 0; }
        rows[rows.length - 1].push({ t, w });
        rw += w + gapX;
      }
      // centre the pill block plus its caption in the space under the heading
      const blockH = rows.length * hgt + (rows.length - 1) * gapY + 60;
      let y = 190 + Math.max(0, (H - 190 - 60 - blockH) / 2);
      let idx = 0;
      for (const row of rows) {
        const tw = row.reduce((a, r) => a + r.w, 0) + gapX * (row.length - 1);
        let tx = cx - tw / 2;
        for (const r of row) {
          const a = anim(160 + idx * 26, 300);   // tags pop in sequence
          ctx.save();
          ctx.globalAlpha = a;
          const sc = 0.9 + 0.1 * a;
          ctx.translate(tx + r.w / 2, y + hgt / 2);
          ctx.scale(sc, sc);
          ctx.translate(-(tx + r.w / 2), -(y + hgt / 2));
          ctx.fillStyle = 'rgba(255,153,0,.13)';
          roundRect(ctx, tx, y, r.w, hgt, 999);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,153,0,.34)';
          ctx.stroke();
          ctx.fillStyle = '#ffb44d';
          ctx.fillText(r.t, tx + r.w / 2, y + 26);
          ctx.restore();
          tx += r.w + gapX;
          idx++;
        }
        y += hgt + gapY;
      }
      const a = anim(160 + idx * 26, 340);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `400 19px ${FONT}`;
      ctx.fillStyle = DIM;
      ctx.fillText(b.sub, cx, y + 34);
      ctx.restore();
    }

    if (b.style === 'rows') {
      let y = 258;
      b.rows.forEach((r, i) => {
        const a = anim(180 + i * 130, 340);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate((1 - a) * -26, 0);
        ctx.font = `700 30px ${FONT}`;
        ctx.fillStyle = ACCENT;
        const noW = ctx.measureText('No ').width;
        const lblW = (ctx.font = `400 30px ${FONT}`, ctx.measureText(r).width);
        const startX = cx - (noW + lblW) / 2;
        ctx.textAlign = 'left';
        ctx.font = `700 30px ${FONT}`;
        ctx.fillStyle = ACCENT;
        ctx.fillText('No ', startX, y);
        ctx.font = `400 30px ${FONT}`;
        ctx.fillStyle = '#e8eef7';
        ctx.fillText(r, startX + noW, y);
        ctx.textAlign = 'center';
        ctx.restore();
        y += 52;
      });
      const a = anim(180 + b.rows.length * 130, 340);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `400 19px ${FONT}`;
      ctx.fillStyle = DIM;
      ctx.fillText(b.sub, cx, y + 26);
      ctx.restore();
    }
    ctx.textAlign = 'left';
  }

  function drawProgress(ctx, W, H, p) {
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(0, H - 4, W, 4);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, H - 4, W * p, 4);
  }

  window.DemoCompose = { backdrop, drawStage, drawStageFull, drawCaption, drawKinetic, drawCard, drawProgress };
})();
