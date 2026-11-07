// Per-pixel transition tracking (zigzag with hysteresis) and the sliding
// window of transition times. DESIGN.md sections 2 and 3.
// Pure module: no DOM, no chrome.*, no Node built-ins.

import { WINDOW_MS } from "./presets.js";

/** Ring slots per pixel. Holds more than the 7 transitions a decision needs. */
export const RING = 8;

/**
 * Per-pixel ring of transition times and the half-open window count.
 * @param {number} count
 */
export function createRing(count) {
  const ring = new Float64Array(count * RING);
  const head = new Uint8Array(count);
  function clear() {
    ring.fill(-Infinity);
    head.fill(0);
  }
  clear();
  return {
    /** @param {number} i @param {number} t */
    register(i, t) {
      const h = (head[i] + 1) & (RING - 1);
      head[i] = h;
      ring[i * RING + h] = t;
    },
    /** Transitions of pixel i in (t - WINDOW_MS, t]. @param {number} i @param {number} t */
    countInWindow(i, t) {
      const from = t - WINDOW_MS;
      let n = 0;
      const base = i * RING;
      for (let k = 0; k < RING; k++) {
        const s = ring[base + k];
        if (s > from && s <= t) n++;
      }
      return n;
    },
    /**
     * Earliest and latest transition of pixel i in (t - WINDOW_MS, t], written
     * to out[0] and out[1]. Returns the count.
     * @param {number} i @param {number} t @param {Float64Array} out
     */
    spanInWindow(i, t, out) {
      const from = t - WINDOW_MS;
      let n = 0;
      let lo = Infinity;
      let hi = -Infinity;
      const base = i * RING;
      for (let k = 0; k < RING; k++) {
        const s = ring[base + k];
        if (s > from && s <= t) {
          n++;
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
      }
      out[0] = lo;
      out[1] = hi;
      return n;
    },
    clear,
  };
}

/**
 * @param {number} count  number of pixels
 * @param {{ delta: number, darkLimit: number }} rule
 *   delta: minimum swing between extrema; darkLimit: a transition counts only
 *   when its darker state is below this.
 */
export function createTracker(count, { delta, darkLimit }) {
  // While dir == 0, ext/run hold the lowest/highest value seen so far.
  // Afterwards ext is the last confirmed extremum and run the most extreme
  // value since then, in the current direction.
  const ext = new Float32Array(count);
  const run = new Float32Array(count);
  const dir = new Int8Array(count); // -1 falling, 0 unknown, +1 rising
  // Falling swing confirmed while still at or above darkLimit: register the
  // transition once (if) the fall goes below the limit.
  const pending = new Uint8Array(count);
  const ring = createRing(count);
  const register = ring.register;
  let started = false;

  function clear() {
    dir.fill(0);
    pending.fill(0);
    ring.clear();
    started = false;
  }
  clear();

  return {
    count,

    /**
     * Feed one frame of values (e.g. luminance) taken at time t.
     * @param {Float32Array} values @param {number} t
     */
    update(values, t) {
      if (!started) {
        ext.set(values);
        run.set(values);
        started = true;
        return;
      }
      for (let i = 0; i < count; i++) {
        const x = values[i];
        const d = dir[i];
        if (d === 0) {
          let lo = ext[i];
          let hi = run[i];
          if (x < lo) lo = x;
          if (x > hi) hi = x;
          if (x - lo >= delta) {
            dir[i] = 1;
            if (lo < darkLimit) register(i, t);
            ext[i] = lo;
            run[i] = x;
          } else if (hi - x >= delta) {
            dir[i] = -1;
            ext[i] = hi;
            run[i] = x;
            if (x < darkLimit) register(i, t);
            else pending[i] = 1;
          } else {
            ext[i] = lo;
            run[i] = hi;
          }
        } else if (d === 1) {
          if (x > run[i]) {
            run[i] = x;
          } else if (run[i] - x >= delta) {
            // Peak confirmed: falling transition.
            ext[i] = run[i];
            run[i] = x;
            dir[i] = -1;
            if (x < darkLimit) register(i, t);
            else pending[i] = 1;
          }
        } else {
          if (x < run[i]) {
            run[i] = x;
            if (pending[i] === 1 && x < darkLimit) {
              register(i, t);
              pending[i] = 0;
            }
          } else if (x - run[i] >= delta) {
            // Trough confirmed: rising transition, darker state is the trough.
            pending[i] = 0;
            ext[i] = run[i];
            dir[i] = 1;
            if (run[i] < darkLimit) register(i, t);
            run[i] = x;
          }
        }
      }
    },

    /** Transitions of pixel i inside the half-open window (t - WINDOW_MS, t]. */
    countInWindow: ring.countInWindow,
    spanInWindow: ring.spanInWindow,

    reset: clear,
  };
}
