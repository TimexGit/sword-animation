// Small math / easing / noise / color toolbox shared by the scene, the renderer
// and the procedural soundtrack. Pure functions only, no DOM, no Node APIs.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

export function smoothstep(a, b, x) {
  const t = clamp01(invLerp(a, b, x));
  return t * t * (3 - 2 * t);
}

export function smootherstep(a, b, x) {
  const t = clamp01(invLerp(a, b, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Normalised "ease in": starts slow, ends fast. pow curve is snappier than cubic.
export const easeIn = (p) => Math.pow(clamp01(p), 2.6);
export const easeOut = (p) => 1 - Math.pow(1 - clamp01(p), 2.6);
export const easeInOut = (p) => {
  const t = clamp01(p);
  return t < 0.5 ? Math.pow(2 * t, 3) / 2 : 1 - Math.pow(2 - 2 * t, 3) / 2;
};

// Impulse-ish decay used for flashes / shakes.
export const decay = (dt, tau) => (dt < 0 ? 0 : Math.exp(-dt / tau));

/* ------------------------------------------------------------------ *
 * Keyframe track, interpolated with a monotone cubic (PCHIP) spline.
 *
 * Keys are [time, value, tangent?].  Without an explicit tangent the slope
 * comes from the Fritsch-Carlson weighted harmonic mean, which never
 * overshoots: the curve's shape is then controlled purely by where the
 * keys are placed — the way hand-drawn animation timing works.  An explicit
 * tangent is honoured but clamped into the monotone-safe range, so a badly
 * judged slope can never make the motion wobble backwards.
 * ------------------------------------------------------------------ */
export function makeTrack(keys) {
  const ks = keys.map((k) => [k[0], k[1], k[2] === undefined ? null : k[2]]);
  ks.sort((a, b) => a[0] - b[0]);
  const n = ks.length;
  const h = new Array(n - 1);
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = ks[i + 1][0] - ks[i][0] || 1e-9;
    d[i] = (ks[i + 1][1] - ks[i][1]) / h[i];
  }
  const m = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  m[0] = n > 1 ? d[0] : 0;
  m[n - 1] = n > 1 ? d[n - 2] : 0;
  for (let i = 0; i < n; i++) {
    const want = ks[i][2];
    if (want === null) continue;
    if (i === 0 || i === n - 1) {
      const dd = i === 0 ? d[0] : d[n - 2];
      m[i] = dd === 0 ? 0 : Math.sign(dd) * Math.min(Math.abs(want), 3 * Math.abs(dd));
    } else if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const lim = 3 * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]));
      m[i] = want === 0 ? 0 : Math.sign(want) * Math.min(Math.abs(want), lim);
    }
  }
  return function evalTrack(t) {
    if (t <= ks[0][0]) return ks[0][1];
    if (t >= ks[n - 1][0]) return ks[n - 1][1];
    let i = 0;
    while (i < n - 2 && t > ks[i + 1][0]) i++;
    const u = (t - ks[i][0]) / h[i];
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return h00 * ks[i][1] + h10 * h[i] * m[i] + h01 * ks[i + 1][1] + h11 * h[i] * m[i + 1];
  };
}

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------ */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash based value noise (1D / 2D), cheap and stable across platforms.
function hash1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
}

export function noise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1);
}

export function fbm2(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(fx, fy) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
  }
  return sum / (norm || 1);
}

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */
export function rgba(r, g, b, a) {
  return `rgba(${r | 0},${g | 0},${b | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
}

export function mixColor(c0, c1, t) {
  const u = clamp01(t);
  return [
    c0[0] + (c1[0] - c0[0]) * u,
    c0[1] + (c1[1] - c0[1]) * u,
    c0[2] + (c1[2] - c0[2]) * u,
  ];
}

// Hot metal ramp used by sparks: white -> yellow -> orange -> deep red.
export function heatColor(u, alpha = 1) {
  // u = 1 freshly born (hottest), 0 nearly dead
  const x = clamp01(u);
  let r, g, b;
  if (x > 0.72) {
    const k = (x - 0.72) / 0.28;
    r = 255;
    g = 255 * (0.78 + 0.22 * k);
    b = 150 + 105 * k;
  } else if (x > 0.4) {
    const k = (x - 0.4) / 0.32;
    r = 255;
    g = 120 + 79 * k;
    b = 30 + 120 * k;
  } else {
    const k = clamp01(x / 0.4);
    r = 180 + 75 * k;
    g = 30 + 90 * k;
    b = 10 + 20 * k;
  }
  return rgba(r, g, b, alpha);
}

export function coldColor(u, alpha = 1) {
  // cold moonlit steel: white -> pale blue -> deep blue
  const x = clamp01(u);
  return rgba(
    lerp(120, 245, x),
    lerp(165, 250, x),
    lerp(235, 255, x),
    alpha
  );
}
