// Red flash tracking (DESIGN.md section 4, WCAG_NOTES red-flash formula).
// A red transition: the colour moves more than RED_UV_DELTA in CIE 1976 UCS
// (u', v') from the pixel's anchor, and the anchor or the new colour is
// saturated red (linear R / (R + G + B) >= RED_SHARE). Then the anchor moves.
// Pure module: no DOM, no chrome.*, no Node built-ins.

import { LINEAR } from "./luma.js";
import { RED_SHARE, RED_UV_DELTA } from "./presets.js";
import { createRing } from "./tracker.js";

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
        if (sum <= 0) continue; // black: no chromaticity, keep the anchor
        const red = R / sum >= RED_SHARE ? 1 : 0;
        // Cheap skip: neither the anchor nor this colour is saturated red.
        if (has[i] === 1 && red === 0 && aRed[i] === 0) continue;
        const X = 0.4124 * R + 0.3576 * G + 0.1805 * B;
        const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
        const den = X + 15 * Y + 3 * Z;
        const u = (4 * X) / den;
        const v = (9 * Y) / den;
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
