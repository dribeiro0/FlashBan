// Detection engine public API (docs/CONTRACTS.md section 1).
// Pure module: no DOM, no chrome.*, no Node built-ins. Time is always the `t`
// the caller passes in. Never throws: unreadable input fails closed.
//
// Status: skeleton with the final API shape. Valid input gets a calm report;
// real flash analysis lands next (BUILD_ORDER step 2).

import { WINDOW_MS, GAP_MS, MAX_SAMPLE_SIDE, getPreset } from "./presets.js";

/**
 * @typedef {import("./presets.js").PresetName} PresetName
 * @typedef {{ preset: PresetName, sampleWidth: number, sampleHeight: number, realAreaScale: number }} DetectorOptions
 * @typedef {{ t: number, pixels: Uint8ClampedArray }} FrameSample
 * @typedef {{
 *   v: 1,
 *   flashesPerSecond: number,
 *   redFlashesPerSecond: number,
 *   areaPx: number,
 *   areaPct: number,
 *   violation: boolean,
 *   severity: "none" | "warn" | "block",
 *   reason?: "general" | "red" | "both",
 *   windowMs?: number,
 *   sampleRateHz?: number,
 *   undersampled?: boolean,
 *   redAreaPx?: number,
 * }} FlashReport
 * @typedef {{ push(sample: FrameSample): FlashReport, peek(): FlashReport, reset(): void }} Detector
 */

/** @returns {FlashReport} */
function calmReport(sampleRateHz = 0) {
  return {
    v: 1,
    flashesPerSecond: 0,
    redFlashesPerSecond: 0,
    areaPx: 0,
    areaPct: 0,
    violation: false,
    severity: "none",
    windowMs: WINDOW_MS,
    sampleRateHz,
    undersampled: false,
    redAreaPx: 0,
  };
}

/** Fail-closed report: unreadable input or internal error. @returns {FlashReport} */
function blockReport() {
  return { ...calmReport(), violation: true, severity: "block" };
}

/** @param {unknown} n */
function isSide(n) {
  return Number.isInteger(n) && /** @type {number} */ (n) > 0 && /** @type {number} */ (n) <= MAX_SAMPLE_SIDE;
}

/** @param {unknown} opts @returns {opts is DetectorOptions} */
function validOptions(opts) {
  if (opts === null || typeof opts !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (opts);
  return (
    getPreset(o.preset) !== null &&
    isSide(o.sampleWidth) &&
    isSide(o.sampleHeight) &&
    typeof o.realAreaScale === "number" &&
    Number.isFinite(o.realAreaScale) &&
    o.realAreaScale > 0
  );
}

/** A detector for invalid options: every report blocks. @returns {Detector} */
function alwaysBlock() {
  return {
    push: () => blockReport(),
    peek: () => blockReport(),
    reset() {},
  };
}

/**
 * @param {DetectorOptions} opts
 * @returns {Detector}
 */
export function createDetector(opts) {
  let ok = false;
  try {
    ok = validOptions(opts);
  } catch {
    ok = false;
  }
  if (!ok) return alwaysBlock();

  const expectedLength = opts.sampleWidth * opts.sampleHeight * 4;

  /** @type {FlashReport} */
  let last = calmReport();
  /** @type {number | null} */
  let lastT = null;

  /** @param {FrameSample} sample @returns {FlashReport} */
  function analyze(sample) {
    const { t, pixels } = sample;
    if (typeof t !== "number" || !Number.isFinite(t)) return blockReport();
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== expectedLength) return blockReport();

    // Equal timestamps: ignore the sample, no double counting.
    if (lastT !== null && t === lastT) return last;

    const dt = lastT === null ? 0 : t - lastT;
    lastT = t;
    const rate = dt > 0 ? 1000 / dt : 0;
    const report = calmReport(rate);
    if (dt > GAP_MS) {
      report.undersampled = true;
      report.severity = "warn";
    }
    return report;
  }

  return {
    push(sample) {
      try {
        if (sample === null || typeof sample !== "object") {
          last = blockReport();
        } else {
          last = analyze(sample);
        }
      } catch {
        last = blockReport();
      }
      return { ...last };
    },
    peek() {
      return { ...last };
    },
    reset() {
      last = calmReport();
      lastT = null;
    },
  };
}
