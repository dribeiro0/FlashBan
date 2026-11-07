// Cross-element area aggregation (threat T2, DESIGN.md section 5).
// An attacker can split one big flash into many small elements, each under
// the area threshold. WCAG judges concurrent area on the screen, so we sum the
// latest report of every element that is still being sampled.
// v1 rule: plain sum over all current ids (over-counts far-apart elements,
// which errs towards flagging). Pure module: no DOM, no chrome.*.

import { WINDOW_MS, getPreset } from "./presets.js";

/** Cap on tracked ids, so a page with thousands of elements can't grow memory without bound. */
const MAX_IDS = 4096;

/**
 * @param {"strict" | "wcag" | "relaxed"} presetName
 */
export function createAggregator(presetName) {
  // Unknown preset: use the strictest area so we fail towards flagging.
  const preset = getPreset(presetName) || getPreset("strict");
  const limit = /** @type {import("./presets.js").Preset} */ (preset).areaPx;
  /** @type {Map<string, { t: number, areaPx: number, redAreaPx: number }>} */
  const latest = new Map();

  /** @param {unknown} n */
  const area = (n) => (n === undefined ? 0 : typeof n === "number" && n >= 0 && !Number.isNaN(n) ? n : Infinity);

  function prune(t) {
    for (const [id, r] of latest) if (!(r.t > t - WINDOW_MS)) latest.delete(id);
  }

  return {
    /**
     * Record the latest report of one element. Malformed numbers count as
     * infinite area (fail closed); a report without a string id is ignored
     * because there is nothing to guard.
     * @param {{ id: string, t: number, areaPx: number, redAreaPx?: number }} r
     */
    update(r) {
      try {
        if (!r || typeof r.id !== "string" || typeof r.t !== "number" || !Number.isFinite(r.t)) return;
        latest.set(r.id, { t: r.t, areaPx: area(r.areaPx), redAreaPx: area(r.redAreaPx) });
        if (latest.size > MAX_IDS) prune(r.t);
      } catch {
        // never throw
      }
    },

    /**
     * Page-level verdict at time t. Reports older than one window are dropped.
     * @param {number} t
     * @returns {{ violation: boolean, totalAreaPx: number, totalRedAreaPx: number, ids: string[], reason?: "general" | "red" | "both" }}
     */
    result(t) {
      try {
        if (typeof t !== "number" || !Number.isFinite(t)) {
          return { violation: true, totalAreaPx: 0, totalRedAreaPx: 0, ids: [...latest.keys()] };
        }
        prune(t);
        let total = 0;
        let red = 0;
        /** @type {string[]} */
        const ids = [];
        for (const [id, r] of latest) {
          if (r.t > t) continue; // from the future relative to this query: ignore
          total += r.areaPx;
          red += r.redAreaPx;
          if (r.areaPx > 0 || r.redAreaPx > 0) ids.push(id);
        }
        const general = total > limit;
        const redHit = red > limit;
        /** @type {ReturnType<ReturnType<typeof createAggregator>["result"]>} */
        const out = { violation: general || redHit, totalAreaPx: total, totalRedAreaPx: red, ids };
        if (general || redHit) out.reason = general && redHit ? "both" : general ? "general" : "red";
        return out;
      } catch {
        return { violation: true, totalAreaPx: 0, totalRedAreaPx: 0, ids: [...latest.keys()] };
      }
    },
  };
}
