// General-flash vectors from TEST_VECTORS.md: F (frequency), A (amplitude),
// R (area), S (slow/smooth), T1-T3 (timing). Synthetic numbers only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDetector } from "../src/detect/index.js";
import { DARK, LIGHT, lumaOf, grayFor, grid, square, fill, rng, drive, whole } from "./helpers.js";

const W = 16;
const H = 9;
// Scale 16: a full 16 x 9 frame is 36,864 CSS px, over the 21,824 px threshold.
// (Scale 8 would make it 9,216 px, too small to ever violate.)
const BASE = { preset: "wcag", sampleWidth: W, sampleHeight: H, realAreaScale: 16 };

/**
 * Run a full-frame vector, then reset and run it again: both runs must end
 * with the same report (TEST_VECTORS conventions). Returns the first run.
 */
function runVector(opts, times, paint, w = W, h = H) {
  const d = createDetector({ ...BASE, ...opts, sampleWidth: w, sampleHeight: h });
  const first = drive(d, w, h, times, paint);
  d.reset();
  const second = drive(d, w, h, times, paint);
  assert.deepEqual(second.at(-1).r, first.at(-1).r, "same result after reset()");
  return first;
}

const last = (reports) => reports.at(-1).r;
const anyViolation = (reports) => reports.some(({ r }) => r.violation);

function assertNone(r) {
  assert.equal(r.violation, false);
  assert.equal(r.severity, "none");
}
function assertViolation(r) {
  assert.equal(r.violation, true);
  assert.equal(r.severity, "block");
  assert.equal(r.reason, "general");
}

/** Samples on a 60 fps grid plus exactly at each transition time; level flips at each. */
function explicit(transitions, endMs) {
  const times = [...new Set([-17, ...grid(60, endMs), ...transitions])].sort((a, b) => a - b);
  const levelAt = (t) => (transitions.filter((x) => x <= t).length % 2 === 0 ? DARK : LIGHT);
  return { times, paint: whole(levelAt) };
}

test("levels: the hand-computed pairs sit on the intended side", () => {
  assert.ok(lumaOf(LIGHT) - lumaOf(DARK) > 0.2);
  assert.ok(lumaOf(90) - lumaOf(0) >= 0.1, "SWING_OVER");
  assert.ok(lumaOf(86) - lumaOf(0) < 0.1, "SWING_UNDER");
  assert.ok(lumaOf(232) >= 0.8, "BRIGHT_OK darker state");
  assert.ok(lumaOf(225) < 0.8, "BRIGHT_FLASH darker state");
  assert.ok(lumaOf(255) - lumaOf(225) >= 0.1);
});

// ---- 1. Frequency ----

test("F1: 2 Hz passes, flashesPerSecond 2", () => {
  const r = last(runVector({}, grid(60, 4000), whole(square(250))));
  assertNone(r);
  assert.equal(r.flashesPerSecond, 2);
});

test("F2: half-period 167 ms (~2.99 Hz) passes, flashesPerSecond 3", () => {
  const reps = runVector({}, grid(60, 4000), whole(square(167)));
  assert.equal(anyViolation(reps), false);
  assert.equal(last(reps).flashesPerSecond, 3);
});

test("F3: half-period 166 ms (~3.01 Hz) violates", () => {
  // Explicit transition times so the edge doesn't depend on the 60 fps grid.
  const tr = Array.from({ length: 24 }, (_, k) => 166 * (k + 1));
  const { times, paint } = explicit(tr, 4000);
  // 7 transitions span 996 ms, so the window holds 7 only right after each
  // transition: check the run, not just the last report.
  const reps = runVector({}, times, paint);
  const hit = reps.find(({ r }) => r.violation);
  assert.ok(hit, "violates during the stimulus");
  assertViolation(hit.r);
});

test("F4: 4 Hz violates, flashesPerSecond 4", () => {
  const r = last(runVector({}, grid(60, 4000), whole(square(125))));
  assertViolation(r);
  assert.equal(r.flashesPerSecond, 4);
});

test("F5: 10 Hz violates, flashesPerSecond capped at 4", () => {
  const r = last(runVector({}, grid(60, 4000), whole(square(50))));
  assertViolation(r);
  assert.equal(r.flashesPerSecond, 4);
});

test("F6: exactly 6 transitions then constant never violates", () => {
  const tr = [100, 250, 400, 550, 700, 850];
  const { times, paint } = explicit(tr, 4000);
  assert.equal(anyViolation(runVector({}, times, paint)), false);
});

test("F7: 7 transitions exactly 1000 ms apart pass; 999 ms violates", () => {
  const pass = explicit([0, 166, 333, 500, 666, 833, 1000], 1000);
  assert.equal(anyViolation(runVector({}, pass.times, pass.paint)), false);
  const fail = explicit([0, 166, 333, 500, 666, 833, 999], 999);
  assertViolation(last(runVector({}, fail.times, fail.paint)));
});

test("F8: 4-flash burst violates during the burst, clears 1000 ms later", () => {
  const tr = [100, 212, 325, 437, 550, 662, 775, 887];
  const { times, paint } = explicit(tr, 4000);
  const reps = runVector({}, times, paint);
  assert.ok(reps.some(({ t, r }) => t <= 1000 && r.violation));
  for (const { t, r } of reps) if (t >= 1887) assertNone(r);
});

test("F9: strict flags ~3 Hz (3 flashes > 2), wcag does not", () => {
  const times = grid(60, 4000);
  assertViolation(last(runVector({ preset: "strict" }, times, whole(square(167)))));
  assert.equal(anyViolation(runVector({ preset: "wcag" }, times, whole(square(167)))), false);
});

test("F10: strict passes 2 Hz", () => {
  assertNone(last(runVector({ preset: "strict" }, grid(60, 4000), whole(square(250)))));
});

test("F11: one stray 0.3 step in calm gray never warns or blocks", () => {
  const lo = grayFor(0.2);
  const hi = grayFor(0.5);
  const reps = runVector({}, grid(60, 5000), whole((t) => (t < 2500 ? lo : hi)));
  for (const { r } of reps) assertNone(r);
});

test("F12: one flash pair every 1.5 s never violates", () => {
  const tr = [];
  for (let s = 200; s < 10000; s += 1500) tr.push(s, s + 100);
  const { times, paint } = explicit(tr, 10000);
  assert.equal(anyViolation(runVector({}, times, paint)), false);
});

test("F13: 6 transitions plus a stray 7th 100 ms later violates (ceil edge)", () => {
  const tr = [100, 200, 300, 400, 500, 600, 700];
  const { times, paint } = explicit(tr, 900);
  assertViolation(last(runVector({}, times, paint)));
});

// ---- 2. Amplitude ----

test("A1: swing under 0.10 never registers", () => {
  const r = last(runVector({}, grid(60, 4000), whole(square(83, 0, 86))));
  assertNone(r);
  assert.equal(r.flashesPerSecond, 0);
});

test("A2: swing just over 0.10 violates", () => {
  assertViolation(last(runVector({}, grid(60, 4000), whole(square(83, 0, 90)))));
});

test("A3: darker state at or above 0.80 is not a flash", () => {
  assertNone(last(runVector({}, grid(60, 4000), whole(square(83, 232, 255)))));
});

test("A4: darker state below 0.80 is a flash", () => {
  assertViolation(last(runVector({}, grid(60, 4000), whole(square(83, 225, 255)))));
});

test("A5: per-pixel noise up to 0.03 luminance is ignored", () => {
  const rand = rng(42);
  const paint = (px) => {
    for (let i = 0; i < px.length; i += 4) {
      const g = grayFor(0.3 + (rand() - 0.5) * 0.03);
      px[i] = px[i + 1] = px[i + 2] = g;
      px[i + 3] = 255;
    }
  };
  const d = createDetector(BASE);
  for (const { r } of drive(d, W, H, grid(60, 5000), paint)) assertNone(r);
});

test("A6: steady drift up to 1.0 is not a flash", () => {
  const times = grid(60, 2000);
  const reps = runVector({}, times, (px, t, i) => fill(px, grayFor(Math.min(1, i * 0.04))));
  for (const { r } of reps) assertNone(r);
});

// ---- 3. Area (64 x 36 frame, realAreaScale 8) ----

const AW = 64;
const AH = 36;

/**
 * Each part is { rect: [x, y, w, h] } (sample px) or { from, to } (pixel
 * indices) and follows levelAt; the rest stays DARK.
 */
function region(parts) {
  const idx = parts.map((p) => {
    if (!p.rect) return Array.from({ length: p.to - p.from }, (_, k) => p.from + k);
    const [x, y, w, h] = p.rect;
    const out = [];
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) out.push(r * AW + c);
    return out;
  });
  return (px, t) => {
    fill(px, DARK);
    parts.forEach(({ levelAt }, k) => {
      const g = levelAt(t);
      for (const i of idx[k]) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = g;
    });
  };
}
// At realAreaScale 8 the 341 x 256 CSS px field is 43 x 32 sample px (ceil).
const area = (parts, opts = {}) =>
  last(runVector({ realAreaScale: 8, ...opts }, grid(60, 4000), region(parts), AW, AH));
const hz4 = square(125);

test("R1: whole frame violates; areaPx is the best 341 x 256 field (43 x 32 sample px)", () => {
  const r = area([{ from: 0, to: AW * AH, levelAt: hz4 }]);
  assertViolation(r);
  assert.equal(r.areaPx, 43 * 32 * 64); // 88,064 CSS px; the whole 512 x 288 frame doesn't fit one field
});

test("R2: exactly the threshold (31 x 11 = 341 px = 21,824 CSS px) passes", () => {
  const r = area([{ rect: [0, 0, 31, 11], levelAt: hz4 }]);
  assertNone(r);
  assert.equal(r.areaPx, 21824);
});

test("R3: one sample pixel over the threshold violates (38 x 9 = 342 px)", () => {
  const r = area([{ rect: [0, 0, 38, 9], levelAt: hz4 }]);
  assertViolation(r);
  assert.equal(r.areaPx, 21888);
});

test("R4: small region passes but still reports 4 flashes", () => {
  const r = area([{ rect: [0, 0, 10, 1], levelAt: hz4 }]);
  assertNone(r);
  assert.equal(r.flashesPerSecond, 4);
});

test("R5: two out-of-phase regions in one field add up and violate", () => {
  const r = area([
    { rect: [0, 0, 20, 10], levelAt: hz4 },
    { rect: [20, 10, 20, 10], levelAt: square(125, LIGHT, DARK) },
  ]);
  assertViolation(r);
  assert.equal(r.areaPx, 25600);
});

test("R6: 2 Hz pixels do not add to the 4 Hz area", () => {
  const r = area([
    { rect: [0, 0, 31, 11], levelAt: hz4 },
    { rect: [0, 12, 30, 10], levelAt: square(250) },
  ]);
  assertNone(r);
  assert.equal(r.areaPx, 21824);
});

test("R7: areaPct is the share of the sampled area", () => {
  const r = area([{ rect: [0, 0, 31, 11], levelAt: hz4 }]);
  assert.ok(Math.abs(r.areaPct - 341 / 2304) < 1e-9);
});

test("R8: realAreaScale is applied (scale 4: 5,456 px, passes)", () => {
  const r = area([{ rect: [0, 0, 31, 11], levelAt: hz4 }], { realAreaScale: 4 });
  assertNone(r);
  assert.equal(r.areaPx, 5456);
});

// ---- Area rule v2 (DESIGN.md s5): field box (b) and time overlap (c) ----

test("R9 (b): two regions too far apart for one 341 x 256 field don't add up", () => {
  // Each 200 sample px (12,800 CSS px); 40+ sample px apart horizontally (> 43 - 20).
  const r = area([
    { rect: [0, 0, 20, 10], levelAt: hz4 },
    { rect: [44, 20, 20, 10], levelAt: hz4 },
  ]);
  assertNone(r);
  assert.equal(r.areaPx, 12800);
});

test("R10 (c): a quarter-period phase-shifted checkerboard still adds up (half-cycle slack)", () => {
  // Second region lags by 62 ms: never flips at the same instant as the first.
  const lagged = (t) => hz4(t + 62);
  const r = area([
    { rect: [0, 0, 20, 10], levelAt: hz4 },
    { rect: [20, 0, 20, 10], levelAt: lagged },
  ]);
  assertViolation(r);
  assert.equal(r.areaPx, 25600);
});

test("R11 (c): a burst early and a different burst late in the window don't add up", () => {
  // 10 Hz bursts, 8 transitions each: A at 25..375 ms, B at 625..975 ms.
  const burst = (from) => (t) => {
    const n = Math.max(0, Math.min(8, Math.floor((t - from) / 50) + 1));
    return n % 2 === 0 ? DARK : LIGHT;
  };
  const d = createDetector({ ...BASE, realAreaScale: 8, sampleWidth: AW, sampleHeight: AH });
  const paint = region([
    { rect: [0, 0, 20, 10], levelAt: burst(25) },
    { rect: [20, 0, 20, 10], levelAt: burst(625) },
  ]);
  const reps = drive(d, AW, AH, grid(60, 1000), paint);
  assert.equal(reps.some(({ r }) => r.violation), false);
  // Each burst alone is over the flash limit: the same two bursts at the same time violate.
  const d2 = createDetector({ ...BASE, realAreaScale: 8, sampleWidth: AW, sampleHeight: AH });
  const together = region([
    { rect: [0, 0, 20, 10], levelAt: burst(25) },
    { rect: [20, 0, 20, 10], levelAt: burst(25) },
  ]);
  assert.ok(drive(d2, AW, AH, grid(60, 1000), together).some(({ r }) => r.violation));
});

// ---- 5. Slow changes and smooth waveforms ----

test("S1: one linear ramp then constant", () => {
  const reps = runVector({}, grid(60, 4000), whole((t) => grayFor(Math.min(1, t / 2000))));
  for (const { r } of reps) assertNone(r);
});

test("S2: staircase fade in 20 steps over 1 s", () => {
  const reps = runVector({}, grid(60, 3000), whole((t) => grayFor(Math.min(1, Math.floor(t / 50) * 0.05))));
  for (const { r } of reps) assertNone(r);
});

test("S3: 1 Hz triangle wave", () => {
  const tri = (t) => 1 - Math.abs(((t / 500) % 2) - 1);
  const reps = runVector({}, grid(60, 4000), whole((t) => grayFor(tri(t))));
  for (const { r } of reps) assertNone(r);
});

test("S4: smooth 4 Hz sine (0.25 to 0.50 luminance) violates", () => {
  const sine = (t) => 0.375 + 0.125 * Math.sin((2 * Math.PI * 4 * t) / 1000);
  assertViolation(last(runVector({}, grid(60, 4000), whole((t) => grayFor(sine(t))))));
});

test("S5: 4 Hz sawtooth, swing 0.3, violates", () => {
  const saw = (t) => 0.1 + 0.3 * (((t * 4) / 1000) % 1);
  assertViolation(last(runVector({}, grid(60, 4000), whole((t) => grayFor(saw(t))))));
});

test("S6: repeated 0.5 s fade-in / fade-out (1 Hz) passes", () => {
  const fade = (t) => {
    const p = (t % 1000) / 500;
    return p < 1 ? p : 2 - p;
  };
  const reps = runVector({}, grid(60, 5000), whole((t) => grayFor(fade(t))));
  for (const { r } of reps) assertNone(r);
});

// ---- 7. Timing (first three; gap and reset rules come with step 3) ----

test("T1: 4 Hz violates at 144, 60, 30 and 24 fps with the same count", () => {
  for (const fps of [144, 60, 30, 24]) {
    const r = last(runVector({}, grid(fps, 4000), whole(square(125))));
    assertViolation(r);
    assert.equal(r.flashesPerSecond, 4, `${fps} fps`);
  }
});

test("T2: 3.5 Hz violates at 30 and 60 fps", () => {
  for (const fps of [30, 60]) {
    assertViolation(last(runVector({}, grid(fps, 4000), whole(square(1000 / 7)))));
  }
});

test("T3: 4 Hz with jittered 8-40 ms intervals violates, not undersampled", () => {
  const rand = rng(7);
  const times = [0];
  while (times.at(-1) < 4000) times.push(times.at(-1) + 8 + Math.round(rand() * 32));
  const reps = runVector({}, times, whole(square(125)));
  assertViolation(last(reps));
  assert.equal(reps.some(({ r }) => r.undersampled), false);
});
