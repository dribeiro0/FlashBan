// Red flash tracking (DESIGN.md section 4, WCAG_NOTES red-flash formula).
// A red transition: the colour moves more than RED_UV_DELTA in CIE 1976 UCS
// (u', v') from the pixel's anchor, and the anchor or the new colour is
// saturated red (linear R / (R + G + B) >= RED_SHARE). Then the anchor moves.
// Pure module: no DOM, no chrome.*, no Node built-ins.

import { LINEAR } from "./luma.js";
import { RED_SHARE, RED_UV_DELTA } from "./presets.js";
import { createRing } from "./tracker.js";

/** Below this relative luminance a colour's hue fades to neutral (pure red ~ sRGB 61). */
export const DARK_Y = 0.01;
// D65 white point in CIE 1976 UCS: the chromaticity of black and greys.
const NEUTRAL_U = 0.1978;
const NEUTRAL_V = 0.4683;

/** @param {number} count number of pixels */
export function createRedTracker(count) {
  const au = new Float32Array(count); // anchor u'
  const av = new Float32Array(count); // anchor v'
  const aRed = new Uint8Array(count); // anchor is saturated red
  const has = new Uint8Array(count); // anchor set (pixel has had a non-black colour)
  const ring = createRing(count);
  const d2 = RED_UV_DELTA * RED_UV_DELTA;

  function clear() {
    has.fill(0);
    aRed.fill(0);
    ring.clear();
  }
  clear();

  return {
    /** @param {Uint8ClampedArray} pixels RGBA @param {number} t */
    update(pixels, t) {
      for (let i = 0, p = 0; i < count; i++, p += 4) {
        const R = LINEAR[pixels[p]];
        const G = LINEAR[pixels[p + 1]];
        const B = LINEAR[pixels[p + 2]];
        const sum = R + G + B;
        const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        // Near-black colours have no visible hue, but their chromaticity is
        // pure noise (video compression in dark scenes and letterbox bars:
        // RGB 3,0,1 then 1,2,0 jumps across the whole u'v' plane). So a
        // colour's chromaticity fades to neutral grey below DARK_Y, and a
        // near-black colour never counts as saturated red. A real flash from
        // black to visible red still moves far enough (about 0.26 in u'v').
        const w = Y >= DARK_Y ? 1 : Y / DARK_Y;
        const red = sum > 0 && w >= 0.5 && R / sum >= RED_SHARE ? 1 : 0;
        // Cheap skip: neither the anchor nor this colour is saturated red.
        if (has[i] === 1 && red === 0 && aRed[i] === 0) continue;
        let u = NEUTRAL_U;
        let v = NEUTRAL_V;
        if (sum > 0) {
          const X = 0.4124 * R + 0.3576 * G + 0.1805 * B;
          const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
          const den = X + 15 * Y + 3 * Z;
          u = NEUTRAL_U + w * ((4 * X) / den - NEUTRAL_U);
          v = NEUTRAL_V + w * ((9 * Y) / den - NEUTRAL_V);
        }
        if (has[i] === 0) {
          au[i] = u;
          av[i] = v;
          aRed[i] = red;
          has[i] = 1;
          continue;
        }
        const du = u - au[i];
        const dv = v - av[i];
        if (du * du + dv * dv > d2) {
          ring.register(i, t);
          au[i] = u;
          av[i] = v;
          aRed[i] = red;
        } else if (red === 1 && aRed[i] === 0) {
          // Drifted into saturated red without a big jump: keep the anchor's
          // position but note it is red now.
          aRed[i] = 1;
        }
      }
    },
    countInWindow: ring.countInWindow,
    spanInWindow: ring.spanInWindow,
    reset: clear,
  };
}
