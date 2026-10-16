// QA harness: render a set of probe frames and tile them into labelled contact
// sheets so the motion and the composition can be judged at a glance.
//
//   node scripts/qa.mjs --spec overview            (30 frames, every 5th)
//   node scripts/qa.mjs --spec strike              (16 consecutive frames)
//   node scripts/qa.mjs --spec impact
//   node scripts/qa.mjs --frames 20,45,56,100 --out out/qa/custom.png --cols 4
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";
import { FPS, FRAMES, W, H } from "../src/scene.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const has = (n) => process.argv.includes(`--${n}`);

const SPECS = {
  overview: { from: 0, to: FRAMES - 1, step: 5, cols: 6, tile: [320, 180] },
  strike: { from: 48, to: 66, step: 1, cols: 5, tile: [384, 216] },
  impact: { from: 54, to: 68, step: 1, cols: 5, tile: [384, 216] },
  windup: { from: 10, to: 48, step: 2, cols: 5, tile: [384, 216] },
  recover: { from: 66, to: 148, step: 6, cols: 5, tile: [384, 216] },
  keys: { frames: [0, 18, 36, 42, 46, 50, 53, 55, 56, 57, 58, 60, 66, 78, 96, 118, 132, 148], cols: 6, tile: [320, 180] },
};

const specName = arg("spec", "overview");
const spec = SPECS[specName] || SPECS.overview;
let frames = spec.frames
  ? spec.frames.slice()
  : [];
if (!frames.length) {
  for (let f = spec.from; f <= spec.to; f += spec.step) frames.push(f);
}
if (arg("frames", null)) frames = arg("frames", "").split(",").map((x) => parseInt(x, 10));
const cols = Number(arg("cols", spec.cols || 5));
const tileW = Number(arg("tilew", spec.tile ? spec.tile[0] : 384));
const tileH = Number(arg("tileh", spec.tile ? spec.tile[1] : 216));
const label = !has("nolabel");
const outPath = path.resolve(ROOT, arg("out", `out/qa/${specName}.png`));
const rows = Math.ceil(frames.length / cols);

const FFMPEG = process.env.FFMPEG ||
  (fs.existsSync("/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2")
    ? "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
    : "ffmpeg");
const CHROME = process.env.CHROMIUM_PATH || path.join(ROOT, ".cache", "chromium", "chromium");
const CHROME_LIBS = path.join(ROOT, ".cache", "chromium", "libs", "lib");

const seqDir = path.join(ROOT, "frames", "qa");
fs.rmSync(seqDir, { recursive: true, force: true });
fs.mkdirSync(seqDir, { recursive: true });

const PORT = Number(arg("port", 8188));
const server = await startServer(PORT);
const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
    "--force-color-profile=srgb", "--force-device-scale-factor=1"],
  env: { ...process.env, LD_LIBRARY_PATH: CHROME_LIBS },
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html?render=1`, { waitUntil: "load" });
await page.waitForFunction("window.__ready === true", null, { timeout: 60000 });

const t0 = Date.now();
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const durl = await page.evaluate((tt) => window.SwordApp.capture(tt), f / FPS);
  fs.writeFileSync(path.join(seqDir, `f_${String(i + 1).padStart(4, "0")}.png`),
    Buffer.from(durl.slice(durl.indexOf(",") + 1), "base64"));
}
await browser.close();
server.close();
if (errs.length) console.log("page errors:", errs.slice(0, 5));

// label each tile with its real frame number (evenly stepped lists only)
const FF_FILTERS = spawnSync(FFMPEG, ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout || "";
const HAS_DRAWTEXT = /\bdrawtext\b/.test(FF_FILTERS);
const filters = [
  `scale=${tileW}:${tileH}:flags=lanczos`,
  "setsar=1",
];
const stepped = frames.length > 1 && frames.every((f, i) => i === 0 || f - frames[i - 1] === frames[1] - frames[0]);
if (label && stepped && HAS_DRAWTEXT) {
  const font = fs.existsSync("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
    ? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" : "DejaVuSans-Bold";
  const start = frames[0];
  const step = frames.length > 1 ? frames[1] - frames[0] : 1;
  filters.push(
    `drawtext=fontfile=${font}:text='%{eif\\:${step}*n+${start}\\:d}':x=10:y=8:fontsize=20` +
    `:fontcolor=white@0.92:box=1:boxcolor=black@0.45:boxborderw=6`
  );
}
filters.push(`tile=${cols}x${rows}`, "pad=iw:ih:0:0:black");
const filter = filters.join(",");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
execFileSync(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-framerate", "1", "-i", path.join(seqDir, "f_%04d.png"),
  "-vf", filter, "-frames:v", "1", outPath,
], { stdio: "inherit" });

const st = fs.statSync(outPath);
console.log(`sheet ${path.relative(ROOT, outPath)}  ${frames.length} frames  ${rows}x${cols} tiles  ${(st.size / 1024).toFixed(0)} KB  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`frames: ${frames.join(" ")}`);
