// Reusable offscreen sprites + the post-processing chain.
// Everything is cached on first use so the per-frame cost stays tiny.

import { TAU, clamp01, fbm2, mulberry32 } from "../lib/util.js";

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const cache = {};

/* Soft radial sprite used for glows, particles, dust, bokeh. */
export function glowSprite(key, size, stops) {
  const k = `glow:${key}:${size}`;
  if (cache[k]) return cache[k];
  const c = makeCanvas(size, size);
  const x = c.getContext("2d");
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  cache[k] = c;
  return c;
}

/* A soft, cloudy sprite for mist / smoke — fbm modulated alpha. */
export function mistSprite(key, size, seed = 1) {
  const k = `mist:${key}:${size}`;
  if (cache[k]) return cache[k];
  const c = makeCanvas(size, size);
  const x = c.getContext("2d");
  const img = x.createImageData(size, size);
  const d = img.data;
  const rng = mulberry32(seed);
  const off = rng() * 100;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const u = xx / size;
      const v = y / size;
      // fbm + radial falloff
      let n = fbm2(u * 3.1 + off, v * 3.1 + off, 5) * 0.5 + 0.5;
      n = Math.pow(n, 1.5);
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2;
      const fall = clamp01(1 - Math.sqrt(dx * dx + dy * dy));
      const a = Math.pow(fall, 1.7) * n;
      const i = (y * size + xx) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = a * 255;
    }
  }
  x.putImageData(img, 0, 0);
  cache[k] = c;
  return c;
}

/* Tileable monochrome grain. Drawn with 'overlay' at very low alpha. */
export function grainTile(size = 512, seed = 7) {
  const k = `grain:${size}:${seed}`;
  if (cache[k]) return cache[k];
  const c = makeCanvas(size, size);
  const x = c.getContext("2d");
  const img = x.createImageData(size, size);
  const d = img.data;
  const rng = mulberry32(seed);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (rng() - 0.5) * 160;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  cache[k] = c;
  return c;
}

/* Pre-baked god-ray wedge sprite: bright at the gate edge, fading out. */
export function raySprite(size = 512, seed = 3) {
  const k = `rays:${size}:${seed}`;
  if (cache[k]) return cache[k];
  const c = makeCanvas(size, size);
  const x = c.getContext("2d");
  const img = x.createImageData(size, size);
  const d = img.data;
  const rng = mulberry32(seed);
  const seed2 = rng() * 50;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const u = xx / size - 0.5;
      const v = y / size; // 0 = centre of gate, 1 = outer edge
      const ang = Math.atan2(u, 0.0001);
      const r = Math.min(0.5, Math.abs(u));
      // angular rays, noisier further out
      const n = fbm2(u * 9 + seed2, v * 1.2, 4) * 0.5 + 0.5;
      const ray = Math.pow(clamp01(n * 1.25 - 0.15), 2.0);
      // vertical falloff: strongest just outside the gate rim
      const fall = Math.exp(-Math.pow((v - 0.12) / 0.42, 2)) * (1 - v * 0.35);
      const a = ray * fall;
      const i = (y * size + xx) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = Math.pow(clamp01(a), 1.2) * 255;
    }
  }
  x.putImageData(img, 0, 0);
  cache[k] = c;
  return c;
}

/* ------------------------------------------------------------------ *
 *  Bloom / glow chain
 * ------------------------------------------------------------------ */
export function makeBloom(scaleSmall, scaleTiny) {
  const a = makeCanvas(1, 1), b = makeCanvas(1, 1);
  let sw = 0, sh = 0, tw = 0, th = 0;
  return {
    resize(w, h) {
      sw = Math.max(1, Math.round(w / scaleSmall));
      sh = Math.max(1, Math.round(h / scaleSmall));
      tw = Math.max(1, Math.round(w / scaleTiny));
      th = Math.max(1, Math.round(h / scaleTiny));
      a.width = sw; a.height = sh;
      b.width = tw; b.height = th;
    },
    /* Extract the bright parts of `src` (approx: multiply the image by itself,
     * i.e. square the colour response) into the small buffer `b`. */
    extract(src, srcW, srcH, passes = 1) {
      const x = b.getContext("2d");
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = "high";
      x.clearRect(0, 0, tw, th);
      x.globalCompositeOperation = "source-over";
      x.drawImage(src, 0, 0, srcW, srcH, 0, 0, tw, th);
      x.globalCompositeOperation = "multiply";
      for (let i = 0; i < passes; i++) x.drawImage(b, 0, 0);
      x.globalCompositeOperation = "source-over";
      return b;
    },
    /* Blurred copy of b at radius r (into a).
     *
     * b is the small (scaleTiny) buffer and a is the larger (scaleSmall) one,
     * so b MUST be scaled up to fill a. Drawing it 1:1 leaves the glow in the
     * top-left quarter of a, and stretching `a` back up to full frame then
     * stamps a quarter-scale, top-left-anchored ghost of the whole plate onto
     * the image — which reads as a phantom second sword. */
    blur(radius) {
      const x = a.getContext("2d");
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = "high";
      x.clearRect(0, 0, sw, sh);
      x.filter = `blur(${radius}px)`;
      x.drawImage(b, 0, 0, b.width, b.height, 0, 0, sw, sh);
      x.filter = "none";
      return a;
    },
    /* Horizontal-only streak (anamorphic) — cheap multi-tap box blur in 1 axis. */
    streak(taps = 11, spread = 26) {
      const x = a.getContext("2d");
      x.clearRect(0, 0, sw, sh);
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = "high";
      x.globalAlpha = 1 / taps;
      const sx = sw / b.width;
      const sy = sh / b.height;
      for (let i = 0; i < taps; i++) {
        const t = (i / (taps - 1) - 0.5) * 2;
        x.drawImage(b, 0, 0, b.width, b.height, t * spread * sx, 0, sw, sh);
      }
      x.globalAlpha = 1;
      return a;
    },
    /* The raw small bright-pass buffer, for debugging. */
    bright() { return b; },
  };
}

/* ------------------------------------------------------------------ *
 *  Chromatic aberration — a shockwave lens.
 *
 *  Rather than pulling the image apart into R/G/B (which loses energy and
 *  skews the colour), two tinted copies are re-added on top of the intact
 *  frame with 'lighter': one pushed outwards, one inwards. The result is a
 *  fringe that grows with the radius and never darkens the plate.
 * ------------------------------------------------------------------ */
export function makeSplitter() {
  const cc = makeCanvas(1, 1);
  const red = makeCanvas(1, 1);
  const grn = makeCanvas(1, 1);
  const blu = makeCanvas(1, 1);
  const fringe = makeCanvas(1, 1);
  return {
    resize(w, h) {
      for (const c of [cc, red, grn, blu, fringe]) {
        c.width = w; c.height = h;
      }
    },

    /**
     * Lateral chromatic aberration.
     *
     * The frame is split into three single-channel plates; the red plate is
     * scaled outward and the blue plate inward, and then the three are summed.
     * Summing channel plates is what keeps the result neutral: each pixel of
     * the output takes its red, green and blue from exactly one plate, so a
     * white pixel stays white and a dark pixel stays dark. Adding a red-tinted
     * *copy* and a blue-tinted *copy* instead double-counts both channels and
     * turns every bright pixel magenta.
     */
    apply(frame, ctx, w, h, amount, cx, cy, radius) {
      if (amount <= 0.05) return;
      const plate = (target, tint) => {
        const t = target.getContext("2d");
        t.globalCompositeOperation = "source-over";
        t.globalAlpha = 1;
        t.clearRect(0, 0, w, h);
        t.drawImage(frame, 0, 0);
        t.globalCompositeOperation = "multiply";
        t.fillStyle = tint;
        t.fillRect(0, 0, w, h);
        t.globalCompositeOperation = "source-over";
      };
      plate(red, "#ff0000");
      plate(grn, "#00ff00");
      plate(blu, "#0000ff");

      const fx = fringe.getContext("2d");
      fx.globalCompositeOperation = "source-over";
      fx.globalAlpha = 1;
      fx.clearRect(0, 0, w, h);
      fx.drawImage(grn, 0, 0);            // green stays put: the reference plate

      const kOut = 1 + (amount / radius) * 1.6;
      const kIn = 1 - (amount / radius) * 1.6;
      const shift = amount * 0.6;

      fx.globalCompositeOperation = "lighter";
      fx.save();
      fx.translate(cx, cy); fx.scale(kOut, kOut); fx.translate(-cx, -cy);
      fx.drawImage(red, shift, shift * 0.3);
      fx.restore();
      fx.save();
      fx.translate(cx, cy); fx.scale(kIn, kIn); fx.translate(-cx, -cy);
      fx.drawImage(blu, -shift, -shift * 0.3);
      fx.restore();

      // The plate is summed on a black background, so it carries the whole
      // scene, not just the fringe. ADDING it would double every bright pixel.
      // It is instead mixed back over the original through a mask, which is
      // what aberration actually is: same energy, different channel offsets.
      const mask = fx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius * 1.25);
      mask.addColorStop(0, "rgba(255,255,255,0.30)");
      mask.addColorStop(0.34, "rgba(255,255,255,0.52)");
      mask.addColorStop(0.72, "rgba(255,255,255,0.16)");
      mask.addColorStop(1, "rgba(255,255,255,0)");
      fx.globalCompositeOperation = "destination-in";
      fx.fillStyle = mask;
      fx.fillRect(0, 0, w, h);
      fx.globalCompositeOperation = "source-over";

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(fringe, 0, 0);
      ctx.restore();
    },
  };
}
