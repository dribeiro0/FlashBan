# Threat model: Photosensitive Seizure Shield

## Assets

1. The user's physical safety (the main asset: harm here is a seizure, not data loss).
2. The integrity of the detector and the safe-mode overlay.
3. The user's browsing privacy (what domains they visit).
4. The integrity of the shared domain reputation list.

## Threat category: content-based denial of safety

An attacker uses ordinary web content as the payload. Nothing is "hacked" in the usual sense: the browser renders exactly what it was told to, and the harm is physical. This is a real, documented attack pattern ("epilepsy trolling") delivered through posts, GIFs, avatars and pages.

## Adversaries

| Adversary | Goal | Capability |
|---|---|---|
| Troll / harasser | Trigger a seizure in a target or a community | Posts GIFs, videos, links; controls a page |
| Evasive page author | Deliver strobing content past the shield | Full control of page HTML, CSS, JS |
| Report poisoner | Get a legitimate site blocked, or get their own site removed from the list | Can run many extension installs or call the API directly |
| Malicious page vs. extension | Read user data through the extension, or disable it | Runs script in the same tab as the content script |

## Threats and mitigations (STRIDE-style)

| # | Threat | Mitigation | Status |
|---|---|---|---|
| T1 | Strobe timed between our samples (aliasing) | Sample every rendered frame with `requestVideoFrameCallback` / `requestAnimationFrame`, never on a slow timer; use timestamps not frame counts | planned |
| T2 | Split a large flash into many small elements each under the area threshold | Aggregate flashing area across elements in the same viewport and window, not per element | planned |
| T3 | Red-only flashes that pass the luminance check | Separate red-flash detector | planned |
| T4 | Hide pixels from analysis (cross-origin video, tainted canvas, DRM, WebGL buffer cleared) | Fail closed: unreadable visible media is dimmed and labeled "can't verify" | planned |
| T5 | CPU exhaustion: hundreds of videos/iframes so the detector falls behind | Per-page budget; when exceeded, fail closed on everything not yet verified | planned |
| T6 | Page script removes or restyles the overlay | Closed shadow root, top-layer placement, `MutationObserver` that re-applies the guard, guard state kept in the isolated content-script world | planned |
| T7 | Page script spoofs messages to the extension | Background only trusts `chrome.runtime` messages from our own extension id; shape validation on every message | planned |
| T8 | Flashing starts after a long safe intro to get past guarded start | Detection runs continuously, not only at start | planned |
| T9 | Report poisoning to list a legitimate domain | Listing needs several distinct installs in a window; per-install weighting and rate limits; contest path | planned |
| T10 | Spam or oversized reports against the API | Strict schema, 2 KB limit, rate limiting by IP and install id, reject unknown fields | planned |
| T11 | Privacy leak through reports | Only registrable domain + metrics are sent, never URLs, page content, or personal identifiers; reporting is opt-in | planned |
| T12 | Supply-chain or remote code in the extension | No remote scripts, no `eval`, strict MV3 CSP, pinned dependencies | planned |
| T13 | The overlay itself harms the user (flicker on show/hide) | Overlay is static; transitions are slow fades or none under `prefers-reduced-motion` | planned |

Update the Status column (planned, built, tested) as work lands. Judges should be able to see which ones we actually tested.

## Adversarial test pages (in `demo/adversarial/`)

1. `aliasing.html`: 15 Hz strobe that lines up with a 30 Hz timer.
2. `split-area.html`: 16 small canvases flashing in sync.
3. `red-only.html`: saturated red flashes with little luminance change.
4. `late-start.html`: 10 s calm, then strobe.
5. `overlay-killer.html`: script that deletes and hides our overlay elements in a loop.
6. `cpu-flood.html`: 200 hidden and visible videos.
7. `tainted.html`: cross-origin canvas we can't read (expect dim + "can't verify").

Each page states its expected result. A pass means the shield blocks or fails closed.

## Out of scope (say so in the pitch)

- Content in native apps or outside the browser.
- Guaranteed protection: the shield reduces risk, it is not a medical device. The README and the popup must say this.
