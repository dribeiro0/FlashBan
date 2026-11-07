// Soften mode reference filter (SOFTEN_DESIGN.md section 3-4).
// Per pixel, per channel, two cascaded first-order low-pass stages on linear
// light: a = 1 - exp(-dt / tau); s1 += a (x - s1); s2 += a (s1 - s2).
// dt comes from the caller's timestamps, never 1/fps.
// This is the reference and test oracle; the browser may use a cheaper path
// (canvas globalAlpha blending) as long as the verify detector passes.
// It is NOT a safety guarantee on its own: the caller must run a second
// createDetector on the output and block if it still violates.
// Pure module: no DOM, no chrome.*. Never throws.

import { LINEAR } from "./luma.js";

/** Default time constant in seconds (smallest that cleared every simulated strobe). */
export const DEFAULT_TAU = 0.2;

/** Linear light 0..1 -> sRGB byte, 4096-entry inverse LUT. */
const INV_SIZE = 4096;
const INVERSE = new Uint8Array(INV_SIZE + 1);
for (let i = 0; i <= INV_SIZE; i++) {
  const v = i / INV_SIZE;
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  INVERSE[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** Larger sides than the detector's cap are allowed here (it filters the visible frame). */
const MAX_SIDE = 4096;

/** @param {unknown} n */
const isSide = (n) => Number.isInteger(n) && /** @type {number} */ (n) > 0 && /** @type {number} */ (n) <= MAX_SIDE;
/** @param {unknown} s */
const isTau = (s) => typeof s === "number" && Number.isFinite(s) && s > 0 && s <= 10;

/**
 * @param {{ width: number, height: number, tau?: number }} opts  tau in seconds
 * @returns {{
 *   push(pixels: Uint8ClampedArray, t: number): Uint8ClampedArray,
 *   setTau(seconds: number): boolean,
 *   reset(): void,
 *   readonly failed: boolean,
 * }}
 *   push returns the softened RGBA frame (the same buffer every call: copy it
 *   to keep it). After bad input it returns an opaque
 *   mid-grey frame and `failed` is true until the next good push: the caller
 *   must block (fail closed).
 */
export function createSoftener(opts) {
  const valid = !!opts && isSide(opts.width) && isSide(opts.height) && (opts.tau === undefined || isTau(opts.tau));
  const width = valid ? opts.width : 1;
  const height = valid ? opts.height : 1;
  const n = width * height * 3;
  const len = width * height * 4;
  let tau = valid && opts.tau !== undefined ? opts.tau : DEFAULT_TAU;

  const s1 = new Float32Array(n);
  const s2 = new Float32Array(n);
  const out = new Uint8ClampedArray(len);
  let started = false;
  /** @type {number | null} */
  let lastT = null;
  let failed = !valid;

  /** Opaque mid-grey: shows nothing of the source. */
  function grey() {
    const g = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      g[i] = g[i + 1] = g[i + 2] = 128;
      g[i + 3] = 255;
    }
    return g;
  }

  function reset() {
    started = false;
    lastT = null;
    failed = !valid;
  }

  return {
    push(pixels, t) {
      try {
        if (!valid || !(pixels instanceof Uint8ClampedArray) || pixels.length !== len || typeof t !== "number" || !Number.isFinite(t)) {
          failed = true;
          return grey();
        }
        failed = false;
        if (!started) {
          for (let i = 0, p = 0; i < n; i += 3, p += 4) {
            s1[i] = s2[i] = LINEAR[pixels[p]];
            s1[i + 1] = s2[i + 1] = LINEAR[pixels[p + 1]];
            s1[i + 2] = s2[i + 2] = LINEAR[pixels[p + 2]];
          }
          started = true;
          lastT = t;
        } else {
          // Equal or backwards time: hold the state (a = 0), never speed up.
          const dt = lastT === null ? 0 : Math.max(0, t - lastT);
          if (t > /** @type {number} */ (lastT)) lastT = t;
          const a = 1 - Math.exp(-dt / 1000 / tau);
          if (a > 0) {
            for (let i = 0, p = 0; i < n; i += 3, p += 4) {
              for (let c = 0; c < 3; c++) {
                const k = i + c;
                const x = LINEAR[pixels[p + c]];
                s1[k] += a * (x - s1[k]);
                s2[k] += a * (s1[k] - s2[k]);
              }
            }
          }
        }
        for (let i = 0, p = 0; i < n; i += 3, p += 4) {
          out[p] = INVERSE[Math.round(Math.min(1, Math.max(0, s2[i])) * INV_SIZE)];
          out[p + 1] = INVERSE[Math.round(Math.min(1, Math.max(0, s2[i + 1])) * INV_SIZE)];
          out[p + 2] = INVERSE[Math.round(Math.min(1, Math.max(0, s2[i + 2])) * INV_SIZE)];
          out[p + 3] = 255;
        }
        return out;
      } catch {
        failed = true;
        return grey();
      }
    },

    setTau(seconds) {
      if (!isTau(seconds)) return false;
      tau = seconds;
      return true;
    },

    reset,

    get failed() {
      return failed;
    },
  };
}
