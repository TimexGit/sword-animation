# Sword Animation

A 5-second animated sword swing (16:9, 30 fps) built with JavaScript on a canvas,
with a procedurally generated soundtrack, rendered to MP4 via FFmpeg.

## Files

- `src/sword.js` — shared canvas drawing code (works in browser and Node).
- `src/audio.js` — procedural soundtrack generator (WAV).
- `index.html` — live browser preview of the animation.
- `render.mjs` — renders frames with `@napi-rs/canvas`, encodes MP4 with FFmpeg.
- `render-playwright.mjs` — alternative renderer using Playwright + FFmpeg.
- `out/sword.mp4` — final rendered video.
- `out/contact.png` — contact sheet used for QA.

## Render

```bash
node render.mjs
```

FFmpeg binary path can be overridden with `FFMPEG=/path/to/ffmpeg`.
