// Message validation and log updates for the background worker.
// Pure functions (no chrome.*), unit-tested with `npm test`.

import { PRESETS, isValidDomain } from "../shared/settings.js";

export const SOURCES = /** @type {const} */ (["video", "canvas", "css", "gif", "dom"]);
const SEVERITIES = ["none", "warn", "block"];
const REASONS = ["general", "red", "both"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_LOG_DOMAINS = 1000;

/** @param {unknown} x @param {number} min @param {number} max */
const num = (x, min, max) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
/** @param {unknown} x */
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

/**
 * Validate a FlashReport (CONTRACTS section 1) and copy only known fields.
 * @param {unknown} raw
 */
export function validateFlashReport(raw) {
  if (!isObj(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.v !== 1) return null;
  if (!num(r.flashesPerSecond, 0, 1000) || !num(r.redFlashesPerSecond, 0, 1000)) return null;
  if (!num(r.areaPx, 0, 1e9) || !num(r.areaPct, 0, 100)) return null;
  if (typeof r.violation !== "boolean" || !SEVERITIES.includes(/** @type {string} */ (r.severity))) return null;
  /** @type {Record<string, unknown>} */
  const out = {
    v: 1,
    flashesPerSecond: r.flashesPerSecond,
    redFlashesPerSecond: r.redFlashesPerSecond,
    areaPx: r.areaPx,
    areaPct: r.areaPct,
    violation: r.violation,
    severity: r.severity,
  };
  if (r.reason !== undefined) {
    if (!REASONS.includes(/** @type {string} */ (r.reason))) return null;
    out.reason = r.reason;
  }
  if (r.windowMs !== undefined) {
    if (!num(r.windowMs, 1, 60_000)) return null;
    out.windowMs = r.windowMs;
  }
  if (r.sampleRateHz !== undefined) {
    if (!num(r.sampleRateHz, 0, 1000)) return null;
    out.sampleRateHz = r.sampleRateHz;
  }
  if (r.undersampled !== undefined) {
    if (typeof r.undersampled !== "boolean") return null;
    out.undersampled = r.undersampled;
  }
  if (r.redAreaPx !== undefined) {
    if (!num(r.redAreaPx, 0, 1e9)) return null;
    out.redAreaPx = r.redAreaPx;
  }
  return out;
}

/**
 * Validate a message from a content script (CONTRACTS sections 3 and 3a).
 * Returns a normalized copy, or null to drop it.
 * @param {unknown} raw
 */
export function validateContentMessage(raw) {
  if (!isObj(raw)) return null;
  const m = /** @type {Record<string, unknown>} */ (raw);
  if (m.v !== 1) return null;
  switch (m.type) {
    case "getSettings":
      return { type: "getSettings", v: 1 };
    case "lockdown":
      if (typeof m.on !== "boolean") return null;
      return { type: "lockdown", v: 1, on: m.on };
    case "violation": {
      const report = validateFlashReport(m.report);
      if (!report || !SOURCES.includes(/** @type {any} */ (m.source)) || !num(m.at, 0, 1e15)) return null;
      const domain = typeof m.domain === "string" && isValidDomain(m.domain) ? m.domain : "";
      return { type: "violation", v: 1, domain, source: m.source, report, at: m.at };
    }
    case "report": {
      const report = validateFlashReport(m.report);
      if (!report || !SOURCES.includes(/** @type {any} */ (m.source)) || !num(m.at, 0, 1e15)) return null;
      if (typeof m.sourceId !== "string" || !ID_RE.test(m.sourceId)) return null;
      if (!PRESETS.includes(/** @type {any} */ (m.preset))) return null;
      return { type: "report", v: 1, sourceId: m.sourceId, source: m.source, preset: m.preset, report, at: m.at };
    }
    case "page": {
      const a = m.aggregate;
      if (!isObj(a) || !num(m.at, 0, 1e15)) return null;
      const agg = /** @type {Record<string, unknown>} */ (a);
      if (typeof agg.violation !== "boolean" || !num(agg.totalAreaPx, 0, 1e9)) return null;
      if (!Array.isArray(agg.ids) || agg.ids.length > 256 || !agg.ids.every((id) => typeof id === "string" && ID_RE.test(id))) return null;
      return { type: "page", v: 1, aggregate: { violation: agg.violation, totalAreaPx: agg.totalAreaPx, ids: [...agg.ids] }, at: m.at };
    }
    default:
      return null;
  }
}

/**
 * Validate a HUD subscription (CONTRACTS section 3a).
 * @param {unknown} raw
 */
export function validateHudSubscribe(raw) {
  if (!isObj(raw)) return null;
  const m = /** @type {Record<string, unknown>} */ (raw);
  if (m.type !== "hudSubscribe" || m.v !== 1) return null;
  if (typeof m.tabId !== "number" || !Number.isInteger(m.tabId) || m.tabId < 0 || m.tabId > 2 ** 31) return null;
  return { type: "hudSubscribe", v: 1, tabId: m.tabId };
}

/**
 * @typedef {{ count: number, firstSeen: number, lastSeen: number, maxFps: number, sources: string[] }} DomainEntry
 * @typedef {{ v: 1, domains: Record<string, DomainEntry> }} ViolationLog
 */

/** @returns {ViolationLog} */
export function emptyLog() {
  return { v: 1, domains: {} };
}

/**
 * Return a new log with one violation added (CONTRACTS section 4).
 * Keeps at most MAX_LOG_DOMAINS domains, dropping the least recently seen.
 * @param {unknown} log
 * @param {string} domain
 * @param {string} source
 * @param {{ flashesPerSecond: number }} report
 * @param {number} at
 * @returns {ViolationLog}
 */
export function applyViolation(log, domain, source, report, at) {
  const base = isObj(log) && /** @type {any} */ (log).v === 1 && isObj(/** @type {any} */ (log).domains) ? /** @type {ViolationLog} */ (log) : emptyLog();
  /** @type {Record<string, DomainEntry>} */
  const domains = { ...base.domains };
  const prev = domains[domain];
  const fps = Number.isFinite(report.flashesPerSecond) ? report.flashesPerSecond : 0;
  domains[domain] = prev
    ? {
        count: prev.count + 1,
        firstSeen: prev.firstSeen,
        lastSeen: Math.max(prev.lastSeen, at),
        maxFps: Math.max(prev.maxFps, fps),
        sources: prev.sources.includes(source) ? prev.sources : [...prev.sources, source],
      }
    : { count: 1, firstSeen: at, lastSeen: at, maxFps: fps, sources: [source] };

  const names = Object.keys(domains);
  if (names.length > MAX_LOG_DOMAINS) {
    names.sort((a, b) => domains[a].lastSeen - domains[b].lastSeen);
    for (const name of names.slice(0, names.length - MAX_LOG_DOMAINS)) delete domains[name];
  }
  return { v: 1, domains };
}
