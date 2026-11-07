// API shape and fail-closed tests (TEST_VECTORS.md B1-B7, T8; skeleton stage).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDetector } from "../src/detect/index.js";
import { PRESETS, getPreset } from "../src/detect/presets.js";

const W = 16;
const H = 9;
const OPTS = { preset: "wcag", sampleWidth: W, sampleHeight: H, realAreaScale: 2 };

/** @param {number} gray @param {number} [alpha] */
function frame(gray, alpha = 255) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i + 1] = px[i + 2] = gray;
    px[i + 3] = alpha;
  }
  return px;
}

function assertBlock(r) {
  assert.equal(r.violation, true);
  assert.equal(r.severity, "block");
}

function assertShape(r) {
  assert.equal(r.v, 1);
  for (const k of ["flashesPerSecond", "redFlashesPerSecond", "areaPx", "areaPct", "windowMs", "sampleRateHz", "redAreaPx"]) {
    assert.equal(typeof r[k], "number", k);
  }
  assert.equal(typeof r.violation, "boolean");
  assert.equal(typeof r.undersampled, "boolean");
  assert.ok(["none", "warn", "block"].includes(r.severity));
}

test("API: push, peek and reset exist and return full FlashReports", () => {
  const d = createDetector(OPTS);
  assertShape(d.peek());
  const r = d.push({ t: 0, pixels: frame(128) });
  assertShape(r);
  assert.equal(r.severity, "none");
  assert.equal(r.windowMs, 1000);
  assert.deepEqual(d.peek(), r);
  d.reset();
  assert.equal(d.peek().severity, "none");
});

test("peek returns a copy the caller cannot mutate", () => {
  const d = createDetector(OPTS);
  d.push({ t: 0, pixels: frame(10) });
  const p = d.peek();
  p.violation = true;
  assert.equal(d.peek().violation, false);
});

test("presets: constants from WCAG_NOTES", () => {
  assert.equal(PRESETS.wcag.maxFlashes, 3);
  assert.equal(PRESETS.wcag.areaPx, 21824);
  assert.equal(PRESETS.strict.maxFlashes, 2);
  assert.equal(PRESETS.strict.anyRedFlash, true);
  assert.equal(getPreset("nope"), null);
  assert.equal(getPreset("toString"), null);
});

test("B1: pixels one byte short blocks", () => {
  const d = createDetector(OPTS);
  assertBlock(d.push({ t: 0, pixels: new Uint8ClampedArray(W * H * 4 - 1) }));
});

test("B2: non-finite t blocks", () => {
  for (const t of [NaN, Infinity, -Infinity, undefined, "5"]) {
    const d = createDetector(OPTS);
    assertBlock(d.push({ t, pixels: frame(0) }));
  }
});

test("B3: plain Array or Uint8Array pixels block", () => {
  const d = createDetector(OPTS);
  assertBlock(d.push({ t: 0, pixels: new Array(W * H * 4).fill(0) }));
  assertBlock(d.push({ t: 1, pixels: new Uint8Array(W * H * 4) }));
});

test("B4: bad options give a detector that always blocks", () => {
  const bad = [
    undefined,
    null,
    {},
    { ...OPTS, sampleWidth: 0 },
    { ...OPTS, sampleWidth: -4 },
    { ...OPTS, sampleWidth: 12.5 },
    { ...OPTS, sampleWidth: 1000 },
    { ...OPTS, sampleHeight: 0 },
    { ...OPTS, preset: "loose" },
    { ...OPTS, realAreaScale: 0 },
    { ...OPTS, realAreaScale: NaN },
  ];
  for (const o of bad) {
    const d = createDetector(o);
    assertBlock(d.peek());
    assertBlock(d.push({ t: 0, pixels: frame(0) }));
  }
});

test("B5: an internal error is caught at the push boundary", () => {
  const d = createDetector(OPTS);
  const evil = {
    t: 0,
    get pixels() {
      throw new Error("boom");
    },
  };
  assertBlock(d.push(evil));
  assertBlock(d.push(null));
  assertBlock(d.push(undefined));
});

test("B6/B7: all-black and all-transparent frames are valid input", () => {
  for (const px of [frame(0), frame(255, 0)]) {
    const d = createDetector(OPTS);
    for (let t = 0; t <= 5000; t += 1000 / 60) {
      const r = d.push({ t, pixels: px });
      assert.equal(r.violation, false);
      assert.equal(r.severity, "none");
    }
  }
});

test("T8: identical timestamps are ignored, no throw", () => {
  const d = createDetector(OPTS);
  const a = d.push({ t: 100, pixels: frame(0) });
  const b = d.push({ t: 100, pixels: frame(255) });
  assert.deepEqual(b, a);
});

test("sampleRateHz is measured from timestamps", () => {
  const d = createDetector(OPTS);
  d.push({ t: 0, pixels: frame(0) });
  const r = d.push({ t: 1000 / 60, pixels: frame(0) });
  assert.ok(Math.abs(r.sampleRateHz - 60) < 1e-6);
});

test("gap over 100 ms marks undersampled and warns", () => {
  const d = createDetector(OPTS);
  d.push({ t: 0, pixels: frame(0) });
  const r = d.push({ t: 150, pixels: frame(0) });
  assert.equal(r.undersampled, true);
  assert.equal(r.severity, "warn");
});
