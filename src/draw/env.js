// Environment: the stone hall, the moon gate, the altar block, floor and depth.
// The gate is the only real light source, so everything else is lit by it.

import { TAU, clamp, clamp01, lerp, rgba, smoothstep, fbm2, noise1, mulberry32 } from "../lib/util.js";
import {
  W, H, FLOOR_Y, GATE, T, embers, bokeh, pose, BLADE_LEN, impactPoint,
} from "../scene.js";
import { makeCanvas, glowSprite, mistSprite } from "./gfx.js";

/* ---------------------------------------------------------------- *
 *  A low-res layer used for the defocused foreground.
 * ---------------------------------------------------------------- */
export function makeLayer(scale) {
  const canvas = makeCanvas(W / scale, H / scale);
  const ctx = canvas.getContext("2d");
  return {
    canvas,
    ctx,
    scale,
    begin() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(1 / scale, 0, 0, 1 / scale, 0, 0);
    },
  };
}

/* ---------------------------------------------------------------- *
 *  Wall
 * ---------------------------------------------------------------- */
export function drawSky(ctx, t) {
  // base gradient
  const g = ctx.createLinearGradient(0, -160, 0, FLOOR_Y);
  g.addColorStop(0, "#02040a");
  g.addColorStop(0.40, "#04070f");
  g.addColorStop(0.75, "#070b16");
  g.addColorStop(1, "#0a101c");
  ctx.fillStyle = g;
  ctx.fillRect(-240, -240, W + 480, FLOOR_Y + 240);

  // the wall brightens where the gate's light falls
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const pool = ctx.createRadialGradient(GATE.x + 40, GATE.y + 190, 60, GATE.x + 40, GATE.y + 190, 1080);
  pool.addColorStop(0, "rgba(74,104,166,0.10)");
  pool.addColorStop(0.32, "rgba(44,64,112,0.07)");
  pool.addColorStop(0.7, "rgba(20,32,64,0.025)");
  pool.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(-240, -240, W + 480, FLOOR_Y + 240);
  ctx.restore();

  // stone mottling
  ctx.save();
  ctx.globalAlpha = 0.075;
  ctx.globalCompositeOperation = "overlay";
  const m = mistSprite("wall", 512, 11);
  for (let i = 0; i < 5; i++) {
    ctx.drawImage(m, -400 + i * 480, -220, 940, 800);
  }
  ctx.restore();

  // masonry: 4 courses, very low contrast, only where they can be read
  ctx.save();
  const courses = [110, 288, 466, 644, 820];
  const bands = [[-260, 2100]];
  for (let c = 0; c < courses.length - 1; c++) {
    const y0 = courses[c];
    const y1 = courses[c + 1];
    for (const [bx0, bx1] of bands) {
      ctx.beginPath();
      ctx.moveTo(bx0, y0);
      ctx.lineTo(bx1, y0);
      ctx.strokeStyle = "rgba(2,4,9,0.5)";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx0, y0 + 2.5);
      ctx.lineTo(bx1, y0 + 2.5);
      ctx.strokeStyle = "rgba(120,150,205,0.055)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const off = (c % 2) * 240;
      ctx.strokeStyle = "rgba(2,4,9,0.28)";
      ctx.lineWidth = 2;
      for (let x = bx0 + off; x < bx1; x += 480) {
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // A heavy column in the left third: it gives the wall scale, adds a dark
  // foreground anchor, and its lit right edge echoes the gate's ring.
  const px0 = 118, px1 = 392;
  const capY = 96;
  const pg = ctx.createLinearGradient(px0, 0, px1, 0);
  pg.addColorStop(0, "#010104");
  pg.addColorStop(0.5, "#04060c");
  pg.addColorStop(0.86, "#080d18");
  pg.addColorStop(1, "#0e1524");
  ctx.fillStyle = pg;
  ctx.fillRect(px0, -240, px1 - px0, FLOOR_Y + 240 - capY);
  // capital
  ctx.fillStyle = "#070b14";
  ctx.fillRect(px0 - 22, capY, px1 - px0 + 44, 42);
  ctx.fillRect(px0 - 14, capY - 16, px1 - px0 + 28, 18);
  // base
  ctx.fillStyle = "#060a13";
  ctx.fillRect(px0 - 26, FLOOR_Y - 54, px1 - px0 + 52, 56);
  ctx.fillStyle = "rgba(120,158,220,0.14)";
  ctx.fillRect(px0 - 26, FLOOR_Y - 56, px1 - px0 + 52, 2.5);
  // fluting
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const fx = px0 + 40 + i * 62;
    const fgd = ctx.createLinearGradient(fx, 0, fx + 22, 0);
    fgd.addColorStop(0, "rgba(0,0,0,0.6)");
    fgd.addColorStop(0.6, "rgba(0,0,0,0.15)");
    fgd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fgd;
    ctx.fillRect(fx, capY + 42, 22, FLOOR_Y - capY - 96);
  }
  ctx.restore();
  // lit edge facing the gate
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const crg = ctx.createLinearGradient(px1 - 26, 0, px1 + 6, 0);
  crg.addColorStop(0, "rgba(150,190,250,0)");
  crg.addColorStop(0.72, "rgba(150,190,250,0.14)");
  crg.addColorStop(1, "rgba(190,220,255,0.26)");
  ctx.fillStyle = crg;
  ctx.fillRect(px1 - 26, capY + 42, 32, FLOOR_Y - capY - 96);
  ctx.fillStyle = "rgba(190,220,255,0.20)";
  ctx.fillRect(px0 - 14, capY - 15.5, px1 - px0 + 28, 1.4);
  ctx.restore();
}

/* ---------------------------------------------------------------- *
 *  God rays from the gate
 * ---------------------------------------------------------------- */
let rayCache = null;
function rays() {
  if (rayCache) return rayCache;
  const size = 512;
  const c = makeCanvas(size, size);
  const x = c.getContext("2d");
  const img = x.createImageData(size, size);
  const d = img.data;
  const seed = 21.7;
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const u = (xx / size - 0.5) * 2;
      const v = (y / size - 0.5) * 2;
      const r = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      const n = fbm2(Math.cos(ang) * 2.2 + seed, Math.sin(ang) * 2.2 - seed, 5) * 0.5 + 0.5;
      const spokes = Math.pow(clamp01(n * 1.55 - 0.3), 1.9);
      const outer = Math.exp(-Math.pow((r - 0.64) / 0.40, 2));
      const inner = 1 - Math.exp(-Math.pow(Math.max(0, r - 0.18) / 0.17, 2));
      const a = spokes * outer * inner;
      const i = (y * size + xx) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
      d[i + 3] = Math.pow(clamp01(a), 1.3) * 255;
    }
  }
  x.putImageData(img, 0, 0);
  rayCache = c;
  return c;
}

/* ---------------------------------------------------------------- *
 *  The moon gate
 * ---------------------------------------------------------------- */
export function drawGate(ctx, t, energy = 1) {
  const { x: gx, y: gy, r } = GATE;
  const flick = 1 + 0.02 * noise1(t * 1.7) + 0.012 * noise1(t * 5.3);

  // 1. broad external halo
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.42 * energy;
  ctx.drawImage(glowSprite("gatehalo", 512, [
    [0, "rgba(150,188,255,0.60)"],
    [0.24, "rgba(96,136,220,0.30)"],
    [0.55, "rgba(40,64,128,0.10)"],
    [1, "rgba(0,0,0,0)"],
  ]), gx - r * 3.2, gy - r * 3.2, r * 6.4, r * 6.4);
  ctx.restore();

  // 2. the disc: what is seen *through* the gate
  ctx.save();
  ctx.beginPath();
  ctx.arc(gx, gy, r - 9, 0, TAU);
  ctx.clip();
  const dg = ctx.createRadialGradient(gx - r * 0.24, gy - r * 0.30, 8, gx, gy, r);
  dg.addColorStop(0, "rgba(198,220,255,0.62)");
  dg.addColorStop(0.30, "rgba(132,172,240,0.40)");
  dg.addColorStop(0.62, "rgba(72,110,190,0.22)");
  dg.addColorStop(1, "rgba(34,54,110,0.30)");
  ctx.fillStyle = dg;
  ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
  const m = mistSprite("gatehaze", 512, 5);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 3; i++) {
    const s = 1.5 + i * 0.7;
    ctx.globalAlpha = 0.075 - i * 0.017;
    ctx.drawImage(m,
      gx - r * s + Math.sin(t * (0.12 + i * 0.05) + i) * 40,
      gy - r * s + Math.cos(t * (0.09 + i * 0.04) + i * 2) * 30,
      r * 2 * s, r * 2 * s);
  }
  ctx.restore();

  // 3. hot core + anamorphic flare
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const core = glowSprite("gatecore", 256, [
    [0, "rgba(255,255,255,0.85)"],
    [0.16, "rgba(214,232,255,0.42)"],
    [0.48, "rgba(130,176,255,0.12)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  ctx.globalAlpha = 0.50 * energy * flick;
  ctx.drawImage(core, gx - r * 0.98, gy - r * 1.06, r * 1.96, r * 1.96);
  ctx.globalAlpha = 0.20 * energy;
  ctx.save();
  ctx.translate(gx, gy - r * 0.08);
  ctx.scale(1, 0.05);
  ctx.drawImage(core, -r * 2.6, -r * 1.0, r * 5.2, r * 2.0);
  ctx.restore();
  ctx.restore();

  // 4. rays
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.20 * energy;
  ctx.translate(gx, gy);
  ctx.rotate(0.06 + Math.sin(t * 0.07) * 0.03);
  const R = r * 3.0;
  ctx.drawImage(rays(), -R, -R, R * 2, R * 2);
  ctx.globalAlpha = 0.10 * energy;
  ctx.rotate(-0.42 + Math.sin(t * 0.05 + 1) * 0.02);
  ctx.drawImage(rays(), -R * 0.62, -R * 0.62, R * 1.24, R * 1.24);
  ctx.restore();

  // 5. the ring
  ctx.save();
  const ringGrad = ctx.createLinearGradient(gx - r, gy - r, gx + r, gy + r);
  ringGrad.addColorStop(0, "rgba(255,250,238,0.92)");
  ringGrad.addColorStop(0.38, "rgba(206,224,255,0.72)");
  ringGrad.addColorStop(0.72, "rgba(146,178,240,0.60)");
  ringGrad.addColorStop(1, "rgba(112,144,214,0.66)");
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.arc(gx, gy, r, 0, TAU);
  ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(gx, gy, r - 5, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(150,190,255,0.20)";
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.arc(gx, gy, r + 5, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(8,12,28,0.55)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(gx, gy, r - 10, -0.4, 1.95);
  ctx.stroke();
  // small studs around the rim
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + 0.13;
    const lit = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(a + 2.2));
    ctx.beginPath();
    ctx.arc(gx + Math.cos(a) * (r + 6), gy + Math.sin(a) * (r + 6), 2.4, 0, TAU);
    ctx.fillStyle = `rgba(255,246,222,${0.22 * lit})`;
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- *
 *  Stonework on the floor: a broken plinth at the far right, rubble across
 *  the middle distance. Everything sits below the strike line so the blade
 *  always has a clean runway down to the floor.
 * ---------------------------------------------------------------- */
export function drawStonework(ctx, t, o = {}) {
  const flash = o.flash ?? 0;
  const rng = mulberry32(0x77aa);

  // ---- a fallen drum of a column lying behind the sword's rest position
  ctx.save();
  const fg = ctx.createLinearGradient(0, 806, 0, 900);
  fg.addColorStop(0, "#1a2338");
  fg.addColorStop(0.35, "#101828");
  fg.addColorStop(1, "#070b14");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-40, 900);
  ctx.lineTo(-40, 838);
  ctx.quadraticCurveTo(150, 800, 330, 852);
  ctx.lineTo(330, 902);
  ctx.closePath();
  ctx.fill();
  // the lit top edge catches the gate
  ctx.beginPath();
  ctx.moveTo(-40, 838);
  ctx.quadraticCurveTo(150, 800, 330, 852);
  ctx.strokeStyle = "rgba(150,190,250,0.20)";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  // fluting on the flanks
  for (let i = 0; i < 6; i++) {
    const px = -20 + i * 62;
    ctx.beginPath();
    ctx.moveTo(px, 902);
    ctx.lineTo(px + 18, 830 + i * 3);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();

  // ---- broken plinth at the right: a step against the wall
  const px0 = 1616, px1 = 1980, pTop = 828;
  const pg = ctx.createLinearGradient(0, pTop, 0, FLOOR_Y + 20);
  pg.addColorStop(0, "#1c2740");
  pg.addColorStop(0.22, "#141c2e");
  pg.addColorStop(0.7, "#0a0f1c");
  pg.addColorStop(1, "#060a12");
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.moveTo(px0, FLOOR_Y + 24);
  ctx.lineTo(px0 + 10, pTop + 6);
  ctx.lineTo(px0 + 74, pTop - 8);
  ctx.lineTo(px1, pTop - 2);
  ctx.lineTo(px1, FLOOR_Y + 24);
  ctx.closePath();
  ctx.fill();
  // its top slab
  const tg = ctx.createLinearGradient(0, pTop - 26, 0, pTop + 4);
  tg.addColorStop(0, "#3f4f6e");
  tg.addColorStop(0.5, "#2b3852");
  tg.addColorStop(1, "#1d2740");
  ctx.beginPath();
  ctx.moveTo(px0 + 10, pTop + 6);
  ctx.lineTo(px0 + 34, pTop - 26);
  ctx.lineTo(px1, pTop - 20);
  ctx.lineTo(px1, pTop - 2);
  ctx.closePath();
  ctx.fillStyle = tg;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(px0 + 10, pTop + 6.5);
  ctx.lineTo(px0 + 34, pTop - 26);
  ctx.lineTo(px1, pTop - 20);
  ctx.strokeStyle = "rgba(196,222,255,0.34)";
  ctx.lineWidth = 1.8;
  ctx.stroke();
  // shadow line where the slab meets the wall
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(px0 + 12, pTop + 7, px1 - px0, 3);
  // chipped corner
  ctx.beginPath();
  ctx.moveTo(px0 + 10, pTop + 6);
  ctx.lineTo(px0 + 46, pTop + 30);
  ctx.lineTo(px0 + 4, pTop + 40);
  ctx.closePath();
  ctx.fillStyle = "#05080f";
  ctx.fill();

  // ---- rubble across the middle distance
  ctx.save();
  for (let i = 0; i < 22; i++) {
    const x = 260 + rng() * 1300;
    const y = FLOOR_Y + 10 + rng() * 120;
    const w = 10 + rng() * 40;
    const h = 5 + rng() * 15;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.55, y - h);
    ctx.lineTo(x + w, y - h * 0.35);
    ctx.lineTo(x + w * 0.8, y + h * 0.4);
    ctx.lineTo(x + w * 0.15, y + h * 0.35);
    ctx.closePath();
    ctx.fillStyle = `rgba(${7 + rng() * 9},${10 + rng() * 11},${18 + rng() * 15},1)`;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.55, y - h);
    ctx.lineTo(x + w, y - h * 0.35);
    ctx.strokeStyle = "rgba(126,162,222,0.13)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  ctx.restore();

  // ---- the cut the blade leaves in the floor
  const ip = impactPoint;
  const dmg = clamp01((t - T.impact + 0.03) / 0.05);
  if (dmg > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ip.x - 190, FLOOR_Y - 60, 380, 200);
    ctx.clip();
    // a wedge knocked out of the stone
    ctx.beginPath();
    ctx.moveTo(ip.x - 62 * dmg, FLOOR_Y - 2);
    ctx.lineTo(ip.x - 22 * dmg, FLOOR_Y + 20 * dmg);
    ctx.lineTo(ip.x + 16 * dmg, FLOOR_Y + 8 * dmg);
    ctx.lineTo(ip.x + 58 * dmg, FLOOR_Y - 1);
    ctx.closePath();
    ctx.fillStyle = "#03050a";
    ctx.fill();
    // cracks radiating along the floor
    ctx.strokeStyle = "rgba(2,4,9,0.85)";
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 9; i++) {
      const a = -0.25 - i * 0.22;
      const len = (44 + Math.abs(noise1(i * 2.7)) * 76) * dmg;
      ctx.beginPath();
      ctx.moveTo(ip.x + noise1(i) * 24, FLOOR_Y + 2);
      ctx.lineTo(ip.x + noise1(i) * 24 + Math.cos(a) * len,
        FLOOR_Y + 2 + Math.abs(Math.sin(a)) * len * 0.35);
      ctx.stroke();
    }
    // molten glow inside the fresh cut, cooling off
    const cool = clamp01(1 - (t - T.impact) / 1.8);
    if (cool > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      const r = 96;
      ctx.globalAlpha = cool * 0.20;
      ctx.drawImage(glowSprite("cut", 128, [
        [0, "rgba(255,246,218,0.95)"],
        [0.3, "rgba(255,170,72,0.55)"],
        [1, "rgba(255,90,20,0)"],
      ]), ip.x - r * 1.4, FLOOR_Y - r * 0.55, r * 2.8, r * 1.1);
    }
    ctx.restore();
  }

  // ---- warm bounce from the strike
  if (flash > 0.004) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp01(flash * 0.10);
    const r = 300;
    ctx.drawImage(glowSprite("strikeflash", 256, [
      [0, "rgba(255,238,200,0.9)"],
      [0.35, "rgba(255,152,62,0.30)"],
      [1, "rgba(255,90,20,0)"],
    ]), ip.x - r, FLOOR_Y - r * 0.5, r * 2, r * 1.15);
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- *
 *  Floor
 * ---------------------------------------------------------------- */
export function drawFloor(ctx, t) {
  const g = ctx.createLinearGradient(0, FLOOR_Y - 4, 0, H + 160);
  g.addColorStop(0, "#0a0f1c");
  g.addColorStop(0.14, "#060a12");
  g.addColorStop(0.55, "#03050a");
  g.addColorStop(1, "#010103");
  ctx.fillStyle = g;
  ctx.fillRect(-240, FLOOR_Y - 1, W + 480, H + 260);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const near = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 80);
  near.addColorStop(0, "rgba(110,144,208,0.10)");
  near.addColorStop(1, "rgba(110,144,208,0)");
  ctx.fillStyle = near;
  ctx.fillRect(-240, FLOOR_Y, W + 480, 80);

  // reflection of the gate stretched down the floor
  ctx.save();
  ctx.beginPath();
  ctx.rect(-240, FLOOR_Y, W + 480, H + 260 - FLOOR_Y);
  ctx.clip();
  const refl = ctx.createRadialGradient(GATE.x, FLOOR_Y + 30, 8, GATE.x, FLOOR_Y + 30, GATE.r * 1.45);
  refl.addColorStop(0, "rgba(158,196,255,0.17)");
  refl.addColorStop(0.4, "rgba(96,136,214,0.075)");
  refl.addColorStop(1, "rgba(36,64,130,0)");
  ctx.save();
  ctx.translate(GATE.x, FLOOR_Y);
  ctx.scale(1, 3.2);
  ctx.translate(-GATE.x, -FLOOR_Y);
  ctx.fillStyle = refl;
  ctx.fillRect(GATE.x - GATE.r * 2.6, FLOOR_Y - 4, GATE.r * 5.2, GATE.r * 2.4);
  ctx.restore();

  // vertical smears on the polished stone
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i++) {
    const px = GATE.x + Math.sin(i * 12.9898) * GATE.r * 1.3;
    const w = 6 + Math.abs(Math.sin(i * 4.1)) * 20;
    const a = 0.035 * (0.4 + 0.6 * Math.abs(Math.cos(i * 2.3)));
    const sg = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    sg.addColorStop(0, `rgba(172,204,255,${a})`);
    sg.addColorStop(1, "rgba(150,190,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(px - w / 2, FLOOR_Y, w, H - FLOOR_Y + 40);
  }
  ctx.restore();

  // perspective joints
  ctx.save();
  ctx.beginPath();
  ctx.rect(-240, FLOOR_Y, W + 480, H + 260 - FLOOR_Y);
  ctx.clip();
  const vpx = 1020;
  for (const [d, lw] of [[64, 1.4], [136, 1.9], [238, 2.6], [388, 3.6]]) {
    ctx.lineWidth = lw * 0.5;
    ctx.strokeStyle = "rgba(3,5,10,0.55)";
    ctx.beginPath();
    ctx.moveTo(-240, FLOOR_Y + d);
    ctx.lineTo(W + 240, FLOOR_Y + d);
    ctx.stroke();
  }
  ctx.lineWidth = 1.0;
  for (let i = -9; i <= 9; i++) {
    const x0 = vpx + i * 250;
    const x1 = vpx + i * 250 * 3.8;
    ctx.strokeStyle = "rgba(3,5,10,0.38)";
    ctx.beginPath();
    ctx.moveTo(x0, FLOOR_Y);
    ctx.lineTo(x1, H + 120);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

/* ---------------------------------------------------------------- *
 *  Fog banks that give the hall depth
 * ---------------------------------------------------------------- */
export function drawMist(ctx, t) {
  const banks = [
    { y: FLOOR_Y + 24, s: 2.6, a: 0.055, sp: 9, seed: 1 },
    { y: FLOOR_Y - 44, s: 3.6, a: 0.038, sp: 14, seed: 2 },
    { y: FLOOR_Y - 210, s: 5.0, a: 0.024, sp: 6, seed: 3 },
  ];
  ctx.save();
  for (const b of banks) {
    const m = mistSprite("fog" + b.seed, 512, b.seed * 13);
    for (let i = 0; i < 4; i++) {
      const x = ((i * 560 + t * b.sp + b.seed * 300) % (W + 900)) - 450;
      ctx.globalAlpha = b.a * (0.6 + 0.4 * Math.sin(t * 0.2 + i + b.seed));
      const w = 900 * b.s * 0.35;
      ctx.drawImage(m, x, b.y - w * 0.28, w, w * 0.56);
    }
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- *
 *  Atmosphere: embers, bokeh
 * ---------------------------------------------------------------- */
export function drawAtmosphere(ctx, t) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const spr = glowSprite("ember", 32, [
    [0, "rgba(255,226,180,0.9)"],
    [0.4, "rgba(255,170,90,0.32)"],
    [1, "rgba(255,120,40,0)"],
  ]);
  for (const e of embers(t)) {
    ctx.globalAlpha = e.a * 0.42;
    const s = e.r * 6;
    ctx.drawImage(spr, e.x - s / 2, e.y - s / 2, s, s);
  }
  const bk = glowSprite("bokeh", 128, [
    [0, "rgba(150,190,255,0.20)"],
    [0.55, "rgba(120,165,240,0.09)"],
    [1, "rgba(90,130,220,0)"],
  ]);
  for (const b of bokeh(t)) {
    ctx.globalAlpha = b.a;
    ctx.drawImage(bk, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- *
 *  Defocused foreground rocks
 * ---------------------------------------------------------------- */
export function drawForeground(layer) {
  const c = layer.ctx;
  c.save();
  const rocks = [
    { x: -70, y: 1120, rx: 320, ry: 104 },
    { x: 240, y: 1136, rx: 200, ry: 68 },
    { x: 1960, y: 1100, rx: 270, ry: 96 },
    { x: 1640, y: 1150, rx: 190, ry: 64 },
  ];
  for (const r of rocks) {
    c.beginPath();
    c.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, TAU);
    const g = c.createLinearGradient(r.x, r.y - r.ry, r.x, r.y + r.ry * 0.4);
    g.addColorStop(0, "rgba(8,11,19,0.98)");
    g.addColorStop(0.5, "rgba(3,4,8,0.99)");
    g.addColorStop(1, "rgba(1,1,3,1)");
    c.fillStyle = g;
    c.fill();
    c.beginPath();
    c.ellipse(r.x, r.y - 4, r.rx * 0.94, r.ry * 0.9, 0, Math.PI * 1.06, Math.PI * 1.94);
    c.strokeStyle = "rgba(116,154,220,0.24)";
    c.lineWidth = 3.2;
    c.stroke();
  }
  c.restore();
}

/* ---------------------------------------------------------------- *
 *  Soft shadow the sword casts (light comes from the gate)
 * ---------------------------------------------------------------- */
export function drawSwordShadow(ctx, p, intensity = 1) {
  if (intensity <= 0.01) return;
  // Light from the gate, projected onto the floor plane.
  const LX = GATE.x;
  const LY = GATE.y - 640;
  const projFloor = (x, y) => {
    const d = (FLOOR_Y - LY) / (y - LY || 1);
    return { x: LX + (x - LX) * d, y: FLOOR_Y };
  };
  const dark = glowSprite("shadow", 128, [
    [0, "rgba(0,0,0,0.9)"],
    [0.45, "rgba(0,0,0,0.45)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i <= 9; i++) {
    const u = i / 9;
    const x = p.x + p.dirX * BLADE_LEN * u;
    const y = p.y + p.dirY * BLADE_LEN * u;
    const s = projFloor(x, y);
    const w = 110 + u * 170;
    ctx.globalAlpha = (0.26 - u * 0.13) * intensity;
    ctx.drawImage(dark, s.x - w / 2, s.y - w * 0.11, w, w * 0.22);
  }
  ctx.globalAlpha = 0.34 * intensity;
  ctx.drawImage(dark, p.x - 170, FLOOR_Y - 30, 340, 60);
  ctx.restore();
}
