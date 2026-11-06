# Demo and pitch plan

Owner: @sysoutprntlne. Planning draft, November 6, 2026.
No product behavior has been verified. Main currently contains planning and board tooling, not a loadable extension. Confirm event rules before implementing fixtures or product code.

## Three-minute presentation

| Time | Message | Evidence required before presenting as working |
| --- | --- | --- |
| 0:00–0:25 | Flashing web content creates an accessibility barrier and can be weaponized. Our aim is to reduce exposure. | Static illustration; never surprise the audience with a flashing example. |
| 0:25–1:10 | Show detection and the static safe-mode overlay on one synthetic canvas fixture. | Recorded run with preset, timestamps, detector output, and expected/actual verdict. Use a static evidence slide if unavailable. |
| 1:10–1:40 | Demonstrate the same workflow for CSS and JS-driven content. | Separate verified runs; do not imply coverage from the canvas result. |
| 1:40–2:10 | Show keyboard access, visible focus, a screen-reader announcement, and an explicit reveal action. | Manual keyboard and screen-reader checks against the shipped overlay. |
| 2:10–2:35 | Explain local domain logging and the security threat model. | Local-log evidence. Mention reporting/reputation as implemented only if backend tests exist; otherwise label planned. |
| 2:35–3:00 | State limitations, what passed, and next steps. | Actual test summary. No guaranteed protection or medical-device claims. |

Default to static screenshots, logs, and presenter narration. Live stimuli are optional, require advance warning and explicit operator consent, and must not be shown to an audience without agreement. Low brightness does not establish safety. Do not solicit testing from photosensitive people.

## Six-slide outline

1. **Problem:** web flashing as an accessibility and abuse problem; static visual only.
2. **Approach:** discover content → analyze continuously → guard/cover → explicit reveal. Distinguish reactive detection from pre-render protection.
3. **Evidence:** source, preset, expected verdict, actual verdict, measurement, commit tested. Empty evidence means “not tested.”
4. **Accessible controls:** keyboard, focus, screen reader, reduced motion; include only checked behavior.
5. **Security:** local logging, unreadable-media policy, attack cases; separate built/tested from planned.
6. **Limits and next steps:** cross-origin/DRM limits, initial exposure, false positives/negatives, incomplete coverage. Not a medical device; no guarantee of protection.

## Evidence gate

Before rehearsal, record the tested commit, Chrome version, platform, preset, viewport, zoom, device pixel ratio, fixture parameters, and result for every claimed capability.

| Capability | Current status | Evidence to collect | Owner |
| --- | --- | --- | --- |
| Extension loads unpacked | Not implemented on main | Installation and reload check | @DxubleBTW |
| Canvas / CSS / JS handling | Not tested | Per-source run from acceptance matrix | Demo + detection/core owners |
| Static overlay and explicit reveal | Not tested | Screenshot, keyboard and screen-reader notes | @DxubleBTW |
| Unreadable media fails closed | Not tested | Guard state and reason; security fixture | Core + @unseentrader007 |
| Local domain log | Not tested | Local record without paths or query strings | @DxubleBTW |
| Reputation API / poisoning defense | Planned | Backend validation, rate-limit and distinct-install tests | @unseentrader007 |
| GIF look-ahead | Stretch; not tested | Decoder and pre-playback evidence | Detection/core owners |

## Static fallback

If the extension is unavailable, present this as a design walkthrough. Show architecture and a clearly labeled overlay mockup, not a simulated “working” detector. If the API is absent, omit its live segment and label reputation reporting planned. If a demo fails, stop it and show previously captured evidence labeled with its tested commit. If no evidence exists, say so.

## Next handoffs

- Ask the lead to confirm event rules, source priorities, and the demo environment before implementation.
- Request an existing read-only telemetry path from core; do not create a page-message protocol or change contracts unilaterally.
- Build the three initial fixture specifications in DEMO_ACCEPTANCE.md after kickoff. Add generated media only after the core path works.
- Freeze features around Sunday 10:00 per the runbook; rehearse twice using the presentation machine.
