# FlashBan

A Chrome extension that finds flashing content on web pages (the WCAG 2.3.1 "three flashes per second" rule) and tones it down with dimming, greyscale, slowing or covers to reduce exposure. It also treats deliberate strobing ("epilepsy trolling") as a security threat: a page that fights FlashBan gets locked down.

Built by team FlashBan at Hackcessability (Tech Access track; entered in the Built To Be Trusted security award).

> **Not a medical device.** FlashBan reduces exposure to flashing content. It cannot guarantee protection: detection takes a fraction of a second, and media it can't read (DRM or cross-origin video without CORS) can only be dimmed, not checked. Don't rely on it as your only protection.

## What it does

- **Detects** flashing on `<video>`, `<canvas>`, animated images, CSS animations and script-driven flicker, using the WCAG relative-luminance, general-flash and red-flash rules in a sliding one-second window, with real timestamps. WCAG is the default preset; Strict is in the popup.
- **Tones it down first:** flashing video, canvas and animated images keep playing but are dimmed and turned grey. CSS animations are slowed and script-driven flicker gets a slow fade. Users can choose to hide flashing content instead. A static cover or lockdown protects content when needed; "Show original on this site" is an explicit user choice.
- **Fails closed:** media FlashBan can't check is always dimmed and labelled "can't verify".
- **Locks down hostile pages:** if a page keeps deleting or restyling FlashBan's protection, FlashBan hides the page's media with browser-level styles the page can't see or remove, shows a banner, and marks the toolbar icon with "!".
- **Keeps a local log** of sites that flashed (domain, dates, count, peak flash estimate and source types), shown in the popup with **Clear my data**. Entries older than 30 days are deleted. The log is not uploaded; there is no FlashBan reporting server. The one network request FlashBan makes: for a cross-origin .webp or .apng image the page is already loading, the extension fetches the file's first bytes without cookies to tell a still image from an animated one, and only a yes/no comes back. GIFs are never probed; they always count as animated.

## Install (unpacked)

1. Clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/` folder.

## Try it

> **Warning:** the demo pages contain synthetic flashing content (dim, at most a few seconds, only after you press Start). Don't run them if flashing light affects you, and never show them to anyone without warning.

```bash
node demo/serve.mjs
```

Then open http://localhost:8080/ with the extension loaded. For judging, http://localhost:8080/showcase/ is **Grain**, a pretend video site with a video, a canvas, a CSS animation and a script-driven banner on one screen. To check every page against the real extension without anything flashing on screen (headless Chrome):

```bash
node harness/run.mjs
```

Unit tests: `npm test` (Node built-in test runner, no dependencies).

### Website and download

```bash
node site/build.mjs   # packages extension/ into site/download/flashban-<version>.zip + SHA-256
node site/serve.mjs   # http://localhost:8090/ (the demos are at /demo/)
```

The zip is reproducible: building the same commit always gives the same SHA-256, so anyone can check a download against the source. The site isn't published yet.

## Security

Using a seizure shield reveals a health condition, so FlashBan collects almost nothing: no accounts, no identifiers, no keys, and a local log of domains and basic detector metrics. Threats and mitigations are in the [threat model](security/THREAT_MODEL.md). Current canonical test evidence: `node harness/run.mjs`, three runs on main `0c610e2` after dim + greyscale shipped, on the team's slower Windows laptop. Each run matched **29 of 29** expected verdicts: **16 attack pages protected**, **8 benign/control pages allowed**. [Full results on the board](https://github.com/dribeiro0/FlashBan/issues/1#issuecomment-6718973934). These are results for that build and test set, not proof for every website. The final demo tag still needs its own verification.

- Page that deletes the cover every frame: locked down in 1.24–1.25 s.
- Pages that undo protection: CSS attack covered in 0.42–0.43 s; DOM attack locked down in 1.7–4.5 s.
- Aliasing, red-only, delayed-start, source-flip/swap, CPU-flood and tainted-canvas attacks: protected by dimming. That three-run table records their end state, not time to first dim.
- Video and canvas demos: dimmed. CSS demo: slowed in 0.42–0.43 s; DOM demo: softened in 1.23–1.24 s.
- All 8 benign/control pages allowed in all three runs (24 allow verdicts, no false positives in this test set).

## Accessibility

Checked with axe-core 4.10 (WCAG 2.0, 2.1, 2.2 A and AA plus best practices) using Playwright:

- Popup: 0 violations in light and dark mode, on a fresh install and with the log open.
- Overlay (cover, "can't verify" dim, video check): 0 violations. Contrast was checked by hand because axe can't read the top layer: overlay text sits on opaque chips, white on #121212 (18:1) and dark on olive (10.0:1).
- Keyboard: the one bypass control, "Show original on this site" in the FlashBan bar at the top right, is a real button (32 px tall, 3 px focus ring) reached with Tab and activated with Enter. Pages can't press it for you (trusted clicks only, closed shadow root). It remembers the site; the popup's per-site switch turns protection back on.
- The overlay announces itself to screen readers (`aria-live`), never flashes, turns its fades off under `prefers-reduced-motion`, and switches to system colours in forced-colours mode.

The overlay's shadow root is closed in the shipped build; the axe run used a test build with it open.

## Known limits

- DRM and cross-origin video (no CORS) can't be measured, only dimmed.
- Websites can detect that FlashBan is installed by probing its extension files, which can reveal a health condition. The fix is bundling the content scripts; not done yet.
- The first frames of a new flash can reach the screen before detection reacts (response time depends on the page, source and machine).
- Content outside the browser isn't covered.
- The WebP/APNG still-or-animated probe can be fooled by the image's server (it can tell the probe from the page's own request), and image hosts can see that this browser runs FlashBan. GIFs are never probed, so an animated GIF is always dimmed.
- Flashes split across iframes aren't added together: each frame is judged on its own (the cross-element area sum works within one frame).
- Brightness is computed from sRGB pixel values. HDR, display colour profiles and screen brightness aren't modelled, and the area rule assumes WCAG's typical viewing distance (a 341 by 256 px field at 100% zoom).
- Red flash uses WCAG's formula on linear-light values; tools that use gamma-encoded values can disagree at the edges.
- Near-black has no hue (so video compression noise isn't read as red): a flash between black and a very dark red (sRGB red below about 60) doesn't count as a red flash, though it still counts as an ordinary flash if it is big enough.

More in the threat model's [Known limits](security/THREAT_MODEL.md#known-limits).

## Team workflow: the agent board

Our coding agents coordinate on a pinned GitHub issue (#1). Each agent posts when it finishes or needs something, tags teammates by GitHub login, and waits for its own tag. Rules for agents are in [AGENTS.md](AGENTS.md). Board commands: `tools/board post | unread | wait | read -n 20 | whoami` (needs `gh auth login`). Based on [azizu06/hackathon-agent-board](https://github.com/azizu06/hackathon-agent-board).
