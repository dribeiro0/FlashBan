# Detector design

Owner: detection engine. Status: planning only, no code. Constants come from `WCAG_NOTES.md`. Interface is `docs/CONTRACTS.md` section 1; proposed additions are in section 9 and are **not** agreed yet.

Goals, in order: never miss real flashing (fail closed), count with real timestamps, stay cheap, stay pure (no DOM, no `chrome.*`, runs under Node).

## 1. Shape of the module

```
detect/
  index.ts        createDetector, analyzeAnimation, createAggregator (public API)
  luma.ts         sRGB -> linear LUT, relative luminance, red share, u'v'
  tracker.ts      per-pixel transition tracking (luminance and red)
  window.ts       per-pixel ring buffers of transition times, window counts
  aggregate.ts    cross-element area aggregation (threat T2)
  presets.ts      constants per preset
  css.ts          analyzeAnimation (no pixels)
```

Only typed arrays and numbers cross the boundary. Time is always the `t` the caller passes in; the module never calls `performance.now()` or `Date.now()`.

## 2. Per-pixel extremum tracking (luminance)

Input per frame: RGBA bytes at `sampleWidth x sampleHeight` (default 128 x 72 = 9,216 pixels).

1. Convert to relative luminance `L` (0..1) with a 256-entry `Float32Array` LUT for the linearisation. One multiply-add per channel, no `pow` in the hot loop.
2. Keep three `Float32Array`s of length P: `ext` (last confirmed extremum value), `run` (most extreme value seen since, in the current direction), and an `Int8Array` `dir` (-1 falling, 0 unknown, +1 rising).
3. On each new `L` for a pixel (zigzag filter with a 0.10 hysteresis):
   - `dir == 0`: if `|L - ext| >= 0.10`, set `dir = sign(L - ext)`, `run = L`, and register the **first** transition when the darker of `ext` and `L` is below 0.80. Until then, `ext` follows the value so a slow ramp from an old baseline does not look like a jump.
   - `dir == +1` and `L > run`: `run = L` (still rising, extend the peak).
   - `dir == +1` and `run - L >= 0.10`: the peak is confirmed. `ext = run`, `dir = -1`, `run = L`, and register a falling transition (if the darker of the two states, here `L`, is below 0.80).
   - `dir == -1` is the mirror.
4. A transition is only registered when its darker state is below 0.80 (WCAG). A swing between 0.85 and 0.95 is ignored.

Why zigzag instead of frame differences: a slow fade changes a little every frame and never reaches 0.10 between *extrema*, so it registers one transition at most. A fast flicker registers a transition on almost every swing, whatever the frame rate. This is the "extremum to extremum" idea in the plan.

Registered transitions are timestamped with the **sample time at which the 0.10 swing completed**. That reacts fast (no waiting for the next reversal) at the cost of up to one sample interval of error, which is fine against a 1000 ms window.

Noise: the 0.10 hysteresis already filters compression noise, which is far smaller. We do not smooth in time (smoothing would hide fast flicker).

## 3. Sliding window and counting

Each pixel gets an 8-slot ring of transition times (`Float32Array`, P x 8, about 295 KB at 9,216 px, plus a `Uint8Array` head). The ring holds more than the 7 transitions we need for the decision.

Window is half-open `(t - 1000, t]`. For one pixel, `n` = number of transitions inside the window, and **flashes = ceil(n / 2)**.

Why `ceil`: a flash is two opposing transitions, so a strobe at exactly 3 Hz has 6 transitions per second (3 flashes, passes). A strobe just above 3 Hz can put 7 transitions in one window; `ceil(7/2) = 4` fails, which is what "more than three flashes per second" means for a repeating signal. A `floor` would only fail from 3.5 Hz and let a 3.2 Hz strobe through, which is the wrong error for a safety tool. The cost is that a single odd transition rounds up, so one pass in a noisy sequence can count a half flash; that only matters at the very edge.

Cheap decision: a pixel has more than `F` flashes (`F = 3` wcag, `F = 2` strict) when it has at least `2F + 1` transitions in the window. That is a single comparison: the ring slot holding the `(2F+1)`-th most recent transition must be `> t - 1000`. So the per-frame cost is one compare per pixel, not a scan.

Per-pixel qualification (instead of one global "flashes per second") is deliberate: a region that flashes fast is what matters, and a different region that flashes slowly must not dilute it.

## 4. Red flash

Same structure, separate state arrays, separate ring.

- Compute linear `R, G, B` from the same LUT. Red share `r = R / (R + G + B)`, skipping pixels where the sum is 0.
- Chromaticity: `X, Y, Z` from linear sRGB, then `u' = 4X / (X + 15Y + 3Z)`, `v' = 9Y / (X + 15Y + 3Z)`.
- Per pixel keep an anchor `(u', v')` and whether the anchor was "saturated red" (`r >= 0.8`). A transition registers when the distance from the anchor is `> 0.2` and **either** the anchor or the new colour is saturated red. Then the anchor moves.
- Opposing pairs and the ring-buffer count are identical to section 3. Red flash violation uses the same flash limit `F`.
- Optimisation: if neither the anchor nor the pixel has `r >= 0.8`, skip the chromaticity maths. Almost all pixels take that branch.

Open question, not yet answerable from the glossary text: whether `R/(R+G+B)` is computed on linearised or gamma-encoded values. We use linearised (same convention as luminance). Note this in the README if anyone reproduces the numbers with another tool (PEAT).

Strict preset: any single red flash pair in the window is a violation (area ignored), see `presets.ts`.

## 5. Area, and adding it up across elements (threat T2)

Per detector (one element): `areaPx` = (number of pixels with more than `F` flashes in the window) x `realAreaScale^2`, where `realAreaScale` is CSS px per sample px. Measured in **CSS pixels** (see `WCAG_NOTES.md` section 4, point 2).

Violation for one element: `areaPx > AREA_PX[preset]` and `flashes > F` (the pixel count already enforces the second part).

T2 says an attacker splits one big flash into many small elements, each under the threshold. WCAG also measures concurrent area on the screen, not per element, so the fix is spec-aligned:

- `createAggregator()` is a pure helper owned by detection, **called by the content script**, because only the content script knows element rectangles.
- Each element detector reports `{ id, t, areaPx, redAreaPx, rect }` (rect in viewport CSS px, optional) after every sample.
- Aggregator keeps the latest report per id. A report older than `WINDOW_MS` is dropped (the element stopped being sampled or left the viewport).
- v1 rule (shipping): **sum** `areaPx` over all current ids. If the sum `> AREA_PX[preset]`, the page violates, even though no element does. This over-counts when far-apart elements flash (the spec only sums within one 10 degree field), which errs towards flagging. Documented as a known conservative choice.
- v2 rule (stretch, only if time): bin by `rect` and sum within any 341 x 256 CSS px box, using a sliding box over the rect centres.
- The aggregator returns which ids contributed, so the content script can guard all of them, not just the biggest.

An attacker can still use hundreds of tiny iframes to exhaust CPU: that is T5 and is handled by the budget below.

## 6. Sampling rate

- The caller must sample **every rendered frame**: `requestVideoFrameCallback` for video, `requestAnimationFrame` for canvas. Never a timer slower than 30 Hz (threat T1).
- The detector measures its own input rate from the timestamps. Gap rule: if the time since the previous sample is over 100 ms, flashes may have been missed in between. The report is marked `undersampled` (proposed field) and severity is at least `warn`. If the gaps persist for a full window, severity is `block` (fail closed).
- Identical or backwards timestamps: equal `t` is ignored. A backwards jump of up to 250 ms is ignored. A larger one (seek, loop, tab throttle recovery) does **not** reset: the detector keeps a continuous internal clock (`now = t + offset`, resumed one normal step after the last sample), so the flash history survives, and it holds severity `warn` for one window. (Changed while coding: a hard reset let an 800 ms looping strobe stay clean forever, vector T7.) Gaps over 100 ms set `undersampled` and `warn` for one window; an unbroken run of gaps lasting a whole window blocks. Non-finite `t` is bad input, see section 8.
- Aliasing note: video sampled by `requestVideoFrameCallback` runs at the video's own frame rate. A 24 fps video can represent at most 12 Hz of flicker (24 transitions per second), above the 3 Hz limit, so this is fine for the rule we check.

## 7. CPU budget (threat T5)

Starting numbers, to be measured on Saturday and then edited here:

| Item | Starting value |
|---|---|
| Default sample size | 128 x 72 |
| Lower sample sizes (degrade in this order) | 96 x 54, 64 x 36, 32 x 18 |
| Per-source target | at most 1.0 ms per `push` on a laptop at 128 x 72 |
| Per-page budget | at most 4 ms of detector time per animation frame, summed over all sources |
| Minimum useful size | 32 x 18 (each sample pixel is large, so a small flash is coarse; at that size the area threshold is only a few sample pixels) |

The content script measures `performance.now()` around `push` (outside the detector, which stays pure) and passes a `budgetExceeded` signal. Behaviour when over budget:

1. Step the offending sources down one size. A size change calls `reset()` for that source and gives `warn` for one window.
2. If the smallest size is still over budget, or the page budget is exceeded for 500 ms, **stop analysing the sources not yet verified and guard them** (`dim`, labelled "can't verify"). Analysed sources keep running.
3. The page never freezes because of us. The detector never loops over unbounded input: cost is `O(P)` per push with `P` capped at 128 x 72.

## 8. Fail-closed behaviour

`push` never throws. These return `{ violation: true, severity: "block" }` (contract rule):
- `pixels` is not a `Uint8ClampedArray`, or its length is not `sampleWidth * sampleHeight * 4`.
- `t` is not a finite number.
- Sample dimensions are not positive integers, or exceed 256 x 256 (memory cap), at `createDetector`.
- An internal error is caught at the `push` boundary.

Contract rule on the other side: an all-transparent or all-black frame is **valid** input, not an error. Analysis of "unreadable" media (tainted canvas, DRM) never reaches the detector; that is the content script's fail-closed path (threat T4).

`analyzeAnimation` follows the same rule: an animation it cannot read returns `violation: true`.

## 9. Contract check and proposed changes (not agreed)

Current `FlashReport` / `createDetector` shapes work as they are. Proposed **additive** changes, all optional fields so `v` stays `1`:

| Change | Why | Who it touches |
|---|---|---|
| `realAreaScale` documented as **CSS px per sample px** (not DPR-scaled) | Section 5 and `WCAG_NOTES.md` | Content script (computes it) |
| `FlashReport.windowMs: number` | HUD and tests show the window used | HUD (Jun) |
| `FlashReport.sampleRateHz: number` | HUD "how fast are we sampling"; shows aliasing risk | HUD |
| `FlashReport.undersampled: boolean` | Gap rule, section 6 | Content script, HUD |
| `FlashReport.redAreaPx: number` | HUD and aggregation of red | HUD, content script |
| `FlashReport.areaPx` meaning clarified: area of pixels over the preset's flash limit | Violation compares this number | All readers |
| New export `createAggregator()` | Threat T2, section 5 | Content script (calls it) |
| `createDetector` returns `peek(): FlashReport` (last report without a sample) | HUD polling without a push | HUD |

HUD numbers I propose Jun reads, all from `FlashReport`: `flashesPerSecond`, `redFlashesPerSecond`, `areaPx`, `areaPct`, `severity`, `reason`, plus the new `sampleRateHz` and `undersampled`. Nothing else is promised. The HUD should call these "detector estimates", not measurements of the display.

`flashesPerSecond` definition for the HUD: the highest flash count `f` such that at least 1% of the area threshold (rounded up to one sample pixel) has `f` or more flashes in the window. This ignores single noisy pixels and still shows a real small strobe. It is a display number; the violation uses `areaPx` and the preset, not this.

## 10. Not doing (stated so nobody assumes it)

- No fine-pattern exemption (checkerboards, noise).
- No look-ahead decode here (that is the extension's offscreen job and only feeds this module frames).
- No colour-managed or HDR luminance.
- No guarantee for content we cannot sample.
