# Detector test vectors

Owner: detection engine. Status: planning only. These are the synthetic sequences we unit-test on Saturday, with the expected result. Rules and constants: `extension/src/detect/WCAG_NOTES.md`. Behaviour: `extension/src/detect/DESIGN.md`.

No real media and nothing that is shown on a screen. Every vector is generated as numbers in Node.

## Conventions

- Default sample size `16 x 9` (144 px), `realAreaScale = 8` CSS px per sample px, so one sample pixel is 64 px and a full frame is 9,216 px. Area vectors use `64 x 36` (2,304 px) instead, still `realAreaScale = 8`.
- Default sampling 60 fps with integer-millisecond timestamps (`t = round(i * 1000 / fps)`). Vectors that depend on an exact edge give explicit transition times instead of a frequency, because 3 Hz does not fall on whole milliseconds.
- Levels are given as sRGB gray bytes. The test helper `lumaOf(g)` returns relative luminance, and each vector asserts its own level pair with it before running (so a typo in a level cannot make a test pass by accident). Values in brackets are approximate, computed by hand.
  - `DARK = 0` (L = 0), `LIGHT = 140` (L about 0.26). Swing about 0.26, darker state far below 0.80.
  - `SWING_OVER = 0 <-> 90` (about 0.102). `SWING_UNDER = 0 <-> 86` (about 0.093). Hand-computed, **verify with the helper** and shift a byte if either is on the wrong side.
  - `BRIGHT_OK = 232 <-> 255` (darker state about 0.807, not a flash). `BRIGHT_FLASH = 225 <-> 255` (darker state about 0.753, a flash).
- "Square wave at X Hz" means the level flips every `500 / X` ms, whole frame unless stated.
- "Result" is the `FlashReport` after the last sample unless a "when" is given. `none` means `violation: false, severity: "none"`.
- Default preset is `wcag` unless stated. Each vector also runs after `reset()` and must give the same answer.

## 1. Frequency

| ID | Input | Expected |
|---|---|---|
| F1 | Square wave 2 Hz, 4 s, DARK/LIGHT, full frame | none, `flashesPerSecond` 2 |
| F2 | Half-period 167 ms (about 2.99 Hz), 4 s | none. 7 transitions need 1002 ms, the window holds 6. `flashesPerSecond` 3 |
| F3 | Half-period 166 ms (about 3.01 Hz), 4 s | **violation**, reason `general`. 7 transitions in 996 ms, `ceil(7/2) = 4` |
| F4 | Square wave 4 Hz, 4 s | **violation**, `flashesPerSecond` 4 |
| F5 | Square wave 10 Hz, 4 s | **violation**, `flashesPerSecond` reads 4 (the 8-slot ring caps the count at 4 flashes; fine, anything above 3 is a violation) |
| F6 | Exactly 6 transitions then constant for 3 s | none; never above 3 |
| F7 | Edge: 7 transitions where the first and seventh are exactly 1000 ms apart (explicit times `0,166,333,500,666,833,1000`) | none at `t = 1000` (first one drops out of the half-open window); the same with the seventh at 999 ms is a **violation** |
| F8 | Burst: 4 flashes (8 transitions) in 900 ms, then constant 3 s | violation during the burst; report returns to none once the burst is 1000 ms old. The detector does not latch (latching is the content script's job) |
| F9 | Preset `strict`, half-period 167 ms (about 3 Hz, 6 transitions) | **violation** (3 flashes > 2); same input under `wcag` is none |
| F10 | Preset `strict`, 2 Hz | none |
| F11 | Calm constant gray for 5 s with **one** stray transition (a single 0.3 step) in the middle, then constant again (test requested by the lead) | none, never `warn` or `block`. One transition is `ceil(1/2) = 1` flash, far from the limit of 3 |
| F12 | One isolated flash pair (2 transitions) every 1.5 s for 10 s | none (never more than 1 flash in any window) |
| F13 | A clean 3-flash burst (6 transitions) and a stray 7th transition 100 ms later, all inside one window | **violation**. This is the `ceil` edge, expected by design; recorded so nobody "fixes" it by accident |

## 2. Amplitude and darker-state limit

| ID | Input | Expected |
|---|---|---|
| A1 | 6 Hz square wave, `SWING_UNDER` | none, `flashesPerSecond` 0 (swing below 0.10 never registers) |
| A2 | 6 Hz square wave, `SWING_OVER` | **violation** |
| A3 | 6 Hz square wave, `BRIGHT_OK` (darker state at or above 0.80) | none |
| A4 | 6 Hz square wave, `BRIGHT_FLASH` | **violation** |
| A5 | Constant gray plus seeded random noise of at most 0.03 luminance per pixel per frame, 5 s | none (hysteresis ignores noise) |
| A6 | Drift: level rises 0.04 every frame to 1.0 over 25 frames then constant | none (no swing of 0.10 followed by a reversal) |

## 3. Area

All area vectors run 4 Hz (violating rate) on a `64 x 36` frame, `realAreaScale = 8`. Area threshold for `wcag` is 21,824 px. Pixels outside the flashing region stay constant at DARK.

| ID | Flashing region | Expected |
|---|---|---|
| R1 | Whole frame (2,304 sample px, 147,456 px) | **violation**, `areaPx` 147,456 |
| R2 | 341 sample px (`areaPx` 21,824, exactly the threshold) | none (a tie passes), `areaPx` 21,824 |
| R3 | 342 sample px (`areaPx` 21,888) | **violation** |
| R4 | 10 sample px (640 px) | none; `flashesPerSecond` still reports 4 (above the 1% display floor) |
| R5 | Two disjoint 200-px regions flashing **out of phase** with each other at 4 Hz (400 sample px, 25,600 px) | **violation** (concurrent area is the union, phase does not matter) |
| R6 | 341 sample px flashing at 4 Hz and a second region of 300 px flashing at 2 Hz | violation decided on the 4 Hz pixels only: none (2 Hz pixels do not exceed the flash limit and do not add to the area) |
| R7 | `areaPct` check: 341 px region on a 2,304 px frame | `areaPct` is 341/2304 of the visible area; asserts the HUD number, not the verdict |
| R8 | `realAreaScale` 4 instead of 8, 341 sample px | `areaPx` 5,456, none. Same pixels, different scale, proves the scale is applied |

## 4. Aggregation across elements (threat T2)

Tested on `createAggregator(preset)` (`update(r)` and `result(t)`) with synthetic reports `{ id, t, areaPx, redAreaPx }`, `wcag` preset.

| ID | Input | Expected |
|---|---|---|
| G1 | 10 ids, each `areaPx` 2,560, all reported at the same `t` (sum 25,600) | **aggregate violation**, even though each is under 21,824; all 10 ids returned as contributors |
| G2 | Same, but 9 ids at 2,560 (sum 23,040) | **violation**; 8 ids (sum 20,480) is none |
| G3 | 10 ids as in G1 but 5 of them last reported 1,500 ms earlier | none (stale reports are dropped, remaining sum 12,800) |
| G4 | `result(t)` with no updates ever made | `violation: false`, `totalAreaPx` 0, `ids` empty, no throw (the contract has no `remove`; ids drop out by going stale) |
| G5 | Same id reports twice in one window | counted once, latest report only |
| G6 | Sum exactly 21,824 | none; 21,825 or more is a violation |
| G7 | Red areas from several ids exceeding the threshold while general area does not | violation, reason `red` |

## 5. Slow changes and smooth waveforms

| ID | Input | Expected |
|---|---|---|
| S1 | One linear ramp 0 to 1 over 2 s, then constant | none (at most one transition) |
| S2 | Staircase fade 0 to 1 in 20 equal steps over 1 s | none |
| S3 | Triangle wave 1 Hz (smooth up and down) | none (2 transitions per second) |
| S4 | **Smooth** sine wave at 4 Hz, amplitude 0.25 luminance peak to 0.50 trough, 4 s | **violation**. It never "jumps", but extrema are counted, not frame differences |
| S5 | Sawtooth 4 Hz (slow rise, instant drop), swing 0.3 | **violation** (8 transitions per second) |
| S6 | Fade-in then fade-out, 0.5 s each, repeated (1 Hz) | none |

## 6. Red flash

Gray `G128` is about L = 0.216, close to pure red's L = 0.2126, so a swing between them is nearly **iso-luminant** (general delta below 0.10) while the chromaticity distance is above 0.2 (about 0.26). Hand-computed; the test asserts both with helpers before use.

| ID | Input | Expected |
|---|---|---|
| Re1 | 4 Hz square wave, pure red (255,0,0) <-> gray `G128`, full frame | **violation**, reason `red`; `redFlashesPerSecond` 4; general flashes 0 |
| Re2 | 4 Hz, (200,60,60) <-> (60,200,60). Red share 0.625 is under 0.8, so neither state is saturated red | no red flash. General flash decided by luminance only |
| Re3 | 4 Hz, red (255,0,0) <-> dark red (80,0,0). Same chromaticity, different brightness | reason `general` (luminance delta about 0.19), no red flash |
| Re4 | 4 Hz, red (255,0,0) <-> white (255,255,255) | **violation**, reason `both` |
| Re5 | Re1 at 3 Hz (6 transitions per second) | none |
| Re6 | Re1 at 4 Hz but red region only 341 sample px (at the area threshold) | none; 342 px is a violation. Red area is judged separately from general area |
| Re7 | Preset `strict`, one red flash pair (2 transitions) in a second | **violation**, reason `red` (strict treats any red flash as a violation) |
| Re8 | All-black frames and all-red frames only (no alternation) | none. Pixels with R+G+B = 0 skip the chromaticity maths without producing NaN |

## 7. Irregular timing and sampling

| ID | Input | Expected |
|---|---|---|
| T1 | Same 4 Hz square wave sampled at 144, 60, 30 and 24 fps | **violation** every time, same `flashesPerSecond` (timestamps, not frame counts) |
| T2 | 3.5 Hz square wave at 30 fps and at 60 fps | **violation** at both (frame-count logic would differ) |
| T3 | 4 Hz square wave with seeded jittered intervals between 8 and 40 ms | **violation**. Intervals stay under the 100 ms gap limit, so no `undersampled` |
| T4 | 4 Hz wave, then a 150 ms gap with no samples, then it resumes | `undersampled` true and `severity` at least `warn` for the report after the gap; back to normal after a window |
| T5 | 4 Hz square wave sampled **at 4 Hz on phase** (aliasing: every sample sees the same level), 3 s | `undersampled` true, severity at least `warn` (and `block` after a full window of such gaps). Never a clean `none` |
| T6 | Video-style timestamps: samples at `mediaTime * 1000`, then a backwards jump of 1,000 ms (seek) | detector resets and holds `warn` for one window; no throw |
| T7 | Looping strobe: 800 ms of 4 Hz, jump back to 0, repeat | still reaches a violation within a few loops (the reset does not clear the `warn` hold early) |
| T8 | Two samples with identical `t` | second one ignored, no double counting, no throw |
| T9 | Long safe intro: constant for 30 s, then 4 Hz begins at `t0` (threat T8) | violation by `t0 + 1000` ms at the latest |
| T10 | Time-to-detect: 4 Hz begins at `t0`, 60 fps | violation within about 900 ms (the 7th transition lands 750 to 875 ms after onset); record the actual number, edit this row |

## 8. Bad input, fail closed

| ID | Input | Expected |
|---|---|---|
| B1 | `pixels` length is one byte short | `violation: true`, `severity: "block"`, no throw |
| B2 | `t = NaN`, `Infinity` and `undefined` | block, no throw |
| B3 | `pixels` is a plain `Array` or a `Uint8Array` (not clamped) | block |
| B4 | `createDetector` with `sampleWidth = 0`, negative, non-integer, or 1000 | detector that always blocks, no throw |
| B5 | Detector internals forced to throw (inject a bad state in a test hook) | `push` returns block, does not propagate |
| B6 | All-black frames for 5 s | none (valid input) |
| B7 | All-transparent frames (alpha 0) for 5 s | none (valid input; luminance uses RGB) |
| B8 | `analyzeAnimation` with a keyframe it cannot read (non-colour property value) | `violation: true` |

## 9. CSS animation path (`analyzeAnimation`, no pixels)

Fake `Animation` objects with keyframes and timing, no DOM.

| ID | Input | Expected |
|---|---|---|
| C1 | `opacity` 0 <-> 1, duration 125 ms, infinite, alternate (4 cycles per second) | violation, `cyclesPerSecond` 4, `maxLuminanceDelta` large |
| C2 | Same at duration 1000 ms (1 cycle per second) | none |
| C3 | `background-color` black <-> white, 4 Hz | violation |
| C4 | `background-color` swing of 0.05 luminance, 8 Hz | none (below 0.10) |
| C5 | `background-color` `#e8e8e8` <-> `#ffffff` (darker state at or above 0.80), 8 Hz | none |
| C6 | `opacity` 0.9 <-> 1.0 over a mid-gray page, 8 Hz | none (computed delta too small) |
| C7 | `iterations: 3` finite at 8 Hz | not a violation on its own (3 cycles in total, no more than 3 in a second) |
| C8 | `steps(1)` timing function at 4 Hz | violation (jumps count, same as a hard toggle) |
| C9 | Animation with `playbackRate` 2 on a 250 ms duration | uses the effective rate: 8 cycles per second, violation |

## 10. Not asserted in CI, but recorded

- **Performance:** 600 pushes at `128 x 72`, report median and p95 `push` time. Target from DESIGN.md is at most 1.0 ms median. Print it, do not fail the build on it (CI machines vary).
- **Determinism:** the same input sequence twice gives byte-identical `FlashReport` JSON.
- **Cross-check (stretch):** run vectors F4, A2, R1, Re1 through the Trace Center PEAT if someone can, and record agreement in the README honestly.
