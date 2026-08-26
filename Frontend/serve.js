/* ============================================================
   serve.js — Static server for development
   OPSTS — GCTU

   Two reasons this exists rather than `python -m http.server`:

     1. No-store. Python's server sends no Cache-Control, so a
        browser applies heuristic freshness from Last-Modified and
        keeps serving an edited js file from disk cache without
        revalidating. You edit a file, reload, and watch the old
        one run — with no error to tell you that is what happened.

     2. Port 5500. That is what CORS_ORIGINS and APP_URL in
        Backend/.env already name, so the API accepts calls from
        here and password-reset emails point back here.

   Production is a real static host; nothing here ships.
============================================================ */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = Number(process.env.PORT) || 5500;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  const requested = decodeURIComponent(url.parse(req.url).pathname);
  const relative = requested === "/" ? "/index.html" : requested;

  /* Resolve, then confirm the result is still inside ROOT. Without
     the second half, "/../../.env" walks straight out of the folder. */
  const resolved = path.resolve(ROOT, "." + relative);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  fs.readFile(resolved, (err, body) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(`Not found: ${relative}`);
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(resolved).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`OPSTS frontend → http://localhost:${PORT}`);
  console.log(`Serving ${ROOT}`);
});
