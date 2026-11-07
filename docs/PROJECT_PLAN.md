# Photosensitive Seizure Shield: project plan

Track: Technology and Interface, with the BUCyS cybersecurity subtrack.
Team: FlashBan. Event: Hackcessability, Nov 7-8 (kickoff Sat 12:00pm, CDS 1750; demos Sun).

## 1. Problem

Flashing or strobing content can trigger seizures in people with photosensitive epilepsy. WCAG 2.3.1 (Three Flashes or Below Threshold) says content must not flash more than three times in any one-second period unless the flashes are below the "general flash" and "red flash" thresholds. Websites, ads, embedded videos and social feeds break this rule all the time, and the user has no control: by the time you see it, it has already rendered.

There is also a security angle. Deliberately sending strobing content to people with epilepsy ("epilepsy trolling") is a real attack: it has been done through social media posts, GIFs, and web pages. We treat it as a content-based denial-of-safety threat: the attacker's payload is ordinary web content, and the harm is physical.

## 2. Product in one paragraph

Seizure Shield is a Chrome (Manifest V3) browser extension. It watches video, canvas, animated images and CSS/JS animations on every page, measures flashing with the WCAG metrics, and when content is likely to exceed the safe threshold it dims, freezes, or blocks that content and shows an accessible "Safe mode" overlay. Offending domains are logged locally and can be reported to a small backend that builds a reputation list, so repeat offenders are blocked earlier next time.

## 3. What counts as "flashing" (the metrics we implement)

Summarized from WCAG 2.2. The confirmed constants, definitions and sources are in `extension/src/detect/WCAG_NOTES.md` (David, PR #5); that file wins if anything here disagrees.

- **Relative luminance** of a pixel: convert each 8-bit sRGB channel to linear (`c/255`; if `<= 0.04045` divide by 12.92, else `((c+0.055)/1.055)^2.4`), then `L = 0.2126 R + 0.7152 G + 0.0722 B`.
- **General flash:** a pair of opposing changes in relative luminance (an increase followed by a decrease, or the reverse) where each change is at least 0.10 on the 0 to 1 relative luminance scale (a fixed absolute change, not 10% of the current value) and the darker state is below 0.80.
- **Red flash (WCAG 2.2 rule):** a pair of opposing transitions where one of the states is saturated red (`R/(R+G+B) >= 0.8`) and the two states are more than 0.2 apart in the CIE 1976 UCS chromaticity diagram (`sqrt((u'1-u'2)^2 + (v'1-v'2)^2) > 0.2`). Do not use the older WCAG 2.0 formula.
- **Frequency:** more than 3 flashes in any one-second window is a failure. A flash is two opposing transitions, and a window holding `n` transitions counts as `ceil(n/2)` flashes, so 7 transitions in one second is 4 flashes and fails. A repeating on/off cycle with a period shorter than about 333 ms fails.
- **Area:** a failure needs the area flashing at the same time to be **greater than** 25% of a 10-degree visual field (a tie passes). WCAG estimates the field as 341 by 256 pixels at 1024 by 768, so the threshold is 21,824 pixels. We measure in **CSS pixels**, not device pixels (no `devicePixelRatio` scaling), and adjust the threshold for browser zoom. The area is measured against the screen, not one element: flashing areas across elements are added together (threat T2). `areaPct` is for display only.

Everything above is the legal-style rule. Our product default is deliberately more cautious than the rule (see "Sensitivity presets").

## 4. Architecture

```
extension/
  manifest.json           MV3
  src/
    detect/               pure functions, no DOM: luminance, frame diff, flash counter, red flash
    content/              content script: finds media, samples frames, applies safe mode
    background/           service worker: settings, domain log, report queue, offscreen jobs
    offscreen/            offscreen document for look-ahead decoding (stretch)
  popup/                  accessible settings and status UI
  options/                domain allowlist, sensitivity, log viewer
api/                      small backend: report intake, domain reputation list
demo/                     synthetic test pages and a live metrics HUD
security/                 threat model, test notes
docs/                     this plan, contracts, timeline, pitch
```

### 4.1 Detection engine (`extension/src/detect/`)

Pure TypeScript/JavaScript, unit-testable in Node without a browser.

1. **Downscale.** Draw each sampled frame to a small `OffscreenCanvas` (for example 128 by 72) so analysis is cheap. Keep the scale factor so area can be converted back to real pixels.
2. **Luminance map.** Use a 256-entry lookup table for the sRGB-to-linear step. Output a `Float32Array` of relative luminance per pixel.
3. **Per-pixel transition tracking.** For each pixel keep the last luminance extremum and the current direction. When the luminance moves at least 0.10 away from the last extremum in the opposite direction (and the darker side is under 0.80), register a transition and set a new extremum. This tracks extremum-to-extremum changes rather than single frame differences, so slow ramps are not miscounted and fast flicker is.
4. **Flash counting.** Two consecutive opposing transitions on a pixel make one flash. For each frame, count pixels with a transition and convert to real pixel area.
5. **Sliding window.** Keep timestamped events for the last 1000 ms. If the window contains more than 3 flashes and the combined area passes the threshold, emit a violation. Use real timestamps (`requestVideoFrameCallback` metadata or `performance.now()`), never frame counts, because frame rates vary.
6. **Red flash detector.** Same structure, separate transition rule, same window logic.
7. **Output:** `{ flashesPerSecond, areaPx, areaPct, redFlash, severity, windowMs }` per sample (see `docs/CONTRACTS.md`).

Sampling rate: at least every displayed frame for video (`requestVideoFrameCallback`), every animation frame for canvas. Sampling slower than the flash rate causes aliasing, so a page could hide a strobe between samples. Never sample on a timer slower than 30 Hz.

### 4.2 Sources of flashing and how we watch each

| Source | How we detect it | Notes |
|---|---|---|
| `<video>` | `requestVideoFrameCallback`, draw to offscreen canvas, run the detector | Cross-origin video without CORS taints the canvas and blocks pixel reads. See "Cross-origin limits". |
| `<canvas>` 2D | Sample with `drawImage(canvas)` each animation frame | Works unless the canvas is tainted. |
| WebGL canvas | Same sampling, but the buffer may be cleared before we read it | Stretch goal. Fallback: treat as unverifiable and apply the policy for unverifiable content. |
| CSS animations and transitions | `document.getAnimations({subtree: true})`, read `effect.getKeyframes()` and `getComputedTiming()` | Look for animated `opacity`, `background-color`, `color`, `filter`, `visibility`. Compute cycles per second and contrast between keyframes. Cheap and does not need pixels. |
| JS-driven flicker (class toggles, `setInterval` style changes) | `MutationObserver` rate on style and class attributes, plus pixel sampling of the affected element | Mutation rate is a trigger, pixels are the confirmation. |
| Animated GIF, APNG, WebP | Fetch bytes from the service worker, decode with `ImageDecoder` (WebCodecs), read frame durations and pixels | Deterministic and can be done before the image is shown. |
| Whole-page strobing (body background toggling) | Covered by the CSS and mutation paths above, plus optional viewport-level sampling | Viewport capture via `tabCapture` needs a user gesture. Stretch. |

### 4.3 Safe mode (what "block or dim before it renders" means)

Detection takes some time. We use three layers so the first harmful frames are minimized:

1. **Guarded start (default on).** New video, canvas and animated-image elements that are visible start under a light dim (CSS filter on the element) for a short warm-up window (about 500 to 1000 ms) while the detector gathers its first window. If nothing is flagged the dim fades out smoothly (a slow fade, never a flicker).
2. **Look-ahead (stretch, best result).** For same-origin or CORS-readable media, the extension fetches and decodes upcoming frames ahead of playback in an offscreen document and finds flashing sections before the playhead gets there. The player is then dimmed or skipped at exactly that range. This is the only way to truly block before render.
3. **Reaction (always on).** When a violation fires, apply the safe-mode treatment within one frame: pause the video (`video.pause()`), pause animations (`animation.pause()` through the Web Animations API), cover the element with an opaque, static overlay, and announce it to assistive tech.

The overlay:
- Is a static, neutral block with text such as "Flashing content hidden. Press Enter to show." It never animates.
- Is placed in a closed shadow root and, where possible, the browser top layer (`<dialog>` or popover) so the page cannot style it away.
- Is keyboard reachable, has a visible focus ring, meets AA contrast, announces itself with `aria-live="assertive"`, and respects `prefers-reduced-motion`.
- Has a "show anyway" action that requires an explicit user action and stays off for the rest of the session only for that element.

Fail-closed policy: if the detector cannot analyze something (tainted canvas, DRM video, detector crash, CPU budget exceeded), the default is to dim and warn, not to let it through. Users can change this per site.

### 4.4 Sensitivity presets

- **Strict (default):** stricter than WCAG. Flags above 2 flashes per second, lower area threshold, treats any red flash as a violation.
- **WCAG:** the standard thresholds above.
- **Relaxed:** WCAG thresholds, no guarded start.

### 4.5 Cross-origin limits (be honest in the demo)

Browsers block reading pixels from cross-origin media that is not served with CORS. Our options, in order: (1) extension host permissions let the service worker fetch many resources, so we can decode GIFs and progressive MP4 ourselves; (2) for streaming video (MSE, HLS) we fall back to the real-time path plus fail-closed dimming; (3) for DRM video we cannot read pixels, so we apply the unverifiable policy. We state this limit in the README and the pitch instead of hiding it.

### 4.6 Backend (`api/`) and the security feature

- `POST /api/reports`: accepts a signed report from an extension install (domain, timestamp, source type, metrics). No page content, no URLs with paths or query strings, no user identifiers. Reports are validated, size-limited and rate-limited.
- `GET /api/domains`: returns the reputation list: domains with enough independent reports, with a severity and last-seen date. The extension pulls this list and uses it to start flagged domains in strict guarded mode.
- Poisoning defense: a domain is only listed after reports from several distinct installs within a time window, reports are weighted per install, and a listed domain can be contested. This stops an attacker from getting a legitimate site blocked by flooding reports.
- Privacy: the local log is stored on device by default. Reporting is opt-in and sends only the minimal fields above.

## 5. Security work (BUCyS subtrack)

The full model is in `security/THREAT_MODEL.md`. Summary of what we build and show:

- A **threat model** that names the attacks: epilepsy trolling payloads, evasion of the detector, abuse of the reporting system, attacks on the extension itself.
- **Hardening that is demonstrable:** strict CSP, minimal permissions, message origin checks, closed shadow DOM overlay, input validation and rate limiting on the API, no `eval`, no remote code.
- **Adversarial tests:** a set of synthetic "evasion" pages (strobe between samples, below-threshold area, red-only flashes, many tiny iframes to exhaust CPU, page script that tries to remove the overlay) with expected results.
- **Domain logging** that doubles as threat intelligence, with the poisoning defense above.

## 6. Test plan

Important: we never use real seizure-inducing videos from the internet and we do not test on a person who has photosensitive epilepsy. We generate synthetic stimuli in `demo/` and judge them by the numbers the detector prints. Anyone on the team with photosensitivity must not look at the test pages. Keep the test pages' brightness low while developing.

1. **Unit tests (Node):** feed the detector synthetic luminance sequences (3 flashes per second just under the limit, 4 per second over, small area vs large area, slow ramps, red flashes) and assert the output.
2. **Synthetic pages in `demo/`:** canvas strobe, CSS keyframe strobe, JS class-toggle strobe, a generated MP4/GIF at known rates, and a page with several of these at once. Each page declares its expected verdict so we can check the extension automatically.
3. **Cross-check:** compare our numbers on the same synthetic clips against a reference tool such as the Trace Center's PEAT, if the team can run it, and report the agreement honestly.
4. **Performance:** measure CPU cost per video and set a budget; the detector degrades (lower resolution, fail-closed) instead of freezing the page.
5. **Accessibility audit of our own UI:** keyboard only, screen reader (VoiceOver or NVDA), contrast check, reduced motion.

## 7. Demo script (about 3 minutes)

1. Show the problem on a clearly labeled safe-to-view test page (low brightness, warning shown beforehand): flashing without the shield. Keep it very short or show the detector's numbers instead of the visual.
2. Turn the shield on: same page, content is hidden, overlay announced, HUD shows flashes per second and area.
3. Show the three sources (canvas, CSS, video) all caught, plus the GIF look-ahead catching it before it plays.
4. Switch to the security view: the domain log, the reputation list, and one evasion attempt failing.
5. Close with the accessibility story: keyboard-only and screen-reader use of the overlay, and the honest limits slide.

## 8. Timeline

| When | Goal |
|---|---|
| Thu night / Fri | Repo, board issue #1 pinned, everyone logged in with `gh`, agents tested on the board. Read the WCAG definitions. Scaffold the extension (MV3 hello-world loads in Chrome). |
| Sat 12:00 kickoff | Confirm track, finalize the owner table, agree the contracts in `docs/CONTRACTS.md`. |
| Sat 12:30 to 18:00 | Detector core with unit tests. Content script finds video/canvas and runs the detector. CSS animation inspection. Safe mode overlay v1. API skeleton. Attend the BUCyS workshop. |
| Sat 18:00 to 23:00 | End-to-end flow working on synthetic pages. Domain log and report endpoint. Guarded start. Threat model draft. Sleep in shifts. |
| Sat night (remote) | Integration, harness, false-positive check, polish; rehearse twice at 11:00 PM. The venue closes about 7:30 PM. |
| Sun 6:00 AM | Feature freeze. Then the security answer, final README/slides and setup only. Devpost due 9:00 AM, judging 9:30 AM. Current schedule: `docs/RUNBOOK.md`. |

## 9. Scope control

Must have: detector with tests, video + canvas + CSS detection, safe mode overlay, domain log, threat model, demo pages.
Should have: GIF decode and look-ahead, reputation API, strict preset, adversarial test pages.
Could have: WebGL support, viewport-level capture, Firefox build, red-flash tuning against a reference tool.
Do not build: accounts, payments, a dashboard website, anything that needs real user data.

## 10. Risks

- Cross-origin pixel access blocks real-time analysis on many real sites. Mitigation: fail-closed dim, host-permission fetch, and an honest limits slide.
- False positives annoy users. Mitigation: hysteresis, a one-click "show anyway", an allowlist, and sensitivity presets.
- Detector too slow. Mitigation: low-resolution analysis, per-page CPU budget, graceful degradation.
- We misstate WCAG thresholds. Mitigation: someone reads the spec text and signs off before Sunday.
- Over-scoping. Mitigation: the must-have list above and a Sunday 10:00 feature freeze.
