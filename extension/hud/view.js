// Pure helpers for the demo HUD (no DOM, no chrome.*), unit-tested with `npm test`.
// The background already validates reports (CONTRACTS 3a); this is defense in depth and
// keeps only the fields CONTRACTS section 1 lets the HUD show.

export const STALE_MS = 1000; // show "unavailable" when a source has sent nothing for 1 s

const SOURCES = ["video", "canvas", "css", "gif", "dom"];
const SEVERITIES = ["none", "warn", "block"];
const REASONS = ["general", "red", "both"];
const PRESETS = ["strict", "wcag", "relaxed"];
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const num = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

// A missing query value must not become tab 0 through Number(null).
export function parseHudTab(search) {
  const value = new URLSearchParams(search).get("tab");
  if (value === null || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Parse one message from the background port.
 * @param {unknown} m
 * @param {number} tabId the tab this HUD subscribed to
 * @returns {{kind:"status", enabled:boolean} | {kind:"report", id:string, row:object} | {kind:"page", page:object} | null}
 */
export function parseHudMessage(m, tabId) {
  if (!isObj(m) || m.v !== 1) return null;
  if (m.type === "hudStatus") return typeof m.enabled === "boolean" ? { kind: "status", enabled: m.enabled } : null;
  if (m.tabId !== tabId) return null;
  if (m.type === "report") {
    const r = m.report;
    if (typeof m.sourceId !== "string" || !ID_RE.test(m.sourceId)) return null;
    if (!SOURCES.includes(m.source) || !PRESETS.includes(m.preset) || !isObj(r)) return null;
    if (!num(r.flashesPerSecond) || !num(r.redFlashesPerSecond) || !num(r.areaPx) || !num(r.areaPct)) return null;
    if (!SEVERITIES.includes(r.severity)) return null;
    return {
      kind: "report",
      id: m.sourceId,
      row: {
        source: m.source,
        preset: m.preset,
        flashesPerSecond: r.flashesPerSecond,
        redFlashesPerSecond: r.redFlashesPerSecond,
        areaPx: r.areaPx,
        areaPct: r.areaPct,
        severity: r.severity,
        reason: REASONS.includes(r.reason) ? r.reason : "",
        sampleRateHz: num(r.sampleRateHz) ? r.sampleRateHz : null,
        undersampled: r.undersampled === true,
      },
    };
  }
  if (m.type === "page") {
    const a = m.aggregate;
    if (!isObj(a) || typeof a.violation !== "boolean" || !num(a.totalAreaPx) || !Array.isArray(a.ids)) return null;
    return { kind: "page", page: { violation: a.violation, totalAreaPx: a.totalAreaPx, count: a.ids.length } };
  }
  return null;
}

/**
 * Display strings for one source row. `row` null or stale means "unavailable".
 * @param {object | null} row
 * @param {number} age ms since the last report
 */
export function formatRow(row, age) {
  if (!row || age > STALE_MS) return { fps: "unavailable", red: "unavailable", area: "unavailable", rate: "unavailable", severity: "unavailable" };
  const pct = row.areaPct * 100; // detector areaPct is a 0..1 share of the sampled area (PR #13)
  return {
    fps: row.flashesPerSecond.toFixed(1),
    red: row.redFlashesPerSecond.toFixed(1),
    area: `${Math.round(row.areaPx).toLocaleString("en-US")} px (${pct.toFixed(0)}%)`,
    rate: row.sampleRateHz === null ? "unknown" : `${row.sampleRateHz.toFixed(0)} Hz${row.undersampled ? ", undersampled" : ""}`,
    severity: row.severity + (row.reason ? ` (${row.reason})` : ""),
  };
}
