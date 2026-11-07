import test from "node:test";
import assert from "node:assert/strict";
import { parseHudMessage, formatRow } from "./view.js";

const report = (over = {}) => ({
  type: "report", v: 1, tabId: 7, sourceId: "f0-s1", source: "canvas", preset: "strict", at: 1,
  report: { v: 1, flashesPerSecond: 4, redFlashesPerSecond: 0, areaPx: 57600, areaPct: 1, violation: true, severity: "block", reason: "general", sampleRateHz: 60, ...over },
});

test("hudStatus parses regardless of tab", () => {
  assert.deepEqual(parseHudMessage({ type: "hudStatus", v: 1, enabled: false }, 7), { kind: "status", enabled: false });
  assert.equal(parseHudMessage({ type: "hudStatus", v: 1, enabled: "yes" }, 7), null);
});

test("report keeps only section-1 fields", () => {
  const p = parseHudMessage({ ...report(), extra: "<img>" }, 7);
  assert.equal(p.kind, "report");
  assert.equal(p.id, "f0-s1");
  assert.deepEqual(Object.keys(p.row).sort(), ["areaPct", "areaPx", "flashesPerSecond", "preset", "reason", "redFlashesPerSecond", "sampleRateHz", "severity", "source", "undersampled"]);
});

test("rejects other tabs, bad ids and bad values", () => {
  assert.equal(parseHudMessage(report(), 8), null);
  assert.equal(parseHudMessage({ ...report(), sourceId: "<script>" }, 7), null);
  assert.equal(parseHudMessage(report({ flashesPerSecond: NaN }), 7), null);
  assert.equal(parseHudMessage(report({ severity: "evil" }), 7), null);
  assert.equal(parseHudMessage({ ...report(), v: 2 }, 7), null);
  assert.equal(parseHudMessage(null, 7), null);
});

test("page aggregate parses", () => {
  const p = parseHudMessage({ type: "page", v: 1, tabId: 7, aggregate: { violation: true, totalAreaPx: 30000, ids: ["a", "b"] }, at: 1 }, 7);
  assert.deepEqual(p, { kind: "page", page: { violation: true, totalAreaPx: 30000, count: 2 } });
});

test("formatRow shows unavailable when stale or missing", () => {
  assert.equal(formatRow(null, 0).fps, "unavailable");
  const row = parseHudMessage(report(), 7).row;
  assert.equal(formatRow(row, 1001).severity, "unavailable");
  const f = formatRow(row, 10);
  assert.equal(f.fps, "4.0");
  assert.equal(f.area, "57,600 px (100%)");
  assert.equal(f.rate, "60 Hz");
  assert.equal(f.severity, "block (general)");
});
