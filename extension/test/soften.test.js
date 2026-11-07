// Soften filter vectors SO1-SO8 (SOFTEN_DESIGN.md section 6). The softened
// output is run through createDetector, which is how the extension verifies it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSoftener } from "../src/detect/soften.js";
import { createDetector } from "../src/detect/index.js";
import { LINEAR } from "../src/detect/luma.js";
import { grid, grayFor, rng } from "./helpers.js";

const W = 16;
const H = 9;
const DET = { preset: "wcag", sampleWidth: W, sampleHeight: H, realAreaScale: 16 };

/** Full-frame RGBA of one colour. */
function solid([r, g, b]) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  return px;
}
const gray = (g) => solid([g, g, g]);

/**
 * Feed `colourAt(t)` through a softener and two detectors (input and output).
 * Returns per-sample { t, inL, outL, in, out } where in/out are detector reports.
 */
function run(colourAt, times, { tau = 0.2, preset = "wcag" } = {}) {
  const soft = createSoftener({ width: W, height: H, tau });
  const dIn = createDetector({ ...DET, preset });
  const dOut = createDetector({ ...DET, preset });
  return times.map((t) => {
    const px = solid(colourAt(t));
    const o = soft.push(px, t);
    return {
      t,
      outPx: o.slice(0, 4),
      in: dIn.push({ t, pixels: px }),
      out: dOut.push({ t, pixels: o }),
      failed: soft.failed,
    };
  });
}
const sq = (halfMs, a, b) => (t) => (Math.floor(t / halfMs) % 2 === 0 ? a : b);
const DARK = [0, 0, 0];
const WHITE = [255, 255, 255];
const outViolates = (rows) => rows.some((r) => r.out.violation);
const inViolates = (rows) => rows.some((r) => r.in.violation);
const lumaPx = (p) => 0.2126 * LINEAR[p[0]] + 0.7152 * LINEAR[p[1]] + 0.0722 * LINEAR[p[2]];

test("SO1: full-swing 4 Hz strobe is softened below the limit", () => {
  const rows = run(sq(125, DARK, WHITE), grid(60, 4000));
  assert.ok(inViolates(rows), "input violates");
  assert.equal(outViolates(rows), false);
});

test("SO2: 3.01 Hz at 24 fps: none at tau 200 ms", () => {
  // At 24 fps the input itself is borderline for the detector (each transition
  // is seen up to one 42 ms frame late), so only the output is asserted.
  const rows = run(sq(166, DARK, WHITE), grid(24, 6000));
  assert.equal(outViolates(rows), false);
});

test("SO2b: a shorter tau lets some 24 fps strobes through (why 200 ms)", () => {
  // The planning simulation found 4 cases at 150 ms, all 24 fps, 3.0-3.5 Hz.
  // Scan that band and record whether any slips through here.
  let leaks = 0;
  for (let hz = 3.01; hz <= 3.5; hz += 0.05) {
    const rows = run(sq(500 / hz, DARK, WHITE), grid(24, 6000), { tau: 0.15 });
    if (outViolates(rows)) leaks++;
  }
  let leaks200 = 0;
  for (let hz = 3.01; hz <= 3.5; hz += 0.05) {
    if (outViolates(run(sq(500 / hz, DARK, WHITE), grid(24, 6000)))) leaks200++;
  }
  assert.equal(leaks200, 0, "200 ms clears the band");
  // Not asserted either way for 150 ms: recorded for the doc.
  console.log(`# SO2b: 150 ms leaks ${leaks} of 10 strobes in 3.01-3.5 Hz at 24 fps`);
});

test("SO3: 15 Hz is softened below the limit", () => {
  const rows = run(sq(1000 / 30, DARK, WHITE), grid(60, 4000));
  assert.ok(inViolates(rows));
  assert.equal(outViolates(rows), false);
});

test("SO4: red-only strobe (#c80000 / #616161, 4 Hz) has no red flash after softening", () => {
  const rows = run(sq(125, [200, 0, 0], [97, 97, 97]), grid(60, 4000));
  assert.ok(rows.some((r) => r.in.violation && r.in.reason === "red"), "input is a red flash");
  assert.equal(outViolates(rows), false);
  assert.equal(rows.at(-1).out.redFlashesPerSecond, 0);
});

test("SO5: a slow 0.1 Hz fade keeps at least 95% of its amplitude", () => {
  const Lof = (t) => 0.3 + 0.2 * Math.sin((2 * Math.PI * 0.1 * t) / 1000);
  const rows = run((t) => {
    const g = grayFor(Lof(t));
    return [g, g, g];
  }, grid(30, 30000));
  const after = rows.filter((r) => r.t >= 10000);
  const outs = after.map((r) => lumaPx(r.outPx));
  const ins = after.map((r) => LINEAR[grayFor(Lof(r.t))]);
  const amp = (xs) => Math.max(...xs) - Math.min(...xs);
  assert.ok(amp(outs) >= 0.95 * amp(ins), `out ${amp(outs).toFixed(3)} vs in ${amp(ins).toFixed(3)}`);
  assert.equal(outViolates(rows), false);
});

test("SO6: a single dark-to-light cut reaches 90% within ~800 ms, no violation", () => {
  const rows = run((t) => (t < 1000 ? DARK : WHITE), grid(60, 4000));
  const hit = rows.find((r) => r.t >= 1000 && lumaPx(r.outPx) >= 0.9);
  assert.ok(hit, "reaches 90%");
  const lag = hit.t - 1000;
  assert.ok(lag <= 800, `lag ${lag} ms`);
  console.log(`# SO6: 90% lag ${lag} ms at tau 200 ms`);
  assert.equal(outViolates(rows), false);
});

test("SO7: irregular timestamps (+/-8 ms jitter, one 120 ms gap) stay below the limit", () => {
  const rand = rng(3);
  const times = [];
  for (let t = 0; t < 4000; ) {
    times.push(Math.round(t));
    t += t > 2000 && t < 2017 ? 120 : 16.7 + (rand() - 0.5) * 16;
  }
  const rows = run(sq(125, DARK, WHITE), times);
  assert.ok(inViolates(rows));
  assert.equal(rows.some((r) => r.out.violation && r.out.reason), false, "no flash violation in output");
});

test("SO8: bad input does not throw, returns opaque grey and sets failed", () => {
  const s = createSoftener({ width: W, height: H });
  s.push(gray(0), 0);
  assert.equal(s.failed, false);
  for (const [px, t] of [
    [new Uint8ClampedArray(3), 16],
    [gray(0), NaN],
    [[1, 2, 3], 16],
  ]) {
    const o = s.push(/** @type {any} */ (px), /** @type {any} */ (t));
    assert.equal(s.failed, true);
    assert.equal(o[0], 128);
    assert.equal(o[3], 255);
  }
  // Recovers on the next good frame.
  s.push(gray(0), 32);
  assert.equal(s.failed, false);
  // Bad options: always failed.
  const bad = createSoftener({ width: 0, height: 9 });
  assert.equal(bad.failed, true);
  bad.push(gray(0), 0);
  assert.equal(bad.failed, true);
  assert.equal(createSoftener(/** @type {any} */ (null)).failed, true);
  assert.equal(s.setTau(-1), false);
  assert.equal(s.setTau(0.25), true);
});

test("equal and backwards timestamps hold the state", () => {
  const s = createSoftener({ width: W, height: H });
  s.push(gray(0), 100);
  const a = s.push(gray(255), 100).slice(0, 4); // dt 0: no change
  assert.equal(a[0], 0);
  const b = s.push(gray(255), 50).slice(0, 4); // backwards: no change
  assert.equal(b[0], 0);
});
