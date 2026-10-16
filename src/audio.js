// Generate soundtrack WAV in code.
const fs = require("fs");

function writeWav(path, samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    v = v < 0 ? v * 0x8000 : v * 0x7fff;
    buf.writeInt16LE(v | 0, 44 + i * 2);
  }
  fs.writeFileSync(path, buf);
}

function generate(outPath, duration) {
  const sr = 44100;
  const n = Math.floor(sr * duration);
  const samples = new Float32Array(n);
  const impactT = 1.95;

  // ambient low hum
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    samples[i] += 0.04 * Math.sin(2 * Math.PI * 55 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.1 * t));
  }

  // whoosh: noise burst during swing (t 0.85..2.0)
  // precompute noise
  let noiseState = 12345;
  function noise() {
    noiseState = (noiseState * 1103515245 + 12345) & 0x7fffffff;
    return (noiseState / 0x7fffffff) * 2 - 1;
  }
  // simple one-pole lowpass
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let env = 0;
    if (t >= 0.85 && t <= 2.0) {
      const u = (t - 0.85) / (2.0 - 0.85);
      env = Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(Math.PI * u * 2));
    }
    const raw = noise();
    lp = lp + 0.15 * (raw - lp);
    samples[i] += lp * env * 0.55;
  }

  // impact clang at impactT
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const dt = t - impactT;
    if (dt < 0 || dt > 1.5) continue;
    const env = Math.exp(-dt * 4.5);
    // metallic ping
    samples[i] += 0.6 * env * Math.sin(2 * Math.PI * 220 * dt);
    samples[i] += 0.4 * env * Math.sin(2 * Math.PI * 440 * dt);
    samples[i] += 0.25 * env * Math.sin(2 * Math.PI * 880 * dt);
    // noise burst
    const n2 = noise();
    samples[i] += 0.35 * Math.exp(-dt * 8) * n2;
    // low thud
    samples[i] += 0.5 * Math.exp(-dt * 6) * Math.sin(2 * Math.PI * 60 * dt);
  }

  // tail shimmer
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t < 2.0) continue;
    const dt = t - 2.0;
    const env = Math.exp(-dt * 1.2) * 0.4;
    samples[i] += env * 0.15 * Math.sin(2 * Math.PI * 660 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t));
  }

  // normalize
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = 0.85 / (peak || 1);
  for (let i = 0; i < n; i++) samples[i] *= gain;

  writeWav(outPath, samples, sr);
  console.log("wrote", outPath);
}

module.exports = { generate };
if (require.main === module) {
  const out = process.argv[2] || "audio/soundtrack.wav";
  generate(out, 5);
}
