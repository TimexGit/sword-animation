// Minimal static server for the preview and for the renderer.
// Binds 0.0.0.0 so it also works behind a proxied preview host.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
};

export function startServer(port = Number(process.env.PORT || 8173), host = "0.0.0.0") {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
      const stat = fs.statSync(file);
      if (stat.isDirectory()) { res.writeHead(404).end("not found"); return; }
      const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
      const range = req.headers.range;
      if (range && /^bytes=/.test(range)) {
        const [s, e] = range.replace("bytes=", "").split("-");
        const start = s ? parseInt(s, 10) : 0;
        const end = e ? parseInt(e, 10) : stat.size - 1;
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8173);
  const s = await startServer(port);
  console.log(`serving ${ROOT} on http://0.0.0.0:${port}/  (preview: /index.html)`);
  process.on("SIGTERM", () => s.close(() => process.exit(0)));
  process.on("SIGINT", () => s.close(() => process.exit(0)));
}
