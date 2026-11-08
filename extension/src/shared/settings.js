// Settings shape shared by the background, content scripts and the popup.
// Pure module: no chrome.* calls, so it can be unit-tested in Node.

/** @typedef {"strict" | "wcag" | "relaxed"} Preset */

/**
 * @typedef {Object} Settings
 * @property {1} v
 * @property {Preset} preset
 * @property {boolean} guardedStart   dim new media while the first window is analysed
 * @property {boolean} failClosed     dim media we can't analyse (tainted, DRM, errors)
 * @property {string[]} allowlist     registrable domains where the shield is off
 * @property {boolean} hud            relay detector reports to the Demo HUD page
 * @property {OnFlash} onFlash        what to do with flashing video: soften it (default) or cover it
 * @property {Strength} strength      protection strength 1-5: how dark flashing media is dimmed; 5 blocks it
 */

/** @typedef {1 | 2 | 3 | 4 | 5} Strength */
// Dim darkness per strength step (share of black over the media). Step 1 is the
// safe floor: below ~0.66 black the brightest pixel could reach the 0.10
// relative-luminance change a flash needs, so the slider can't go lighter than
// 0.72 (max change ~0.064). Step 5 has no dim: it blocks (covers and pauses).
export const STRENGTH_DIM = Object.freeze({ 1: 0.72, 2: 0.8, 3: 0.88, 4: 0.94 });
export const STRENGTH_BLOCK = 5;

/** @typedef {"soften" | "block"} OnFlash */
export const ON_FLASH = /** @type {const} */ (["soften", "block"]);

export const PRESETS = /** @type {const} */ (["strict", "wcag", "relaxed"]);

/** @type {Settings} */
export const DEFAULT_SETTINGS = Object.freeze({
  v: 1,
  preset: "wcag", // WCAG 2.3.1 limits by default; Strict is one click away in the popup
  guardedStart: true,
  failClosed: true,
  allowlist: [],
  hud: false,
  onFlash: "soften",
  strength: 2,
});

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/;

/** @param {unknown} d */
export function isValidDomain(d) {
  return typeof d === "string" && DOMAIN_RE.test(d);
}

/**
 * Merge an untrusted partial settings object onto defaults, keeping only valid fields.
 * @param {unknown} raw
 * @returns {Settings}
 */
export function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS, allowlist: [] };
  if (!raw || typeof raw !== "object") return out;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (PRESETS.includes(/** @type {any} */ (r.preset))) out.preset = /** @type {Preset} */ (r.preset);
  if (typeof r.guardedStart === "boolean") out.guardedStart = r.guardedStart;
  if (typeof r.failClosed === "boolean") out.failClosed = r.failClosed;
  if (typeof r.hud === "boolean") out.hud = r.hud;
  if (ON_FLASH.includes(/** @type {any} */ (r.onFlash))) out.onFlash = /** @type {OnFlash} */ (r.onFlash);
  if (Number.isInteger(r.strength) && /** @type {number} */ (r.strength) >= 1 && /** @type {number} */ (r.strength) <= 5) out.strength = /** @type {Strength} */ (r.strength);
  if (Array.isArray(r.allowlist)) {
    out.allowlist = [
      ...new Set(
        r.allowlist
          .filter((d) => typeof d === "string")
          .map((d) => d.toLowerCase().trim())
          .filter(isValidDomain),
      ),
    ].slice(0, 500);
  }
  return out;
}

// Common two-label public suffixes. Not the full Public Suffix List: good enough
// for a hackathon build, and the limit is documented in the README.
const TWO_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk", "me.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "ac.jp", "co.kr", "or.kr",
  "com.br", "com.cn", "com.mx", "com.tr", "com.sg", "com.hk", "co.in", "co.za",
  "github.io", "gitlab.io", "pages.dev", "netlify.app", "vercel.app", "web.app",
  "firebaseapp.com", "herokuapp.com", "blogspot.com", "glitch.me",
]);

/**
 * Registrable domain (eTLD+1, approximated) from a URL. Returns "" for
 * non-http(s) URLs, IP addresses get returned as-is, localhost stays "localhost".
 * @param {string} url
 */
export function registrableDomain(url) {
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    host = u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
  if (!host) return "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}
