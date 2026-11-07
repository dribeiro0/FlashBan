# Adversarial page plan

Owner: @sysoutprntlne. Planning draft, November 6, 2026. None of these pages exist yet; they will be built in `demo/adversarial/` on Saturday, after the pre-kickoff code rule is confirmed. The page list and threat numbers come from [THREAT_MODEL.md](THREAT_MODEL.md).

## Rules every page follows

These are the same safety rules as the demo pages (`docs/DEMO_ACCEPTANCE.md`, "Controls and exposure constraints"). All pages are written fresh after kickoff, and the adversarial pages share one run controller with the demo pages instead of copying it.

- Loads static, with a visible warning. Nothing moves until an explicit **Start**. Each run is bounded (3 s of flashing, unless the page says otherwise) and never restarts by itself. Stop, Escape, blur, a hidden tab and `prefers-reduced-motion` all stop it.
- Dim colors only: `#8c8c8c` and `#2b2b2b`, the same as the fixtures, except `red-only.html`.
- No remote assets and no real seizure media. `tainted.html` uses a second local origin (below).
- Each page sets `<meta name="shield-expected" content="block">` (all seven are attacks, so `allow` would be a miss) and one line saying what a pass looks like. A **pass** means the shield blocks the content or fails closed (dimmed and labeled "can't verify"). Letting it through is a **fail**.
- Results go in the THREAT_MODEL Status column (planned → built → tested) with the commit and Chrome version.

## The seven pages

| Page | Threat | How it will be built | Expected verdict (pass looks like) | Overlap with planned demo pages |
|---|---|---|---|---|
| `aliasing.html` | T1 | One canvas filling the fixture area. Mode A (default) flips light/dark on **every** `requestAnimationFrame` (30 cycles/s on a 60 Hz screen), which a 30 Hz timer sampler sees as a constant color. Mode B is the threat model's 15 Hz strobe, scheduled by real time so its edges line up with a 33.3 ms timer. The page prints the flips it actually displayed. | **block**: caught by per-frame sampling (rAF/rVFC), not missed between samples. | Shares drawing and run controls with `canvas.html`, which runs only at 4 cycles/s. The per-frame mode is new. |
| `split-area.html` | T2 | A 4×4 grid of 16 canvases, each 80×60 CSS px (4,800 px, under the 21,824 px area threshold on its own), all flipping together at 4 cycles/s. Together they cover 76,800 px, well over the threshold. The page says "run at 100% browser zoom": the threshold scales with zoom, and the setup stays valid only between about 53% and 213% (checked by @dribeiro0). | **block**: the area is summed across elements (`createAggregator()` in `docs/CONTRACTS.md` section 1). Judging each canvas alone would wrongly allow it. | Same drawing as `canvas.html`, repeated 16 times. |
| `red-only.html` | T3 | One canvas alternating at 4 cycles/s between saturated red `#c80000` and grey `#616161`. Their relative luminance is nearly equal (about 0.12 each), so the change is far under the 0.10 general-flash delta, but the red share is above 0.8 with a large chromaticity change. Checked by @dribeiro0 against `WCAG_NOTES.md`: luminance delta 0.003, red share 1.0, chromaticity (UCS) distance 0.259 > 0.2, so it is a red flash and not a general flash. The canvas is at least 300×200 CSS px so the red area also passes the 21,824 px threshold under the `wcag` preset (`strict` flags any red flash). | **block** with `reason: "red"`, and no general flash reported. | None. The demo pages are greyscale only. |
| `late-start.html` | T8 | The same element as `canvas.html`, but after Start it stays calm (static dark) for 10 s, then flashes at 4 cycles/s for 3 s. A countdown is shown so the operator knows when it will begin. | **block** during the flashing part, although guarded start ended long before. | Partly. Pressing Start on `canvas.html` well after page load also tests an element past warm-up (see `DEMO_ACCEPTANCE.md`, "existing element"). The timed 10 s lead-in is new. |
| `overlay-killer.html` | T6 | A `canvas.html`-style strobe plus an attacker script that runs on every frame and on a `MutationObserver`. It removes every element it didn't create, sets `display:none`, `opacity:0` and `z-index:-1` on unknown nodes, closes all open `<dialog>`s, calls `hidePopover()` on every popover, and adds a full-page `z-index: 2147483647` cover of its own. The page counts and shows how many removals it attempted. | **block**: the content stays paused and covered for the whole run, and the overlay comes back within one frame whenever it is removed. | None. |
| `cpu-flood.html` | T5 | Prepare records one short synthetic clip (the same local recording approach planned for `video.html`), then creates 200 `<video>` elements that share that `blob:` URL: 20 visible in a grid, 180 hidden or off-screen. On Start, all play for 3 s and one visible video carries the flashing pattern. The page shows its own frame time so a freeze is visible. | **block**: the flashing video is covered, and every visible video the shield could not check within budget is dimmed and labeled "can't verify". The page stays responsive. | Uses the `video.html` clip. The 200-element page is new. |
| `tainted.html` | T4 | A second local server on a different origin (`http://localhost:8001`, while the page is on `http://127.0.0.1:8000`) serves a static synthetic image with no CORS headers. The page draws it into a canvas, which taints the canvas, and alternates it with a dark fill at 4 cycles/s. The page confirms the taint by catching the `getImageData` security error itself. | **block (fail closed)**: dimmed and labeled "can't verify", since pixels can't be read. Running the strobe unchanged is a fail. | None. |

## Build order (Saturday)

1. `red-only`, `split-area` and `late-start` first. They are small variations of the `canvas.html` demo page, and they test David's detector and aggregator directly.
2. `tainted` and `overlay-killer` next. They need Avery's overlay and fail-closed path to exist before they can pass.
3. `aliasing` and `cpu-flood` last. They need the real sampling loop and the CPU budget.

## Open questions

- @DxubleBTW: the contract's meta tag has only `block|allow`. Should "dimmed, can't verify" count as `block` for automatic checking (my assumption above), or do you want a third value? That would be a contract change, so it's not applied.
