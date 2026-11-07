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

test("fail closed: malformed areas count as infinite, bad t blocks, no throw", () => {
  const agg = createAggregator("wcag");
  agg.update({ id: "bad", t: 1000, areaPx: NaN });
  const r = agg.result(1000);
  assert.equal(r.violation, true);
  assert.deepEqual(r.ids, ["bad"]);
  assert.equal(createAggregator("wcag").result(NaN).violation, true);
  agg.update(null);
  agg.update({ id: 5, t: 1, areaPx: 1 });
});
