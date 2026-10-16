// Procedural soundtrack. Pure JS + typed arrays so the exact same code runs in
// Node (writing a WAV) and in the browser (playing through Web Audio).
//
// Layers: cave ambience -> tension pad -> riser -> blade whoosh (driven by the
// real angular velocity of the sword) -> impact (inharmonic metal + body + sub)
// -> debris tinkles, all through a convolution reverb built from a synthesised
// impulse response of a stone hall.

import { mulberry32, clamp, clamp01, lerp, smoothstep } from "./util.js";
import { pose, T, DURATION } from "../scene.js";

export const SAMPLE_RATE = 48000;

/* ================================================================== *
 *  Tiny DSP kit
 * ================================================================== */
class OnePole {
  constructor(cut = 1000, sr = SAMPLE_RATE) { this.z = 0; this.set(cut, sr); }
  set(cut, sr = SAMPLE_RATE) { this.a = Math.exp((-2 * Math.PI * cut) / sr); }
  lp(x) { this.z = x + this.a * (this.z - x); return this.z; }
  hp(x) { this.z = x + this.a * (this.z - x); return x - this.z; }
}

class Biquad {
  constructor(type = "lowpass", f = 1000, q = 1, sr = SAMPLE_RATE) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.type = type;
    this.set(type, f, q, sr);
  }
  /* Retune an existing filter without repeating its type. */
  tune(f, q) { this.set(this.type, f, q, SAMPLE_RATE); }
  set(type, f, q = 1, sr = SAMPLE_RATE) {
    this.type = type;
    const w = (2 * Math.PI * clamp(Number(f) || 1000, 20, sr * 0.47)) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const qq = Number.isFinite(q) ? Math.max(0.05, q) : 1;
    const alpha = sw / (2 * qq);
    let b0, b1, b2, a0, a1, a2;
    if (type === "lowpass") {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === "highpass") {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else { // bandpass (constant peak gain)
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/* In-place radix-2 FFT (used only for the reverb convolution). */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k], ui = im[i + k];
        const jj = i + k + half;
        const vr = re[jj] * cr - im[jj] * ci;
        const vi = re[jj] * ci + im[jj] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[jj] = ur - vr; im[jj] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

/* Overlap-add convolution with a fixed IR. */
function convolve(sig, ir, block = 16384) {
  const L = ir.length;
  let n = 1;
  while (n < block + L - 1) n <<= 1;
  const irRe = new Float64Array(n);
  const irIm = new Float64Array(n);
  for (let i = 0; i < L; i++) irRe[i] = ir[i];
  // pad the IR to the block size end so the tail is captured
  fft(irRe, irIm, false);

  const out = new Float32Array(sig.length + L);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let start = 0; start < sig.length; start += block) {
    re.fill(0); im.fill(0);
    const len = Math.min(block, sig.length - start);
    for (let i = 0; i < len; i++) re[i] = sig[start + i];
    fft(re, im, false);
    for (let i = 0; i < n; i++) {
      const a = re[i], b = im[i];
      re[i] = a * irRe[i] - b * irIm[i];
      im[i] = a * irIm[i] + b * irRe[i];
    }
    fft(re, im, true);
    for (let i = 0; i < n && start + i < out.length; i++) out[start + i] += re[i];
  }
  return out;
}

/* ================================================================== *
 *  Impulse response of a stone hall, synthesised from noise + taps
 * ================================================================== */
function buildIR(sr, seconds = 1.6, seed = 991) {
  const rng = mulberry32(seed);
  const len = Math.floor(sr * seconds);
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  const lpL = new OnePole(9000, sr);
  const lpR = new OnePole(9000, sr);
  let t60 = 1.0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.exp((-6.908 * t) / t60) * (1 - Math.exp(-t * 400));
    if (i % 64 === 0) {
      // high frequencies die away faster than the low tail
      const cut = 9000 * Math.exp(-t * 1.5) + 700;
      lpL.set(cut, sr);
      lpR.set(cut, sr);
    }
    left[i] = lpL.lp(rng() * 2 - 1) * env;
    right[i] = lpR.lp(rng() * 2 - 1) * env;
    // a hint of diffusion modulated by a slow-ish random walk
    const d = Math.sin(t * 3.1 + rng() * 0.2) * 0.15;
    left[i] += left[Math.max(0, i - 1)] * d;
    right[i] += right[Math.max(0, i - 1)] * d;
  }
  // early reflections of a wide stone room
  const taps = [
    [0.0091, 0.62], [0.0137, -0.5], [0.0193, 0.42], [0.0267, -0.34],
    [0.0361, 0.28], [0.0472, -0.22], [0.0613, 0.17],
  ];
  for (const [tt, g] of taps) {
    const i = Math.floor(tt * sr);
    const r = g * (1 + (rng() - 0.5) * 0.2);
    left[Math.min(len - 1, i)] += r;
    right[Math.min(len - 1, i + 37)] += r * 0.92;
  }
  // Normalise so the convolution has unity energy gain: sqrt(sum(ir^2)) = 1
  // per channel.  That makes the wet level predictable from the send level.
  let e = 0;
  for (let i = 0; i < len; i++) e += left[i] * left[i] + right[i] * right[i];
  const g = 1 / Math.sqrt(Math.max(e / 2, 1e-12));
  for (let i = 0; i < len; i++) { left[i] *= g; right[i] *= g; }
  // and scale to a musical reverb gain so the send reads as a real wet level
  const wet = 0.72;
  for (let i = 0; i < len; i++) { left[i] *= wet; right[i] *= wet; }
  return { left, right };
}

/* ================================================================== *
 *  Main render
 * ================================================================== */
export function renderSoundtrack(opts = {}) {
  const sr = opts.sampleRate || SAMPLE_RATE;
  const dur = opts.duration || DURATION;
  const n = Math.floor(sr * dur);
  const rng = mulberry32(20240517);
  const rngL = mulberry32(1234);
  const rngR = mulberry32(5678);
  const impactT = T.impact;
  const hit = Math.round(sr * impactT);

  // separate buses so the mix (and the reverb send) can be balanced properly
  const bedL = new Float32Array(n), bedR = new Float32Array(n);
  const padL = new Float32Array(n), padR = new Float32Array(n);
  const whoL = new Float32Array(n), whoR = new Float32Array(n);
  const hitL = new Float32Array(n), hitR = new Float32Array(n);

  /* ---------- 1. cave bed: drone + air + felt rumble ---------- */
  {
    const windL = new Biquad("lowpass", 420, 0.7, sr);
    const windR = new Biquad("lowpass", 420, 0.7, sr);
    const airL = new Biquad("bandpass", 780, 0.85, sr);
    const airR = new Biquad("bandpass", 780, 0.85, sr);
    const rumble = new OnePole(90, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const breath = 0.72 + 0.28 * Math.sin(2 * Math.PI * 0.083 * t);
      const breath2 = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.061 * t + 1.7);
      const drone =
        0.16 * Math.sin(2 * Math.PI * 55.0 * t) * breath +
        0.10 * Math.sin(2 * Math.PI * 82.41 * t + 0.6) * breath2 +
        0.055 * Math.sin(2 * Math.PI * 110.0 * t + 2.1) +
        0.03 * Math.sin(2 * Math.PI * 164.81 * t) +
        0.018 * Math.sin(2 * Math.PI * 220.0 * t + 4.0);
      const mv = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.047 * t);
      if (i % 64 === 0) {
        windL.tune(240 + 320 * mv, 0.7);
        windR.tune(260 + 300 * (1 - mv), 0.7);
        airL.tune(600 + 420 * mv, 0.85);
        airR.tune(640 + 400 * (1 - mv), 0.85);
      }
      const wl = windL.process(rngL() * 2 - 1);
      const wr = windR.process(rngR() * 2 - 1);
      const al = airL.process(rngL() * 2 - 1);
      const ar = airR.process(rngR() * 2 - 1);
      const bed = 0.02 + 0.05 * mv;
      bedL[i] = drone * 0.96 + wl * 0.16 * bed + al * 0.26 * bed;
      bedR[i] = drone * 1.04 + wr * 0.16 * bed + ar * 0.26 * bed;
    }
    // 31 Hz rumble, felt rather than heard
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const r = rumble.lp(rngL() * 2 - 1) * 0.4 * Math.sin(2 * Math.PI * 31 * t);
      bedL[i] += r * 0.02;
      bedR[i] += r * 0.02;
    }
  }

  /* ---------- 2. tension pad: additive voices through a rising filter ---------- */
  {
    const voices = [
      [110.0, 1.0, -0.9, 0.9], [130.81, 0.85, 1.1, -1.2],
      [164.81, 0.8, -1.4, 1.3], [220.0, 0.62, 1.6, -1.5],
      [261.63, 0.5, -1.8, 1.7], [329.63, 0.42, 2.0, -2.1],
      [392.0, 0.3, -2.2, 2.3], [493.88, 0.22, 2.4, -2.5],
    ];
    const partials = 9;
    const oscL = [], oscR = [];
    for (let v = 0; v < voices.length; v++) {
      oscL.push([]); oscR.push([]);
      for (let k = 1; k <= partials; k++) {
        const tilt = Math.exp(-k * 0.42) * (1 + 0.9 * Math.exp(-Math.pow((k - 2.2) / 1.1, 2)));
        oscL[v].push({ f: voices[v][0] * k, a: tilt, ph: rng() * 6.283 });
        oscR[v].push({ f: voices[v][0] * k, a: tilt, ph: rng() * 6.283 });
      }
    }
    const lpA = new OnePole(700, sr);
    const lpB = new OnePole(700, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const swell = smoothstep(0.35, 1.75, t) * (1 - smoothstep(1.815, 1.895, t));
      const resolve = smoothstep(impactT + 0.12, impactT + 0.95, t) * (1 - smoothstep(3.5, 5.0, t));
      const env = 0.14 + 0.86 * Math.max(swell, resolve);
      if (env < 0.03) continue;
      const cut = 460 + 3200 * smoothstep(0.5, 1.87, t) * (0.35 + 0.65 * swell);
      if (i % 48 === 0) { lpA.set(cut, sr); lpB.set(cut, sr); }
      const vib = 1 + 0.0022 * Math.sin(2 * Math.PI * 4.6 * t + 0.4);
      let sa = 0, sb = 0;
      for (let v = 0; v < voices.length; v++) {
        const vg = voices[v][1];
        for (let k = 0; k < partials; k++) {
          const p = oscL[v][k], q = oscR[v][k];
          sa += Math.sin(2 * Math.PI * p.f * vib * t + p.ph) * p.a * vg;
          sb += Math.sin(2 * Math.PI * q.f * vib * t + q.ph) * q.a * vg;
        }
      }
      const g = env * 0.0072;
      padL[i] = lpA.lp(sa * 0.02) * g;
      padR[i] = lpB.lp(sb * 0.02) * g;
    }
  }

  /* ---------- 3. riser ---------- */
  {
    const bpL = new Biquad("bandpass", 300, 1.2, sr);
    const bpR = new Biquad("bandpass", 300, 1.2, sr);
    const hissL = new Biquad("highpass", 3000, 0.8, sr);
    const hissR = new Biquad("highpass", 3000, 0.8, sr);
    const t0 = 0.62;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (t < t0 || t > impactT + 0.01) continue;
      const u = clamp01((t - t0) / (impactT - t0));
      const f = 260 * Math.pow(16, Math.pow(u, 1.25));
      const q = 1.1 + 7.5 * Math.pow(u, 2);
      if (i % 32 === 0) { bpL.tune(f, q); bpR.tune(f * 1.02, q); }
      const trem = 1 - (0.15 + 0.5 * Math.pow(u, 2)) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (3.5 + 15 * u) * t));
      const env = Math.pow(u, 1.7) * trem;
      const g = 0.155 * env;
      bedL[i] += bpL.process(rngL() * 2 - 1) * g;
      bedR[i] += bpR.process(rngR() * 2 - 1) * g;
      const hg = 0.022 * Math.pow(u, 3);
      bedL[i] += hissL.process(rngL() * 2 - 1) * hg;
      bedR[i] += hissR.process(rngR() * 2 - 1) * hg;
      const tone = Math.sin(2 * Math.PI * 98 * Math.pow(4.2, u) * t) * 0.008 * env;
      bedL[i] += tone;
      bedR[i] += tone * 0.92;
    }
  }

  /* ---------- 4. the sword's whoosh, driven by the real blade motion ---------- */
  {
    const wL = new Biquad("bandpass", 1800, 1.1, sr);
    const wR = new Biquad("bandpass", 1800, 1.1, sr);
    const lowL = new Biquad("lowpass", 5000, 0.8, sr);
    const lowR = new Biquad("lowpass", 5000, 0.8, sr);
    const subL = new Biquad("bandpass", 140, 0.9, sr);
    const subR = new Biquad("bandpass", 140, 0.9, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const p = pose(t);
      const sp = Math.abs(p.omega);
      if (sp < 25) continue;
      const drive = Math.pow(clamp01((sp - 25) / 1300), 1.35);
      const f = 900 + 3400 * clamp01((sp - 100) / 1400);
      if (i % 24 === 0) {
        wL.tune(f, 1.0 + 1.6 * p.roll);
        wR.tune(f * 0.97, 1.0 + 1.6 * p.roll);
        lowL.tune(2200 + 6000 * drive, 0.8);
        lowR.tune(2200 + 6000 * drive, 0.8);
        subL.tune(90 + 200 * (1 - p.roll), 0.9);
        subR.tune(90 + 200 * (1 - p.roll), 0.9);
      }
      const nl = rngL() * 2 - 1;
      const nr = rngR() * 2 - 1;
      const stop = t > impactT ? Math.exp(-(t - impactT) / 0.012) : 1;
      const g = 0.26 * drive * stop;
      const bodyA = lowL.process(nl) * 0.9;
      const bodyB = lowR.process(nr) * 0.9;
      const air = wL.process(nl);
      const airR = wR.process(nr);
      const subA = subL.process(nl) * 0.5;
      const subB = subR.process(nr) * 0.5;
      const pan = clamp((p.tipX / 1920) * 2 - 1, -1, 1) * 0.55;
      const gl = Math.sqrt((1 - pan) / 2) * 1.414;
      const gr = Math.sqrt((1 + pan) / 2) * 1.414;
      whoL[i] = (bodyA * 0.4 + air * 0.75 + subA * 0.3) * g * gl;
      whoR[i] = (bodyB * 0.4 + airR * 0.75 + subB * 0.3) * g * gr;
    }
  }

  /* ---------- 5. the strike ---------- */
  {
    const metal = [
      [1.0, 1.0, 0.62], [1.87, 0.72, 0.46], [2.71, 0.5, 0.34],
      [3.42, 0.38, 0.26], [4.53, 0.3, 0.19], [5.91, 0.22, 0.14],
      [7.4, 0.16, 0.09], [9.6, 0.12, 0.07],
    ];
    const base = 620;
    const bodyL = new Biquad("bandpass", 1150, 0.7, sr);
    const bodyR = new Biquad("bandpass", 1250, 0.7, sr);
    const crackL = new Biquad("highpass", 3800, 0.8, sr);
    const crackR = new Biquad("highpass", 4000, 0.8, sr);
    for (let i = Math.max(0, hit - 4); i < Math.min(n, hit + Math.floor(sr * 2.2)); i++) {
      const dt = (i - hit) / sr;
      if (dt < 0) continue;
      let m = 0, mR = 0;
      for (const [ratio, amp, dec] of metal) {
        const e = Math.exp(-dt / dec);
        if (e < 1e-4) continue;
        const f = base * ratio;
        m += Math.sin(2 * Math.PI * f * dt) * amp * e;
        mR += Math.sin(2 * Math.PI * f * 1.004 * dt + 0.7) * amp * e;
      }
      const c = Math.exp(-dt / 0.0075);
      const nl = rngL() * 2 - 1;
      const nr = rngR() * 2 - 1;
      const k = Math.exp(-dt / 0.055) * Math.sin(2 * Math.PI * (196 - dt * 260) * dt);
      const sub = Math.exp(-dt / 0.42) * Math.sin(2 * Math.PI * (86 - 44 * Math.min(1, dt / 0.3)) * dt)
        * (1 - Math.exp(-dt * 900));
      hitL[i] += m * 0.062 + crackL.process(nl) * c * 0.30 + k * 0.075 + sub * 0.46
        + bodyL.process(nl) * Math.exp(-dt / 0.09) * 0.10;
      hitR[i] += mR * 0.062 + crackR.process(nr) * c * 0.28 + k * 0.07 + sub * 0.46
        + bodyR.process(nr) * Math.exp(-dt / 0.09) * 0.10;
    }
  }

  /* ---------- 6. debris settling: scattered metallic tinkles ---------- */
  {
    const scale = [1.0, 1.335, 1.5, 1.782, 2.0, 2.378, 3.0];
    for (let k = 0; k < 22; k++) {
      const t0 = impactT + 0.05 + Math.pow(rng(), 1.6) * 2.15;
      const start = Math.floor(t0 * sr);
      if (start >= n) continue;
      const f0 = 900 + rng() * 2600;
      const amp = 0.018 + Math.pow(rng(), 2) * 0.05;
      const pan = (rng() * 2 - 1) * 0.7;
      const gl = Math.sqrt((1 - pan) / 2) * 1.414;
      const gr = Math.sqrt((1 + pan) / 2) * 1.414;
      const dec = 0.06 + rng() * 0.14;
      const mul = scale[(rng() * scale.length) | 0];
      for (let i = start; i < Math.min(n, start + Math.floor(sr * 0.5)); i++) {
        const dt = (i - start) / sr;
        const e = Math.exp(-dt / dec);
        if (e < 1e-4) break;
        const s = Math.sin(2 * Math.PI * f0 * mul * dt) * 0.6 +
                  Math.sin(2 * Math.PI * f0 * mul * 2.41 * dt) * 0.3 +
                  Math.sin(2 * Math.PI * f0 * mul * 3.77 * dt) * 0.18;
        hitL[i] += s * e * amp * gl;
        hitR[i] += s * e * amp * gr;
      }
    }
  }

  /* ---------- 7. reverb: synthesised stone hall, on a proper send ---------- */
  const wetL = new Float32Array(n);
  const wetR = new Float32Array(n);
  {
    const ir = buildIR(sr, 1.7, 991);
    const sendL = new Float32Array(n);
    const sendR = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const open = 0.35 + 0.65 * smoothstep(1.2, impactT, t);
      sendL[i] = bedL[i] * 0.30 + padL[i] * 0.55 + whoL[i] * 0.45 + hitL[i] * 0.60 * open;
      sendR[i] = bedR[i] * 0.30 + padR[i] * 0.55 + whoR[i] * 0.45 + hitR[i] * 0.60 * open;
    }
    const a = convolve(sendL, ir.left);
    const b = convolve(sendR, ir.right);
    for (let i = 0; i < n; i++) {
      wetL[i] = a[i] * 0.40;
      wetR[i] = b[i] * 0.40;
    }
  }

  /* ---------- 8. mix, bus level, soft-knee limit, fades ---------- */
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  {
    const hpL = new Biquad("highpass", 28, 0.72, sr);
    const hpR = new Biquad("highpass", 28, 0.72, sr);
    for (let i = 0; i < n; i++) {
      L[i] = hpL.process(bedL[i] * 1.00 + padL[i] * 1.05 + whoL[i] * 1.0 + hitL[i] * 1.0 + wetL[i]);
      R[i] = hpR.process(bedR[i] * 1.00 + padR[i] * 1.05 + whoR[i] * 1.0 + hitR[i] * 1.0 + wetR[i]);
    }
    // the duck: pull the bed down just before the hit so it lands in a hole
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const pre = Math.exp(-Math.pow((t - (impactT - 0.06)) / 0.05, 2));
      const post = t > impactT ? Math.exp(-(t - impactT) / 0.10) : 0;
      const duck = 1 - 0.34 * pre - 0.22 * post;
      L[i] *= duck;
      R[i] *= duck;
    }
    // normalise the mix first, so the limiter only catches the very top
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(L[i]), b = Math.abs(R[i]);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
    }
    const g = peak > 0 ? 0.86 / peak : 1;
    const knee = 0.62;
    const limit = (x) => {
      const a = Math.abs(x);
      if (a <= knee) return x;
      const s = x < 0 ? -1 : 1;
      return s * (knee + Math.tanh((a - knee) / 0.34) * (0.92 - knee));
    };
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fin = clamp01(t / 0.03);
      const fout = clamp01((DURATION - t) / 0.30);
      const gg = fin * fout;
      L[i] = limit(L[i] * g) * gg;
      R[i] = limit(R[i] * g) * gg;
    }
  }

  return { left: L, right: R, sampleRate: sr, duration: dur };
}

/* ================================================================== *
 *  16-bit PCM WAV encoder (shared by Node + browser)
 * ================================================================== */
export function encodeWav(left, right, sampleRate) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const wr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  wr(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  wr(8, "WAVE");
  wr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  wr(36, "data");
  v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    let a = clamp(left[i], -1, 1);
    let b = clamp(right[i], -1, 1);
    v.setInt16(o, a < 0 ? a * 0x8000 : a * 0x7fff, true);
    v.setInt16(o + 2, b < 0 ? b * 0x8000 : b * 0x7fff, true);
    o += 4;
  }
  return new Uint8Array(buf);
}
