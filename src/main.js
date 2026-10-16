// Browser entry: live preview with the procedurally generated soundtrack, plus
// the capture hook used by the Playwright renderer.

import { createRenderer } from "./render.js";
import { W, H, FPS, FRAMES, DURATION, T, pose, BLADE_LEN } from "./scene.js";
import { renderSoundtrack } from "./lib/audio.js";

const params = new URLSearchParams(location.search);
const isRenderMode = params.get("render") === "1";

const view = document.getElementById("view");
const ctx = view.getContext("2d", { alpha: false, desynchronized: false });
const renderer = createRenderer();
renderer.drawTo(ctx, 0);           // warm the caches

/* ---------------- capture API used by scripts/render.mjs ---------------- */
let captureOpts = {};
window.SwordApp = {
  renderer,
  W, H, FPS, FRAMES, DURATION, T,
  ready: false,
  setOptions(o) { captureOpts = { ...captureOpts, ...o }; },
  /* Render a specific frame and return it as a PNG data URL. */
  capture(t, extra) {
    const c = renderer.drawTo(ctx, t, { ...captureOpts, ...(extra || {}) });
    return c.toDataURL("image/png");
  },
  drawDebug(t) {
    const c = renderer.drawTo(ctx, t, captureOpts);
    const p = pose(t);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // tip trajectory of the whole shot
    ctx.beginPath();
    for (let i = 0; i <= 500; i++) {
      const q = pose((i / 500) * DURATION);
      const s = q;
      if (i === 0) ctx.moveTo(s.tipX, s.tipY);
      else ctx.lineTo(s.tipX, s.tipY);
    }
    ctx.strokeStyle = "rgba(255,120,160,0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // per-frame tip marks
    for (let f = 0; f <= FRAMES; f++) {
      const q = pose(f / FPS);
      ctx.beginPath();
      ctx.arc(q.tipX, q.tipY, 4, 0, Math.PI * 2);
      ctx.fillStyle = f % 5 === 0 ? "#ffd166" : "rgba(255,209,102,0.45)";
      ctx.fill();
    }
    ctx.font = "20px ui-monospace, monospace";
    ctx.fillStyle = "#cfe0ff";
    ctx.fillText(`t=${t.toFixed(3)}  frame=${Math.round(t * FPS)}  ang=${p.angle.toFixed(1)}°  ω=${p.omega.toFixed(0)}°/s  tip=${p.tipX.toFixed(0)},${p.tipY.toFixed(0)}`, 24, 40);
    return c;
  },
  captureDebug(t) { this.drawDebug(t); return view.toDataURL("image/png"); },
};
window.__ready = true;

/* ---------------- soundtrack ---------------- */
let audioCtx = null;
let audioBuffer = null;
let audioSource = null;
let audioStart = 0;
let audioPlaying = false;

async function ensureAudio() {
  if (audioBuffer) return true;
  try {
    const { left, right, sampleRate } = renderSoundtrack();
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const buf = audioCtx.createBuffer(2, left.length, sampleRate);
    buf.copyToChannel(left, 0);
    buf.copyToChannel(right, 1);
    audioBuffer = buf;
    return true;
  } catch (e) {
    console.warn("audio unavailable", e);
    return false;
  }
}

/* ---------------- playback ---------------- */
let playing = false;
let looping = true;
let debug = false;
let t0 = 0;
let last = 0;
let fpsAcc = 0;
let fpsN = 0;

const scrub = document.getElementById("scrub");
const tcode = document.getElementById("tcode");
const fpsEl = document.getElementById("fps");
const playBtn = document.getElementById("play");
const loopBtn = document.getElementById("loop");
const dbgBtn = document.getElementById("dbg");

function currentT() {
  if (playing) {
    let t = t0 + (performance.now() - last) / 1000;
    if (audioPlaying && audioCtx) t = audioStart + (audioCtx.currentTime - audioStartClock);
    if (looping) t = t % DURATION;
    else t = Math.min(t, DURATION - 1 / FPS);
    return t;
  }
  return Number(scrub.value);
}

let audioStartClock = 0;

function frame(now) {
  const t = currentT();
  if (debug) window.SwordApp.drawDebug(t);
  else renderer.drawTo(ctx, t);
  scrub.value = String(t);
  tcode.textContent = `${t.toFixed(3)}s · frame ${Math.min(FRAMES - 1, Math.floor(t * FPS))}`;
  if (now) {
    fpsAcc += now - (frame._last || now);
    frame._last = now;
    fpsN++;
    if (fpsN >= 20) {
      fpsEl.textContent = `${(1000 / (fpsAcc / fpsN)).toFixed(1)} fps (preview)`;
      fpsAcc = 0;
      fpsN = 0;
    }
  }
  requestAnimationFrame(frame);
}

playBtn.onclick = async () => {
  if (playing) {
    playing = false;
    playBtn.textContent = "▶ Play";
    if (audioSource) { try { audioSource.stop(); } catch (e) {} audioSource = null; }
    audioPlaying = false;
    return;
  }
  playing = true;
  playBtn.textContent = "❚❚ Pause";
  last = performance.now();
  t0 = Number(scrub.value);
  const ok = await ensureAudio();
  if (ok) {
    if (audioCtx.state === "suspended") await audioCtx.resume();
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.loop = looping;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.9;
    audioSource.connect(gain).connect(audioCtx.destination);
    audioSource.start(0, t0 % DURATION);
    audioStart = t0;
    audioStartClock = audioCtx.currentTime;
    audioPlaying = true;
    audioSource.onended = () => {
      if (looping && playing) {
        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.loop = true;
        audioSource.connect(gain);
        audioSource.start(0);
        audioStart = 0;
        audioStartClock = audioCtx.currentTime;
      }
    };
  }
};

loopBtn.onclick = () => {
  looping = !looping;
  loopBtn.textContent = `Loop: ${looping ? "on" : "off"}`;
  loopBtn.classList.toggle("on", looping);
  if (audioSource) audioSource.loop = looping;
};
dbgBtn.onclick = () => {
  debug = !debug;
  dbgBtn.textContent = `Debug: ${debug ? "on" : "off"}`;
};
scrub.oninput = () => {
  if (playing) {
    t0 = Number(scrub.value);
    last = performance.now();
    if (audioPlaying && audioCtx) { audioStart = t0; audioStartClock = audioCtx.currentTime; }
  }
};
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
  if (e.code === "KeyD") dbgBtn.click();
  if (e.code === "KeyL") loopBtn.click();
});

if (isRenderMode) {
  document.getElementById("hud").style.display = "none";
  document.getElementById("tag").style.display = "none";
  document.getElementById("boot").style.display = "none";
} else {
  const boot = document.getElementById("boot");
  requestAnimationFrame(() => {
    boot.style.opacity = "0";
    setTimeout(() => boot.remove(), 420);
  });
  requestAnimationFrame(frame);
}
