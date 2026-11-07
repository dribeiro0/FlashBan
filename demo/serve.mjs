// Minimal static server for the demo fixtures: node demo/serve.mjs [port]. Localhost only, no dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2]) || 8080;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

createServer(async (req, res) => {
  try {
    // Inside the try: a malformed %-escape throws URIError and must not crash the server.
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = normalize(join(root, path.endsWith("/") ? path + "index.html" : path));
    const type = types[extname(file)];
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || !type) { res.writeHead(404).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(port, "127.0.0.1", () => console.log(`Demo fixtures at http://localhost:${port}/`));
