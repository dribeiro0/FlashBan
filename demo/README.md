# Demo fixtures

Synthetic, dependency-free test pages for Photosensitive Seizure Shield. Owner: @sysoutprntlne. `demo/adversarial/` belongs to security and is not part of this harness.

> **Warning:** the block fixtures show a synthetic light/dark change at 4 cycles per second with a three-second target duration, and only after you press Start. Warn anyone who can see the screen before you start a run. Low brightness is not a safety guarantee. These pages are not calibrated against WCAG thresholds and do not show that anything is safe.

## Run

```sh
cd demo
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/
```

ES modules need HTTP, so `file://` will not work. The pages load no external media or remote assets.

## Pages

| Page | `shield-expected` | Source |
| --- | --- | --- |
| `canvas.html` | block | 2D canvas `fillRect` of the whole canvas |
| `css.html` | block | CSS `@keyframes` (`250ms step-end 12`), applied only after Start |
| `dom.html` | block | class toggle on one element |
| `static.html` | allow | nothing changes; no timer, animation or loop |

Behavior on every page:
- Loads static and never starts by itself. Each run needs an explicit Start, targets a 3 s deadline, and does not restart automatically. Browser stalls can delay JavaScript cleanup; actual elapsed time and deadline overrun are reported without clamping. CSS also stops after twelve animation cycles.
- Escape, Stop, window blur, a hidden document or pagehide stops the run and restores the static dark state.
- With `prefers-reduced-motion: reduce`, Start is disabled and any active run stops. Keyboard focus moves to Stop during a run and returns to Start on stop when appropriate.
- Timing comes from `performance.now()` elapsed time, not frame counts. The two colors are `#8c8c8c` and `#2b2b2b`.
- The page shows the configured frequency separately from what it observed: script-side apply timestamps, or CSS `animationiteration` counts. These are not measured display frames.
- Detector telemetry is shown as "unavailable". The pages do not read shield results.

Code: `js/run-state.js` holds the pure, DOM-free run and timing logic with an injected clock and scheduler. `js/fixture.js` wires up the DOM. `css/fixtures.css` holds the shared styles.

## Test

```sh
node --test demo/test/
```

Run the test command from the repository root (or use `node --test test/` from `demo/`). These tests cover only the pure run-state logic: bounds, delayed callbacks, stop/cancel, duplicate loops, restart, reduced motion and invalid input. They do not cover the browser, the detector or the extension.

## Known limits (unverified)

- Detector integration is not tested. No one has checked that the shield flags the block pages or allows `static.html`.
- Effective flash area, luminance and the WCAG preset boundaries have not been verified with the detection owner. The target is up to 48rem wide at 3:2, so the area depends on viewport, zoom and DPR.
- Under load, the browser may display fewer than 4 cycles per second. Record actual timing for acceptance evidence.
- The CSS page reports iteration events, not per-frame color changes.
- Video and GIF fixtures are not implemented. See `docs/DEMO_ACCEPTANCE.md`.
