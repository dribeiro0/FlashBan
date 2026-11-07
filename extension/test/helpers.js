// Synthetic stimulus helpers for detector tests. Numbers only, nothing is displayed.
import { LINEAR } from "../src/detect/luma.js";

export const DARK = 0;
export const LIGHT = 140;

/** Relative luminance of an sRGB gray byte. */
export const lumaOf = (g) => LINEAR[g];

/** Gray byte whose luminance is closest to L. */
export function grayFor(L) {
  let best = 0;
  for (let g = 1; g < 256; g++) if (Math.abs(LINEAR[g] - L) < Math.abs(LINEAR[best] - L)) best = g;
  return best;
}

/** Sample times at `fps` from `from` to `to` ms inclusive, integer ms. */
export function grid(fps, to, from = 0) {
  const out = [];
  for (let i = 0; ; i++) {
    const t = from + Math.round((i * 1000) / fps);
    if (t > to) break;
    out.push(t);
  }
  return out;
}

/** Square wave level: flips every half-period ms, starting at `a`. */
export const square = (halfMs, a = DARK, b = LIGHT) => (t) => (Math.floor(t / halfMs) % 2 === 0 ? a : b);

/** Full-frame RGBA buffer of one gray level. */
export function fill(px, gray) {
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i + 1] = px[i + 2] = gray;
    px[i + 3] = 255;
  }
}

/** Seeded PRNG (mulberry32), returns 0..1. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Push frames into a detector. `paint(px, t, frameIndex)` fills the RGBA buffer.
 * Returns every report with its time.
 */
export function drive(detector, w, h, times, paint) {
  const px = new Uint8ClampedArray(w * h * 4);
  const reports = [];
  times.forEach((t, i) => {
    paint(px, t, i);
    reports.push({ t, r: detector.push({ t, pixels: px }) });
  });
  return reports;
}

/** Full-frame painter from a level function of time. */
export const whole = (levelAt) => (px, t) => fill(px, levelAt(t));
