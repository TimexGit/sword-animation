// Frame orchestrator: builds one complete image for a given time.
//
//   env canvas  : sky, gate, floor, fog, altar, foreground   (once per frame)
//   main canvas : sub-frame accumulated sword passes on top of the env, which
//                 is what gives the swing its motion blur
//   fx          : trail, motes, sparks, dust, impact
//   post        : bloom, anamorphic streak, grade, lens split, vignette, grain

import { clamp, clamp01, lerp, rgba, DEG, noise1, smoothstep } from "./lib/util.js";
import {
  W, H, FPS, DURATION, FRAMES, FLOOR_Y, GATE, T, impactPoint,
  pose, camBaseAt, shakeAt, impactFlash, impactEnergy,
} from "./scene.js";
import { makeCanvas, makeBloom, makeSplitter, grainTile } from "./draw/gfx.js";
import {
  makeLayer, drawSky, drawGate, drawFloor, drawMist, drawAtmosphere,
  drawForeground, drawSwordShadow, drawStonework,
} from "./draw/env.js";
import { drawSword, drawGrip } from "./draw/sword.js";
import { drawTrail, drawSparks, drawDust, drawMotes, drawImpact } from "./draw/fx.js";

export const DEFAULTS = {
  subFrames: 10,
  fastSubFrames: 26,
  shutter: 0.58,        // fraction of a frame the virtual shutter is open
  bloom: true,
  streak: true,
  grade: true,
  grain: true,
  bounceLight: true,
  fadeInFrames: 2,
  fadeOutFrames: 9,
};

export function createRenderer(userOpts = {}) {
  const optsAll = { ...DEFAULTS, ...userOpts };

  const envCanvas = makeCanvas(W, H);
  const envCtx = envCanvas.getContext("2d");
  const fgLayer = makeLayer(4);
  drawForeground(fgLayer);
  const bloom = makeBloom(4, 4);
  bloom.resize(W, H);
  const split = makeSplitter();
  split.resize(W, H);
  const scratch = makeCanvas(W, H);
  const sctx = scratch.getContext("2d");
  const post = makeCanvas(W, H);
  const pctx = post.getContext("2d");

  /* transform for camera-space drawing at a given shake offset */
  function applyCam(ctx, cb, sh) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(W / 2 + sh.x, H / 2 + sh.y);
    ctx.rotate(cb.rot + sh.rot);
    ctx.scale(cb.zoom, cb.zoom);
    ctx.translate(-cb.x, -cb.y);
  }

  /* environment drawn at the base camera pose (shake is added later so the
   * whole plate can be moved rigidly for the motion blur) */
  function drawEnvironment(tMid) {
    const cb = camBaseAt(tMid);
    envCtx.setTransform(1, 0, 0, 1, 0, 0);
    envCtx.globalAlpha = 1;
    envCtx.globalCompositeOperation = "source-over";
    envCtx.clearRect(0, 0, W, H);
    envCtx.save();
    applyCam(envCtx, cb, { x: 0, y: 0, rot: 0 });
    drawSky(envCtx, tMid);
    drawGate(envCtx, tMid, 1);
    drawFloor(envCtx, tMid);
    drawMist(envCtx, tMid);
    const flash = clamp01(impactFlash(tMid) * 1.1);
    drawStonework(envCtx, tMid, { flash });
    const p = pose(tMid);
    drawSwordShadow(envCtx, p, 0.45 + 0.55 * smoothstep(T.windup, T.loaded, tMid));
    // defocused foreground: nearer, so it scales a touch more
    const fz = cb.zoom * 1.045;
    envCtx.save();
    envCtx.translate(W / 2, H / 2);
    envCtx.scale(fz, fz);
    envCtx.translate(-W / 2, -H / 2);
    envCtx.translate(-(cb.x - W / 2) * 0.10, -(cb.y - H / 2) * 0.10);
    envCtx.drawImage(fgLayer.canvas, 0, 0, W, H);
    envCtx.restore();
    envCtx.restore();
  }

  function draw(origin, t, callOpts = {}) {
    // per-call options override the renderer's defaults
    const o = { ...optsAll, ...callOpts };
    const tMid = t;
    const cb = camBaseAt(tMid);
    const shMid = shakeAt(tMid);
    const frame = Math.max(0, Math.min(FRAMES - 1, Math.round(t * FPS)));

    /* ---------- 1. environment plate ---------- */
    drawEnvironment(tMid);

    /* ---------- 2. sword, accumulated ---------- */
    const pMid = pose(tMid);
    const N = Math.abs(pMid.omega) > 600 ? o.fastSubFrames : o.subFrames;
    const dt = (o.shutter ?? 0.58) / FPS;
    origin.setTransform(1, 0, 0, 1, 0, 0);
    origin.globalAlpha = 1;
    origin.globalCompositeOperation = "source-over";
    origin.clearRect(0, 0, W, H);

    for (let s = 0; s < N; s++) {
      const ts = t - dt / 2 + ((s + 0.5) / N) * dt;   // shutter centred on t
      const sh = shakeAt(ts);
      origin.save();
      // the plate is rigid: shift + rotate it by the delta shake only
      origin.translate(W / 2, H / 2);
      origin.rotate(sh.rot - shMid.rot);
      origin.translate(-W / 2, -H / 2);
      origin.drawImage(envCanvas, sh.x - shMid.x, sh.y - shMid.y);
      origin.restore();

      const ps = pose(ts);
      const fl = clamp01(impactFlash(ts));
      const oc = camBaseAt(ts);
      origin.save();
      applyCam(origin, oc, sh);
      origin.globalAlpha = 1 / N;
      drawSword(origin, ps, {
        charge: ps.charge, flash: fl, hand: o.hand, t: ts, grip: false,
        warmOrigin: o.bounceLight ? { x: impactPoint.x, y: FLOOR_Y } : null,
      });
      origin.restore();
    }

    /* ---------- 3. trail, particles, impact (camera space) ---------- */
    const sh = shMid;
    const place = () => applyCam(origin, cb, sh);

    // the arm, once, at full opacity (see drawSword: accumulated sub-frames
    // would leave it translucent and the background would show through)
    if (o.grip !== false) {
      origin.save();
      place();
      origin.globalAlpha = 1;
      drawGrip(origin, pMid, { charge: pMid.charge, flash: clamp01(impactFlash(tMid)), t: tMid });
      origin.restore();
    }

    if (o.trail !== false) {
      origin.save();
      place();
      drawTrail(origin, t, { alpha: 1 });
      origin.restore();
    }

    origin.save();
    place();
    if (o.motes !== false) drawMotes(origin, frame);
    if (o.sparks !== false) drawSparks(origin, frame);
    if (o.dust !== false) drawDust(origin, frame);
    if (o.impact !== false) drawImpact(origin, t, { scale: 1 });
    origin.restore();

    origin.save();
    applyCam(origin, { x: cb.x, y: cb.y, zoom: cb.zoom * 1.03, rot: cb.rot }, sh);
    drawAtmosphere(origin, t);
    origin.restore();

    /* ---------- 4. post ---------- */
    origin.setTransform(1, 0, 0, 1, 0, 0);
    if (o.bloom) {
      // square the image twice (multiply with itself) -> a cheap threshold:
      // only genuinely bright pixels survive into the glow
      bloom.extract(origin.canvas, W, H, 2);
      const mid = bloom.blur(1.7);
      origin.save();
      origin.globalCompositeOperation = "lighter";
      origin.globalAlpha = 0.20;
      origin.drawImage(mid, 0, 0, W, H);
      origin.restore();
      const wide = bloom.blur(4.6);
      origin.save();
      origin.globalCompositeOperation = "lighter";
      origin.globalAlpha = 0.095;
      origin.drawImage(wide, 0, 0, W, H);
      origin.restore();
      if (o.streak) {
        const st = bloom.streak(11, 20);
        origin.save();
        origin.globalCompositeOperation = "lighter";
        origin.globalAlpha = 0.14;
        origin.drawImage(st, 0, 0, W, H);
        origin.restore();
      }
    }

    if (o.exposure !== 1) {
      // Exposure is a linear multiply; the lift restores a filmic floor so the
      // blacks keep their colour instead of crushing to pure black.
      origin.save();
      origin.globalCompositeOperation = "lighter";
      origin.globalAlpha = clamp01((o.exposure - 1) * 0.35);
      origin.fillStyle = "rgb(30,40,66)";
      origin.fillRect(0, 0, W, H);
      origin.restore();
    }

    if (o.grade) {
      // cool shadows / warm highlights, gently
      origin.save();
      origin.globalCompositeOperation = "soft-light";
      origin.globalAlpha = 0.26;
      const g = origin.createLinearGradient(0, 0, W * 0.55, H);
      g.addColorStop(0, "rgba(56,92,178,0.42)");
      g.addColorStop(0.48, "rgba(104,110,140,0.20)");
      g.addColorStop(1, "rgba(255,166,104,0.34)");
      origin.fillStyle = g;
      origin.fillRect(0, 0, W, H);
      origin.restore();

      // lift the blacks a hair so the shadows keep some colour
      origin.save();
      origin.globalCompositeOperation = "lighter";
      origin.globalAlpha = 0.038;
      origin.fillStyle = "rgb(24,32,58)";
      origin.fillRect(0, 0, W, H);
      origin.restore();
    }

    // lens split on the hit
    const fdt = t - T.impact;
    if (o.split !== false && fdt > -0.03 && fdt < 0.20) {
      const amt = Math.exp(-Math.max(0, fdt) / 0.045) * 2.4 + (fdt < 0 ? 0.5 : 0);
      split.apply(origin.canvas, origin, W, H, amt, impactPoint.x, FLOOR_Y - 20, 340);
    }

    // Film response: a global S-curve. Everything upstream works in a fairly
    // narrow value range, so this is what finally gives the shot a proper
    // black point, clean mid-tones and a little extra colour in the highlights.
    if (o.film !== false) {
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, W, H);
      pctx.drawImage(origin.canvas, 0, 0);
      origin.setTransform(1, 0, 0, 1, 0, 0);
      origin.clearRect(0, 0, W, H);
      origin.filter = "contrast(1.24) saturate(1.12) brightness(0.90)";
      origin.drawImage(post, 0, 0);
      origin.filter = "none";
    }

    // vignette
    origin.save();
    const vg = origin.createRadialGradient(W / 2, H * 0.46, H * 0.30, W / 2, H * 0.5, H * 1.02);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(0.55, "rgba(0,0,0,0.16)");
    vg.addColorStop(1, "rgba(0,0,0,0.62)");
    origin.fillStyle = vg;
    origin.fillRect(0, 0, W, H);
    origin.restore();

    if (o.grain) {
      origin.save();
      origin.globalCompositeOperation = "overlay";
      origin.globalAlpha = 0.05;
      const g = grainTile(512, 7);
      const ox = -(Math.floor(noise1(t * 91.7) * 400) % 512);
      const oy = -(Math.floor(noise1(t * 77.3 + 5) * 400) % 512);
      for (let y = 0; y < H + 512; y += 512) {
        for (let x = 0; x < W + 512; x += 512) origin.drawImage(g, x + ox, y + oy);
      }
      origin.restore();
    }

    // short fades so the clip reads as a finished piece
    const f = t * FPS;
    let fade = 1;
    // a short fade from black, but never a fully dead first frame
    if (o.fadeInFrames > 0) fade = Math.min(fade, 0.18 + 0.82 * clamp01(f / o.fadeInFrames));
    if (o.fadeOutFrames > 0) fade = Math.min(fade, 0.06 + 0.94 * clamp01((FRAMES - 1 - f) / o.fadeOutFrames));
    if (fade < 1) {
      origin.save();
      origin.globalAlpha = 1 - fade;
      origin.fillStyle = "#000";
      origin.fillRect(0, 0, W, H);
      origin.restore();
    }
    origin.globalAlpha = 1;
    origin.globalCompositeOperation = "source-over";
    return origin.canvas;
  }

  function drawTo(ctx, t, opts) {
    const c = draw(sctx, t, opts);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(c, 0, 0);
    return c;
  }

  return { draw, drawTo, canvas: scratch, envCanvas, opts: optsAll };
}
