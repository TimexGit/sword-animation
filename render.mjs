import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sword = await import("./src/sword.js");
const { W, H, DURATION, FPS, drawFrame } = sword.default || sword;

const FFMPEG = process.env.FFMPEG || "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2";

const framesDir = path.join(__dirname, "frames");
fs.mkdirSync(framesDir, { recursive: true });
// clean old frames
for (const f of fs.readdirSync(framesDir)) if (f.endsWith(".png")) fs.unlinkSync(path.join(framesDir, f));

const totalFrames = Math.round(DURATION * FPS);
console.log("rendering", totalFrames, "frames", W, "x", H);

for (let i = 0; i < totalFrames; i++) {
  const t = i / FPS;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawFrame(ctx, t);
  const buf = canvas.toBuffer("image/png");
  const name = `frame_${String(i + 1).padStart(4, "0")}.png`;
  fs.writeFileSync(path.join(framesDir, name), buf);
  if (i % 10 === 0) console.log("frame", i + 1, "/", totalFrames);
}
console.log("frames done");

// generate audio
const { generate } = await import("./src/audio.js");
const audioPath = path.join(__dirname, "audio", "soundtrack.wav");
fs.mkdirSync(path.dirname(audioPath), { recursive: true });
generate(audioPath, DURATION);

// encode mp4
const outDir = path.join(__dirname, "out");
fs.mkdirSync(outDir, { recursive: true });
const mp4Path = path.join(outDir, "sword.mp4");
const args = [
  "-y",
  "-framerate", String(FPS),
  "-i", path.join(framesDir, "frame_%04d.png"),
  "-i", audioPath,
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "18",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-b:a", "192k",
  "-shortest",
  mp4Path,
];
console.log("ffmpeg", args.join(" "));
execFileSync(FFMPEG, args, { stdio: "inherit" });
console.log("done", mp4Path);
