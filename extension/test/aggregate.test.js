// Aggregation vectors G1-G7 (threat T2) from TEST_VECTORS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAggregator } from "../src/detect/index.js";

const feed = (agg, n, areaPx, t = 1000, extra = {}) => {
  for (let i = 0; i < n; i++) agg.update({ id: `s${i}`, t, areaPx, ...extra });
};

test("G1: ten elements each under the threshold add up to a violation", () => {
  const agg = createAggregator("wcag");
  feed(agg, 10, 2560);
  const r = agg.result(1000);
  assert.equal(r.violation, true);
  assert.equal(r.totalAreaPx, 25600);
  assert.equal(r.reason, "general");
  assert.deepEqual([...r.ids].sort(), Array.from({ length: 10 }, (_, i) => `s${i}`).sort());
});

test("G2: 9 x 2,560 violates, 8 x 2,560 does not", () => {
  const a = createAggregator("wcag");
  feed(a, 9, 2560);
  assert.equal(a.result(1000).violation, true);
  const b = createAggregator("wcag");
  feed(b, 8, 2560);
  assert.equal(b.result(1000).violation, false);
});

test("G3: stale reports (1,500 ms old) are dropped", () => {
  const agg = createAggregator("wcag");
  for (let i = 0; i < 10; i++) agg.update({ id: `s${i}`, t: i < 5 ? 0 : 1500, areaPx: 2560 });
  const r = agg.result(1500);
  assert.equal(r.violation, false);
  assert.equal(r.totalAreaPx, 12800);
  assert.equal(r.ids.length, 5);
});

test("G4: no updates gives a calm result, no throw", () => {
  const r = createAggregator("wcag").result(1000);
  assert.equal(r.violation, false);
  assert.equal(r.totalAreaPx, 0);
  assert.deepEqual(r.ids, []);
});

test("G5: the same id twice counts once (latest report only)", () => {
  const agg = createAggregator("wcag");
  agg.update({ id: "a", t: 900, areaPx: 20000 });
  agg.update({ id: "a", t: 1000, areaPx: 15000 });
  assert.equal(agg.result(1000).totalAreaPx, 15000);
});

test("G6: a sum of exactly 21,824 passes, 21,825 violates", () => {
  const a = createAggregator("wcag");
  a.update({ id: "x", t: 1000, areaPx: 10912 });
  a.update({ id: "y", t: 1000, areaPx: 10912 });
  assert.equal(a.result(1000).violation, false);
  a.update({ id: "z", t: 1000, areaPx: 1 });
  assert.equal(a.result(1000).violation, true);
});

test("G7: red areas from several ids violate with reason red", () => {
  const agg = createAggregator("wcag");
  feed(agg, 10, 0, 1000, { redAreaPx: 2560 });
  const r = agg.result(1000);
  assert.equal(r.violation, true);
  assert.equal(r.reason, "red");
  assert.equal(r.totalRedAreaPx, 25600);
});

test("strict preset uses the strict area (10,912 px)", () => {
  const agg = createAggregator("strict");
  feed(agg, 5, 2560); // 12,800
  assert.equal(agg.result(1000).violation, true);
});

// ---- Area rule v2 with rects: the best 341 x 256 field ----

/** 16 tiles of 80 x 60 CSS px (4,800 px each) laid out from (x0, y0) with a gap. */
function tiles(agg, x0, y0, gap, t = 1000) {
  for (let i = 0; i < 16; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const rect = { left: x0 + col * (80 + gap), top: y0 + row * (60 + gap), width: 80, height: 60 };
    agg.update({ id: `tile${i}`, t, areaPx: 4800, rect });
  }
}

test("T2 split-area tiles: 16 contiguous 80x60 tiles (320 x 240) still violate", () => {
  const agg = createAggregator("wcag");
  tiles(agg, 100, 100, 0);
  const r = agg.result(1000);
  assert.equal(r.violation, true);
  assert.equal(r.totalAreaPx, 76800);
  assert.equal(r.ids.length, 16);
});

test("G8: the same tiles spread far apart across the screen don't share one field", () => {
  const agg = createAggregator("wcag");
  tiles(agg, 0, 0, 400); // 480 px between tile origins: one tile per field
  const r = agg.result(1000);
  assert.equal(r.violation, false);
  assert.equal(r.totalAreaPx, 4800);
});

test("G9: a tile only partly inside the field counts only that part", () => {
  const agg = createAggregator("wcag");
  // Two 300 x 100 elements (30,000 px each), side by side: one field holds at most 341 px of width.
  agg.update({ id: "a", t: 1000, areaPx: 30000, rect: { left: 0, top: 0, width: 300, height: 100 } });
  agg.update({ id: "b", t: 1000, areaPx: 30000, rect: { left: 300, top: 0, width: 300, height: 100 } });
  const r = agg.result(1000);
  assert.equal(r.violation, true);
  assert.equal(r.totalAreaPx, 34100); // 341 x 100 of flashing inside the best field
});

test("G10: reports without a rect count in every field (conservative)", () => {
  const agg = createAggregator("wcag");
  agg.update({ id: "far", t: 1000, areaPx: 12000, rect: { left: 5000, top: 5000, width: 200, height: 60 } });
  agg.update({ id: "norect", t: 1000, areaPx: 12000 });
  assert.equal(agg.result(1000).violation, true);
});

test("fail closed: malformed areas count as infinite, bad t blocks, no throw", () => {
  const withRect = createAggregator("wcag");
  withRect.update({ id: "bad", t: 1000, areaPx: NaN, rect: { left: 0, top: 0, width: 10, height: 10 } });
  assert.equal(withRect.result(1000).violation, true, "a rect doesn't clamp a malformed area");
  const agg = createAggregator("wcag");
  agg.update({ id: "bad", t: 1000, areaPx: NaN });
  const r = agg.result(1000);
  assert.equal(r.violation, true);
  assert.deepEqual(r.ids, ["bad"]);
  assert.equal(createAggregator("wcag").result(NaN).violation, true);
  agg.update(null);
  agg.update({ id: 5, t: 1, areaPx: 1 });
});
