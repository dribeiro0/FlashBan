// FlashBan's look for the UI we inject into pages (safemode.js, soften.js) and
// the lockdown stylesheet (background/sw.js), in one place so the three stay in
// sync. Matches extension/hud/hud.css, extension/popup/popup.css and site/.
// Static strings only: these are interpolated into CSS text, never into HTML.
// Contrast: INK on GROUND 18.1:1, MUTE on GROUND 15.3:1, GROUND on ACCENT 13.5:1.

export const GROUND = "#121212";
export const INK = "#ffffff";
export const MUTE = "#e8e8e8";
export const ACCENT = "#ffd84d"; // brand chip and buttons
export const RULE = "#3a3a36"; // 1px borders on dark surfaces
export const GRAIN_DARK = "#1d1d1a"; // decorative dither tone next to GROUND (~1.1:1, never behind text)
// System fonts only: page overlays never load font files (no extra web-accessible resources).
export const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
export const MONO = `ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace`;

// Motion: slow, one-shot, opacity/transform only, for UI that is NOT protection
// (the bar, the page-check notice, a soften badge). Panels that dim or cover
// content appear instantly. Everything is off under prefers-reduced-motion.
export const ENTER_MS = 300;
// Each stylesheet applies it as `animation: fb-enter ${ENTER_MS}ms ease-out both`
// and turns it off in its own prefers-reduced-motion block.
export const ENTER_KEYFRAMES = `@keyframes fb-enter { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }`;
