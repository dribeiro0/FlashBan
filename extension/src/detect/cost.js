// CPU budget meter for one sampled source (threat T5, DESIGN.md section 7).
//
// Why not one running mean of everything: measured on Nov 7 (Chrome 157,
// David's laptop, one 320x180 canvas read into 128x72), the pixel READBACK
// (drawImage + getImageData) costs 2.3 ms median but 8.2 ms mean, because the
// GPU stalls now and then (p95 18 ms, max 21 ms). The detector push itself is
// 0.14-0.35 ms. A 3 ms running mean of the sum therefore marks ordinary
// long-running canvases (maps, games, charts) as "can't keep up" and dims them.
//
// So the two costs are judged separately:
// - readback: by the MEDIAN over a window of frames (occasional stalls are
//   not "can't keep up"; a sustained slow readback is);
// - detector: by the MEAN over the same window (it is our own code and steady).
// Frames whose content didn't change can be left out (changed: false), so a
// static canvas doesn't use up the budget.
//
// Fail closed stays: a sustained overload still reports `over`, and a
// non-finite cost counts as over the limit. Pure module, never throws.

/**
 * @param {{ readMedianLimitMs?: number, detectMeanLimitMs?: number, window?: number, minSamples?: number }} [opts]
 */
export function createCostMeter(opts = {}) {
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
  const readLimit = num(opts.readMedianLimitMs, 12);
  const detectLimit = num(opts.detectMeanLimitMs, 1.5);
  const size = Math.max(1, Math.min(600, Math.round(num(opts.window, 60))));
  const minSamples = Math.max(1, Math.min(size, Math.round(num(opts.minSamples, 30))));

  const reads = new Float64Array(size);
  const detects = new Float64Array(size);
  const sorted = new Float64Array(size);
  let head = 0;
  let count = 0;

  function reset() {
    head = 0;
    count = 0;
  }

  /** @param {unknown} v */
  const cost = (v) => (typeof v === "number" && v >= 0 && Number.isFinite(v) ? v : Infinity);

  function stats() {
    const n = count;
    if (n === 0) return { readMedianMs: 0, detectMeanMs: 0, samples: 0 };
    for (let i = 0; i < n; i++) sorted[i] = reads[i];
    const part = sorted.subarray(0, n).sort();
    const readMedianMs = n % 2 ? part[(n - 1) / 2] : (part[n / 2 - 1] + part[n / 2]) / 2;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += detects[i];
    return { readMedianMs, detectMeanMs: sum / n, samples: n };
  }

  return {
    /**
     * Record one sampled frame. Frames with changed === false are ignored.
     * @param {{ readMs: number, detectMs: number, changed?: boolean }} f
     */
    add(f) {
      try {
        if (!f || f.changed === false) return;
        reads[head] = cost(f.readMs);
        detects[head] = cost(f.detectMs);
        head = (head + 1) % size;
        if (count < size) count++;
      } catch {
        // never throw
      }
    },

    /**
     * @returns {{ over: boolean, reason?: "readback" | "detector", readMedianMs: number, detectMeanMs: number, samples: number }}
     */
    check() {
      try {
        const s = stats();
        if (s.samples < minSamples) return { over: false, ...s };
        if (!(s.detectMeanMs <= detectLimit)) return { over: true, reason: "detector", ...s };
        if (!(s.readMedianMs <= readLimit)) return { over: true, reason: "readback", ...s };
        return { over: false, ...s };
      } catch {
        return { over: true, readMedianMs: Infinity, detectMeanMs: Infinity, samples: count };
      }
    },

    reset,
  };
}
