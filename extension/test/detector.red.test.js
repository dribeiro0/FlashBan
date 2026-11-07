// Red-flash vectors Re1-Re8 from TEST_VECTORS.md. Synthetic numbers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDetector } from "../src/detect/index.js";
import { LINEAR } from "../src/detect/luma.js";
import { grid, drive } from "./helpers.js";

const W = 16;
const H = 9;
const OPTS = { preset: "wcag", sampleWidth: W, sampleHeight: H, realAreaScale: 16 };

const RED = [255, 0, 0];
const G128 = [128, 128, 128];

/** u', v', linear red share and relative luminance of an sRGB colour. */
function colour([r, g, b]) {
  const R = LINEAR[r];
  const G = LINEAR[g];
  const B = LINEAR[b];
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const den = X + 15 * Y + 3 * Z;
  return { u: (4 * X) / den, v: (9 * Y) / den, share: R / (R + G + B), L: Y };
}
const uvDist = (a, b) => Math.hypot(colour(a).u - colour(b).u, colour(a).v - colour(b).v);

/** Paint pixels [0, n) with colour a or b alternating every halfMs; the rest black. */
function strobe(a, b, halfMs, n = W * H) {
  return (px, t) => {
    const c = Math.floor(t / halfMs) % 2 === 0 ? a : b;
    px.fill(0);
    for (let i = 0; i < px.length / 4; i++) {
      px[i * 4 + 3] = 255;
      if (i < n) {
        px[i * 4] = c[0];
        px[i * 4 + 1] = c[1];
        px[i * 4 + 2] = c[2];
      }
    }
  };
}

function run(paint, opts = {}, w = W, h = H, end = 4000) {
  const d = createDetector({ ...OPTS, ...opts, sampleWidth: w, sampleHeight: h });
  const first = drive(d, w, h, grid(60, end), paint);
  d.reset();
  const second = drive(d, w, h, grid(60, end), paint);
  assert.deepEqual(second.at(-1).r, first.at(-1).r, "same result after reset()");
  return first;
}
const last = (reps) => reps.at(-1).r;

test("colours: red vs G128 is near iso-luminant with a large chromaticity jump", () => {
  assert.ok(Math.abs(colour(RED).L - colour(G128).L) < 0.1);
  assert.ok(uvDist(RED, G128) > 0.2);
  assert.ok(colour(RED).share >= 0.8);
});

test("Re1: red <-> gray 4 Hz is a red flash, no general flash", () => {
  const r = last(run(strobe(RED, G128, 125)));
  assert.equal(r.violation, true);
  assert.equal(r.reason, "red");
  assert.equal(r.redFlashesPerSecond, 4);
  assert.equal(r.flashesPerSecond, 0);
});

test("Re2: neither state saturated red gives no red flash", () => {
  // Magenta <-> green: chromaticity jump over 0.2, red share well under 0.8.
  const A = [180, 0, 180];
  const B = [0, 180, 0];
  assert.ok(colour(A).share < 0.8 && colour(B).share < 0.8);
  assert.ok(uvDist(A, B) > 0.2);
  const r = last(run(strobe(A, B, 125)));
  assert.equal(r.redFlashesPerSecond, 0);
  assert.notEqual(r.reason, "red");
  assert.notEqual(r.reason, "both");
});

test("Re2b: (200,60,60) <-> (60,200,60) IS red under the linear convention", () => {
  // TEST_VECTORS listed this as 'not saturated' using gamma values (0.625).
  // In linear light its red share is 0.865, so we flag it (the safe error).
  assert.ok(colour([200, 60, 60]).share >= 0.8);
  const r = last(run(strobe([200, 60, 60], [60, 200, 60], 125)));
  assert.ok(r.redFlashesPerSecond >= 4);
  assert.ok(r.reason === "red" || r.reason === "both");
});

test("Re3: red <-> dark red is a general flash only", () => {
  const r = last(run(strobe(RED, [80, 0, 0], 125)));
  assert.equal(r.violation, true);
  assert.equal(r.reason, "general");
  assert.equal(r.redFlashesPerSecond, 0);
});

test("Re4: red <-> white is both", () => {
  const r = last(run(strobe(RED, [255, 255, 255], 125)));
  assert.equal(r.violation, true);
  assert.equal(r.reason, "both");
});

test("Re5: red <-> gray at 3 Hz passes", () => {
  const reps = run(strobe(RED, G128, 1000 / 6));
  assert.equal(
    reps.some(({ r }) => r.violation),
    false,
  );
});

test("Re6: red area is judged on its own threshold (341 px passes, 342 fails)", () => {
  const atThreshold = last(run(strobe(RED, G128, 125, 341), { realAreaScale: 8 }, 64, 36));
  assert.equal(atThreshold.violation, false);
  assert.equal(atThreshold.redAreaPx, 21824);
  const over = last(run(strobe(RED, G128, 125, 342), { realAreaScale: 8 }, 64, 36));
  assert.equal(over.violation, true);
  assert.equal(over.reason, "red");
});

test("Re7: strict flags a single red flash pair", () => {
  // Gray, red at 400 ms, gray again at 500 ms, then gray: 2 red transitions.
  const paint = (px, t) => {
    const c = t >= 400 && t < 500 ? RED : G128;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  };
  const strict = run(paint, { preset: "strict" }, W, H, 900);
  const hit = strict.find(({ r }) => r.violation);
  assert.ok(hit, "strict violates");
  assert.equal(hit.r.reason, "red");
  const wcag = run(paint, { preset: "wcag" }, W, H, 900);
  assert.equal(
    wcag.some(({ r }) => r.violation),
    false,
  );
});

test("Re8: all-black then all-red frames (one change) give no flash and no NaN", () => {
  const paint = (px, t) => {
    const c = t < 2000 ? [0, 0, 0] : RED;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  };
  for (const { r } of run(paint)) {
    assert.equal(r.violation, false);
    assert.equal(r.severity, "none");
    assert.ok(Number.isFinite(r.redFlashesPerSecond));
  }
});
