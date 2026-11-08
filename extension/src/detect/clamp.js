// Masked brightness-clamp softener (soften mode, second filter).
// Pure module: no DOM, no chrome.*, no Node built-ins.
//
// Per pixel we keep a slow average colour (two-stage EMA, 0.5 s per stage,
// linear light).
// Inside the flashing mask the output keeps the average's chromaticity and
// its luminance is clamped to a band of +/- BAND around the average's
// luminance, so its luminance can never swing by 0.10 (no general flash) and
// its chromaticity only moves as slowly as the average (no red flash).
// Outside the mask, pixels pass through untouched (sharp, real time).
// The mask is dilated by one sample pixel, held for HOLD_MS after a pixel
// stops flashing, and blended in over RAMP_MS, so the mask itself never
// switches abruptly (threat T13).

import { LINEAR } from "./luma.js";

export const BAND = 0.03; // max luminance deviation from the slow average
// Swing bound: 2*BAND + ripple of the (two-stage) average < 0.10.
const AVG_TAU = 0.5; // s, per stage (two stages)
const HOLD_MS = 3000;
const RAMP_MS = 300;
const MAX_SIDE = 4096;

const INV_SIZE = 4096;
const INVERSE = new Uint8Array(INV_SIZE + 1);
for (let i = 0; i <= INV_SIZE; i++) {
  const v = i / INV_SIZE;
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  INVERSE[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
}
/** @param {number} v linear 0..1 */
const toByte = (v) => INVERSE[Math.round(Math.min(1, Math.max(0, v)) * INV_SIZE)];

const isSide = (n) => Number.isInteger(n) && n > 0 && n <= MAX_SIDE;

/**
 * @param {{ width: number, height: number, maskWidth?: number, maskHeight?: number }} opts
 *   maskWidth/maskHeight: resolution of the detector mask (defaults to width/height).
 */
export function createClampSoftener(opts) {
  const valid = !!opts && isSide(opts.width) && isSide(opts.height);
  const W = valid ? opts.width : 1;
  const H = valid ? opts.height : 1;
  const MW = valid && isSide(opts.maskWidth) ? opts.maskWidth : W;
  const MH = valid && isSide(opts.maskHeight) ? opts.maskHeight : H;
  const P = W * H;
  const avg1 = new Float32Array(P * 3);
  const avg = new Float32Array(P * 3); // second stage: smoother
  const weight = new Float32Array(P); // 0 = pass through, 1 = fully clamped
  const until = new Float64Array(MW * MH).fill(-Infinity); // mask hold per mask pixel
  const out = new Uint8ClampedArray(P * 4);
  let lastT = null;
  let failed = !valid;

  function grey() {
    const g = new Uint8ClampedArray(P * 4);
    for (let i = 0; i < g.length; i += 4) { g[i] = g[i + 1] = g[i + 2] = 128; g[i + 3] = 255; }
    return g;
  }

  return {
    get failed() { return failed; },
    /**
     * @param {Uint8ClampedArray} pixels RGBA, width*height*4
     * @param {number} t ms
     * @param {Uint8Array} [mask] detector mask (maskWidth*maskHeight), 1 = flashing.
     *   Omitted: the whole frame is clamped (safe default).
     */
    push(pixels, t, mask) {
      try {
        if (!valid || !(pixels instanceof Uint8ClampedArray) || pixels.length !== P * 4 || typeof t !== "number" || !Number.isFinite(t) ||
            (mask !== undefined && !(mask instanceof Uint8Array && mask.length === MW * MH))) {
          failed = true;
          return grey();
        }
        failed = false;
        const first = lastT === null;
        const dt = first ? 0 : Math.max(0, t - lastT);
        if (first || t > lastT) lastT = t;
        const a = 1 - Math.exp(-dt / 1000 / AVG_TAU);
        const step = dt / RAMP_MS;

        // Hold + dilate the mask in mask coordinates.
        if (mask) {
          for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
            if (!mask[y * MW + x]) continue;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx >= 0 && yy >= 0 && xx < MW && yy < MH) until[yy * MW + xx] = t + HOLD_MS;
            }
          }
        }

        for (let i = 0, p = 0; i < P; i++, p += 4) {
          const r = LINEAR[pixels[p]], g = LINEAR[pixels[p + 1]], b = LINEAR[pixels[p + 2]];
          const k = i * 3;
          if (first) { avg1[k] = avg[k] = r; avg1[k + 1] = avg[k + 1] = g; avg1[k + 2] = avg[k + 2] = b; }
          else {
            avg1[k] += a * (r - avg1[k]); avg1[k + 1] += a * (g - avg1[k + 1]); avg1[k + 2] += a * (b - avg1[k + 2]);
            avg[k] += a * (avg1[k] - avg[k]); avg[k + 1] += a * (avg1[k + 1] - avg[k + 1]); avg[k + 2] += a * (avg1[k + 2] - avg[k + 2]);
          }

          let target = 1;
          if (mask) {
            const mx = Math.min(MW - 1, Math.floor(((i % W) * MW) / W));
            const my = Math.min(MH - 1, Math.floor((Math.floor(i / W) * MH) / H));
            target = until[my * MW + mx] > t ? 1 : 0;
          }
          let w = weight[i];
          if (first) w = target; else if (w < target) w = Math.min(target, w + step); else if (w > target) w = Math.max(target, w - step);
          weight[i] = w;

          if (w === 0) {
            out[p] = pixels[p]; out[p + 1] = pixels[p + 1]; out[p + 2] = pixels[p + 2];
          } else {
            const ar = avg[k], ag = avg[k + 1], ab = avg[k + 2];
            const La = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab;
            const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const Lc = Math.min(La + BAND, Math.max(La - BAND, L));
            let cr, cg, cb;
            if (La > 1e-4) { const s = Lc / La; cr = ar * s; cg = ag * s; cb = ab * s; }
            else { cr = cg = cb = Lc; }
            out[p] = toByte(r + w * (cr - r));
            out[p + 1] = toByte(g + w * (cg - g));
            out[p + 2] = toByte(b + w * (cb - b));
          }
          out[p + 3] = 255;
        }
        return out;
      } catch {
        failed = true;
        return grey();
      }
    },
    reset() { lastT = null; weight.fill(0); until.fill(-Infinity); failed = !valid; },
  };
}
