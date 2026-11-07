// createCostMeter: budgets from the Nov 7 measurements (cost.js header).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCostMeter } from "../src/detect/index.js";
import { rng } from "./helpers.js";

/** Readback like headed Chrome on David's laptop: ~2.3 ms, with GPU stalls up to ~21 ms. */
function realisticRead(rand) {
  const r = rand();
  if (r < 0.06) return 17 + rand() * 4; // ~6% stalls (p95 ~18 ms)
  if (r < 0.3) return 3 + rand() * 6;
  return 1.8 + rand() * 0.9;
}

test("measured headed-Chrome readback (mean ~8 ms, stalls to 21 ms) is NOT over budget", () => {
  const rand = rng(11);
  const m = createCostMeter();
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const readMs = realisticRead(rand);
    sum += readMs;
    m.add({ readMs, detectMs: 0.2 });
  }
  assert.ok(sum / 300 > 3, "the old 3 ms running mean would have tripped");
  const c = m.check();
  assert.equal(c.over, false, JSON.stringify(c));
  assert.ok(c.readMedianMs < 4);
});

test("a sustained slow readback (median 15 ms) is over budget, reason readback", () => {
  const m = createCostMeter();
  for (let i = 0; i < 60; i++) m.add({ readMs: 14 + (i % 3), detectMs: 0.2 });
  const c = m.check();
  assert.equal(c.over, true);
  assert.equal(c.reason, "readback");
});

test("a slow detector (mean 2 ms) is over budget, reason detector", () => {
  const m = createCostMeter();
  for (let i = 0; i < 60; i++) m.add({ readMs: 2, detectMs: 2 });
  const c = m.check();
  assert.equal(c.over, true);
  assert.equal(c.reason, "detector");
});

test("the measured detector worst case (0.35 ms) is well within budget", () => {
  const m = createCostMeter();
  for (let i = 0; i < 60; i++) m.add({ readMs: 2.3, detectMs: 0.35 });
  assert.equal(m.check().over, false);
});

test("no verdict before minSamples; unchanged frames are not counted", () => {
  const m = createCostMeter({ minSamples: 30 });
  for (let i = 0; i < 29; i++) m.add({ readMs: 50, detectMs: 5 });
  assert.equal(m.check().over, false);
  for (let i = 0; i < 100; i++) m.add({ readMs: 50, detectMs: 5, changed: false });
  assert.equal(m.check().samples, 29);
  m.add({ readMs: 50, detectMs: 5 });
  assert.equal(m.check().over, true);
});

test("only the last `window` frames count (recovers after a slow patch)", () => {
  const m = createCostMeter({ window: 60 });
  for (let i = 0; i < 60; i++) m.add({ readMs: 30, detectMs: 0.2 });
  assert.equal(m.check().over, true);
  for (let i = 0; i < 60; i++) m.add({ readMs: 2, detectMs: 0.2 });
  assert.equal(m.check().over, false);
});

test("fail closed: non-finite costs count as over; reset clears; bad input never throws", () => {
  const m = createCostMeter({ minSamples: 3 });
  for (let i = 0; i < 3; i++) m.add({ readMs: NaN, detectMs: 0.1 });
  assert.equal(m.check().over, true);
  m.reset();
  assert.equal(m.check().samples, 0);
  m.add(/** @type {any} */ (null));
  m.add(/** @type {any} */ ({ readMs: "x", detectMs: -1 }));
  assert.doesNotThrow(() => m.check());
  // Bad options fall back to the defaults.
  const d = createCostMeter(/** @type {any} */ ({ readMedianLimitMs: -5, window: "big" }));
  for (let i = 0; i < 60; i++) d.add({ readMs: 11, detectMs: 0.2 });
  assert.equal(d.check().over, false);
});
