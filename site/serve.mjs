// Local server for the FlashBan website: node site/serve.mjs [port]  (default 8090)
// Serves site/ at / and the demo pages (demo/) at /demo/, so the site can link to the Grain demo.
// Localhost only, read-only, no dependencies. Paths are resolved inside their root or refused.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  { prefix: "/demo/", dir: resolve(HERE, "..", "demo") },
  { prefix: "/", dir: HERE },
];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".zip": "application/zip",
  ".sha256": "text/plain; charset=utf-8",
};
const port = Number(process.argv[2]) || 8090;

/** Maps a URL path to a file inside one of the roots, or null. Exported for tests. */
export function resolvePath(urlPath) {
  let path;
  try { path = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  if (path.includes("\0")) return null;
  for (const { prefix, dir } of ROOTS) {
    if (path === prefix.slice(0, -1) && prefix !== "/") return { redirect: prefix };
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const file = normalize(join(dir, rest.endsWith("/") || rest === "" ? rest + "index.html" : rest));
    if (file !== dir && !file.startsWith(dir + sep)) return null;
    if (file.endsWith(".mjs") && prefix === "/") return null; // don't serve the build/server scripts
    return { file };
  }
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(async (req, res) => {
    const hit = resolvePath(req.url || "/");
    if (hit?.redirect) { res.writeHead(301, { Location: hit.redirect }); return res.end(); }
    if (!hit || (req.method !== "GET" && req.method !== "HEAD")) { res.writeHead(404); return res.end("Not found"); }
    try {
      const s = await stat(hit.file);
      if (!s.isFile()) throw new Error("not a file");
      const body = await readFile(hit.file);
      const headers = {
        "Content-Type": TYPES[extname(hit.file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      };
      if (hit.file.endsWith(".zip")) headers["Content-Disposition"] = `attachment; filename="${hit.file.split(sep).pop()}"`;
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }).listen(port, "127.0.0.1", () => console.log(`FlashBan site: http://localhost:${port}/  (demo at /demo/)`));
}
