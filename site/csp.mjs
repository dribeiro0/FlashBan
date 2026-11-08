// Keeps the website's Content-Security-Policy hashes in step with its inline <style> and <script>.
//   node site/csp.mjs          -> rewrites the 'sha256-...' sources in every site/*.html that has inline blocks
// The CSP allows exactly these blocks and nothing else inline; site/csp.test.js fails if they drift.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = dirname(fileURLToPath(import.meta.url));
const hash = (text) => "sha256-" + createHash("sha256").update(text, "utf8").digest("base64");

/** Inline <style> and <script> (no src) bodies, exactly as the browser hashes them. */
export function inlineBlocks(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, ""); // comments can mention <script> in plain text
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return { styles, scripts };
}

/** The CSP content attribute of the page's meta tag, or null. */
export function cspOf(html) {
  return /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? null;
}

/** Returns the html with script-src and style-src carrying exactly the hashes of its inline blocks. */
export function withHashes(html) {
  const { styles, scripts } = inlineBlocks(html);
  const csp = cspOf(html);
  if (!csp) throw new Error("no CSP meta tag");
  const set = (policy, directive, hashes) =>
    policy.replace(new RegExp(`${directive} 'self'[^;]*`), `${directive} 'self'${hashes.map((h) => ` '${h}'`).join("")}`);
  // Hash each block as LF and as CRLF: a Windows checkout (core.autocrlf) turns \n into \r\n inside the
  // blocks, and the browser hashes the bytes it is given, so both forms must be allowed.
  const both = (blocks) => [...new Set(blocks.flatMap((b) => { const lf = b.replace(/\r\n/g, "\n"); return [hash(lf), hash(lf.replace(/\n/g, "\r\n"))]; }))];
  let next = set(csp, "script-src", both(scripts));
  next = set(next, "style-src", both(styles));
  return html.replace(csp, next);
}

export { hash };

async function main() {
  for (const name of await readdir(SITE)) {
    if (!name.endsWith(".html")) continue;
    const file = join(SITE, name);
    const html = await readFile(file, "utf8");
    const { styles, scripts } = inlineBlocks(html);
    if (!styles.length && !scripts.length) continue;
    const next = withHashes(html);
    if (next !== html) { await writeFile(file, next); console.log(`updated CSP hashes in ${name}`); }
    else console.log(`${name}: CSP hashes already current`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
