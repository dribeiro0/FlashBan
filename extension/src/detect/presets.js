// Detector constants per preset. Values come from WCAG_NOTES.md.
// Pure module: no DOM, no chrome.*, no Node built-ins.

/** Sliding window length in ms (half-open window (t - WINDOW_MS, t]). */
export const WINDOW_MS = 1000;

/** Minimum relative-luminance swing for a general-flash transition. */
export const LUMA_DELTA = 0.10;

/** A transition counts only when its darker state is below this luminance. */
export const DARKER_STATE_LIMIT = 0.80;

/** Red share R/(R+G+B) at or above this makes a state "saturated red". */
export const RED_SHARE = 0.8;

/** CIE 1976 UCS (u', v') distance a red transition must exceed. */
export const RED_UV_DELTA = 0.2;

/** A gap between samples above this (ms) marks the report undersampled. */
export const GAP_MS = 100;

/** A backwards timestamp jump larger than this (ms) resets the detector. */
export const BACKWARDS_RESET_MS = 250;

/** Largest accepted sample size per side (memory cap). */
export const MAX_SAMPLE_SIDE = 256;

/**
 * @typedef {"strict" | "wcag" | "relaxed"} PresetName
 * @typedef {{
 *   maxFlashes: number,   // violation when flashes in the window is greater than this
 *   areaPx: number,       // violation when flashing area in CSS px is greater than this
 *   anyRedFlash: boolean, // true: a single red flash pair is a violation, area ignored
 * }} Preset
 */

/** @type {Readonly<Record<PresetName, Readonly<Preset>>>} */
export const PRESETS = Object.freeze({
  // 25% of a 341 x 256 CSS px field = 21,824 px. A tie passes (WCAG_NOTES s4 point 3).
  wcag: Object.freeze({ maxFlashes: 3, areaPx: 21824, anyRedFlash: false }),
  // Product choice, stricter than the spec: lower limit, half the area, any red flash.
  strict: Object.freeze({ maxFlashes: 2, areaPx: 10912, anyRedFlash: true }),
  // Never looser than WCAG: same thresholds as wcag for now.
  relaxed: Object.freeze({ maxFlashes: 3, areaPx: 21824, anyRedFlash: false }),
});

/**
 * @param {unknown} name
 * @returns {Readonly<Preset> | null} null when the name is not a known preset
 */
export function getPreset(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(PRESETS, name)
    ? PRESETS[/** @type {PresetName} */ (name)]
    : null;
}
