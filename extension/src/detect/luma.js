// sRGB -> linear light and relative luminance (WCAG definition).
// Pure module: no DOM, no chrome.*, no Node built-ins.

/** sRGB byte -> linear value 0..1 (256-entry LUT, no pow in the hot loop). */
export const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Relative luminance of one sRGB colour, 0..1.
 * @param {number} r @param {number} g @param {number} b  bytes 0..255
 */
export function lumaOf(r, g, b) {
  return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
}

/**
 * Fill `out` with the relative luminance of every RGBA pixel. Alpha is ignored.
 * @param {Uint8ClampedArray} pixels RGBA bytes
 * @param {Float32Array} out length pixels.length / 4
 */
export function lumaFrame(pixels, out) {
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.2126 * LINEAR[pixels[p]] + 0.7152 * LINEAR[pixels[p + 1]] + 0.0722 * LINEAR[pixels[p + 2]];
  }
}
