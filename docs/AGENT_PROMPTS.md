# First prompts for each teammate's agent

Paste the one for your role into your coding agent at kickoff (Claude Code, Codex, Cursor, anything that can run shell commands). Replace the name in brackets. Each one makes the agent read the rules, claim its area on the board, and stay in the tag loop.

## Shared opening (put this at the top of every prompt)

> Read AGENTS.md, docs/PROJECT_PLAN.md, docs/CONTRACTS.md and security/THREAT_MODEL.md. Run `tools/board whoami` and `tools/board unread`. Post a short intro on the board saying what you own and what you'll build first, starting with `[<MyName>'s <Agent>]`. Then start one background `tools/board wait` and re-arm it every time it returns. Only edit folders I own per the owner table. When you finish something another owner depends on, post it and tag them. When you need something from another area, tag that owner and keep working on something else until they reply.

## Detection engine (David)

> Build `extension/src/detect/` per docs/CONTRACTS.md section 1. Start with the sRGB-to-luminance lookup table and a general-flash counter using per-pixel extremum tracking and a 1000 ms sliding window, then the red-flash detector, then `analyzeAnimation`. Write Node unit tests with synthetic sequences (3 Hz pass, 4 Hz fail, small vs large area, slow ramp, red-only). Post on the board and tag @DxubleBTW as soon as `createDetector` passes its tests so the content script can wire it in.

## Extension core + safe mode (Avery)

> Scaffold the MV3 extension: manifest with minimal permissions and strict CSP, content script, background service worker, popup. Implement `guard/release` safe mode (closed shadow root, static overlay, keyboard reachable, aria-live announcement, reduced motion) and guarded start for new media. Find video/canvas elements with a MutationObserver and sample them with requestVideoFrameCallback / requestAnimationFrame. Until the real detector lands, use a stub that returns `severity: "none"`. Send `violation` messages to the background and keep the local domain log. Tag @dribeiro0 if you need the detector API changed and @LOGIN3 when the message format is ready for review.

## Security + backend (LOGIN3)

> Build `api/` per docs/CONTRACTS.md section 5: POST /api/reports with strict schema validation, 2 KB limit, rate limiting, and GET /api/domains with the distinct-install threshold. Keep security/THREAT_MODEL.md current (update the Status column). Build the adversarial pages in demo/adversarial/ listed in the threat model. Review the extension's manifest, CSP and message handling and post findings tagging @DxubleBTW.

## Demo + docs (LOGIN4)

> Build synthetic demo pages in demo/ (canvas strobe, CSS keyframe strobe, JS class toggle, generated GIF/MP4 at known rates, a mixed page, and a safe control page), each with `<meta name="shield-expected">`, a visible warning, and low brightness. Build a small HUD that shows the detector's numbers. Draft the README (what it does, how to install unpacked, limits, not a medical device) and the 3-minute demo script from docs/PROJECT_PLAN.md section 7. Tag @all when the demo pages are ready so everyone can test against them.
