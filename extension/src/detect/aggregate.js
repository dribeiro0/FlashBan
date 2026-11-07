// Cross-element area aggregation (threat T2, DESIGN.md section 5).
// An attacker can split one big flash into many small elements, each under
// the area threshold. WCAG judges concurrent area on the screen, so we sum the
// latest report of every element that is still being sampled.
// v2 rule (area.js, W3C Understanding 2.3.1): the flashing area that falls
// inside any one 341 x 256 CSS px field (either orientation), using each
// element's viewport rect. An element contributes min(its flashing area, the
// part of its rect inside the field), which never under-counts. Elements
// reported without a rect count in full in every field (conservative), so
// with no rects at all this is the v1 plain sum.
// Pure module: no DOM, no chrome.*.

import { WINDOW_MS, getPreset } from "./presets.js";
import { FIELD_W, FIELD_H } from "./area.js";

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */

/** @param {any} r @returns {Box | null} */
function toBox(r) {
  if (!r || typeof r !== "object") return null;
  const left = Number(r.left ?? r.x);
  const top = Number(r.top ?? r.y);
  const width = Number(r.width);
  const height = Number(r.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 0 || height < 0) return null;
  return { left, top, right: left + width, bottom: top + height };
}

/** @param {Box} a @param {Box} b */
function overlap(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Cap on tracked ids, so a page with thousands of elements can't grow memory without bound. */
const MAX_IDS = 4096;

/**
 * @param {"strict" | "wcag" | "relaxed"} presetName
 */
export function createAggregator(presetName) {
  // Unknown preset: use the strictest area so we fail towards flagging.
  const preset = getPreset(presetName) || getPreset("strict");
  const limit = /** @type {import("./presets.js").Preset} */ (preset).areaPx;
  /** @type {Map<string, { t: number, areaPx: number, redAreaPx: number, box: Box | null }>} */
  const latest = new Map();

  /**
   * Best field for one measure ("areaPx" or "redAreaPx").
   * @param {[string, { areaPx: number, redAreaPx: number, box: Box | null }][]} items
   * @param {"areaPx" | "redAreaPx"} key
   * @returns {{ total: number, ids: string[] }}
   */
  function bestField(items, key) {
    const live = items.filter(([, r]) => r[key] > 0);
    const boxes = live.map(([, r]) => r.box).filter(Boolean);
    /** @type {Box[]} */
    const fields = [];
    if (boxes.length === 0) {
      fields.push({ left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity });
    } else {
      for (const [fw, fh] of [
        [FIELD_W, FIELD_H],
        [FIELD_H, FIELD_W],
      ]) {
        const xs = boxes.flatMap((b) => [b.left, b.right - fw]);
        const ys = boxes.flatMap((b) => [b.top, b.bottom - fh]);
        for (const x of xs) for (const y of ys) fields.push({ left: x, top: y, right: x + fw, bottom: y + fh });
      }
    }
    let best = { total: 0, ids: /** @type {string[]} */ ([]) };
    for (const f of fields) {
      let total = 0;
      const ids = [];
      for (const [id, r] of live) {
        const part = r.box ? Math.min(r[key], overlap(r.box, f)) : r[key];
        if (part > 0) {
          total += part;
          ids.push(id);
        }
      }
      if (total > best.total) best = { total, ids };
    }
    return best;
  }

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
        const a = area(r.areaPx);
        const ra = area(r.redAreaPx);
        // A malformed area stays infinite in every field (no rect clamp): fail closed.
        const box = Number.isFinite(a) && Number.isFinite(ra) ? toBox(/** @type {any} */ (r).rect) : null;
        latest.set(r.id, { t: r.t, areaPx: a, redAreaPx: ra, box });
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
        // Reports from the future relative to this query are ignored.
        const items = [...latest].filter(([, r]) => r.t <= t);
        const g = bestField(items, "areaPx");
        const rf = bestField(items, "redAreaPx");
        const total = g.total;
        const red = rf.total;
        const ids = [...new Set([...g.ids, ...rf.ids])];
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
