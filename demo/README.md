# Demo fixtures

Synthetic test pages for the Seizure Shield extension. **They contain flashing content.** Every stimulus is generated in the page (no downloaded media), dim (#222222 and #777777), bounded (3 s by default, `?seconds=1..10`), and starts only after you press Start. Stop, Escape or hiding the tab ends a run (opening the extension popup does not). With reduced motion on, the moving fixtures stay static.

Run:

```bash
node demo/serve.mjs
```

Then open http://localhost:8080/ with the unpacked extension loaded. (Opening the files directly also works if "Allow access to file URLs" is on for the extension.)

| Page | Source | Rate | `shield-expected` |
|---|---|---|---|
| canvas.html | 2D canvas, requestAnimationFrame | 4 cycles/s | block |
| css.html | `@keyframes` background-color | 4 cycles/s | block |
| dom.html | JS class toggle | 4 cycles/s | block |
| video.html | same-origin blob: video recorded from a hidden canvas | 4 cycles/s | block |
| slow-canvas.html | 2D canvas | 1 cycle/s | allow |
| static.html | no motion | none | allow |
| adversarial/overlay-killer.html | canvas strobe plus a script that removes/hides unknown nodes, closes dialogs and popovers, keeps a max z-index layer (T6) | 4 cycles/s, 10 s | block |
| adversarial/red-only.html | canvas, #c80000 vs #616161 (luminance change 0.004, UCS distance 0.26) (T3) | 4 cycles/s | block |
| adversarial/late-start.html | canvas, 10 s calm then strobe (T8) | 4 cycles/s for 3 s | block |
| adversarial/aliasing.html | canvas at 12.5 cycles/s; a fixed 80 ms sampling grid sees one state (T1) | 12.5 cycles/s | block |
| adversarial/soften-killer-css.html | CSS strobe; page resets playbackRate to 1 every frame (T6) | 4 cycles/s, 6 s | block (cover or lockdown, not soften) |
| adversarial/soften-killer-dom.html | class-toggle strobe; page strips the soften transition every frame (T6) | 4 cycles/s, 6 s | block (cover or lockdown, not soften) |

Stimulus area is 320 by 180 CSS px (57,600 px), above the 21,824 px WCAG area threshold at 100% zoom. Each light/dark change is about 0.17 in relative luminance (over 0.10), with the dark state below 0.80. The meta tag is the intended verdict, not a measurement: record the detector's actual output when testing.
