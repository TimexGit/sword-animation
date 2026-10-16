// The animation "director": staging, timeline, sword pose, camera work and the
// pre-simulated particle systems. Everything here is a pure deterministic
// function of time (or of a fixed frame index), so the video renderer and the
// procedural soundtrack can both drive themselves from the exact same motion.

import {
  DEG, TAU, clamp, clamp01, lerp, invLerp, smoothstep, smootherstep,
  makeTrack, mulberry32, decay, noise1, noise2, fbm2,
} from "./lib/util.js";

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const DURATION = 5;
export const FRAMES = Math.round(DURATION * FPS); // 150

/* ================================================================== *
 *  STAGING — where things live in world (camera-space) coordinates
 * ================================================================== */
export const FLOOR_Y = 906;                              // wall / floor junction
export const GATE = { x: 1424, y: 344, r: 268 };         // the glowing moon gate
/* The blade bites the bare stone floor. Staging the strike on the floor rather
 * than on a raised block is what lets the cut be steep: the tip lands far below
 * the hilt, so the blade arrives on a hard diagonal instead of lying flat. */
export const HAND = { x: 860, y: 800 };                  // hilt position at rest
export const BLADE_LEN = 572;                            // hilt -> tip
export const GUARD_OFF = 34;                             // hilt -> crossguard
export const GRIP_LEN = 132;                             // grip length (hilt is 1/4 of the blade)
export const BLADE_W = 11.5;                             // half-width at the base

/* ================================================================== *
 *  TIMELINE  (impact lands on frame 56 of 150)
 * ================================================================== */
export const T = {
  establish: 0.0,
  windup: 0.62,      // the lift begins
  loaded: 1.34,      // fully loaded
  holdEnd: 1.55,     // tension hold, creeping further back
  strike: 1.58,      // the whip starts
  impact: 56 / 30,   // tip bites the stone, exactly on frame 56
  rebound: 1.96,
  settle: 2.62,
  recover: 3.42,     // starts lifting back up
  end: DURATION,
};

// Hand travel (world px, relative to HAND) — the body drives the blade.
const handXTrack = makeTrack([
  [0.00, 0], [0.80, -16], [1.15, -30], [1.40, -36], [1.55, -36],
  [1.72, -24], [T.impact, -4], [1.96, -10], [2.30, -8], [2.62, -10],
  [2.90, -17], [3.00, -13], [3.24, -24], [3.55, -19], [3.90, -11],
  [4.25, -4], [4.55, -1], [4.85, 0], [5.00, 0],
]);
const handYTrack = makeTrack([
  [0.00, 0], [0.80, -70], [1.15, -120], [1.40, -150], [1.55, -152],
  [1.72, -210], [T.impact, -300], [1.96, -312], [2.30, -304], [2.62, -308],
  [2.90, -320], [3.00, -302], [3.24, -252], [3.55, -186], [3.90, -110],
  [4.25, -44], [4.55, -10], [4.85, 0], [5.00, 0],
]);

// The tip must bite the floor at T.impact -> solve the angle for it.
export const handPosAt = (t) => ({
  x: HAND.x + handXTrack(t),
  y: HAND.y + handYTrack(t),
});
const handAtImpact = handPosAt(T.impact);
// The blade is authored along local -Y, so its world direction is
// (sin θ, −cos θ) in canvas space (x right, y down). Requiring the tip to land
// on the floor gives −cos θ = (FLOOR_Y − hilt.y) / BLADE_LEN:
export const IMPACT_ANGLE = (() => {
  const c = clamp((handAtImpact.y - (FLOOR_Y - 4)) / BLADE_LEN, -1, 1);
  const sn = Math.sqrt(Math.max(0, 1 - c * c));
  return Math.atan2(sn, c) / DEG;
})();

/* Angle track (degrees): canvas convention — 0 = blade points right, -90 = up,
 * +90 = down, and increasing angle is the clockwise cut. The blade starts
 * raised up-left, loads further back and down, then whips clockwise over the
 * top of the frame (crossing the gate) and buries its tip in the stone. */
const A = IMPACT_ANGLE;
const ANGLE_KEYS = [
  //  time            theta (deg)          notes
  [0.00,             -58.0],    // held ready: blade up and to the right
  [0.58,             -58.4],    // alive, barely moving
  [0.72,             -61.0],    // the lift begins
  [0.86,             -68.0],
  [1.00,             -76.0],
  [1.15,             -84.0],
  [1.30,             -90.5],
  [1.42,             -94.5],
  [T.holdEnd,        -95.5],    // creeping further back = the load
  // the whip: keys land on frame boundaries so the acceleration is legible
  [1.63333,          -90.0],    // f49
  [1.66667,          -78.0],    // f50
  [1.70000,          -60.0],    // f51
  [1.73333,          -35.0],    // f52
  [1.76667,           -2.0],    // f53  crossing the gate
  [1.80000,           40.0],    // f54
  [1.83333,           90.0],    // f55  straight down
  [T.impact,             A],    // f56  the tip bites the stone floor
  [T.impact + 0.04,    A + 1.8],   // sinks a couple of degrees into the cut
  [T.impact + 0.11,    A - 3.4],   // and kicks back off the stone
  [T.impact + 0.24,    A - 6.2],
  [T.impact + 0.42,    A - 4.0],   // ringing settle
  [T.impact + 0.63,    A - 5.2],
  [2.70,               A - 6.4],   // the pose holds while the dust drops
  [2.90,               A - 11.5],  // the stone gives a little...
  [3.00,               A - 3.0],   // ...and the tip snaps free
  [3.24,               A - 34.0],  // hauling it clear
  [3.55,                16.0],
  [3.90,               -20.0],
  [4.25,               -46.0],
  [4.55,               -57.0],
  [4.75,               -61.0],     // a touch of overshoot
  [4.88,               -58.6],
  [5.00,               -58.0],
];
const angleTrack = makeTrack(ANGLE_KEYS);

// Blade roll: 0 = flat towards the camera (wide, shows the fuller),
// 1 = edge-on (thin, the cutting profile). The blade turns edge-on for the cut.
const rollTrack = makeTrack([
  [0, 0.14], [1.20, 0.24], [1.55, 0.34], [1.70, 0.48], [1.79, 0.62],
  [T.impact, 0.66], [2.30, 0.50], [3.30, 0.30], [4.60, 0.18], [5, 0.16],
]);

// "Charge": arcane light gathers in the steel during the load, explodes on the
// strike. The steel is never inert — it always has a little life in it.
export const chargeAt = (t) =>
  0.20 +
  0.60 * smoothstep(T.windup, T.loaded + 0.06, t) -
  0.08 * smoothstep(T.loaded, T.holdEnd, t) +
  0.30 * clamp01(noise1(t * 7.3) * 0.5 + 0.5) * smoothstep(1.15, 1.5, t);

// Small idle tremor so the sword is never dead-still. Suppressed while moving fast.
function idle(t) {
  const calm = 1 - smoothstep(1.58, 1.72, t) * (1 - smoothstep(2.35, 2.95, t));
  return (
    (1.15 * Math.sin(TAU * 0.31 * t + 0.6) +
      0.46 * noise1(t * 1.7) +
      0.24 * noise1(t * 4.1 + 12)) *
    calm *
    (0.55 + 0.45 * (1 - chargeAt(t) * 0.5))
  );
}

/* ================================================================== *
 *  POSE
 * ================================================================== */
/* ------------------------------------------------------------------ *
 *  The planted tip
 *
 *  Once the tip has bitten the stone it is the TIP that is fixed in the
 *  world, not the hand: the blade levers in the crack. Driving the hand
 *  instead lets the tip float up out of the cut the moment the hilt bobs,
 *  which reads as the sword hovering over the floor. So for the whole
 *  planted beat the hand is solved backwards from the tip.
 * ------------------------------------------------------------------ */
const TIPX = makeTrack([
  [T.impact, 1263], [T.impact + 0.22, 1267], [T.impact + 0.55, 1261],
  [2.60, 1266], [2.90, 1271], [3.00, 1274],
]);
const TIPY = makeTrack([
  [T.impact, FLOOR_Y - 2], [T.impact + 0.09, FLOOR_Y + 0], [T.impact + 0.34, FLOOR_Y - 1],
  [2.80, FLOOR_Y - 1], [3.00, FLOOR_Y - 1.5],
]);
// 1 while the blade is buried, easing out just before the tip tears free
const pinAt = (t) =>
  clamp01(smoothstep(T.impact - 0.01, T.impact + 0.05, t) *
          (1 - smoothstep(2.80, 3.02, t)));

/* The shock of the hit rings up the blade: a fast, decaying vibration that
 * fades out over the first half second or so. Without it the planted blade
 * reads as frozen. */
function ring(t) {
  const dt = t - T.impact;
  if (dt < 0.02 || dt > 1.1) return 0;
  const amp = 1.1 * Math.exp(-dt / 0.26);
  return amp * Math.sin(dt * 2 * Math.PI * 5.4) * Math.exp(-dt / 0.30);
}

export function pose(t) {
  const tc = clamp(t, 0, DURATION);
  const angle = angleTrack(tc) + idle(tc) + ring(tc);
  let hp = handPosAt(tc);
  const pin = pinAt(tc);
  if (pin > 0.001) {
    const rad0 = (angleTrack(tc) + idle(tc) + ring(tc)) * DEG;
    const px = TIPX(tc) - BLADE_LEN * Math.sin(rad0);
    const py = TIPY(tc) + BLADE_LEN * Math.cos(rad0);
    hp = { x: hp.x + (px - hp.x) * pin, y: hp.y + (py - hp.y) * pin };
  }
  const roll = clamp01(rollTrack(tc));
  const charge = clamp01(chargeAt(tc));

  // Numerical angular velocity (deg/s) — drives whoosh, trails, streaks.
  const d = 1 / 480;
  const omega = (angleTrack(clamp(tc + d, 0, DURATION)) -
                 angleTrack(clamp(tc - d, 0, DURATION))) / (2 * d);

  const rad = angle * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The blade is authored along local -Y and rotated by `rad`, so its world
  // direction is (sin, -cos) in canvas space (x right, y down).
  const dirX = sin;
  const dirY = -cos;
  return {
    angle, rad, cos, sin, dirX, dirY, roll, charge, omega,
    x: hp.x, y: hp.y,
    tipX: hp.x + BLADE_LEN * dirX,
    tipY: hp.y + BLADE_LEN * dirY,
    // derivative of the tip direction with respect to the angle
    tanX: cos, tanY: sin,
    speed: Math.abs(omega) * DEG * BLADE_LEN,    // tip speed, px/s
  };
}

/* ================================================================== *
 *  CAMERA — slow push, a punch on the hit, and a hand-held shake.
 *  The base move and the shake are separate so the renderer can motion
 *  blur the shake while keeping the environment rigid.
 * ================================================================== */
const camZTrack = makeTrack([
  [0, 1.000], [1.00, 1.014], [1.55, 1.030], [1.80, 1.044],
  [T.impact, 1.054], [1.925, 1.075], [2.25, 1.060],
  [2.90, 1.050], [4.20, 1.040], [5.00, 1.032],
]);
const camXTrack = makeTrack([
  [0, 928], [1.20, 964], [1.72, 1010], [T.impact, 1046],
  [2.40, 1030], [3.40, 1000], [4.60, 964], [5, 948],
]);
const camYTrack = makeTrack([
  [0, 556], [1.20, 536], [1.72, 528], [T.impact, 546],
  [1.965, 560], [2.50, 556], [3.60, 556], [5, 552],
]);
const camRTrack = makeTrack([
  [0, 0], [1.50, -0.30], [1.78, -0.62], [T.impact, -0.30],
  [1.945, 0.50], [2.30, 0.26], [3.00, 0.10], [4.40, 0], [5, 0],
]);

// Impact shake: a directional kick plus high-frequency noise, both decaying.
const SHAKE_DIR = { x: 0.13, y: -0.99 };  // tip velocity at contact, normalised

export function shakeAt(t) {
  const tc = clamp(t, 0, DURATION);
  let sx = 0, sy = 0, sr = 0;

  const dt = tc - T.impact;
  if (dt >= 0) {
    const kick = 21 * decay(dt, 0.075);
    const ring = 9 * decay(dt, 0.28);
    sx += SHAKE_DIR.x * kick + ring * noise1(tc * 46);
    sy += SHAKE_DIR.y * kick + ring * noise1(tc * 51 + 3.7);
    sr += 0.70 * decay(dt, 0.13) * noise1(tc * 39 + 9.1);
    sr += 0.30 * decay(dt, 0.40) * noise1(tc * 21 + 2.3);
  }
  const pre = smoothstep(T.loaded - 0.25, T.impact, tc) *
    (1 - smoothstep(T.impact - 0.01, T.impact + 0.05, tc));
  sx += pre * 2.2 * noise1(tc * 33);
  sy += pre * 2.2 * noise1(tc * 37 + 5.5);

  sx += 1.5 * noise1(tc * 0.55 + 2.1);
  sy += 1.5 * noise1(tc * 0.62 + 7.4);
  sr += 0.05 * noise1(tc * 0.4);

  return { x: sx, y: sy, rot: sr * DEG };
}

export function camBaseAt(t) {
  const tc = clamp(t, 0, DURATION);
  return {
    x: camXTrack(tc),
    y: camYTrack(tc),
    zoom: camZTrack(tc),
    rot: camRTrack(tc) * DEG,
  };
}

export function camera(t) {
  const b = camBaseAt(t);
  const s = shakeAt(t);
  return { x: s.x, y: s.y, cx: b.x, cy: b.y, zoom: b.zoom, rot: b.rot + s.rot };
}

/* ================================================================== *
 *  PARTICLE SIMULATION — precomputed per frame so drawing stays pure
 * ================================================================== */

function makeSpark(rng, t0, x, y, vx, vy, opts = {}) {
  return {
    t0, x, y, vx, vy, px: x, py: y, born: t0,
    life: opts.life ?? (0.55 + rng() * 1.15),
    size: opts.size ?? (0.8 + rng() * 2.2),
    drag: opts.drag ?? (0.7 + rng() * 1.3),
    grav: opts.grav ?? (1450 + rng() * 850),
    dead: false,
    kind: opts.kind ?? 0, // 0 spark, 1 ember, 2 molten droplet
    gen: opts.gen ?? 0,
    seed: rng() * 100,
  };
}

function buildSparks() {
  const rng = mulberry32(0xbeef01);
  const imp = pose(T.impact);
  const ox = imp.tipX;
  const oy = FLOOR_Y - 4;

  // Contact cone: the tip is driving down into the stone, so the spray is
  // mostly upward with a tangential (leftward) scrape and a wide fan.
  const list = [];
  for (let i = 0; i < 210; i++) {
    const up = Math.pow(rng(), 0.55);              // 0 = flat along the stone, 1 = straight up
    const spd = 230 + Math.pow(rng(), 1.6) * 2050;
    const side = (rng() - 0.5) * 2;
    const scrape = -0.55 - rng() * 0.9;            // the tip continues leftward
    const vx = side * 0.75 * spd * (1 - up) + scrape * spd * 0.35 * (1 - up * 0.5);
    const vy = -up * spd - 40;
    list.push(
      makeSpark(rng, T.impact + rng() * 0.05, ox + (rng() - 0.5) * 30, oy + (rng() - 0.5) * 12,
        vx, vy, { size: 0.8 + Math.pow(rng(), 2) * 2.8 })
    );
  }
  // fat, slow molten beads that arc and tumble
  for (let i = 0; i < 18; i++) {
    const spd = 180 + rng() * 460;
    const up = 0.45 + rng() * 0.55;
    list.push(
      makeSpark(rng, T.impact + rng() * 0.05, ox + (rng() - 0.5) * 26, oy - rng() * 8,
        (rng() - 0.5) * 190 - spd * 0.3, -spd * up,
        { size: 2.6 + rng() * 2.6, life: 1.1 + rng() * 0.9, drag: 1.5, grav: 1400, kind: 2 })
    );
  }
  // grinding sparks that dribble out of the contact for a third of a second
  for (let i = 0; i < 80; i++) {
    const tb = T.impact + 0.01 + rng() * 0.34;
    list.push(
      makeSpark(rng, tb, ox + (rng() - 0.5) * 24, oy - rng() * 5,
        -70 - rng() * 340, -(50 + rng() * 420),
        { size: 0.7 + rng() * 1.4, life: 0.4 + rng() * 0.7, grav: 2050, drag: 1.2 })
    );
  }

  list.sort((a, b) => a.t0 - b.t0);
  const dt = 1 / 240;
  const frames = [];
  const alive = list.filter((s) => s.t0 <= 0);
  let next = alive.length;
  const FLOOR = FLOOR_Y - 2;

  for (let f = 0; f < FRAMES; f++) {
    const t0 = f / FPS;
    const t1 = (f + 1) / FPS;
    while (next < list.length && list[next].t0 <= t1) alive.push(list[next++]);
    let tt = t0;
    while (tt < t1 - 1e-9) {
      const h = Math.min(dt, t1 - tt);
      for (const s of alive) {
        if (s.dead) continue;
        s.px = s.x;
        s.py = s.y;
        const drag = Math.exp(-s.drag * h);
        s.vx *= drag;
        s.vy = s.vy * drag + s.grav * h;
        s.x += s.vx * h;
        s.y += s.vy * h;
        if (s.y > FLOOR) {
          s.y = FLOOR;
          s.vy *= -0.30 - rng() * 0.15;
          s.vx *= 0.68;
          if (s.kind === 0 && s.gen === 0 && rng() < 0.05 && alive.length < 560) {
            const c = makeSpark(rng, tt, s.x, s.y, s.vx + (rng() - 0.5) * 220,
              -Math.abs(s.vy) * (0.6 + rng()),
              { size: s.size * 0.7, life: s.life * 0.4, grav: 2100, drag: 1.7, gen: 1 });
            c.t0 = tt;
            alive.push(c);
          }
        }
        if (tt > s.born + s.life) s.dead = true;
      }
      tt += h;
    }
    const snap = [];
    for (const s of alive) {
      if (s.dead) continue;
      const age = t1 - s.born;
      const heat = clamp01(1 - age / s.life);
      if (heat <= 0.012) continue;
      snap.push({ x: s.x, y: s.y, px: s.px, py: s.py, heat, size: s.size, kind: s.kind });
    }
    frames.push(snap);
    for (let i = alive.length - 1; i >= 0; i--) if (alive[i].dead) alive.splice(i, 1);
  }
  return frames;
}

function buildDust() {
  const rng = mulberry32(0x5eed02);
  const imp = pose(T.impact);
  const puffs = [];
  for (let i = 0; i < 60; i++) {
    const a = rng() * TAU;
    const rad = Math.pow(rng(), 0.6) * 150;
    puffs.push({
      t0: T.impact + rng() * 0.14,
      x: imp.tipX + Math.cos(a) * rad * 1.4,
      y: FLOOR_Y - 4 + Math.sin(a) * 7,
      vx: (rng() - 0.5) * 240 - 40,
      vy: -20 - rng() * 150,
      r0: 16 + rng() * 28,
      r1: 100 + rng() * 210,
      life: 1.0 + rng() * 1.6,
      seed: rng() * 100,
    });
  }
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    const t1 = (f + 1) / FPS;
    const snap = [];
    for (const p of puffs) {
      const age = t1 - p.t0;
      if (age < 0 || age > p.life) continue;
      const u = age / p.life;
      const k = 1 - Math.exp(-age * 1.6);
      snap.push({
        x: p.x + p.vx * age * (0.65 + 0.35 * Math.exp(-age * 0.8)) + noise1(age * 0.9 + p.seed) * 24 * age,
        y: p.y + p.vy * age + 0.5 * 30 * age * age + noise1(age * 1.1 + p.seed + 30) * 16 * age,
        r: lerp(p.r0, p.r1, Math.pow(k, 0.75)),
        a: Math.pow(1 - u, 1.5) * 0.28,
        seed: p.seed,
        hot: clamp01(1 - age / 0.28),
      });
    }
    frames.push(snap);
  }
  return frames;
}

// Motes of light dragged into the blade while it charges, flung loose on the hit.
function buildChargeMotes() {
  const rng = mulberry32(0xabcd03);
  const parts = [];
  for (let i = 0; i < 46; i++) {
    const a = rng() * TAU;
    const rad = 130 + rng() * 280;
    parts.push({
      x: GATE.x + Math.cos(a) * rad,
      y: GATE.y + Math.sin(a) * rad * 0.8,
      vx: 0, vy: 0, px: 0, py: 0,
      seed: rng() * 10, born: 0.15 + rng() * 1.25, dead: false,
    });
  }
  const frames = [];
  const dt = 1 / 120;
  for (let f = 0; f < FRAMES; f++) {
    const t0 = f / FPS;
    const t1 = (f + 1) / FPS;
    const p = pose(t1);
    const nx = -p.dirY, ny = p.dirX;  // blade normal
    let tt = t0;
    while (tt < t1 - 1e-9) {
      const h = Math.min(dt, t1 - tt);
      const pull = smoothstep(0.55, 1.60, tt);
      const blast = tt > T.impact ? Math.exp(-(tt - T.impact) * 3.6) : 0;
      for (const s of parts) {
        if (s.dead || tt < s.born) continue;
        const along = 0.16 + 0.84 * ((s.seed % 1) * 0.92);
        const off = ((s.seed % 3) - 1) * 26;
        const tx = p.x + p.dirX * BLADE_LEN * along + nx * off;
        const ty = p.y + p.dirY * BLADE_LEN * along + ny * off;
        const dx = tx - s.x, dy = ty - s.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        s.px = s.x; s.py = s.y;
        s.vx += ((dx / d) * 3000 * pull + noise2(s.seed, tt * 1.4) * 130 - s.vx * 1.1) * h;
        s.vy += ((dy / d) * 3000 * pull + noise2(s.seed + 5, tt * 1.4) * 130 - s.vy * 1.1) * h;
        if (blast > 0) {
          const bdx = s.x - p.tipX, bdy = s.y - p.tipY;
          const bd = Math.hypot(bdx, bdy) + 1e-3;
          s.vx += (bdx / bd) * 2900 * blast * h;
          s.vy += (bdy / bd) * 2900 * blast * h;
        }
        s.x += s.vx * h;
        s.y += s.vy * h;
        if (tt > T.impact + 2.4) s.dead = true;
      }
      tt += h;
    }
    const snap = [];
    for (const s of parts) {
      if (s.dead || t1 < s.born) continue;
      const vis = smoothstep(s.born, s.born + 0.25, t1);
      const alpha = vis * (0.22 + 0.78 * smoothstep(0.6, 1.45, t1)) * (1 - smoothstep(2.9, 3.5, t1));
      if (alpha < 0.02) continue;
      snap.push({ x: s.x, y: s.y, px: s.px, py: s.py, a: alpha, seed: s.seed });
    }
    frames.push(snap);
  }
  return frames;
}

export const SPARKS = buildSparks();
export const DUST = buildDust();
export const MOTES = buildChargeMotes();

/* Ambient embers are analytic (no state to simulate). */
export function embers(t) {
  const rng = mulberry32(0x1111aa);
  const out = [];
  for (let i = 0; i < 22; i++) {
    const sx = rng(), sy = rng(), ph = rng() * TAU;
    const sp = 5 + rng() * 18;
    const x = sx * W + Math.sin(t * (0.21 + sx * 0.3) + ph) * 64;
    const y = H - ((sy * H + t * sp) % (H + 160)) + 40;
    const a = 0.14 + 0.45 * (0.5 + 0.5 * Math.sin(t * (1.1 + sy) + ph * 3));
    out.push({ x, y, a: a * (0.3 + sy * 0.7), r: 0.7 + rng() * 2.0 });
  }
  return out;
}

/* Out-of-focus foreground bokeh. */
export function bokeh(t) {
  // Only a whisper of out-of-focus dust near the bottom of frame: any more and
  // it reads as lens dirt rather than atmosphere.
  const rng = mulberry32(0x2222bb);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const sx = rng(), ph = rng() * TAU;
    out.push({
      x: sx * W + Math.sin(t * 0.13 + ph) * 46,
      y: H * 0.62 + rng() * H * 0.36 + Math.cos(t * 0.11 + ph * 1.7) * 26,
      r: 22 + rng() * 40,
      a: 0.014 + rng() * 0.018,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Impact bookkeeping used by FX / audio
 * ------------------------------------------------------------------ */
export const impactPoint = (() => {
  const p = pose(T.impact);
  return { x: p.tipX, y: FLOOR_Y - 4 };
})();

export function impactFlash(t) {
  const dt = t - T.impact;
  if (dt < 0 || dt > 1.2) return 0;
  return Math.exp(-dt / 0.062) * 0.85 + Math.exp(-dt / 0.30) * 0.22;
}

export function impactEnergy(t) {
  // how "hot" the whole shot is right now (used for bounce light and grading)
  return clamp01(impactFlash(t) * 1.4);
}

export { clamp, clamp01, lerp, smoothstep, smootherstep, fbm2, noise1, noise2, TAU, DEG, invLerp };
