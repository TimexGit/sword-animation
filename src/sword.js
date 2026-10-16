// Shared sword animation drawing code. Works in browser and Node (@napi-rs/canvas).
(function (global) {
  const W = 1920;
  const H = 1080;
  const DURATION = 5;
  const FPS = 30;
  const PIVOT = { x: W * 0.52, y: H * 0.62 };
  const BLADE_LEN = 460;

  const KEYFRAMES = [
    [0.0, -0.9],
    [0.9, -2.2],
    [2.0, 1.7],
    [2.6, 1.1],
    [3.9, -0.4],
    [5.0, -0.9],
  ];

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function angleAt(t) {
    t = Math.max(0, Math.min(DURATION, t));
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      const [t0, a0] = KEYFRAMES[i];
      const [t1, a1] = KEYFRAMES[i + 1];
      if (t >= t0 && t <= t1) {
        const s = smoothstep(t0, t1, t);
        return a0 + (a1 - a0) * s;
      }
    }
    return KEYFRAMES[KEYFRAMES.length - 1][1];
  }

  function drawBackground(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a0e1a");
    g.addColorStop(0.5, "#141a2e");
    g.addColorStop(1, "#05060d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // subtle floor
    ctx.save();
    ctx.globalAlpha = 0.35;
    const floor = ctx.createLinearGradient(0, H * 0.78, 0, H);
    floor.addColorStop(0, "rgba(80,90,120,0.0)");
    floor.addColorStop(1, "rgba(80,90,120,0.25)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, H * 0.78, W, H * 0.22);
    ctx.restore();

    // spotlight
    ctx.save();
    const sp = ctx.createRadialGradient(PIVOT.x, PIVOT.y, 0, PIVOT.x, PIVOT.y, 520);
    sp.addColorStop(0, "rgba(90,110,160,0.18)");
    sp.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sp;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSword(ctx, angle, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(PIVOT.x, PIVOT.y);
    ctx.rotate(angle);

    // glow
    ctx.shadowColor = "rgba(180,220,255,0.9)";
    ctx.shadowBlur = 28;

    // blade
    const bladeGrad = ctx.createLinearGradient(-12, -BLADE_LEN, 12, 0);
    bladeGrad.addColorStop(0, "#e8f0ff");
    bladeGrad.addColorStop(0.4, "#b8c6e0");
    bladeGrad.addColorStop(1, "#6a7a9a");
    ctx.fillStyle = bladeGrad;
    ctx.beginPath();
    ctx.moveTo(-18, -16);
    ctx.lineTo(-9, -BLADE_LEN);
    ctx.lineTo(0, -BLADE_LEN - 30);
    ctx.lineTo(9, -BLADE_LEN);
    ctx.lineTo(18, -16);
    ctx.closePath();
    ctx.fill();

    // edge highlight
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, -20);
    ctx.lineTo(0, -BLADE_LEN - 20);
    ctx.lineTo(2, -20);
    ctx.stroke();

    // fuller (groove)
    ctx.strokeStyle = "rgba(60,70,90,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(0, -BLADE_LEN + 20);
    ctx.stroke();

    // guard
    ctx.fillStyle = "#c9a227";
    ctx.shadowColor = "rgba(255,200,80,0.6)";
    ctx.shadowBlur = 12;
    ctx.fillRect(-46, -10, 92, 14);
    // guard ends
    ctx.beginPath();
    ctx.arc(-46, -3, 9, 0, Math.PI * 2);
    ctx.arc(46, -3, 9, 0, Math.PI * 2);
    ctx.fill();

    // handle
    ctx.shadowBlur = 0;
    const handleGrad = ctx.createLinearGradient(-6, 0, 6, 60);
    handleGrad.addColorStop(0, "#3a2a1a");
    handleGrad.addColorStop(1, "#1a1208");
    ctx.fillStyle = handleGrad;
    ctx.fillRect(-7, 4, 14, 58);

    // wrap
    ctx.strokeStyle = "rgba(120,90,50,0.8)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const y = 8 + i * 9;
      ctx.beginPath();
      ctx.moveTo(-7, y);
      ctx.lineTo(7, y + 4);
      ctx.stroke();
    }

    // pommel
    ctx.fillStyle = "#c9a227";
    ctx.shadowColor = "rgba(255,200,80,0.6)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 68, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // particles from impact
  const IMPACT_T = 1.95;
  function drawParticles(ctx, t) {
    const dt = t - IMPACT_T;
    if (dt < 0 || dt > 1.6) return;
    const n = 40;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const seed = i * 9301 + 49297;
      const vx = ((seed % 1000) / 1000 - 0.5) * 900;
      const vy = -200 - (i % 7) * 80 - ((seed >> 3) % 200);
      const x = PIVOT.x + vx * dt * 0.6;
      const y = PIVOT.y + 60 + vy * dt + 0.5 * 600 * dt * dt;
      const life = 1 - dt / 1.6;
      const size = 2 + (i % 4);
      ctx.globalAlpha = life * 0.9;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
      grad.addColorStop(0, "rgba(255,220,120,1)");
      grad.addColorStop(0.4, "rgba(255,120,40,0.8)");
      grad.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, size * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFrame(ctx, t) {
    drawBackground(ctx, t);
    const angle = angleAt(t);

    // motion trail: ghosts
    const trailCount = 6;
    for (let i = trailCount; i >= 1; i--) {
      const tt = t - i * 0.025;
      if (tt < 0) continue;
      const a = angleAt(tt);
      const alpha = 0.06 * (trailCount - i + 1) / trailCount;
      drawSword(ctx, a, alpha);
    }

    drawSword(ctx, angle, 1.0);
    drawParticles(ctx, t);

    // impact shockwave ring
    const rdt = t - IMPACT_T;
    if (rdt >= 0 && rdt < 0.7) {
      const rr = 40 + rdt * 520;
      const ra = (1 - rdt / 0.7) * 0.6;
      ctx.save();
      ctx.globalAlpha = ra;
      ctx.strokeStyle = "rgba(255,200,120,1)";
      ctx.lineWidth = 4;
      ctx.shadowColor = "rgba(255,180,80,0.8)";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(PIVOT.x + 60, PIVOT.y + 60, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // impact flash
    const dt = t - IMPACT_T;
    if (dt >= 0 && dt < 0.18) {
      const flash = 1 - dt / 0.18;
      ctx.save();
      ctx.globalAlpha = flash * 0.6;
      const fg = ctx.createRadialGradient(PIVOT.x, PIVOT.y + 40, 0, PIVOT.x, PIVOT.y + 40, 260);
      fg.addColorStop(0, "rgba(255,240,180,1)");
      fg.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  const api = { W, H, DURATION, FPS, drawFrame, angleAt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.SwordAnim = api;
})(typeof window !== "undefined" ? window : global);
