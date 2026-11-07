// CSS / Web Animations path: analyzeAnimation (no pixels). DESIGN.md s1, s8.
// Reads a duck-typed Animation (effect.getKeyframes(), effect.getComputedTiming(),
// playbackRate) and estimates the flash rate from keyframe luminance.
// Pure module: no DOM, no chrome.*. Anything a luminance property can't be
// read from returns violation: true (fail closed).
//
// Model, per luminance-affecting property:
// - colours (background-color, color, fill, stroke, border colours, outline-color):
//   relative luminance of the colour, alpha composited over the backdrop;
// - opacity and visibility: the element blends between the backdrop and its
//   own colour, which we don't know, so we assume the worst contrast;
// - filter: brightness() / invert() / opacity(); other filter functions block.
// Geometry-only properties (transform, width, top, ...) cannot make a general
// flash on their own and are ignored, so normal spinners and slides pass.
// A property missing from some keyframes takes the worst-case value there.
// Transition times are keyframe times; we count zigzag swings of at least
// 0.10 whose darker state is below 0.80 over 2 s of play (or the whole run
// if shorter) and take the most transitions in any 1000 ms window.

import { LINEAR } from "./luma.js";
import { WINDOW_MS, LUMA_DELTA, DARKER_STATE_LIMIT, getPreset } from "./presets.js";

const COLOUR_PROPS = new Set([
  "backgroundColor",
  "color",
  "fill",
  "stroke",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "background",
]);
const IGNORED = new Set(["offset", "computedOffset", "easing", "composite"]);
// Properties that change luminance in ways we don't model: fail closed.
const UNMODELLED = new Set(["backgroundImage", "boxShadow", "textShadow", "mixBlendMode", "backdropFilter"]);

const NAMED = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  lime: [0, 255, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
};

/** @param {number} c 0..255 (fractional ok) */
const lin = (c) => LINEAR[Math.max(0, Math.min(255, Math.round(c)))];
/** @param {number[]} rgb */
const lumaRgb = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** @param {string} s @returns {number} 0..255, NaN if unreadable */
function channel(s) {
  s = s.trim();
  if (s.endsWith("%")) return (parseFloat(s) / 100) * 255;
  return parseFloat(s);
}
/** @param {string | undefined} s @returns {number} 0..1 */
function alphaOf(s) {
  if (s === undefined) return 1;
  s = s.trim();
  const a = s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s);
  return Math.max(0, Math.min(1, a));
}

/** @param {number} h @param {number} s @param {number} l  (deg, 0..1, 0..1) */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Parse a CSS colour to [r, g, b, a]. Returns null when unreadable
 * (currentColor, var(), color-mix(), gradients ...).
 * @param {unknown} value
 * @returns {number[] | null}
 */
export function parseColour(value) {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  if (Object.prototype.hasOwnProperty.call(NAMED, s)) return [...NAMED[s], 1];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((c) => parseInt(c + c, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  m = /^rgba?\((.*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const rgb = parts.slice(0, 3).map(channel);
    const a = alphaOf(parts[3]);
    if (rgb.some((x) => !Number.isFinite(x)) || !Number.isFinite(a)) return null;
    return [...rgb, a];
  }
  m = /^hsla?\((.*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]);
    const sat = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a = alphaOf(parts[3]);
    if (![h, sat, l, a].every(Number.isFinite)) return null;
    return [...hslToRgb(h, sat, l), a];
  }
  return null;
}

/**
 * Luminance a property value gives, as [low, high] bounds over the unknown
 * element colour / backdrop. null = unreadable.
 * @param {string} prop @param {unknown} value @param {number | null} backdrop
 * @returns {[number, number] | null}
 */
function luminanceOf(prop, value, backdrop) {
  // Worst case for an unknown backdrop: black (0) under light content and vice versa.
  if (COLOUR_PROPS.has(prop)) {
    const c = parseColour(value);
    if (!c) return null;
    const L = lumaRgb(c);
    const a = c[3];
    if (backdrop !== null) {
      const v = a * L + (1 - a) * backdrop;
      return [v, v];
    }
    return [a * L, a * L + (1 - a)];
  }
  if (prop === "opacity") {
    const o = typeof value === "number" ? value : parseFloat(String(value));
    if (!Number.isFinite(o)) return null;
    const op = Math.max(0, Math.min(1, o));
    return opacityBounds(op, backdrop);
  }
  if (prop === "visibility") {
    if (value === "visible") return opacityBounds(1, backdrop);
    if (value === "hidden" || value === "collapse") return opacityBounds(0, backdrop);
    return null;
  }
  if (prop === "filter") {
    if (value === "none") return opacityBounds(1, backdrop);
    const s = String(value).trim();
    let factor = 1;
    const re = /([a-z-]+)\(([^)]*)\)/g;
    let m;
    let consumed = "";
    while ((m = re.exec(s))) {
      consumed += m[0];
      const fn = m[1];
      const arg = m[2].trim();
      const n = arg.endsWith("%") ? parseFloat(arg) / 100 : parseFloat(arg);
      if (!Number.isFinite(n)) return null;
      if (fn === "brightness") factor *= Math.max(0, n);
      else if (fn === "opacity") factor *= Math.max(0, Math.min(1, n));
      // invert(1) turns white content black: model it as a darkening factor.
      else if (fn === "invert") factor *= 1 - Math.min(1, Math.max(0, n));
      else if (fn === "grayscale" || fn === "sepia" || fn === "hue-rotate" || fn === "blur") factor *= 1;
      else return null;
    }
    if (consumed.replace(/\s/g, "") !== s.replace(/\s/g, "")) return null;
    // Treat the filter factor like an opacity multiplier on an unknown colour.
    return opacityBounds(Math.min(1, factor), backdrop);
  }
  return null;
}

/** @param {number} o @param {number | null} backdrop @returns {[number, number]} */
function opacityBounds(o, backdrop) {
  if (backdrop !== null) {
    // Element colour unknown: worst case is the colour farthest from the backdrop.
    const far = backdrop < 0.5 ? 1 : 0;
    const v = o * far + (1 - o) * backdrop;
    return [v, v];
  }
  // Unknown backdrop and element: model the element as white on black.
  return [o, o];
}

/**
 * Transition times of a value series using the same zigzag rule as the pixel path.
 * @param {{ t: number, v: number }[]} series
 */
function transitions(series) {
  /** @type {number[]} */
  const out = [];
  if (series.length === 0) return out;
  let lo = series[0].v;
  let hi = series[0].v;
  let dir = 0;
  let run = series[0].v;
  let pending = false;
  for (let k = 1; k < series.length; k++) {
    const { t, v: x } = series[k];
    if (dir === 0) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      if (x - lo >= LUMA_DELTA) {
        dir = 1;
        if (lo < DARKER_STATE_LIMIT) out.push(t);
        run = x;
      } else if (hi - x >= LUMA_DELTA) {
        dir = -1;
        run = x;
        if (x < DARKER_STATE_LIMIT) out.push(t);
        else pending = true;
      }
    } else if (dir === 1) {
      if (x > run) run = x;
      else if (run - x >= LUMA_DELTA) {
        dir = -1;
        run = x;
        if (x < DARKER_STATE_LIMIT) out.push(t);
        else pending = true;
      }
    } else {
      if (x < run) {
        run = x;
        if (pending && x < DARKER_STATE_LIMIT) {
          out.push(t);
          pending = false;
        }
      } else if (x - run >= LUMA_DELTA) {
        pending = false;
        dir = 1;
        if (run < DARKER_STATE_LIMIT) out.push(t);
        run = x;
      }
    }
  }
  return out;
}

/** Most entries of sorted `times` inside any half-open window of WINDOW_MS. */
function maxInWindow(times) {
  let best = 0;
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] >= WINDOW_MS) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

const BLOCK = Object.freeze({ cyclesPerSecond: 0, maxLuminanceDelta: 1, violation: true });

/**
 * @param {any} a  an Animation (duck-typed)
 * @param {{ preset?: "strict" | "wcag" | "relaxed", areaPx?: number, backdropLuminance?: number }} [opts]
 *   preset defaults to "wcag"; areaPx (CSS px of the animated element), when
 *   given and not over the preset area, means no violation; backdropLuminance
 *   (0..1) narrows the worst case for opacity and translucent colours.
 * @returns {{ cyclesPerSecond: number, maxLuminanceDelta: number, violation: boolean }}
 */
export function analyzeAnimation(a, opts = {}) {
  try {
    const preset = getPreset(opts.preset ?? "wcag");
    if (!preset) return { ...BLOCK };
    const effect = a && a.effect;
    if (!effect || typeof effect.getKeyframes !== "function" || typeof effect.getComputedTiming !== "function") {
      return { ...BLOCK };
    }
    const timing = effect.getComputedTiming();
    const frames = effect.getKeyframes();
    if (!Array.isArray(frames) || !timing) return { ...BLOCK };

    const rate = a.playbackRate === undefined ? 1 : Number(a.playbackRate);
    if (!Number.isFinite(rate)) return { ...BLOCK };
    const duration = Number(timing.duration);
    if (!Number.isFinite(duration) || duration < 0) return { ...BLOCK };
    const iterations = timing.iterations === Infinity ? Infinity : Number(timing.iterations ?? 1);
    if (!(iterations >= 0)) return { ...BLOCK };
    if (rate === 0 || duration === 0 || iterations === 0 || frames.length === 0) {
      return { cyclesPerSecond: 0, maxLuminanceDelta: 0, violation: false };
    }
    const backdrop =
      typeof opts.backdropLuminance === "number" && opts.backdropLuminance >= 0 && opts.backdropLuminance <= 1
        ? opts.backdropLuminance
        : null;
    const direction = String(timing.direction || "normal");

    // Keyframe offsets (computedOffset fills in implicit ones).
    const offsets = frames.map((f, k) => {
      const o = f.computedOffset ?? f.offset ?? (frames.length === 1 ? 1 : k / (frames.length - 1));
      return Number(o);
    });
    if (offsets.some((o) => !Number.isFinite(o))) return { ...BLOCK };

    const props = new Set();
    for (const f of frames) for (const p of Object.keys(f)) if (!IGNORED.has(p)) props.add(p);

    const iterMs = duration / Math.abs(rate);
    const playMs = Math.min(iterations * iterMs, 2000 + iterMs);
    const nIter = Math.ceil(playMs / iterMs);

    let maxDelta = 0;
    let worstTransitionsPerWindow = 0;
    let steadyPerSecond = 0;

    for (const p of props) {
      const unmodelled = UNMODELLED.has(p);
      if (!unmodelled && !COLOUR_PROPS.has(p) && p !== "opacity" && p !== "visibility" && p !== "filter") continue; // geometry
      // Values we can't read (var(), currentColor, box-shadow, gradients...)
      // are NOT an automatic block any more: they take the worst case (a full
      // swing at that keyframe), and the timing decides. A fast animation with
      // unreadable values still violates (fail closed); a slow one, such as a
      // 1 s loading pulse, can't exceed the flash limit whatever its colours.
      /** @type {(number | null)[]} */
      const lows = [];
      /** @type {(number | null)[]} */
      const highs = [];
      for (const f of frames) {
        const b = !unmodelled && p in f ? luminanceOf(p, f[p], backdrop) : null;
        lows.push(b ? b[0] : null);
        highs.push(b ? b[1] : null);
      }
      // Worst-case single value per keyframe, filled in order so neighbouring
      // keyframes are as far apart as the bounds allow; an unknown value takes
      // the extreme opposite of the previous one (so all-unknown alternates 0/1).
      const known = lows.map((l, k) => (l === null ? null : (l + /** @type {number} */ (highs[k])) / 2));
      let prev = known.find((v) => v !== null) ?? 1;
      const values = known.map((v, k) => {
        let out;
        if (v !== null) {
          out = prev >= v ? /** @type {number} */ (lows[k]) : /** @type {number} */ (highs[k]);
        } else {
          out = prev >= 0.5 ? 0 : 1;
        }
        prev = out;
        return out;
      });
      const vmin = Math.min(...values);
      const vmax = Math.max(...values);
      if (vmax - vmin > maxDelta) maxDelta = vmax - vmin;

      // Unroll iterations into a time series.
      /** @type {{ t: number, v: number }[]} */
      const series = [];
      for (let i = 0; i < nIter; i++) {
        const reverse =
          direction === "reverse" ||
          (direction === "alternate" && i % 2 === 1) ||
          (direction === "alternate-reverse" && i % 2 === 0);
        const order = reverse ? [...offsets.keys()].reverse() : [...offsets.keys()];
        for (const k of order) {
          const o = reverse ? 1 - offsets[k] : offsets[k];
          const t = (i + o) * iterMs;
          if (t > playMs) break;
          series.push({ t, v: values[k] });
        }
      }
      series.sort((x, y) => x.t - y.t);
      const times = transitions(series);
      worstTransitionsPerWindow = Math.max(worstTransitionsPerWindow, maxInWindow(times));
      // Steady rate over the unrolled play (for display).
      if (times.length >= 2) {
        const span = times[times.length - 1] - times[0];
        const perSec = span > 0 ? ((times.length - 1) * 1000) / span : 0;
        steadyPerSecond = Math.max(steadyPerSecond, perSec);
      }
    }

    const cyclesPerSecond = Math.round((steadyPerSecond / 2) * 100) / 100;
    const flashes = Math.ceil(worstTransitionsPerWindow / 2);
    let violation = flashes > preset.maxFlashes;
    if (violation && typeof opts.areaPx === "number" && Number.isFinite(opts.areaPx) && opts.areaPx <= preset.areaPx) {
      violation = false;
    }
    return { cyclesPerSecond, maxLuminanceDelta: Math.round(maxDelta * 1000) / 1000, violation };
  } catch {
    return { ...BLOCK };
  }
}
