# Detector build order (Saturday Nov 7)

Owner: detection engine. Planning only: **no code is written before kickoff (12:00)**. Times are targets, not promises; I will post on the board at each wire-in point, and again if one slips by more than 30 minutes. Behaviour is in `DESIGN.md`, test list is in `extension/test/TEST_VECTORS.md` (vector ids below like F4, R2, Re1).

## When can the content script wire things in?

| Time | What is ready | For @DxubleBTW |
|---|---|---|
| **13:30** | `createDetector` with the **final API shape** (`push`, `peek`, `reset`, full `FlashReport`), validating input and failing closed. Analysis is a placeholder that reports `severity: "none"` for valid input. | Wire the content script against the real signature now; replace nothing later. Do not rely on verdicts yet. |
| **14:30** | **Real general-flash detection**, `wcag` preset, area and frequency. Verdicts are real. Vectors F, A, S, B passing. | First point where the overlay can be triggered by actual numbers (the runbook's 18:00 target, met early). |
| 15:15 | Area fields, `windowMs`, `sampleRateHz`, `undersampled`, gap rule, timing vectors R, T passing. | HUD fields complete. |
| 16:00 | Red flash. Vectors Re passing. | `reason: "red" \| "both"` becomes possible. |
| 16:45 | Presets `strict` and `relaxed`, `peek`, `reset` behaviour. | Settings message can pass any preset. |
| 17:30 | `createAggregator`. Vectors G passing. | T2 defence: feed it per-element `areaPx` and guard the returned `ids`. |
| **18:00** | `analyzeAnimation` (CSS path). Vectors C passing. | CSS animation guarding can be wired. |
| 18:00 to 19:00 | Buffer, bug fixes, benchmark, first CPU budget numbers. | Post measured `push` times. |
| 19:00 to 23:00 | Integration support and tuning (below). | |

## Order of work, with the reason for the order

1. **13:00 to 13:30, skeleton.** Folder layout from DESIGN section 1, `presets.js` constants, input validation, a `createDetector` that returns a valid fail-closed report for bad input and a calm report otherwise. Why first: it freezes the API so Avery is never blocked on me.
2. **13:30 to 14:30, luminance and general flash.** `luma.js` (LUT, relative luminance), `tracker.js` (zigzag with 0.10 hysteresis and the 0.80 darker-state rule), `window.js` (8-slot rings, `ceil(n/2)`, half-open window). Test as I go: F1 to F13, A1 to A6, S1 to S6, B1 to B7. Why before area: the frequency rule is the core claim and the easiest to get subtly wrong, and every later feature rides on it.
3. **14:30 to 15:15, area and timing.** Pixel counting over the flash limit, `realAreaScale` in CSS px, `areaPct`, `windowMs`, measured `sampleRateHz`, the 100 ms gap rule, backwards-time reset with the one-window `warn` hold. Tests R1 to R8, T1 to T10.
4. **15:15 to 16:00, red flash.** u'v' chromaticity, saturated-red anchor, separate ring. Tests Re1 to Re8. Why after general flash: it reuses the same ring and window code, so it is quick once those are right.
5. **16:00 to 16:45, presets and API polish.** Strict (limit 2, lower area, any red flash), relaxed, `peek()`, `reset()` clears everything. Tests F9, F10, Re7, determinism.
6. **16:45 to 17:30, aggregator.** Per-id latest report, staleness drop at 1000 ms, sum against the preset area, `ids` of contributors. Tests G1 to G7.
7. **17:30 to 18:00, CSS path.** `analyzeAnimation` over fake `Animation` objects (keyframes, timing, `playbackRate`). Tests C1 to C9. This module needs only numbers and a duck-typed object, so it stays pure.
8. **18:00 to 19:00, benchmark and fix-up.** 600 pushes at 128 x 72, median and p95. If the median is over 1.0 ms, optimise the red branch skip and the per-pixel loop first, then lower the default sample size. Post the numbers so Avery can set the page budget. Finish any red vectors that slipped.
9. **19:00 to 21:00, integration.** Sit with the content script: check the first real `FlashReport` from a page, check `realAreaScale` is CSS px per sample px, check timestamps are real (`rVFC` or `performance.now()`), check the `undersampled` flag fires on a slow timer. Calibrate against Jun's synthetic pages using the numbers the HUD prints.
10. **21:00 to 23:00, cross-check and docs.** If someone can run PEAT, compare F4, A2, R1, Re1 and record the agreement honestly. Send Jun the "known limits" paragraph for the README (HDR and colour management not modelled, viewing angle assumed from CSS pixels, unreadable media is dimmed not measured). Stop at 23:00.

## What I need from other people

- **Avery:** (a) test command in `package.json` (a shared file). I will use Node's built-in `node --test`, no dependencies. Please add `"type": "module"` and `"scripts": {"test": "node --test extension/test"}` or tell me to. (b) How the content script will load the detector. Chrome content scripts are classic scripts, so ES module `import` from `extension/src/detect/` needs a decision: a bundler step, or a dynamic `import()` with `web_accessible_resources`. I will write plain ES modules with JSDoc types and **no build step** and no TypeScript, so there is nothing to compile unless you choose to. The contract file says `index.ts`; I will treat that as `index.js` and keep the same export names and shapes.
- **Jun:** pages that print `FlashReport` numbers so I can calibrate (already planned). Expected verdicts in each page's `shield-expected` meta tag.
- **Everyone:** no changes to `extension/src/detect/` or `extension/test/` without a board handoff, as in AGENTS.md section 3.

## Risks and the fallback for each

| Risk | Fallback |
|---|---|
| Red flash maths takes longer | Ship general flash, area and presets first; red is a flag (`redFlashesPerSecond: 0`, strict preset treats red-dominant pixels conservatively as a general flash) until done. Say so on the board. |
| Per-pixel loop too slow at 128 x 72 | Default to 96 x 54 or 64 x 36 (DESIGN section 7). The area threshold still works at those sizes. |
| `analyzeAnimation` keyframe parsing is messy (colour strings, `currentColor`, filters) | Handle `opacity`, `background-color`, `color`, `visibility` first. Anything unparseable returns `violation: true` (fail closed), which is the contract rule. |
| Behind schedule at 18:00 | Cut order: `relaxed` preset, `peek`, `createAggregator` v2 rule, then PEAT cross-check. Never cut the failing-closed paths or the general-flash tests. |

## Not on the list

Look-ahead decoding, GIF/APNG frame extraction, WebGL buffers and the offscreen document belong to the extension core. They only ever hand this module frames.
