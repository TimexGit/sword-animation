// Render the procedural soundtrack to audio/soundtrack.wav and report levels.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSoundtrack, encodeWav } from "../src/lib/audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const out = process.argv[2] || path.join(root, "audio", "soundtrack.wav");

const t0 = Date.now();
const { left, right, sampleRate } = renderSoundtrack();
const wav = encodeWav(left, right, sampleRate);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, wav);

// quick analysis so the mix can be judged without listening
let peak = 0, sum = 0, sumL = 0, sumR = 0;
for (let i = 0; i < left.length; i++) {
  const a = Math.abs(left[i]), b = Math.abs(right[i]);
  peak = Math.max(peak, a, b);
  sum += (left[i] + right[i]) / 2 * ((left[i] + right[i]) / 2);
  sumL += left[i] * left[i];
  sumR += right[i] * right[i];
}
const db = (x) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
const window = (t) => {
  const s = Math.floor(t * sampleRate), e = Math.floor((t + 0.1) * sampleRate);
  let p = 0, r = 0;
  for (let i = s; i < e && i < left.length; i++) {
    p = Math.max(p, Math.abs(left[i]), Math.abs(right[i]));
    r += left[i] * left[i] + right[i] * right[i];
  }
  return { peak: db(p), rms: db(Math.sqrt(r / ((e - s) * 2))) };
};
console.log(`wrote ${out}  (${(wav.length / 1024 / 1024).toFixed(2)} MB, ${(Date.now() - t0)} ms)`);
console.log(`peak ${db(peak)} dBFS   rms ${db(Math.sqrt(sum / left.length))} dB`);
console.log(`stereo balance L/R: ${db(Math.sqrt(sumL / left.length))} / ${db(Math.sqrt(sumR / right.length))} dB`);
if (process.argv.includes("--envelope")) {
  const rows = [];
  for (let t = 0; t < 5; t += 0.05) {
    const w = window(t);
    rows.push(`${t.toFixed(2)} ${String(w.peak).padStart(4)} ${String(w.rms).padStart(4)}  ${"#".repeat(Math.max(0, Math.round((Number(w.rms) + 40) * 1.2)))}`);
  }
  console.log("  t    peak  rms");
  console.log(rows.join("\n"));
} else {
  for (const t of [0.2, 0.8, 1.3, 1.7, 1.82, 1.86, 1.90, 2.1, 2.6, 3.4, 4.4, 4.9]) {
    const w = window(t);
    console.log(`  t=${t.toFixed(2)}s  peak ${w.peak}  rms ${w.rms}`);
  }
}
