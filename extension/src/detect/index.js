// Detection engine public API (docs/CONTRACTS.md section 1).
// Pure module: no DOM, no chrome.*, no Node built-ins. Time is always the `t`
// the caller passes in. Never throws: unreadable input fails closed.
//
// Status: general flash and red flash with area, timing rules, presets.
// createAggregator and analyzeAnimation land in later steps (BUILD_ORDER).

import {
  WINDOW_MS,
  GAP_MS,
  BACKWARDS_RESET_MS,
  MAX_SAMPLE_SIDE,
  LUMA_DELTA,
  DARKER_STATE_LIMIT,
  getPreset,
} from "./presets.js";
import { lumaFrame } from "./luma.js";
import { createTracker, RING } from "./tracker.js";
import { createRedTracker } from "./red.js";
import { maxInField, maxOverlap } from "./area.js";

export { createAggregator } from "./aggregate.js";
export { analyzeAnimation } from "./css.js";

/**
 * Highest flash count f such that at least `floor` pixels have f or more.
 * @param {Uint32Array} hist @param {number} floor
 */
function displayCount(hist, floor) {
  let atLeast = 0;
  for (let f = hist.length - 1; f >= 1; f--) {
    atLeast += hist[f];
    if (atLeast >= floor) return f;
  }
  return 0;
}

/** Most flashes a pixel can show in one window (ring size / 2). */
const MAX_COUNT = RING / 2;

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

  const preset = /** @type {import("./presets.js").Preset} */ (getPreset(opts.preset));
  const count = opts.sampleWidth * opts.sampleHeight;
  const expectedLength = count * 4;
  const pxArea = opts.realAreaScale * opts.realAreaScale; // CSS px per sample px
  // A pixel exceeds the limit with more than maxFlashes flashes, i.e. at least
  // 2 * maxFlashes + 1 transitions in the window (flashes = ceil(n / 2)).
  const minTransitions = 2 * preset.maxFlashes + 1;
  // Display floor for flashesPerSecond: 1% of the area threshold, at least one sample pixel.
  const displayFloor = Math.max(1, Math.ceil((0.01 * preset.areaPx) / pxArea));

  const luma = new Float32Array(count);
  const tracker = createTracker(count, { delta: LUMA_DELTA, darkLimit: DARKER_STATE_LIMIT });
  const red = createRedTracker(count);
  const histogram = new Uint32Array(MAX_COUNT + 1);
  const redHistogram = new Uint32Array(MAX_COUNT + 1);
  // Area rule v2 scratch (area.js).
  const overMask = new Uint8Array(count);
  const redMask = new Uint8Array(count);
  const sat = new Uint32Array((opts.sampleWidth + 1) * (opts.sampleHeight + 1));
  const spanStarts = new Float64Array(count);
  const spanEnds = new Float64Array(count);
  const redStarts = new Float64Array(count);
  const redEnds = new Float64Array(count);
  const span = new Float64Array(2);

  /**
   * Concurrent flashing area in sample pixels: the smaller of the best
   * 341 x 256 CSS px box and the best time-overlap group (area.js).
   * @param {Uint8Array} mask @param {number} n @param {Float64Array} starts @param {Float64Array} ends
   */
  function concurrent(mask, n, starts, ends) {
    if (n === 0) return 0;
    // Cheap first: if even every flashing pixel together is under the limit,
    // neither refinement can change the verdict, and n is the exact area shown.
    if (n * pxArea <= preset.areaPx) return n;
    const spatial = maxInField(mask, opts.sampleWidth, opts.sampleHeight, opts.realAreaScale, sat);
    if (spatial * pxArea <= preset.areaPx) return spatial;
    const temporal = maxOverlap(starts, ends, n);
    return Math.min(spatial, temporal);
  }

  /** @type {FlashReport} */
  let last = calmReport();
  // Time handling. The caller's clock (`t`) can jump backwards (seek, loop).
  // Internally we keep a continuous clock `now = t + offset`, because the
  // viewer sees continuous flashing even when mediaTime loops: a looping
  // strobe must keep its history, never reset its way to a clean report.
  /** @type {number | null} */
  let lastRaw = null;
  /** @type {number | null} */
  let lastNow = null;
  let offset = 0;
  let lastStep = 1000 / 60; // last normal sample interval
  /** Hold "warn" (and undersampled) until this internal time. */
  let warnUntil = -Infinity;
  let undersampledUntil = -Infinity;
  /** Internal time when an unbroken run of gaps began, or null. */
  /** @type {number | null} */
  let gapRunStart = null;

  function clearState() {
    tracker.reset();
    red.reset();
    lastRaw = null;
    lastNow = null;
    offset = 0;
    lastStep = 1000 / 60;
    warnUntil = -Infinity;
    undersampledUntil = -Infinity;
    gapRunStart = null;
  }

  /** @param {FrameSample} sample @returns {FlashReport} */
  function analyze(sample) {
    const { t, pixels } = sample;
    if (typeof t !== "number" || !Number.isFinite(t)) return blockReport();
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== expectedLength) return blockReport();

    if (lastRaw !== null && lastNow !== null && t <= lastRaw) {
      // Equal or slightly earlier timestamp: ignore, no double counting.
      if (lastRaw - t <= BACKWARDS_RESET_MS) return last;
      // Seek or loop: continue the internal clock one normal step later and
      // hold "warn" for one window.
      offset = lastNow + lastStep - t;
      warnUntil = t + offset + WINDOW_MS;
    }

    const now = t + offset;
    const dt = lastNow === null ? 0 : now - lastNow;
    lastRaw = t;
    lastNow = now;

    // Gap rule: a gap over GAP_MS may hide flashes. Mark undersampled and warn
    // for one window; gaps that persist for a whole window block (fail closed).
    let gapBlock = false;
    if (dt > GAP_MS) {
      if (gapRunStart === null) gapRunStart = now - dt;
      undersampledUntil = now + WINDOW_MS;
      if (now - gapRunStart >= WINDOW_MS) gapBlock = true;
    } else {
      if (dt > 0) lastStep = dt;
      gapRunStart = null;
    }

    lumaFrame(pixels, luma);
    tracker.update(luma, now);
    red.update(pixels, now);

    histogram.fill(0);
    redHistogram.fill(0);
    let over = 0;
    let redOver = 0;
    let redPairs = 0; // pixels with at least one red flash pair (strict rule)
    for (let i = 0; i < count; i++) {
      const n = tracker.spanInWindow(i, now, span);
      if (n >= minTransitions) {
        // Half-cycle slack: half of this pixel's average transition interval.
        const slack = (span[1] - span[0]) / (n - 1) / 2;
        spanStarts[over] = span[0] - slack;
        spanEnds[over] = span[1] + slack;
        over++;
        overMask[i] = 1;
      } else {
        overMask[i] = 0;
      }
      histogram[Math.min(MAX_COUNT, Math.ceil(n / 2))]++;
      const m = red.spanInWindow(i, now, span);
      if (m >= minTransitions) {
        const slack = (span[1] - span[0]) / (m - 1) / 2;
        redStarts[redOver] = span[0] - slack;
        redEnds[redOver] = span[1] + slack;
        redOver++;
        redMask[i] = 1;
      } else {
        redMask[i] = 0;
      }
      if (m >= 2) redPairs++;
      redHistogram[Math.min(MAX_COUNT, Math.ceil(m / 2))]++;
    }

    const report = calmReport(dt > 0 ? 1000 / dt : 0);
    report.flashesPerSecond = displayCount(histogram, displayFloor);
    report.redFlashesPerSecond = displayCount(redHistogram, displayFloor);
    // areaPx: concurrent flashing area in CSS px (the number the violation uses).
    // areaPct: share of the sampled element that is flashing at all (display only).
    report.areaPx = concurrent(overMask, over, spanStarts, spanEnds) * pxArea;
    report.areaPct = over / count;
    report.redAreaPx = concurrent(redMask, redOver, redStarts, redEnds) * pxArea;
    const undersampled = now < undersampledUntil;
    report.undersampled = undersampled;

    const general = report.areaPx > preset.areaPx;
    // Strict: any red flash pair is a violation, area ignored except the
    // display floor (1% of the area threshold) so one stray pixel can't trip it.
    const redHit = report.redAreaPx > preset.areaPx || (preset.anyRedFlash && redPairs >= displayFloor);
    if (general || redHit) {
      report.violation = true;
      report.severity = "block";
      report.reason = general && redHit ? "both" : general ? "general" : "red";
    } else if (gapBlock) {
      // Can't verify: sampled too slowly for a whole window.
      report.violation = true;
      report.severity = "block";
    } else if (undersampled || now < warnUntil) {
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
      clearState();
    },
  };
}
