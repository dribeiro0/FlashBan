// Unit tests for extension core (settings, domains, message validation, log).
// Run from the repo root: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, registrableDomain, isValidDomain, DEFAULT_SETTINGS } from "../shared/settings.js";
import { validateFlashReport, validateContentMessage, validateHudSubscribe, applyViolation, MAX_LOG_DOMAINS } from "./validate.js";

const report = (extra = {}) => ({
  v: 1,
  flashesPerSecond: 5,
  redFlashesPerSecond: 0,
  areaPx: 30000,
  areaPct: 0.4,
  violation: true,
  severity: "block",
  ...extra,
});

test("settings: defaults and junk input", () => {
  assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS, allowlist: [] });
  assert.deepEqual(normalizeSettings("nope"), { ...DEFAULT_SETTINGS, allowlist: [] });
  const s = normalizeSettings({ preset: "evil", guardedStart: "yes", hud: true, allowlist: ["Example.COM", "bad domain", "example.com", 42] });
  assert.equal(s.preset, "strict");
  assert.equal(s.guardedStart, true);
  assert.equal(s.hud, true);
  assert.deepEqual(s.allowlist, ["example.com"]);
});

test("settings: valid presets are kept", () => {
  for (const preset of ["strict", "wcag", "relaxed"]) assert.equal(normalizeSettings({ preset }).preset, preset);
});

test("registrableDomain", () => {
  assert.equal(registrableDomain("https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(registrableDomain("https://news.bbc.co.uk/a"), "bbc.co.uk");
  assert.equal(registrableDomain("https://user.github.io/x"), "user.github.io");
  assert.equal(registrableDomain("http://localhost:8080/"), "localhost");
  assert.equal(registrableDomain("http://127.0.0.1:3000/"), "127.0.0.1");
  assert.equal(registrableDomain("chrome://extensions"), "");
  assert.equal(registrableDomain("about:blank"), "");
  assert.equal(registrableDomain("not a url"), "");
});

test("isValidDomain", () => {
  assert.ok(isValidDomain("example.com"));
  assert.ok(isValidDomain("localhost"));
  assert.ok(!isValidDomain("-bad.com"));
  assert.ok(!isValidDomain("https://example.com"));
  assert.ok(!isValidDomain("a".repeat(254)));
  assert.ok(!isValidDomain(""));
});

test("validateFlashReport keeps known fields only", () => {
  const out = validateFlashReport({ ...report({ reason: "red", sampleRateHz: 60, undersampled: false }), extra: "dropped" });
  assert.ok(out);
  assert.equal(out.reason, "red");
  assert.equal(out.sampleRateHz, 60);
  assert.equal("extra" in out, false);
});

test("validateFlashReport rejects bad shapes", () => {
  assert.equal(validateFlashReport(null), null);
  assert.equal(validateFlashReport(report({ v: 2 })), null);
  assert.equal(validateFlashReport(report({ flashesPerSecond: NaN })), null);
  assert.equal(validateFlashReport(report({ flashesPerSecond: -1 })), null);
  assert.equal(validateFlashReport(report({ severity: "panic" })), null);
  assert.equal(validateFlashReport(report({ violation: "true" })), null);
  assert.equal(validateFlashReport(report({ reason: "blue" })), null);
  assert.equal(validateFlashReport(report({ undersampled: 1 })), null);
});

test("validateContentMessage: violation", () => {
  const m = validateContentMessage({ type: "violation", v: 1, domain: "example.com", source: "video", report: report(), at: 1 });
  assert.equal(m?.type, "violation");
  assert.equal(m?.domain, "example.com");
  const badDomain = validateContentMessage({ type: "violation", v: 1, domain: "https://x.com/path?q=1", source: "video", report: report(), at: 1 });
  assert.equal(badDomain?.domain, "", "full URLs are never stored");
  assert.equal(validateContentMessage({ type: "violation", v: 1, domain: "a.com", source: "webcam", report: report(), at: 1 }), null);
});

test("validateContentMessage: report and page", () => {
  assert.ok(validateContentMessage({ type: "report", v: 1, sourceId: "s1", source: "canvas", preset: "wcag", report: report(), at: 2 }));
  assert.equal(validateContentMessage({ type: "report", v: 1, sourceId: "<img onerror=x>", source: "canvas", preset: "wcag", report: report(), at: 2 }), null);
  assert.equal(validateContentMessage({ type: "report", v: 1, sourceId: "s1", source: "canvas", preset: "max", report: report(), at: 2 }), null);
  assert.ok(validateContentMessage({ type: "page", v: 1, aggregate: { violation: true, totalAreaPx: 5, ids: ["s1", "s2"] }, at: 3 }));
  assert.equal(validateContentMessage({ type: "page", v: 1, aggregate: { violation: true, totalAreaPx: 5, ids: [1] }, at: 3 }), null);
});

test("validateContentMessage: unknown types and versions are dropped", () => {
  assert.equal(validateContentMessage({ type: "setSettings", v: 1 }), null);
  assert.equal(validateContentMessage({ type: "getSettings", v: 2 }), null);
  assert.deepEqual(validateContentMessage({ type: "getSettings", v: 1, junk: 1 }), { type: "getSettings", v: 1 });
});

test("validateHudSubscribe", () => {
  assert.deepEqual(validateHudSubscribe({ type: "hudSubscribe", v: 1, tabId: 12 }), { type: "hudSubscribe", v: 1, tabId: 12 });
  assert.equal(validateHudSubscribe({ type: "hudSubscribe", v: 1, tabId: "12" }), null);
  assert.equal(validateHudSubscribe({ type: "hudSubscribe", v: 1, tabId: 1.5 }), null);
  assert.equal(validateHudSubscribe({ type: "hudSubscribe", v: 1, tabId: -1 }), null);
});

test("applyViolation adds and updates entries", () => {
  let log = applyViolation(undefined, "a.com", "video", { flashesPerSecond: 4 }, 100);
  assert.deepEqual(log.domains["a.com"], { count: 1, firstSeen: 100, lastSeen: 100, maxFps: 4, sources: ["video"] });
  log = applyViolation(log, "a.com", "css", { flashesPerSecond: 9 }, 200);
  assert.deepEqual(log.domains["a.com"], { count: 2, firstSeen: 100, lastSeen: 200, maxFps: 9, sources: ["video", "css"] });
});

test("applyViolation caps the log size", () => {
  let log = undefined;
  for (let i = 0; i < MAX_LOG_DOMAINS + 5; i++) log = applyViolation(log, `d${i}.com`, "video", { flashesPerSecond: 4 }, i);
  assert.equal(Object.keys(log.domains).length, MAX_LOG_DOMAINS);
  assert.equal("d0.com" in log.domains, false, "oldest dropped");
  assert.ok(`d${MAX_LOG_DOMAINS + 4}.com` in log.domains);
});
