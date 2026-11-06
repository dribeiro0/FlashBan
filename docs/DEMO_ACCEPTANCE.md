# Demo fixture acceptance plan

Owner: @sysoutprntlne. Draft branch now includes canvas, CSS, DOM, video and static fixtures in demo/. Unit and headless-browser lifecycle checks pass; detector integration, calibration, known encoded video frame durations and screen-reader validation remain outstanding. Specifications below include future work and are not claims of extension coverage.
Scope: demo/ except demo/adversarial/. Security fixtures remain @unseentrader007's responsibility. Do not change docs/CONTRACTS.md or shared build files without the required owner approval.

## Fixture specification

Each future page supplies a short visible description and exactly one existing contract tag: `<meta name="shield-expected" content="block">` or `<meta name="shield-expected" content="allow">`. A tag declares the intended active-run verdict, not a measurement and not proof of safety.

All fixtures start stopped with static content. Separate expected outcomes from measured detector results. Use no real seizure-triggering media, autoplay, or remote assets.

| Priority | Proposed fixture | Source and active-run specification | Expected tag | Acceptance evidence |
| --- | --- | --- | --- | --- |
| P0 | canvas.html | One same-origin canvas; configurable opposing luminance transitions with timestamps; whole visible canvas region toggles. Default design: four complete cycles per second. | block | Actual frame timestamps, calibrated luminance/area, detector verdict, guarded state and latency. |
| P0 | css.html | One element with background-color keyframes; four complete cycles per second; no animation until explicit Start. | block | Computed keyframes/duration, actual playback state, animation-analysis result, static overlay. |
| P1 | dom.html | One element whose class toggles between two fixed states; schedule with real elapsed time, not accumulated frame counts. Four complete cycles per second. | block | Actual mutation timestamps, source attribution, detector verdict and overlay. Mutation count alone is not a flash measurement. |
| P0 | static.html | Same dimensions and static appearance; no changing styles, timers, or drawing loop. | allow | No false violation during a recorded observation window; initial guarded-start treatment is evaluated separately. |
| P1 | slow-canvas.html | One complete cycle per second using the same calibrated general-flash colors and area. | allow | Under agreed strict/WCAG settings: no violation during the observation window. Confirm final preset rules with detection owner. |
| P0 | video.html | Same-origin synthetic video with known frame durations; must-have alongside canvas/CSS, start paused. | block | Playback timestamps, actual detection, guard state and fallback behavior; core + detection owners verify integration. |
| P1 | generated-gif | Synthetic GIF with known frame durations; stretch after must-have paths. | block | Decoder timing, detection and fallback evidence. No look-ahead claim without evidence. |

These are fixture targets, not claims that a chosen color or size meets WCAG thresholds. Before implementation, detection owner must confirm paired transition counting, luminance values, area conversion, preset boundaries, and the test window. A four-cycle target does not guarantee four displayed cycles under load. Record actual timing.

## Controls and exposure constraints

- Persistent warning before any Start control; no flashing previews or thumbnails. Low brightness is not a safety guarantee.
- Explicit opt-in Start, always-visible Stop, Escape to stop, and automatic stop/reset on blur or hidden document. Returning focus never restarts playback.
- Short bounded run (proposed maximum three seconds, subject to owner review), then static state. Never loop indefinitely or repeatedly restart automatically.
- With prefers-reduced-motion enabled, keep visual fixtures static; offer static logs/specifications rather than encouraging an override. Mark active-run validation not performed.
- Do not start a stimulus outside an explicitly operator-approved, bounded acceptance session. Capture measurement data only in an agreed controlled environment; prefer static presentation evidence.
- Controls and page text meet AA contrast, support keyboard operation and visible focus, and have clear labels. Use a polite status announcement only when run state changes, not on each frame.
- Demo Stop affects only the fixture. Never label it as proof that the extension's safety overlay works.

## Controlled integration checks (pending core/lead agreement)

The meta tag alone cannot drive an automatic verdict check while a fixture is stopped. After an operator explicitly consents to a bounded test session, an agreed harness may activate the existing Start control, wait for the documented measurement window, compare the real detector verdict to the tag, then stop. No page-load activation or unattended recurring runs. This is a proposed test procedure, not a new runtime interface; owner approval is required before implementation.

Guarded start needs a separate recorded test: with the operator-approved session active, insert a fresh media element and verify the core guard exists during its first rendered frames and warm-up. Record actual guard/application timing rather than assuming it from the final overlay. Keep the visual covered while collecting diagnostic evidence wherever possible.

Also test an existing element that remains static past warm-up before Start. Its initial guard may already have been released: continuous reaction is required, and first-frame protection cannot be assumed. Track this with the core owner and coordinate with security's late-start test instead of duplicating their fixture. Until evidence exists, disclose this exposure gap in the pitch.

## Verification matrix

Record commit, Chrome/platform, preset, viewport, zoom, device pixel ratio, stimulus parameters, actual timestamps, detector output, result, and evidence location. Leave absent evidence “not tested.”

| Check | Passing observation |
| --- | --- |
| Initial load | Static page, no source animation/timer, warning visible, controls usable. |
| Start consent | Source runs only after deliberate activation; expected-verdict tag remains constant. |
| Stop / Escape / blur / hidden | Source stops, scheduling is canceled, static state restored; no automatic restart. |
| Repeated Start/Stop | At most one active loop; no orphan timers or animations. |
| Reduced motion | Visual run remains disabled/static, with a useful explanation. |
| Keyboard | Start/Stop work without a pointer; focus stays visible and predictable. |
| Screen reader | Source, warning and control state are understandable; no per-frame announcements. |
| Timing | Report actual timestamps and dropped frames; do not derive frequency solely from configured duration. |
| Area and luminance | Detector owner verifies effective area and linear luminance; record the inputs. |
| Shield integration | Actual extension report and guarded element agree with the declared expected active-run verdict. No fabricated HUD values. |
| Clean control | Static fixture has no violation after warm-up during a documented observation window. |
| Missing telemetry | Show “unavailable”; do not substitute fixture settings for detector readings. |

## Open integration questions

1. What existing, read-only mechanism exposes measured FlashReport data to the demo HUD? The current contracts do not define one. Until agreed, use extension diagnostics or captured logs.
2. How does core identify JS-driven elements and attribute guard state? Do not invent selectors, custom events, or message formats.
3. Which final preset thresholds and area interpretation should fixtures target? Spec constants and viewport aggregation still need owner sign-off.
4. What observation and latency acceptance windows does the lead approve? The proposed run duration is not a settled detector requirement.
5. Lead/core must approve the controlled activation procedure and guarded-start evidence above; no automatic checker is currently implemented.
6. Which event rules permit code before kickoff? Keep this work as planning until confirmed.

Security-owned adversarial coverage (unreadable media, overlay removal, late starts, CPU flooding, and split area) is tracked in security/THREAT_MODEL.md; do not duplicate or report it as tested here.
