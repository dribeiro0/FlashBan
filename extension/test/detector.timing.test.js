// Timing vectors T4-T10 from TEST_VECTORS.md (T1-T3 and T8 live elsewhere).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDetector } from "../src/detect/index.js";
import { DARK, LIGHT, grid, square, drive, whole } from "./helpers.js";

const W = 16;
const H = 9;
const OPTS = { preset: "wcag", sampleWidth: W, sampleHeight: H, realAreaScale: 16 };
const hz4 = whole(square(125));
const calm = whole(() => DARK);
const sev = { none: 0, warn: 1, block: 2 };

test("T4: a 150 ms gap marks undersampled and warns, then clears after a window", () => {
  const d = createDetector(OPTS);
  // Calm content so the gap is the only reason to warn.
  drive(d, W, H, grid(60, 1000), calm);
  const after = drive(d, W, H, grid(60, 3000, 1150), calm);
  assert.equal(after[0].r.undersampled, true);
  assert.ok(sev[after[0].r.severity] >= sev.warn);
  const late = after.filter(({ t }) => t > 2200);
  for (const { r } of late) {
    assert.equal(r.undersampled, false);
    assert.equal(r.severity, "none");
  }
});

test("T4b: 4 Hz across a 150 ms gap still blocks (never downgraded to warn)", () => {
  const d = createDetector(OPTS);
  drive(d, W, H, grid(60, 1500), hz4);
  const after = drive(d, W, H, grid(60, 3000, 1650), hz4);
  assert.equal(after[0].r.undersampled, true);
  assert.equal(after.at(-1).r.severity, "block");
});

test("T5: 4 Hz sampled at 4 Hz on phase is never clean, and blocks after a window", () => {
  const d = createDetector(OPTS);
  const reps = drive(d, W, H, grid(4, 3000), hz4);
  for (const { t, r } of reps.slice(1)) {
    assert.equal(r.undersampled, true, `t=${t}`);
    assert.ok(sev[r.severity] >= sev.warn, `t=${t}`);
  }
  for (const { t, r } of reps.filter(({ t }) => t >= 1000)) {
    assert.equal(r.severity, "block", `t=${t}`);
    assert.equal(r.violation, true);
  }
});

test("T6: a seek after flashing holds warn for one window, no throw", () => {
  // Changed Nov 7: the hold only applies if something was flashing before the jump.
  const d = createDetector(OPTS);
  // 2 Hz flashing (counted, but under the limit), then a 1000 ms backwards seek to calm.
  drive(d, W, H, grid(60, 3000), whole(square(250)));
  const after = drive(d, W, H, grid(60, 4000, 2000), calm);
  assert.equal(after[0].r.severity, "warn");
  assert.ok(after.filter(({ t }) => t < 2900).every(({ r }) => r.severity === "warn"));
  assert.equal(after.at(-1).r.severity, "none");
});

test("T6b: a calm video that loops or seeks is not dimmed", () => {
  const d = createDetector(OPTS);
  drive(d, W, H, grid(60, 3000), calm);
  const after = drive(d, W, H, grid(60, 4000, 2000), calm);
  for (const { r } of after) assert.equal(r.severity, "none");
});

// ---- dropped-frame flag (FrameSample.dropped, additive) ----

/** Drive with an explicit dropped flag on every sample. */
function driveFlag(d, times, paint, dropped) {
  const px = new Uint8ClampedArray(W * H * 4);
  return times.map((t, i) => {
    paint(px, t, i);
    return { t, r: d.push(dropped === undefined ? { t, pixels: px } : { t, pixels: px, dropped }) };
  });
}

test("D1a: an 8 fps video with no dropped frames is not undersampled", () => {
  const reps = driveFlag(createDetector(OPTS), grid(8, 4000), calm, false);
  for (const { r } of reps) {
    assert.equal(r.undersampled, false);
    assert.equal(r.severity, "none");
  }
});

test("D1a: the same 8 fps samples WITHOUT the flag keep the old fail-closed gap rule", () => {
  const reps = driveFlag(createDetector(OPTS), grid(8, 4000), calm, undefined);
  assert.ok(reps.slice(1).every(({ r }) => r.undersampled));
  assert.equal(reps.at(-1).r.severity, "block"); // gaps for a whole window
});

test("D1a: real dropped frames still warn (dropped: true)", () => {
  const reps = driveFlag(createDetector(OPTS), grid(8, 2000), calm, true);
  assert.ok(reps.slice(1).every(({ r }) => r.undersampled));
});

test("D1a: a 1.5 s buffering stall with no dropped frames is not a warning", () => {
  const times = [...grid(30, 2000), ...grid(30, 5000, 3500)];
  const reps = driveFlag(createDetector(OPTS), times, calm, false);
  for (const { r } of reps) assert.equal(r.severity, "none");
});

test("D1a: a 4 Hz strobe inside an 8 fps video is still caught", () => {
  // Every frame flips (125 ms per frame = half a 4 Hz cycle).
  const reps = driveFlag(createDetector(OPTS), grid(8, 4000), hz4, false);
  assert.ok(reps.some(({ r }) => r.violation));
});

test("T7: a looping 800 ms strobe still reaches a violation", () => {
  const d = createDetector(OPTS);
  let hit = false;
  for (let loop = 0; loop < 5 && !hit; loop++) {
    const reps = drive(d, W, H, grid(60, 800), hz4);
    hit = reps.some(({ r }) => r.violation);
  }
  assert.ok(hit);
});

test("T9: 30 s safe intro, then 4 Hz violates by onset + 1000 ms", () => {
  const t0 = 30000;
  const d = createDetector(OPTS);
  const level = (t) => (t < t0 ? DARK : Math.floor((t - t0) / 125) % 2 === 0 ? LIGHT : DARK);
  const reps = drive(d, W, H, grid(60, t0 + 2000), whole(level));
  const first = reps.find(({ r }) => r.violation);
  assert.ok(first && first.t <= t0 + 1000, `first violation at ${first?.t}`);
});

test("T10: time to detect 4 Hz at 60 fps is under ~900 ms", () => {
  const t0 = 1000;
  const d = createDetector(OPTS);
  const level = (t) => (t < t0 ? DARK : Math.floor((t - t0) / 125) % 2 === 0 ? LIGHT : DARK);
  const reps = drive(d, W, H, grid(60, t0 + 2000), whole(level));
  const first = reps.find(({ r }) => r.violation);
  assert.ok(first, "violates");
  const latency = first.t - t0;
  // Measured 750 ms (7th transition). Recorded in TEST_VECTORS.md T10.
  assert.ok(latency <= 900, `latency ${latency} ms`);
});
