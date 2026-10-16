// Render the animation to MP4:
//   1. serve the repo over http (ES modules need a real origin)
//   2. drive Chromium with Playwright, capture one PNG per frame
//   3. synthesise the soundtrack
//   4. encode with FFmpeg (H.264 + AAC, faststart)
//
// usage: node scripts/render.mjs [--range 50-70] [--step 1] [--no-audio]
//                               [--out out/sword.mp4] [--crf 17] [--preset slow]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";
import { renderSoundtrack, encodeWav } from "../src/lib/audio.js";
import { FPS, FRAMES, W, H, DURATION } from "../src/scene.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg("port", 8173));
const FRAMES_DIR = path.join(ROOT, "frames");
const OUT = path.resolve(ROOT, arg("out", "out/sword.mp4"));
const AUDIO = path.join(ROOT, "audio", "soundtrack.wav");
const CRF = arg("crf", "17");
const PRESET = arg("preset", "slow");
const skipAudio = has("no-audio");
const RANGE = arg("range", null);
const STEP = Number(arg("step", 1));
const TMP_VIDEO = arg("tmpvideo", null);

/* ---------- locate ffmpeg + chromium ---------- */
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const candidates = [
    "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const which = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  throw new Error("ffmpeg not found — set FFMPEG=/path/to/ffmpeg");
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const local = path.join(ROOT, ".cache", "chromium", "chromium");
  if (fs.existsSync(local)) return local;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}
  return undefined; // let Playwright resolve its own download
}

const FFMPEG = findFfmpeg();
const CHROME = findChromium();
const CHROME_LIBS = path.join(ROOT, ".cache", "chromium", "libs", "lib");

/* ---------- 1. frames ---------- */
let lo = 0;
let hi = FRAMES - 1;
if (RANGE) {
  const m = /^(\d+)-(\d+)$/.exec(RANGE);
  if (!m) throw new Error("--range must look like 50-70");
  lo = Number(m[1]);
  hi = Number(m[2]);
}
const list = [];
for (let f = lo; f <= hi; f += STEP) list.push(f);

fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

const server = await startServer(PORT);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--hide-scrollbars", "--force-color-profile=srgb",
    "--disable-lcd-text", "--mute-audio", "--force-device-scale-factor=1",
    `--window-size=${W},${H}`,
  ],
  env: { ...process.env, LD_LIBRARY_PATH: CHROME_LIBS },
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/index.html?render=1`, { waitUntil: "load" });
await page.waitForFunction("window.__ready === true", null, { timeout: 60000 });

const T0 = Date.now();
let i = 0;
for (const f of list) {
  const t = f / FPS;
  const dataUrl = await page.evaluate((tt) => window.SwordApp.capture(tt), t);
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  fs.writeFileSync(path.join(FRAMES_DIR, `frame_${String(f + 1).padStart(4, "0")}.png`), Buffer.from(b64, "base64"));
  i++;
  if (i % 10 === 0 || i === list.length) {
    const el = (Date.now() - T0) / 1000;
    const eta = (el / i) * (list.length - i);
    process.stdout.write(`\r  frame ${f + 1}/${hi + 1}  ${(el / i * 1000).toFixed(0)} ms/frame  eta ${eta.toFixed(0)}s   `);
  }
}
process.stdout.write("\n");
await browser.close();
server.close();
if (errors.length) {
  console.log("page errors:");
  for (const e of errors.slice(0, 8)) console.log("  " + e);
  if (errors.length > 8) console.log(`  … ${errors.length - 8} more`);
  if (errors.some((e) => /ReferenceError|TypeError|SyntaxError/.test(e))) process.exitCode = 1;
}

/* ---------- 2. audio ---------- */
if (!skipAudio) {
  const t0 = Date.now();
  const { left, right, sampleRate } = renderSoundtrack();
  fs.mkdirSync(path.dirname(AUDIO), { recursive: true });
  fs.writeFileSync(AUDIO, encodeWav(left, right, sampleRate));
  console.log(`  soundtrack: ${(left.length / sampleRate).toFixed(2)}s @ ${sampleRate}Hz  (${Date.now() - t0} ms)`);
}

/* ---------- 3. encode ---------- */
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const args = [
  "-y", "-hide_banner", "-loglevel", "warning",
  "-framerate", String(FPS), "-start_number", String(lo + 1),
  "-i", path.join(FRAMES_DIR, "frame_%04d.png"),
];
if (!skipAudio) args.push("-i", AUDIO);
args.push(
  "-c:v", "libx264", "-preset", PRESET, "-crf", CRF,
  "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
  "-x264-params", "keyint=15:min-keyint=15:scenecut=0:bframes=2:ref=4",
  "-tune", "film",
);
if (!skipAudio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest");
args.push("-movflags", "+faststart", OUT);
console.log(`  ffmpeg ${path.basename(FFMPEG)} ${args.join(" ").slice(0, 160)}…`);
execFileSync(FFMPEG, args, { stdio: "inherit" });

const stat = fs.statSync(OUT);
console.log(`\ndone → ${path.relative(ROOT, OUT)}  (${(stat.size / 1024 / 1024).toFixed(2)} MB, ${list.length}/${FRAMES} frames)`);
