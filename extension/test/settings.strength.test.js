// Protection strength (popup slider): validation and the dim safety floor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, STRENGTH_DIM, STRENGTH_BLOCK, DEFAULT_SETTINGS } from "../src/shared/settings.js";

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

test("strength defaults to 4 and keeps only integers 1-5", () => {
  assert.equal(DEFAULT_SETTINGS.strength, 4);
  assert.equal(normalizeSettings({}).strength, 4);
  for (const s of [1, 2, 3, 4, 5]) assert.equal(normalizeSettings({ strength: s }).strength, s);
  for (const bad of [0, 6, 2.5, "3", null, -1, Infinity]) assert.equal(normalizeSettings({ strength: bad }).strength, 4);
});

test("every dim step leaves less than the 0.10 luminance change a flash needs", () => {
  for (const [step, black] of Object.entries(STRENGTH_DIM)) {
    const maxLum = lin(1 - black); // brightest pixel left (white under the dim), black stays 0
    assert.ok(maxLum < 0.1, `step ${step}: max ${maxLum.toFixed(3)}`);
  }
  assert.ok(STRENGTH_DIM[1] >= 0.72, "the lightest step never goes under the 0.72 floor");
  assert.equal(STRENGTH_BLOCK, 5);
});
