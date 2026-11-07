// onFlash setting: soften is the default; only "soften" and "block" are accepted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, DEFAULT_SETTINGS } from "../src/shared/settings.js";

test("onFlash defaults to soften", () => {
  assert.equal(DEFAULT_SETTINGS.onFlash, "soften");
  assert.equal(normalizeSettings(undefined).onFlash, "soften");
});

test("onFlash keeps valid values and drops anything else", () => {
  assert.equal(normalizeSettings({ onFlash: "block" }).onFlash, "block");
  assert.equal(normalizeSettings({ onFlash: "soften" }).onFlash, "soften");
  for (const bad of ["off", "", 1, null, { x: 1 }]) assert.equal(normalizeSettings({ onFlash: bad }).onFlash, "soften");
});
