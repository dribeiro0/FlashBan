// CSS animation vectors C1-C9 and B8 from TEST_VECTORS.md, on fake Animation objects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeAnimation } from "../src/detect/index.js";

/**
 * Fake Animation. frames: keyframe objects (offset optional).
 * @param {object[]} frames
 * @param {{ duration: number, iterations?: number, direction?: string, playbackRate?: number }} timing
 */
function anim(frames, { duration, iterations = Infinity, direction = "normal", playbackRate = 1 }) {
  const n = frames.length;
  const withOffsets = frames.map((f, k) => ({ computedOffset: f.offset ?? (n === 1 ? 1 : k / (n - 1)), easing: "linear", ...f }));
  return {
    playbackRate,
    effect: {
      getKeyframes: () => withOffsets,
      getComputedTiming: () => ({ duration, iterations, direction }),
    },
  };
}

test("C1: opacity 0 <-> 1, 125 ms alternate, infinite = 4 cycles/s, violation", () => {
  const r = analyzeAnimation(anim([{ opacity: 0 }, { opacity: 1 }], { duration: 125, direction: "alternate" }));
  assert.equal(r.violation, true);
  assert.equal(r.cyclesPerSecond, 4);
  assert.ok(r.maxLuminanceDelta >= 0.9);
});

test("C2: same at 1000 ms passes", () => {
  // Alternate at 1000 ms is one transition per second = 0.5 cycles/s (C1 at
  // 125 ms is 8 transitions/s = 4 cycles/s). TEST_VECTORS said "1 cycle".
  const r = analyzeAnimation(anim([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, direction: "alternate" }));
  assert.equal(r.violation, false);
  assert.equal(r.cyclesPerSecond, 0.5);
});

test("C3: background-color black <-> white at 4 Hz violates", () => {
  const r = analyzeAnimation(
    anim([{ backgroundColor: "black" }, { backgroundColor: "#fff" }, { backgroundColor: "rgb(0, 0, 0)" }], { duration: 250 }),
  );
  assert.equal(r.violation, true);
  assert.equal(r.cyclesPerSecond, 4);
});

test("C4: a 0.05 luminance swing at 8 Hz passes", () => {
  // #000 (0) <-> #3f3f3f (about 0.05)
  const r = analyzeAnimation(anim([{ backgroundColor: "#000" }, { backgroundColor: "#3f3f3f" }], { duration: 62.5, direction: "alternate" }));
  assert.ok(r.maxLuminanceDelta < 0.1);
  assert.equal(r.violation, false);
});

test("C5: #e8e8e8 <-> #ffffff (darker state at or above 0.80) at 8 Hz passes", () => {
  const r = analyzeAnimation(anim([{ backgroundColor: "#e8e8e8" }, { backgroundColor: "#ffffff" }], { duration: 62.5, direction: "alternate" }));
  assert.equal(r.violation, false);
});

test("C6: opacity 0.9 <-> 1.0 over a mid-gray page at 8 Hz passes", () => {
  const a = anim([{ opacity: 0.9 }, { opacity: 1 }], { duration: 62.5, direction: "alternate" });
  assert.equal(analyzeAnimation(a, { backdropLuminance: 0.216 }).violation, false);
});

test("C7: 3 finite iterations at 8 Hz is not a violation (3 cycles total)", () => {
  // One iteration = one dark -> light -> dark cycle, 125 ms.
  const frames = [{ backgroundColor: "#000" }, { backgroundColor: "#fff" }, { backgroundColor: "#000" }];
  assert.equal(analyzeAnimation(anim(frames, { duration: 125, iterations: 3 })).violation, false);
  // The same animation running forever violates.
  assert.equal(analyzeAnimation(anim(frames, { duration: 125 })).violation, true);
});

test("C8: steps(1) at 4 Hz violates (jumps count like a toggle)", () => {
  const frames = [
    { offset: 0, backgroundColor: "#000", easing: "steps(1)" },
    { offset: 0.5, backgroundColor: "#fff", easing: "steps(1)" },
    { offset: 1, backgroundColor: "#000" },
  ];
  assert.equal(analyzeAnimation(anim(frames, { duration: 250 })).violation, true);
});

test("C9: playbackRate 2 on 250 ms uses the effective rate (8 cycles/s)", () => {
  const frames = [{ backgroundColor: "#000" }, { backgroundColor: "#fff" }, { backgroundColor: "#000" }];
  const r = analyzeAnimation(anim(frames, { duration: 250, playbackRate: 2 }));
  assert.equal(r.cyclesPerSecond, 8);
  assert.equal(r.violation, true);
  // At rate 1 it is 4 cycles/s.
  assert.equal(analyzeAnimation(anim(frames, { duration: 250 })).cyclesPerSecond, 4);
});

test("B8: an unreadable value fails closed when the animation is fast", () => {
  for (const v of ["currentColor", "var(--x)", "color-mix(in srgb, red, blue)", 42]) {
    // 0.2 s blink: worst case is a full swing 10 times a second.
    const fast = analyzeAnimation(anim([{ backgroundColor: "#000" }, { backgroundColor: v }], { duration: 200 }));
    assert.equal(fast.violation, true, `fast ${String(v)}`);
  }
  // Every value unreadable still alternates worst-case, so a fast blink is caught.
  const allUnknown = anim([{ backgroundColor: "var(--a)" }, { backgroundColor: "var(--b)" }], { duration: 200 });
  assert.equal(analyzeAnimation(allUnknown).violation, true);
});

test("B8b: a slow animation with unreadable values passes (1 s loading pulse with var())", () => {
  const pulse = anim([{ backgroundColor: "var(--brand)" }, { backgroundColor: "var(--brand-light)" }], {
    duration: 1000,
    direction: "alternate",
  });
  assert.equal(analyzeAnimation(pulse).violation, false);
  assert.equal(analyzeAnimation(pulse, { preset: "strict" }).violation, false);
});

test("fail closed: missing effect, bad timing, or a throwing object", () => {
  assert.equal(analyzeAnimation(null).violation, true);
  assert.equal(analyzeAnimation({}).violation, true);
  assert.equal(analyzeAnimation(anim([{ opacity: 0 }, { opacity: 1 }], { duration: NaN })).violation, true);
  const evil = { effect: { getKeyframes() { throw new Error("x"); }, getComputedTiming: () => ({ duration: 1 }) } };
  assert.equal(analyzeAnimation(evil).violation, true);
  // Unmodelled properties (box-shadow, gradients) are worst case: fast fails, slow passes.
  assert.equal(analyzeAnimation(anim([{ boxShadow: "0 0 4px red" }, { boxShadow: "none" }], { duration: 150 })).violation, true);
  assert.equal(analyzeAnimation(anim([{ boxShadow: "0 0 4px red" }, { boxShadow: "none" }], { duration: 1500, direction: "alternate" })).violation, false);
});

test("geometry-only animations (spinners, slides) pass", () => {
  const spin = anim([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 100 });
  const r = analyzeAnimation(spin);
  assert.equal(r.violation, false);
  assert.equal(r.maxLuminanceDelta, 0);
});

test("a fast opacity animation on a small element passes when areaPx is given", () => {
  const a = anim([{ opacity: 0 }, { opacity: 1 }], { duration: 125, direction: "alternate" });
  assert.equal(analyzeAnimation(a, { areaPx: 400 }).violation, false);
  assert.equal(analyzeAnimation(a, { areaPx: 50000 }).violation, true);
});

test("strict preset flags ~3 cycles/s; paused or zero-duration animations pass", () => {
  // 170 ms alternate: about 2.94 cycles/s (3 flashes in a window: over strict's 2, not wcag's 3).
  const a = anim([{ opacity: 0 }, { opacity: 1 }], { duration: 170, direction: "alternate" });
  assert.equal(analyzeAnimation(a).violation, false);
  assert.equal(analyzeAnimation(a, { preset: "strict" }).violation, true);
  const paused = anim([{ opacity: 0 }, { opacity: 1 }], { duration: 125, playbackRate: 0 });
  assert.equal(analyzeAnimation(paused).violation, false);
});

test("hsl(), rgba() and missing keyframe values are understood", () => {
  const hsl = anim([{ color: "hsl(0, 0%, 0%)" }, { color: "hsl(0 0% 100%)" }], { duration: 125, direction: "alternate" });
  assert.equal(analyzeAnimation(hsl).violation, true);
  // Only the 50% keyframe sets opacity: the ends are the element's own (unknown) value.
  const implicit = anim([{ offset: 0 }, { offset: 0.5, opacity: 0 }, { offset: 1 }], { duration: 250 });
  assert.equal(analyzeAnimation(implicit).violation, true);
});
