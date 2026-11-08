// createClampSoftener: masked brightness clamp (second soften filter).
// Every claim from the prototype simulation is re-checked here with the real
// detector on the clamped output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClampSoftener, createDetector } from "../src/detect/index.js";
import { createSoftener } from "../src/detect/soften.js";
import { LINEAR } from "../src/detect/luma.js";

const W = 16;
const H = 9;

function solidInto(px, [r, g, b]) {
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
}
const lumaAt = (o, p) => 0.2126 * LINEAR[o[p]] + 0.7152 * LINEAR[o[p + 1]] + 0.0722 * LINEAR[o[p + 2]];

/** Full-frame strobe between a and b at hz, sampled at fps for secs; returns whether the clamped output violates. */
function clampedViolates({ hz, fps, preset, a = [0, 0, 0], b = [255, 255, 255], secs = 5 }) {
  const c = createClampSoftener({ width: W, height: H });
  const d = createDetector({ preset, sampleWidth: W, sampleHeight: H, realAreaScale: 16 });
  const px = new Uint8ClampedArray(W * H * 4);
  let hit = false;
  for (let f = 0; f < fps * secs; f++) {
    const t = Math.round((f * 1000) / fps);
    solidInto(px, Math.floor((t * hz * 2) / 1000) % 2 ? b : a);
    const out = c.push(px, t);
    if (d.push({ t, pixels: out }).violation) hit = true;
  }
  return hit;
}

test("no full-swing strobe from 2 to 20 Hz at 24/30/60 fps survives clamping (strict and wcag)", () => {
  let leaks = 0;
  let cases = 0;
  for (const fps of [24, 30, 60]) {
    for (let hz = 2.05; hz <= 20; hz += 0.25) {
      for (const preset of ["strict", "wcag"]) {
        cases++;
        if (clampedViolates({ hz, fps, preset })) leaks++;
      }
    }
  }
  assert.equal(leaks, 0, `${leaks} of ${cases} strobes still violate`);
});

test("red-only strobe (#c80000 / #616161, 4 Hz) has no red flash after clamping", () => {
  assert.equal(clampedViolates({ hz: 4, fps: 60, preset: "strict", a: [200, 0, 0], b: [97, 97, 97] }), false);
});

test("outside the mask, pixels pass through exactly (strobe in 40% of the frame)", () => {
  const c = createClampSoftener({ width: W, height: H });
  const px = new Uint8ClampedArray(W * H * 4);
  const mask = new Uint8Array(W * H);
  // Left 40% of columns flash; mask marks them (one-pixel dilation reaches one more column).
  const flashCols = Math.round(W * 0.4);
  for (let y = 0; y < H; y++) for (let x = 0; x < flashCols; x++) mask[y * W + x] = 1;
  let checked = 0;
  for (let f = 0; f < 240; f++) {
    const t = Math.round((f * 1000) / 60);
    const on = Math.floor(t / 125) % 2 === 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const v = x < flashCols ? (on ? 255 : 0) : (x * 13 + y * 7 + f) % 256; // moving detail outside
        px[p] = px[p + 1] = px[p + 2] = v;
        px[p + 3] = 255;
      }
    }
    const out = c.push(px, t, mask);
    for (let y = 0; y < H; y++) {
      for (let x = flashCols + 1; x < W; x++) {
        const p = (y * W + x) * 4;
        assert.equal(out[p], px[p]);
        checked++;
      }
    }
  }
  assert.ok(checked > 0);
});

test("a dark-to-light scene cut inside the mask reaches 90% within ~2 s", () => {
  const c = createClampSoftener({ width: W, height: H });
  const px = new Uint8ClampedArray(W * H * 4);
  let reached = null;
  for (let f = 0; f < 60 * 5; f++) {
    const t = Math.round((f * 1000) / 60);
    solidInto(px, t < 1000 ? [0, 0, 0] : [255, 255, 255]);
    const out = c.push(px, t);
    if (t >= 1000 && reached === null && lumaAt(out, 0) >= 0.9) reached = t - 1000;
  }
  assert.ok(reached !== null && reached <= 2200, `lag ${reached} ms`);
});

test("the clamp beats the EMA softener where the EMA leaks (strict, 2.05-2.7 Hz at 24 fps)", () => {
  let emaLeaks = 0;
  let clampLeaks = 0;
  for (let hz = 2.05; hz <= 2.7; hz += 0.05) {
    if (clampedViolates({ hz, fps: 24, preset: "strict" })) clampLeaks++;
    const s = createSoftener({ width: W, height: H });
    const d = createDetector({ preset: "strict", sampleWidth: W, sampleHeight: H, realAreaScale: 16 });
    const px = new Uint8ClampedArray(W * H * 4);
    let hit = false;
    for (let f = 0; f < 24 * 5; f++) {
      const t = Math.round((f * 1000) / 24);
      solidInto(px, Math.floor((t * hz * 2) / 1000) % 2 ? [255, 255, 255] : [0, 0, 0]);
      if (d.push({ t, pixels: s.push(px, t) }).violation) hit = true;
    }
    if (hit) emaLeaks++;
  }
  assert.equal(clampLeaks, 0);
  console.log(`# EMA softener leaks ${emaLeaks} strict strobes at 24 fps in 2.05-2.7 Hz; clamp leaks ${clampLeaks}`);
});

test("works with a real detector mask (detector.mask())", () => {
  const d = createDetector({ preset: "wcag", sampleWidth: W, sampleHeight: H, realAreaScale: 16 });
  const c = createClampSoftener({ width: W, height: H, maskWidth: W, maskHeight: H });
  const check = createDetector({ preset: "wcag", sampleWidth: W, sampleHeight: H, realAreaScale: 16 });
  const px = new Uint8ClampedArray(W * H * 4);
  let outViolates = false;
  for (let f = 0; f < 60 * 5; f++) {
    const t = Math.round((f * 1000) / 60);
    solidInto(px, Math.floor(t / 125) % 2 ? [255, 255, 255] : [0, 0, 0]);
    d.push({ t, pixels: px });
    const m = d.mask();
    assert.ok(m instanceof Uint8Array && m.length === W * H);
    if (check.push({ t, pixels: c.push(px, t, m) }).violation && t > 2200) outViolates = true;
  }
  // The raw detector needs ~0.75 s to flag (7 transitions), the mask ramps in
  // over 300 ms, and the output's 1 s window then still holds those early
  // flashes until ~2.05 s. From then on the clamped output must stay clean.
  assert.equal(outViolates, false);
});

test("bad input fails closed: grey frame and failed = true, never throws", () => {
  const c = createClampSoftener({ width: W, height: H });
  const ok = new Uint8ClampedArray(W * H * 4);
  c.push(ok, 0);
  assert.equal(c.failed, false);
  for (const [px, t, m] of [
    [new Uint8ClampedArray(5), 16, undefined],
    [ok, NaN, undefined],
    [ok, 32, new Uint8Array(3)],
  ]) {
    const out = c.push(/** @type {any} */ (px), /** @type {any} */ (t), /** @type {any} */ (m));
    assert.equal(c.failed, true);
    assert.equal(out[0], 128);
  }
  assert.equal(createClampSoftener(/** @type {any} */ ({ width: 0, height: 9 })).failed, true);
  // The always-block detector has no mask: the caller clamps the whole frame.
  assert.equal(createDetector(/** @type {any} */ ({})).mask(), null);
});
