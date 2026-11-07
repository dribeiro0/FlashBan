# Soften mode design

Owner: detection engine (the pure filter). Wiring is extension core. Status: **design, stretch goal**. Start only if the detector and overlay work end to end by about 16:30 Saturday. Hard stop 19:00 Saturday: if it is not working by then, it goes on the "what's next" slide and the block path ships unchanged.

## 1. Why

Block mode protects people by taking the content away. Soften mode keeps the video playing and flattens the flashes, so the user keeps access. That is the strongest accessibility argument we have (Devpost criteria: Accessibility Impact, Creativity) and answers the security award's "protect users without making the app harder to use".

It is **not** a safety guarantee. Softened output is re-checked by the detector, and anything that still violates is blocked (section 5).

## 2. Flow

1. The detector runs on the video as normal. Normal video is never touched.
2. When a video violates, and the user's setting is "soften" (default stays "block"), the content script switches that video to soften mode.
3. A canvas is placed over the video (same box, `pointer-events: none`) and redraws each frame through the filter. The original video keeps playing underneath, so audio, captions and controls keep working.
4. A **second** detector instance reads the canvas output. If it reports a violation, escalate to block.
5. The switch fades in slowly (none under `prefers-reduced-motion`), because a sudden change is itself threat T13.

## 3. The filter

Per pixel, per channel, two cascaded first-order low-pass stages (exponential moving average) on **linear** light:

```
a   = 1 - exp(-dt / tau)          // dt = real time since the previous frame, not 1/fps
s1 += a * (x  - s1)
s2 += a * (s1 - s2)               // s2 is the output
```

`dt` comes from the frame timestamps (rule: timestamps, not frame counts). First frame initialises `s1 = s2 = x`.

### Simulated (Python, Friday/Saturday planning; not measured on a laptop)

Input: full-swing whole-frame square wave (sRGB 0 to 255), every frequency from 3.01 to 20 Hz in 0.05 Hz steps, at 24, 30 and 60 fps (1,020 cases). The output was run through a zigzag flash counter with the same rules as DESIGN.md (0.10 hysteresis, darker state < 0.80, `ceil(n/2)` in a 1000 ms window).

| tau | Cases still over 3 flashes/s (`wcag`) | Over 2 flashes/s (`strict`, 2.01-20 Hz) | Lag to 90% on a scene cut |
|---|---|---|---|
| none (input) | 1,020 / 1,020 | all | 0 |
| 150 ms | 4 / 1,020 (all at 24 fps, 3.0-3.5 Hz) | not run | ~600 ms |
| **200 ms** | **0 / 1,020** | **0** | **~780 ms** |
| 250 ms | 0 / 1,020 | 0 | ~970 ms |

Decision: **fixed `tau = 200 ms`**. It is the smallest value that cleared every case, and the lag (motion smear) grows with tau, so going higher only costs picture quality.

Caveats, so nobody over-reads this:

- A simple "output swing" metric was misleading: at 24-30 fps, strobes near the frame rate alias into slow beats with a large swing but few flashes. Only the real flash counter gives the right answer, which is why the verify loop (section 5) uses the detector, not a swing threshold.
- Whole-frame, two-level input only. Real video has motion and partial-area flashing; the verify loop is what makes this safe in practice.
- Red flashes: the filter runs per channel, so chromaticity swings shrink the same way, but this was not simulated. The verify step runs the full red-flash check on the output.

## 4. Pure API (proposal, additive, needs the usual board post)

```js
// extension/src/detect/soften.js : pure, no DOM, runs in Node
createSoftener({ width, height, tau })   // tau in seconds
  .push(pixels /* Uint8ClampedArray RGBA */, t /* ms */) -> Uint8ClampedArray  // softened frame
  .setTau(seconds)
  .reset()
```

Rules: same as the detector. Never throws; bad input returns a fully opaque mid-grey frame and a flag so the caller blocks (fail closed). Uses the same sRGB-to-linear LUT as `luma.js` plus an inverse LUT (4,096 entries) for output.

Note: the browser-side canvas does not have to call this function per pixel. A cheaper path is drawing each frame onto a canvas that is not cleared, with `globalAlpha = a` (the browser blends for us, one stage, in gamma space). Two stages = two canvases. This module is the **reference** and the test oracle; the wiring may use either path as long as the verify step passes.

## 5. Verify loop (the safety part)

- A second `createDetector` instance (same preset) samples the softened output at the usual sample size.
- Output violates, or undersampled, or the canvas is unreadable: **block**, label "couldn't soften", log it.
- Source is cross-origin, DRM or tainted: soften is never offered (we can't read the input or the output). Block, as today.
- Picture-in-picture and fullscreen move the video out from under our canvas: on `enterpictureinpicture` or `fullscreenchange`, switch to block. Verify early on a real laptop; behaviour is not tested yet.

## 6. Tests (Node, synthetic, `extension/test/`)

| ID | Input | Expected |
|---|---|---|
| SO1 | 4 Hz full-swing square wave, 4 s, tau 200 ms | output through `createDetector` (`wcag`): none |
| SO2 | 3.01 Hz full-swing (half-period 166 ms) at 24 fps | output: none at 200 ms; a violation at 150 ms (documents why 200 ms) |
| SO3 | 15 Hz | output: none |
| SO4 | Red-only strobe (#c80000 / #616161, 4 Hz) | output: no red flash |
| SO5 | Slow 0.1 Hz sine fade (10 s period) | output amplitude at least 95% of input after warm-up. Note: at 1 Hz the filter keeps only about 40% of the amplitude, which is why soften only engages on flagged video |
| SO6 | Single scene cut, dark to light | output reaches 90% within the documented lag; no violation |
| SO7 | Irregular timestamps (jitter +/-8 ms, one 120 ms gap) | still none; `dt` from timestamps |
| SO8 | Bad input (wrong length, NaN `t`) | no throw, fail-closed flag set |

## 7. Split and timing

| Who | What | Estimate |
|---|---|---|
| David | `soften.js` + SO1-SO8 | ~45 min |
| Avery | canvas overlay, positioning, fade, second detector, PiP/fullscreen fallback, popup setting "When flashing is found: block / soften" | ~1 h |
| Both | measure CPU on a real laptop at 128 x 72 verify size and full-resolution draw | 15 min |

If the laptop can't hold 30 fps while softening, ship block only.

## 8. Pitch wording (only if it works on stage)

"Most tools protect people by taking things away. FlashBan can keep the video playing and take only the flashing away, and it checks its own output before showing it." Never call softened content "safe"; say "below the WCAG flash threshold by our detector's measure".
