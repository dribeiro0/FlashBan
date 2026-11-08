// The website's security policy: every page has a strict CSP, inline code is allowed only by exact hash,
// and nothing loads from other origins. Fails when an inline block changes without `node site/csp.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cspOf, hash, inlineBlocks } from "./csp.mjs";

const SITE = dirname(fileURLToPath(import.meta.url));
const pages = (await readdir(SITE)).filter((n) => n.endsWith(".html"));

for (const name of pages) {
  test(`${name}: strict CSP, inline code only by hash`, async () => {
    const html = await readFile(join(SITE, name), "utf8");
    const csp = cspOf(html);
    assert.ok(csp, "has a CSP meta tag");
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|\*/, "no unsafe sources or other origins");
    const { styles, scripts } = inlineBlocks(html);
    for (const s of scripts) assert.ok(csp.includes(`'${hash(s)}'`), "inline script hash is in script-src (run node site/csp.mjs)");
    for (const s of styles) assert.ok(csp.includes(`'${hash(s)}'`), "inline style hash is in style-src (run node site/csp.mjs)");
    assert.doesNotMatch(html, /\sstyle="/, "no inline style attributes (the CSP would block them)");
    assert.doesNotMatch(html, /\son[a-z]+="/, "no inline event handlers");
    assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:/, "no scripts or stylesheets from other origins");
    assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/, "fonts are self-hosted");
  });
}
