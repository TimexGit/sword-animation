// Render the HTML canvas animation to MP4 using Playwright + FFmpeg.
// Requires a working Chromium (PLAYWRIGHT_BROWSERS_PATH or system chrome).
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG || "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2";
const framesDir = path.join(__dirname, "frames");
fs.mkdirSync(framesDir, { recursive: true });
for (const f of fs.readdirSync(framesDir)) if (f.endsWith(".png")) fs.unlinkSync(path.join(framesDir, f));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const url = "file://" + path.join(__dirname, "index.html");
await page.goto(url);
const FPS = 30, DUR = 5;
const total = FPS * DUR;
for (let i = 0; i < total; i++) {
  const t = i / FPS;
  // advance animation clock by evaluating drawFrame at exact t
  await page.evaluate((t) => {
    const c = document.getElementById('c');
    const ctx = c.getContext('2d');
    window.SwordAnim.drawFrame(ctx, t);
  }, t);
  await page.screenshot({ path: path.join(framesDir, `frame_${String(i + 1).padStart(4, "0")}.png`) });
}
await browser.close();

const audioPath = path.join(__dirname, "audio", "soundtrack.wav");
const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
execFileSync(FFMPEG, [
  "-y", "-framerate", String(FPS), "-i", path.join(framesDir, "frame_%04d.png"),
  "-i", audioPath, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest",
  path.join(outDir, "sword.mp4")
], { stdio: "inherit" });
console.log("done");
