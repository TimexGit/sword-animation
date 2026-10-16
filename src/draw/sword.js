// The blade: an arcane longsword hanging in the air, drawn in local blade
// space (origin = the hilt, blade pointing at -Y) with its lighting passes done
// in world space, because the only light in the scene is the moon gate and the
// steel has to respond to it wherever it is.
//
// The trick to making steel read as steel: keep the base value almost black and
// do all the work with a handful of bright, thin, correctly-placed highlights.

import { TAU, DEG, clamp, clamp01, lerp, rgba, noise1 , makeTrack } from "../lib/util.js";
import {
  W, H, FLOOR_Y, GATE, BLADE_LEN, GUARD_OFF, GRIP_LEN, BLADE_W, T, impactPoint,
} from "../scene.js";

const C = {
  steelDark: [10, 14, 23],
  steelMid: [34, 46, 68],
  steelLit: [96, 126, 172],
  steelHot: [214, 232, 255],
  goldDark: [58, 41, 13],
  goldMid: [140, 106, 34],
  goldHot: [236, 208, 132],
  wrap: [26, 22, 20],
  charge: [132, 226, 255],
};
const col = (c, a) => rgba(c[0], c[1], c[2], a);

/* Cross-blade shading ramp: u = 0 at the cutting edge, 1 at the spine.
 * Each stop is [position, r, g, b, alpha]; alpha is applied as a blend between
 * the base value and the stop colour, so the ramp reads as light on steel
 * rather than as opaque paint. */
const CROSS_RAMP = [
  //  v     r    g    b    a       v = 0 at the cutting edge, 1 at the spine
  [0.00, 6, 9, 16, 0.95],     // the shadowed sliver behind the edge
  [0.080, 96, 124, 166, 0.95],    // the polished bevel
  [0.155, 132, 162, 202, 0.95],   // the crest of the bevel, catching light
  [0.260, 46, 62, 94, 0.95],
  [0.400, 17, 25, 42, 0.95],  // the flat of the blade falls away dark
  [0.560, 22, 32, 52, 0.95],
  [0.680, 56, 76, 112, 0.95], // a soft reflected sheen off the wall
  [0.780, 20, 29, 47, 0.95],
  [0.880, 13, 19, 33, 0.95],  // the shoulder rolls into shadow
  [1.000, 6, 9, 17, 0.95],    // mune
];

function rampAt(u) {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  for (let i = 0; i < CROSS_RAMP.length - 1; i++) {
    const a = CROSS_RAMP[i];
    const b = CROSS_RAMP[i + 1];
    if (x <= b[0]) {
      const t = (x - a[0]) / (b[0] - a[0] || 1);
      return [
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
        a[4] + (b[4] - a[4]) * t,
      ];
    }
  }
  const l = CROSS_RAMP[CROSS_RAMP.length - 1];
  return [l[1], l[2], l[3], l[4]];
}

/* Point on the blade at (u along the blade, v across it). */
function bladePointLocal(u, v, roll) {
  const squash = 1 - 0.30 * roll;
  const sori = SORI * Math.pow(u, 1.85);
  const w = BASE_W * (1 - 0.12 * u);
  const inner = sori - w * squash;
  const outer = sori + w * 0.88 * squash;
  return [inner + (outer - inner) * v, HABAKI_Y - LEN * u];
}

/* Paint the blade as bands that follow its curvature. Filling closed quads
 * (rather than stroking offset lines) means the bands tile exactly, so there
 * are no seams and no double-darkening where they meet. */
function paintCrossBands(ctx, p, roll, bands, alpha = 1) {
  for (const [v0, v1, fill] of bands) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const w = localToWorld(p, ...bladePointLocal(i / N, v0, roll));
      if (i === 0) ctx.moveTo(w.x, w.y);
      else ctx.lineTo(w.x, w.y);
    }
    for (let i = N; i >= 0; i--) {
      const w = localToWorld(p, ...bladePointLocal(i / N, v1, roll));
      ctx.lineTo(w.x, w.y);
    }
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/* ------------------------------------------------------------------ *
 *  Blade geometry
 * ------------------------------------------------------------------ */
const N = 40;             // samples along the blade
const SORI = 15;          // curvature: how far the blade bows toward the spine
const HABAKI_Y = -6;      // where the steel leaves the collar
const LEN = BLADE_LEN - GUARD_OFF;
const BASE_W = BLADE_W;
const KISSAKI = 0.115;    // fraction of the blade taken by the point

export function bladeProfile(roll = 0) {
  const squash = 1 - 0.30 * roll;   // edge-on: the blade narrows a little
  const edge = [];
  const spine = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const y = HABAKI_Y - LEN * u;
    const sori = SORI * Math.pow(u, 1.85);
    // width falls gently along the body, then closes into the point
    const w = BASE_W * (1 - 0.12 * u);
    if (u < 1 - KISSAKI) {
      edge.push([sori - w * squash, y]);
      spine.push([sori + w * 0.88 * squash, y]);
    } else {
      const v = (u - (1 - KISSAKI)) / KISSAKI;
      const e = Math.pow(v, 0.62);
      edge.push([sori - w * squash * (1 - e), y]);
      spine.push([sori + w * 0.92 * squash * Math.pow(1 - v * 0.06, 0.9), y]);
    }
  }
  return { edge, spine, squash };
}

export function localToWorld(p, x, y) {
  return { x: p.x + x * p.cos - y * p.sin, y: p.y + x * p.sin + y * p.cos };
}

function pathFromWorld(pts) {
  const path = new Path2D();
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) path.moveTo(pts[i][0], pts[i][1]);
    else path.lineTo(pts[i][0], pts[i][1]);
  }
  path.closePath();
  return path;
}

export function bladeWorldPath(p, roll = 0) {
  const { edge, spine } = bladeProfile(roll);
  const pts = [];
  for (const [x, y] of edge) {
    const w = localToWorld(p, x, y);
    pts.push([w.x, w.y]);
  }
  for (let i = spine.length - 1; i >= 0; i--) {
    const w = localToWorld(p, spine[i][0], spine[i][1]);
    pts.push([w.x, w.y]);
  }
  return pathFromWorld(pts);
}

/* World-space polyline along one side of the blade. */
function sideWorld(p, side) {
  const out = [];
  for (const [x, y] of side) {
    const w = localToWorld(p, x, y);
    out.push(w.x, w.y);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Main draw
 * ------------------------------------------------------------------ */
export function drawSword(ctx, p, o = {}) {
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.002) return;
  const roll = o.roll ?? p.roll;
  const charge = o.charge ?? p.charge;
  const flash = o.flash ?? 0;
  const glow = o.glow ?? 1;
  const flat = o.flat ?? 0;         // silhouette only (for reflections)
  const runes = o.runes ?? 1;

  const { edge, spine } = bladeProfile(roll);
  const worldPath = bladeWorldPath(p, roll);
  const edgeW = sideWorld(p, edge);
  const spineW = sideWorld(p, spine);

  const drawPoly = (arr) => {
    ctx.beginPath();
    for (let i = 0; i < arr.length; i += 2) {
      if (i === 0) ctx.moveTo(arr[0], arr[1]);
      else ctx.lineTo(arr[i], arr[i + 1]);
    }
  };

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* ---------- 1. silhouette base value ---------- */
  ctx.fillStyle = flat ? "rgba(64,86,124,0.5)" : "#0c1424";
  ctx.fill(worldPath);
  if (!flat) {
    ctx.strokeStyle = "rgba(2,4,9,0.85)";
    ctx.lineWidth = 1.6;
    ctx.stroke(worldPath);
  }

  if (!flat) {
    /* ---------- 2. environment light (clipped to the blade) ---------- */
    ctx.save();
    ctx.clip(worldPath);

    // (a) the gate is a broad bright source behind the blade: the steel goes
    //     dark where it eclipses the gate and catches light where it sits
    //     against the black wall.
    ctx.globalCompositeOperation = "multiply";
    const darkFront = ctx.createRadialGradient(GATE.x, GATE.y, GATE.r * 0.45, GATE.x, GATE.y, GATE.r * 2.2);
    darkFront.addColorStop(0, "rgba(120,140,175,1)");
    darkFront.addColorStop(0.55, "rgba(190,205,230,1)");
    darkFront.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = darkFront;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";

    // (b) the cross-blade value structure, band by band
    const LANES = 22;
    const chargeLift = charge * 0.34;
    const bands = [];
    for (let i = 0; i < LANES; i++) {
      const v0 = i / LANES;
      const v1 = (i + 1) / LANES;
      const [r, g, b, a] = rampAt((v0 + v1) / 2);
      const aa = Math.min(1, a * (1 + chargeLift * 0.5));
      bands.push([v0, v1, rgba(r + chargeLift * 26, g + chargeLift * 20, b, aa)]);
    }
    paintCrossBands(ctx, p, roll, bands);

    // (c) a soft wash that grows toward the tip, so the point is the brightest
    const tipW = localToWorld(p, 0, HABAKI_Y - LEN);
    const baseW = localToWorld(p, 0, HABAKI_Y);
    const lw = ctx.createLinearGradient(baseW.x, baseW.y, tipW.x, tipW.y);
    lw.addColorStop(0, "rgba(140,180,240,0)");
    lw.addColorStop(0.55, "rgba(150,190,245,0.03)");
    lw.addColorStop(0.90, "rgba(170,205,250,0.09)");
    lw.addColorStop(1, "rgba(220,238,255,0.18)");
    ctx.fillStyle = lw;
    ctx.fillRect(0, 0, W, H);

    // (d) the one real highlight: a narrow mirror of the ring, running the
    //     length of the blade and sliding across it as the blade rolls
    const specV = lerp(0.60, 0.50, roll);
    const specHalf = 0.022 + 0.016 * (1 - roll);
    const specParts = [];
    for (let i = 0; i < 5; i++) {
      const t0 = -1 + (i / 5) * 2;
      const t1 = -1 + ((i + 1) / 5) * 2;
      const falloff = (t) => Math.pow(Math.max(0, 1 - Math.abs(t)), 1.4);
      const a0 = falloff(t0) * (0.19 + 0.26 * charge);
      specParts.push([specV + t0 * specHalf, specV + t1 * specHalf, rgba(250, 253, 255, a0)]);
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    paintCrossBands(ctx, p, roll, specParts);
    ctx.restore();

    // (e) a much weaker highlight on the opposite face
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    paintCrossBands(ctx, p, roll, [
      [specV + 0.16, specV + 0.26, "rgba(190,216,255,0.07)"],
    ]);
    ctx.restore();

    // (f) warm bounce off the stone when the blade comes down onto it
    if (flash > 0.004) {
      const wg = ctx.createRadialGradient(impactPoint.x, FLOOR_Y, 0, impactPoint.x, FLOOR_Y, 1100);
      wg.addColorStop(0, rgba(255, 186, 108, 0.24 * flash));
      wg.addColorStop(0.4, rgba(255, 128, 48, 0.085 * flash));
      wg.addColorStop(1, "rgba(255,90,20,0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = wg;
      ctx.fillRect(impactPoint.x - 1100, FLOOR_Y - 700, 2200, 1100);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();

    /* ---------- 3. the lines that make it steel ---------- */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // (a) hamon — the temper line, a soft wavy band just above the edge
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const [ex, ey] = edge[i];
      const wob = Math.sin(u * 26 + 0.6) * 1.5 + Math.sin(u * 61 + 2.2) * 0.9;
      const w = localToWorld(p, ex + 5.6 * (1 - 0.4 * u) + wob * (1 - roll * 0.7), ey);
      if (i === 0) ctx.moveTo(w.x, w.y);
      else ctx.lineTo(w.x, w.y);
    }
    ctx.strokeStyle = rgba(198, 226, 255, 0.055 + charge * 0.10);
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // (b) the cutting edge: a hard, very bright line with a tight bloom
    drawPoly(edgeW);
    ctx.strokeStyle = rgba(186, 220, 255, 0.16 + 0.20 * charge);
    ctx.lineWidth = 4.5;
    ctx.stroke();
    drawPoly(edgeW);
    ctx.strokeStyle = rgba(244, 250, 255, 0.72 + 0.18 * charge);
    ctx.lineWidth = 1.35;
    ctx.stroke();

    // (c) the spine (mune): barely there — it is a rolled, unpolished back
    drawPoly(spineW);
    ctx.strokeStyle = rgba(150, 186, 240, 0.055 + 0.07 * charge);
    ctx.lineWidth = 3.2;
    ctx.stroke();
    drawPoly(spineW);
    ctx.strokeStyle = rgba(206, 226, 255, 0.11 + 0.07 * charge);
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // (d) a fine polish line down the middle of the blade
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const [ex] = edge[i];
      const [, sy] = spine[i];
      const w = localToWorld(p, ex + (spine[i][0] - ex) * 0.46, sy);
      if (i === 0) ctx.moveTo(w.x, w.y);
      else ctx.lineTo(w.x, w.y);
    }
    ctx.strokeStyle = rgba(190, 218, 255, 0.045);
    ctx.lineWidth = 5;
    ctx.stroke();

    // (e) three arcane sigils on the forte, waking up as the blade charges
    if (runes && glow > 0 && charge > 0.10) {
      const a = Math.pow(charge, 1.6) * 0.95 * glow;
      for (let i = 0; i < 3; i++) {
        const u = 0.22 + i * 0.20;
        const idx = Math.min(N, Math.round(u * N));
        const [ex] = edge[idx];
        const [sx] = spine[idx];
        const y = HABAKI_Y - LEN * u;
        const c = localToWorld(p, ex + (sx - ex) * 0.5, y);
        const sc = 1 - u * 0.15;
        const seedv = i * 3.71;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(p.rad);
        ctx.scale(sc, sc);
        ctx.strokeStyle = rgba(C.charge[0], C.charge[1], C.charge[2], a * 0.30);
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(-4, -7);
        ctx.lineTo(4, -2);
        ctx.lineTo(-3, 4);
        ctx.lineTo(4, 9);
        if (seedv > 5) { ctx.moveTo(-4, 6); ctx.lineTo(4, -6); }
        ctx.stroke();
        ctx.strokeStyle = rgba(224, 248, 255, a);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-4, -7);
        ctx.lineTo(4, -2);
        ctx.lineTo(-3, 4);
        ctx.lineTo(4, 9);
        if (seedv > 5) { ctx.moveTo(-4, 6); ctx.lineTo(4, -6); }
        ctx.stroke();
        ctx.restore();
      }
    }

    // (f) aura hugging the whole blade when charged
    if (glow > 0 && charge > 0.05) {
      ctx.strokeStyle = rgba(150, 230, 255, charge * 0.10 * glow);
      ctx.lineWidth = 10;
      ctx.stroke(worldPath);
      ctx.strokeStyle = rgba(220, 250, 255, charge * 0.24 * glow);
      ctx.lineWidth = 2.6;
      ctx.stroke(worldPath);
    }
    ctx.restore();

    /* ---------- 4. tip flare: a point should be the brightest thing ---------- */
    const tipW2 = localToWorld(p, 0, HABAKI_Y - LEN);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const tr = 14 + charge * 22 + flash * 64;
    const tg = ctx.createRadialGradient(tipW2.x, tipW2.y, 0, tipW2.x, tipW2.y, tr);
    tg.addColorStop(0, rgba(255, 255, 255, 0.55));
    tg.addColorStop(0.25, rgba(206, 232, 255, 0.22));
    tg.addColorStop(1, "rgba(120,180,255,0)");
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(tipW2.x, tipW2.y, tr, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- 5. furniture ---------- */
  if (!flat) {
    // The renderer accumulates the sword over N sub-frames at 1/N alpha, so
    // anything large and mid-valued (the arm) only reaches ~65% opacity and
    // the wall shows through it. The renderer therefore draws the arm once,
    // on its own — see render.js.
    if (o.grip !== false) drawGrip(ctx, p, { charge, flash, t: o.t ?? 0 });
    drawHilt(ctx, p, { charge, flash });
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 *  Hilt: habaki, tsuba, wrapped grip, kashira, floating rune ring
 * ------------------------------------------------------------------ */
/* ---------------------------------------------------------------- *
 *  The gripping hand and forearm
 *
 *  The fist is authored in the sword's own local frame so the knuckles
 *  always close around the tsuka, but the forearm has to live in WORLD
 *  space: the shoulder is a point on a body, not on the blade. Solving
 *  the two separately is what stops the arm from pivoting with the
 *  sword like a signpost.
 * ---------------------------------------------------------------- */
// Where the shoulder sits in the world through the swing. The figure
// rises into the cut, so the shoulder climbs and then settles back.
// The shoulder trails the fist: rather than a fixed point (which would make
// the forearm change length from 130 px to 900 px over the swing) it is
// placed a fixed arm's length down and to the right of the wrist, so the
// limb keeps one believable length and simply sweeps with the cut.
const ARM_LEN = makeTrack([[0, 430], [1.30, 452], [1.72, 500], [T.impact, 545],
                           [2.30, 520], [3.00, 480], [3.90, 452], [5, 434]]);

export function drawGrip(ctx, p, o = {}) {
  const charge = o.charge ?? 0;
  const flash = o.flash ?? 0;
  const t = o.t ?? 0;

  // local +y runs from the tsuba down the grip towards the pommel
  const GY0 = 21, GLEN = GRIP_LEN;
  const wrist = localToWorld(p, 0, GY0 + GLEN + 6);
  const L = ARM_LEN(t);
  const DHX = 0.215, DHY = 0.977;   // steeply down: the arm leaves frame
  const sh = { x: wrist.x + DHX * L, y: wrist.y + DHY * L };
  let ax = sh.x - wrist.x, ay = sh.y - wrist.y;
  const alen = Math.hypot(ax, ay) || 1;
  ax /= alen; ay /= alen;
  const nx = -ay, ny = ax;
  // the elbow bows the limb outwards; which way depends on the cut
  const bow = 14;
  const ex = (sh.x + wrist.x) / 2 + nx * bow;
  const ey = (sh.y + wrist.y) / 2 + ny * bow;

  /* --- the sleeve, tapering from the shoulder to the cuff --- */
  const limb = (w0, w1, off) => {
    ctx.beginPath();
    const mx = ex + nx * off, my = ey + ny * off;
    ctx.moveTo(sh.x + nx * w0, sh.y + ny * w0 - off * 0.0);
    ctx.quadraticCurveTo(mx + nx * w0 * 0.92, my + ny * w0 * 0.92,
                         wrist.x + nx * w1, wrist.y + ny * w1);
    ctx.lineTo(wrist.x - nx * w1, wrist.y - ny * w1);
    ctx.quadraticCurveTo(mx - nx * w0 * 0.92, my - ny * w0 * 0.92,
                         sh.x - nx * w0, sh.y - ny * w0);
    ctx.closePath();
  };

  ctx.save();
  limb(40, 24, 0);
  const sg = ctx.createLinearGradient(sh.x + nx * 46, sh.y + ny * 46,
                                      sh.x - nx * 46, sh.y - ny * 46);
  sg.addColorStop(0, "#0a101d");
  sg.addColorStop(0.30, "#182741");
  sg.addColorStop(0.68, "#22314c");
  sg.addColorStop(1, "#0b1120");
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.strokeStyle = "rgba(150,190,245,0.26)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // the lit rim running down the outside of the sleeve
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.beginPath();
  ctx.moveTo(sh.x + nx * 43, sh.y + ny * 43);
  ctx.quadraticCurveTo(ex + nx * 40, ey + ny * 40, wrist.x + nx * 24, wrist.y + ny * 24);
  ctx.strokeStyle = "rgba(168,208,255,0.30)";
  ctx.lineWidth = 3.0;
  ctx.lineCap = "round";
  ctx.stroke();
  if (flash > 0.01) {
    ctx.globalAlpha = clamp01(flash * 0.55);
    ctx.strokeStyle = "rgba(255,168,86,0.55)";
    ctx.lineWidth = 4.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // a cuff band just up from the wrist
  const cw = { x: wrist.x + ax * 46, y: wrist.y + ay * 46 };
  limb2(ctx, cw.x, cw.y, wrist.x, wrist.y, 34, 29, nx, ny);
  const cg = ctx.createLinearGradient(cw.x + nx * 30, cw.y + ny * 30,
                                      cw.x - nx * 30, cw.y - ny * 30);
  cg.addColorStop(0, "#0b1120");
  cg.addColorStop(0.4, "#243049");
  cg.addColorStop(1, "#0a101d");
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = "rgba(170,205,250,0.30)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  /* --- the fist, authored around the grip --- */
  ctx.save();
  ctx.transform(p.cos, p.sin, -p.sin, p.cos, p.x, p.y);

  const fTop = GY0 + 6;
  const fH = 118;
  ctx.save();
  ctx.beginPath();
  rr(ctx, -20, fTop, 40, fH, 19);
  const fg = ctx.createLinearGradient(-22, 0, 22, 0);
  fg.addColorStop(0, "#080d17");
  fg.addColorStop(0.26, "#1b2539");
  fg.addColorStop(0.58, "#121b2c");
  fg.addColorStop(1, "#070b14");
  ctx.fillStyle = fg;
  ctx.fill();
  ctx.strokeStyle = "rgba(150,190,245,0.22)";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // four knuckle rolls down the leading side
  for (let i = 0; i < 4; i++) {
    const yy = fTop + 17 + i * 25;
    ctx.beginPath();
    ctx.ellipse(-11, yy, 8, 11, 0.05, 0, TAU);
    const kg = ctx.createLinearGradient(-19, yy, -2, yy);
    kg.addColorStop(0, "#2a3750");
    kg.addColorStop(0.55, "#17202f");
    kg.addColorStop(1, "#0a101d");
    ctx.fillStyle = kg;
    ctx.fill();
    ctx.strokeStyle = "rgba(160,200,250,0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // the thumb laid along the top of the grip
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(7, fTop + 20, 9, 17, -0.36, 0, TAU);
  ctx.fillStyle = "#1a2437";
  ctx.fill();
  ctx.strokeStyle = "rgba(165,205,250,0.22)";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();

  // the wrist stub between cuff and fist, so the two read as one limb
  ctx.beginPath();
  rr(ctx, -15, fTop + fH - 16, 30, 30, 13);
  ctx.fillStyle = "#0d1524";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (flash > 0.01) {
    ctx.globalAlpha = clamp01(flash * 0.34);
    ctx.beginPath();
    rr(ctx, -21, fTop, 42, fH, 19);
    ctx.strokeStyle = "rgba(255,172,92,0.75)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (charge > 0.25) {
    ctx.globalAlpha = clamp01((charge - 0.25) * 0.5);
    ctx.beginPath();
    ctx.ellipse(-14, fTop + 58, 8, 56, 0, 0, TAU);
    ctx.fillStyle = "rgba(118,200,255,0.42)";
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.restore();
}

// a short tapered quad between two world points, offset along the normal
function limb2(ctx, x0, y0, x1, y1, w0, w1, nx, ny) {
  ctx.beginPath();
  ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
  ctx.lineTo(x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.lineTo(x0 - nx * w0, y0 - ny * w0);
  ctx.closePath();
}

function drawHilt(ctx, p, o) {
  const charge = o.charge ?? 0;
  const flash = o.flash ?? 0;
  const put = (x, y) => localToWorld(p, x, y);
  // helper: run a local-space drawing routine in world space
  const local = () => {
    ctx.save();
    ctx.transform(p.cos, p.sin, -p.sin, p.cos, p.x, p.y);
  };

  /* --- habaki: the brass collar at the mouth of the scabbard line --- */
  local();
  const hb = ctx.createLinearGradient(-11, 0, 11, 0);
  hb.addColorStop(0, col(C.goldDark, 1));
  hb.addColorStop(0.34, col(C.goldHot, 0.95));
  hb.addColorStop(0.55, col(C.goldMid, 1));
  hb.addColorStop(1, col(C.goldDark, 1));
  ctx.fillStyle = hb;
  ctx.beginPath();
  ctx.moveTo(-10, HABAKI_Y + 3);
  ctx.lineTo(-9, HABAKI_Y - 11);
  ctx.lineTo(-3, HABAKI_Y - 14);
  ctx.lineTo(9, HABAKI_Y - 12);
  ctx.lineTo(11, HABAKI_Y + 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,240,190,0.5)";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();

  /* --- tsuba: an oval guard with a pierce-work cutout --- */
  local();
  const ty = HABAKI_Y + 10;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, ty, 30, 12, 0, 0, TAU);
  const tg = ctx.createLinearGradient(-30, ty - 12, 30, ty + 12);
  tg.addColorStop(0, col(C.goldHot, 1));
  tg.addColorStop(0.22, col(C.goldMid, 1));
  tg.addColorStop(0.5, col(C.goldDark, 1));
  tg.addColorStop(0.74, col(C.goldMid, 1));
  tg.addColorStop(1, col(C.goldDark, 1));
  ctx.fillStyle = tg;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,238,180,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // two piercings
  ctx.globalCompositeOperation = "source-over";
  for (const sx of [-15, 15]) {
    ctx.beginPath();
    ctx.ellipse(sx, ty, 5.5, 4.4, 0, 0, TAU);
    ctx.fillStyle = "rgba(4,6,12,0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,232,170,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // carved seppa rings against the blade
  ctx.beginPath();
  ctx.ellipse(0, ty - 8.5, 12.5, 3.4, 0, 0, TAU);
  ctx.fillStyle = "rgba(255,242,196,0.35)";
  ctx.fill();
  ctx.restore();

  /* --- tsuka: the wrapped grip --- */
  const gy0 = ty + 15;
  const glen = GRIP_LEN;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, gy0 + glen / 2, 11.5, glen / 2 + 4, 0, 0, TAU);
  ctx.clip();
  const bg = ctx.createLinearGradient(-16, 0, 16, 0);
  bg.addColorStop(0, "#100d0c");
  bg.addColorStop(0.3, "#241e1b");
  bg.addColorStop(0.55, "#171311");
  bg.addColorStop(1, "#0a0807");
  ctx.fillStyle = bg;
  ctx.fillRect(-14, gy0 - 6, 28, glen + 16);

  // smooth wrapped grip: five subtle crossings, a dark core and a lit spine
  const step = glen / 6;
  for (let i = 0; i < 8; i++) {
    const yy = gy0 + i * step;
    ctx.beginPath();
    ctx.moveTo(-14, yy);
    ctx.quadraticCurveTo(0, yy - 5, 14, yy);
    ctx.strokeStyle = "rgba(120,102,74,0.20)";
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, yy + 3);
    ctx.quadraticCurveTo(0, yy - 2.2, 14, yy + 3);
    ctx.strokeStyle = "rgba(6,5,4,0.55)";
    ctx.lineWidth = 3.4;
    ctx.stroke();
  }
  // kashira-side flare of the same' and a cold rim down the lit side
  const rim = ctx.createLinearGradient(-13, 0, 13, 0);
  rim.addColorStop(0, `rgba(196,222,255,${0.10 + charge * 0.20})`);
  rim.addColorStop(0.25, "rgba(0,0,0,0)");
  rim.addColorStop(0.86, "rgba(0,0,0,0.5)");
  rim.addColorStop(1, `rgba(60,90,150,${0.12 + charge * 0.12})`);
  ctx.fillStyle = rim;
  ctx.fillRect(-14, gy0 - 6, 28, glen + 16);
  const gripShade = ctx.createLinearGradient(-12, 0, 10, 0);
  gripShade.addColorStop(0, "rgba(4,3,3,0.6)");
  gripShade.addColorStop(0.5, "rgba(0,0,0,0)");
  gripShade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gripShade;
  ctx.fillRect(-14, gy0 - 6, 28, glen + 16);
  ctx.restore();

  /* --- kashira: the pommel cap --- */
  const ky = gy0 + glen + 5;
  ctx.beginPath();
  ctx.moveTo(-11, ky - 3);
  ctx.quadraticCurveTo(-12.5, ky + 7, -4.5, ky + 11.5);
  ctx.quadraticCurveTo(4.5, ky + 13.5, 11, ky + 6);
  ctx.quadraticCurveTo(12.5, ky + 1, 10, ky - 3);
  ctx.closePath();
  const kg = ctx.createLinearGradient(-11, ky, 11, ky + 13);
  kg.addColorStop(0, col(C.goldHot, 1));
  kg.addColorStop(0.4, col(C.goldMid, 1));
  kg.addColorStop(1, col(C.goldDark, 1));
  ctx.fillStyle = kg;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,240,190,0.5)";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();

  /* --- the arcane core set into the pommel --- */
  const core = put(0, ky + 2);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const cr = 4 + charge * 8 + flash * 2;
  const cg = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, cr);
  const a = 0.20 + charge * 0.40 + flash * 0.06;
  cg.addColorStop(0, `rgba(236,252,255,${clamp01(a)})`);
  cg.addColorStop(0.3, `rgba(120,220,255,${clamp01(a * 0.5)})`);
  cg.addColorStop(0.66, `rgba(60,140,255,${clamp01(a * 0.16)})`);
  cg.addColorStop(1, "rgba(30,80,200,0)");
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(core.x, core.y, cr, 0, TAU);
  ctx.fill();
  ctx.restore();

}
