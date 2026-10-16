// Impact FX + motion smear: the swing trail, sparks, dust, shockwave and the
// molten cut the blade leaves in the stone.

import { TAU, DEG, clamp, clamp01, lerp, smoothstep, rgba, heatColor, noise1, noise2 } from "../lib/util.js";
import {
  W, H, FLOOR_Y, GATE, BLADE_LEN, GUARD_OFF, T,
  pose, impactFlash, impactPoint, SPARKS, DUST, MOTES,
} from "../scene.js";
import { glowSprite, mistSprite } from "./gfx.js";

const B = BLADE_LEN - GUARD_OFF;
const TOP = FLOOR_Y - 4;
const IP = impactPoint;

/* ------------------------------------------------------------------ *
 *  Swing trail — a ribbon between the tip path and the mid-blade path.
 *  The geometry is exact (the real tip path), so the smear reads as the
 *  blade's own history rather than a decoration.
 * ------------------------------------------------------------------ */
export function drawTrail(ctx, t, o = {}) {
  const p0 = pose(clamp(t, 0, T.end));
  const w = Math.abs(p0.omega);
  const strength = smoothstep(150, 650, w) * 0.7 + smoothstep(650, 1400, w) * 0.3;
  if (strength < 0.012) return;

  const steps = 16;
  // A fixed time span makes the smear explode into a huge wedge at peak speed.
  // Cap the angular sweep instead, so the ribbon always reads as the blade's
  // own width of travel rather than a fan.
  const MAX_SWEEP = 20 * DEG;
  const span = Math.min(0.055, MAX_SWEEP / Math.max(w * DEG, 1e-3));
  const tip = [];
  const mid = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const q = pose(clamp(t - (i / steps) * span, 0, T.end));
    const u = i / steps;
    const tipR = BLADE_LEN * (1 - 0.012 * u);
    const midR = GUARD_OFF + (BLADE_LEN - GUARD_OFF) * 0.46;
    const innR = GUARD_OFF + (BLADE_LEN - GUARD_OFF) * 0.16;
    tip.push([q.x + q.dirX * tipR, q.y + q.dirY * tipR]);
    mid.push([q.x + q.dirX * midR, q.y + q.dirY * midR]);
    inner.push([q.x + q.dirX * innR, q.y + q.dirY * innR]);
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";

  const ribbon = (outer, inn) => {
    ctx.beginPath();
    ctx.moveTo(outer[0][0], outer[0][1]);
    for (let i = 1; i <= steps; i++) ctx.lineTo(outer[i][0], outer[i][1]);
    for (let i = steps; i >= 0; i--) ctx.lineTo(inn[i][0], inn[i][1]);
    ctx.closePath();
  };

  // fade the whole smear out as it gets wider, so the fastest frames show a
  // hot thin streak rather than a solid sail
  const sweep = Math.min(1, Math.abs(p0.omega) * DEG * span / MAX_SWEEP);
  const widthFade = 0.55 + 0.45 * (1 - sweep);
  const A = 0.115 * strength * widthFade * (o.alpha ?? 1);

  // the broad part of the smear, fading from the blade backwards
  ribbon(tip, mid);
  const g = ctx.createLinearGradient(tip[0][0], tip[0][1], tip[steps][0], tip[steps][1]);
  g.addColorStop(0, rgba(206, 230, 255, A * 0.85));
  g.addColorStop(0.22, rgba(130, 182, 252, A * 0.5));
  g.addColorStop(0.60, rgba(74, 122, 220, A * 0.14));
  g.addColorStop(1, rgba(50, 90, 190, 0));
  ctx.fillStyle = g;
  ctx.fill();

  // the hot core: only the last sliver of the sweep, hugging the tip path
  ribbon(tip, inner);
  const g2 = ctx.createLinearGradient(tip[0][0], tip[0][1], tip[steps][0], tip[steps][1]);
  g2.addColorStop(0, rgba(255, 255, 255, A * 1.5));
  g2.addColorStop(0.20, rgba(232, 244, 255, A * 0.7));
  g2.addColorStop(0.55, rgba(232, 244, 255, A * 0.16));
  g2.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g2;
  ctx.fill();

  // a fine line tracing the tip's path
  ctx.beginPath();
  ctx.moveTo(tip[0][0], tip[0][1]);
  for (let i = 1; i <= steps; i++) ctx.lineTo(tip[i][0], tip[i][1]);
  ctx.lineCap = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = rgba(168, 212, 255, A * 0.5);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = rgba(246, 251, 255, 0.55 * strength * widthFade);
  ctx.stroke();

  if (p0.charge > 0.3) {
    ribbon(tip, mid);
    ctx.fillStyle = rgba(110, 214, 255, A * 0.55 * p0.charge);
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 *  Sparks
 * ------------------------------------------------------------------ */
export function drawSparks(ctx, frame) {
  const list = SPARKS[frame] || SPARKS[SPARKS.length - 1];
  if (!list.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  const spr = glowSprite("spark", 64, [
    [0, "rgba(255,255,255,0.98)"],
    [0.2, "rgba(255,232,170,0.85)"],
    [0.55, "rgba(255,140,50,0.24)"],
    [1, "rgba(255,80,0,0)"],
  ]);
  const bead = glowSprite("bead", 64, [
    [0, "rgba(255,252,240,1)"],
    [0.25, "rgba(255,206,120,0.9)"],
    [0.6, "rgba(255,120,40,0.3)"],
    [1, "rgba(255,70,10,0)"],
  ]);

  for (const s of list) {
    const h = s.heat;
    const a = clamp01(Math.pow(h, 0.7) * 1.05);
    const w = s.size * (0.5 + 0.8 * h);
    const len = Math.hypot(s.x - s.px, s.y - s.py);
    if (len > 0.7) {
      ctx.beginPath();
      ctx.moveTo(s.px, s.py);
      ctx.lineTo(s.x, s.y);
      ctx.strokeStyle = heatColor(h * 0.92, a * (s.kind === 2 ? 0.8 : 0.62));
      ctx.lineWidth = Math.max(0.7, w * 0.85);
      ctx.stroke();
    }
    if (h > 0.3 || s.kind === 2) {
      const r = w * (s.kind === 2 ? 5.4 : 3.0);
      ctx.globalAlpha = clamp01(a * (s.kind === 2 ? 0.75 : 0.85));
      ctx.drawImage(s.kind === 2 ? bead : spr, s.x - r, s.y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
  }

  // bloom core right at the contact for the first few frames
  const dt = frame / 30 - T.impact;
  if (dt >= -0.02 && dt < 0.30) {
    const k = Math.exp(-Math.max(0, dt) / 0.085);
    const r = 130 * (1 + Math.max(0, dt) * 1.9);
    ctx.globalAlpha = clamp01(k * 0.48);
    ctx.drawImage(glowSprite("impactcore", 256, [
      [0, "rgba(255,255,255,1)"],
      [0.14, "rgba(255,238,196,0.82)"],
      [0.42, "rgba(255,152,62,0.28)"],
      [1, "rgba(255,90,20,0)"],
    ]), IP.x - r, TOP + 8 - r * 0.66, r * 2, r * 1.32);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 *  Dust
 * ------------------------------------------------------------------ */
export function drawDust(ctx, frame) {
  const list = DUST[frame] || [];
  if (!list.length) return;
  const spr = mistSprite("dust", 256, 42);
  ctx.save();
  // Dust is lit only by the strike and the gate: at an eighth of a percent of
  // white it is a haze, at a half it is a solid slab. 60 of these overlap over
  // the strike zone, so the individual puff has to stay very faint.
  for (const d of list) {
    ctx.globalAlpha = d.a * 0.085;
    ctx.drawImage(spr, d.x - d.r, d.y - d.r * 0.8, d.r * 2, d.r * 1.6);
  }
  ctx.globalCompositeOperation = "lighter";
  const hot = glowSprite("dusthot", 128, [
    [0, "rgba(255,196,130,0.85)"],
    [0.5, "rgba(255,124,44,0.22)"],
    [1, "rgba(255,80,20,0)"],
  ]);
  for (const d of list) {
    if (d.hot <= 0.01) continue;
    ctx.globalAlpha = d.a * d.hot * 0.20;
    ctx.drawImage(hot, d.x - d.r * 0.9, d.y - d.r * 0.75, d.r * 1.8, d.r * 1.5);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 *  Charge motes
 * ------------------------------------------------------------------ */
export function drawMotes(ctx, frame) {
  const list = MOTES[frame] || [];
  if (!list.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const spr = glowSprite("mote", 64, [
    [0, "rgba(235,252,255,0.95)"],
    [0.35, "rgba(130,220,255,0.42)"],
    [1, "rgba(60,140,255,0)"],
  ]);
  for (const m of list) {
    const s = 2.4 + (m.seed % 1) * 3.4;
    ctx.globalAlpha = m.a * 0.5;
    ctx.drawImage(spr, m.x - s, m.y - s, s * 2, s * 2);
    const l = Math.hypot(m.x - m.px, m.y - m.py);
    if (l > 2) {
      ctx.globalAlpha = m.a * 0.3;
      ctx.beginPath();
      ctx.moveTo(m.px, m.py);
      ctx.lineTo(m.x, m.y);
      ctx.strokeStyle = "rgba(170,235,255,0.5)";
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 *  Impact: fireball, shockwave, ground rings, molten cut, light wrap
 * ------------------------------------------------------------------ */
export function drawImpact(ctx, t, o = {}) {
  const dt = t - T.impact;
  if (dt < -0.06 || dt > 2.6) return;
  const cx = IP.x;
  const cy = FLOOR_Y - 2;
  const flash = impactFlash(t);
  const s = o.scale ?? 1;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // ---- the flash of the strike
  //
  // A single soft sprite reads as a shapeless blob, so the flash is built in
  // four layers: a small hard contact core, a torn irregular body, a few
  // tapered spikes thrown out along the cut, and a wide soft skirt of light.
  if (dt >= 0 && dt < 0.42) {
    const k = Math.exp(-dt / 0.085);
    const r = (34 + dt * 300) * s;

    // 1. wide skirt
    ctx.globalAlpha = clamp01(k * 0.20);
    ctx.drawImage(glowSprite("fire", 256, [
      [0, "rgba(255,236,200,1)"],
      [0.16, "rgba(255,206,138,0.72)"],
      [0.46, "rgba(255,132,44,0.20)"],
      [1, "rgba(255,70,10,0)"],
    ]), cx - r * 1.5, cy - r * 1.15, r * 3, r * 2.3);

    // 2. torn body: an irregular lobed polygon, different every frame it grows
    ctx.globalCompositeOperation = "lighter";
    const lobes = 13;
    const body = r * 0.82;
    ctx.globalAlpha = clamp01(k * 0.46);
    ctx.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * TAU;
      const j = 0.62 + 0.38 * Math.abs(Math.sin(i * 2.7 + 1.3)) + 0.16 * Math.sin(i * 5.1);
      const rr = body * j;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr * 0.62;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, body);
    bg.addColorStop(0, "rgba(255,252,242,0.92)");
    bg.addColorStop(0.30, "rgba(255,226,176,0.62)");
    bg.addColorStop(0.62, "rgba(255,158,70,0.30)");
    bg.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = bg;
    ctx.fill();

    // 3. spikes thrown along the cut and out from the contact
    ctx.globalAlpha = clamp01(k * 0.45);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + 0.35 + 0.12 * Math.sin(i * 3.1);
      const len = r * (0.7 + 0.9 * Math.abs(Math.sin(i * 1.9 + 0.4))) * (0.5 + 0.5 * k);
      const wid = 3.2 + 3.0 * Math.abs(Math.cos(i * 2.3));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.30, cy + Math.sin(a) * r * 0.30 * 0.62);
      ctx.lineTo(cx + Math.cos(a + 0.10) * len, cy + Math.sin(a + 0.10) * len * 0.72);
      ctx.lineTo(cx + Math.cos(a - 0.10) * len, cy + Math.sin(a - 0.10) * len * 0.72);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,206,140,0.42)";
      ctx.fill();
    }

    // 4. the contact point itself: small, hard, blinding
    const coreR = (11 + dt * 34) * s;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    cg.addColorStop(0, "rgba(255,255,252,0.95)");
    cg.addColorStop(0.36, "rgba(255,248,224,0.52)");
    cg.addColorStop(1, "rgba(255,228,182,0)");
    ctx.globalAlpha = clamp01(k * 0.85);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy - 6 * s, coreR, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- air shockwave
  if (dt >= 0 && dt < 0.32) {
    const u = dt / 0.32;
    const r = (24 + 480 * Math.pow(u, 0.55)) * s;
    ctx.globalAlpha = Math.pow(1 - u, 1.7) * 0.22;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = "rgba(206,228,255,1)";
    ctx.lineWidth = 13 * (1 - u) + 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- rings skimming along the top of the stone (strongly flattened)
  const rings = [
    { dur: 0.48, max: 430, w: 13, a: 0.5, delay: 0 },
    { dur: 0.70, max: 660, w: 22, a: 0.22, delay: 0.045 },
    { dur: 0.95, max: 900, w: 36, a: 0.10, delay: 0.09 },
  ];
  for (const R of rings) {
    const u = (dt - R.delay) / R.dur;
    if (u < 0 || u > 1) continue;
    const r = 26 + R.max * Math.pow(u, 0.62) * s;
    const a = R.a * Math.pow(1 - u, 1.6) * 0.62;
    // the ring is dust catching the flash, so it is thick and soft rather
    // than a hairline circle
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.10, 0, 0, TAU);
    ctx.strokeStyle = "rgba(255,226,178,0.85)";
    ctx.lineWidth = R.w * (1 - u) * 1.2 + 4;
    ctx.filter = "blur(5px)";
    ctx.stroke();
    ctx.filter = "none";
    ctx.globalAlpha = a * 0.42;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.98, r * 0.10 * 0.98, 0, 0, TAU);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = R.w * (1 - u) * 0.5 + 2;
    ctx.stroke();
  }

  // ---- dust wave skimming outward over the stone and off the front edge
  if (dt < 1.4) {
    const m = mistSprite("dustwave", 256, 77);
    for (let i = 0; i < 20; i++) {
      const jitter = ((i * 37) % 17) / 17;
      const u = (dt - 0.015 - i * 0.009) / 1.15;
      if (u < 0 || u > 1) continue;
      const dir = i % 2 ? 1 : -1;
      const rad = (46 + 600 * Math.pow(u, 0.70)) * (0.50 + 0.95 * jitter);
      const r = (34 + 132 * u) * (0.7 + 0.75 * jitter);
      ctx.globalAlpha = Math.pow(1 - u, 1.9) * 0.014;
      ctx.drawImage(m, cx + rad * dir - r, cy - r * 0.42 - u * 34 * jitter, r * 2.1, r * 0.78);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // ---- glowing contact pool cooling on the stone
  if (dt >= 0 && dt < 2.6) {
    const a = Math.exp(-dt / 0.38) * 0.10 + Math.exp(-dt / 1.3) * 0.022;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp01(a) ;
    const r = 104;
    ctx.drawImage(glowSprite("pool", 160, [
      [0, "rgba(255,222,168,0.60)"],
      [0.26, "rgba(255,158,78,0.28)"],
      [0.58, "rgba(255,112,38,0.10)"],
      [1, "rgba(255,80,20,0)"],
    ]), cx - r * 1.5, cy - r * 0.46, r * 3.0, r * 0.92);
    ctx.restore();
  }

  // ---- light wrap washing over the camera
  if (flash > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp01(flash * 0.085);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.95);
    g.addColorStop(0, "rgba(255,228,186,0.9)");
    g.addColorStop(0.34, "rgba(255,170,92,0.28)");
    g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (dt < 0.10) {
      ctx.globalAlpha = clamp01(1 - dt / 0.10) * 0.10;
      const wg = ctx.createLinearGradient(0, 0, 0, H);
      wg.addColorStop(0, "rgba(255,214,166,0.5)");
      wg.addColorStop(0.55, "rgba(255,186,118,0.14)");
      wg.addColorStop(1, "rgba(255,160,90,0)");
      ctx.fillStyle = wg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
}
