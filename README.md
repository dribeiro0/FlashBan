# FlashBan

A Chrome extension that finds flashing content on web pages (the WCAG 2.3.1 "three flashes per second" rule) and makes it safe: flashing media is dimmed and turned greyscale until a flash is impossible, the worst flashing is blocked, and animations are slowed. It also treats deliberate strobing ("epilepsy trolling") as a security threat: a page that fights FlashBan gets locked down.

Built by team FlashBan at Hackcessability (Tech Access track; entered in the Built To Be Trusted security award).

> **Not a medical device.** FlashBan reduces exposure to flashing content. It cannot guarantee protection: detection takes a fraction of a second, and media it can't read (DRM or cross-origin video without CORS) can only be dimmed, not checked. Don't rely on it as your only protection.

## What it does

- **Detects** flashing on `<video>`, `<canvas>`, animated images, CSS animations and script-driven flicker, using the WCAG relative-luminance, general-flash and red-flash rules in a sliding one-second window, with real timestamps. WCAG is the default preset; Strict is in the popup.
- **Dims instead of breaking the page:** flashing video, canvas and animated images keep playing, dimmed (94% by default) and in greyscale. That keeps the brightest pixel's change under the 0.10 relative-luminance change a flash needs (about 0.005 at 94%), and with no colour there's no red flash. Motion stays sharp: no trails or blocks.
- **Protection strength slider** in the popup: dim 72%, 80%, 88% or 94%, or block. 72% is a hard floor (about 0.064 maximum change), unit-tested for every step.
- **Blocks the worst:** red flashing, or 6 or more flashes a second, is paused behind a static panel at any strength.
- **Slows and smooths:** CSS animations are slowed and script-driven flicker gets a slow fade. "Show original on this site" is an explicit user choice (trusted clicks only).
- **Re-checks reused players:** on sites that play every video, and every home-page preview, in one `<video>` (YouTube), each new video is judged again under the existing protection, which lifts after 1.5 s of calm frames.
- **Fails closed:** media FlashBan can't check is always dimmed and labelled "can't verify".
- **Locks down hostile pages:** if a page keeps deleting or restyling FlashBan's protection, FlashBan hides the page's media with browser-level styles the page can't remove, shows a banner, and marks the toolbar icon with "!".
- **Keeps a local log** of sites that flashed (domain, dates, count, peak flash estimate and source types), shown in the popup with **Clear my data**. Entries older than 30 days are deleted. The log is not uploaded; there is no FlashBan reporting server. The one network request FlashBan makes: for a cross-origin .webp or .apng image the page is already loading, the extension fetches the file's first bytes without cookies to tell a still image from an animated one, and only a yes/no comes back. It refuses links that point at your own computer or network (localhost, private and link-local ranges), and such images stay dimmed. It doesn't yet stop a public link that redirects to one (see Known limits). GIFs are never probed; they always count as animated.

## Install (unpacked)

1. Clone this repo.
2. Optional: `git checkout final` for the judging build.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/` folder. The toolbar shows FlashBan's eye icon.

## Try it

> **Warning:** the demo pages contain synthetic flashing content (dim, at most a few seconds, only after you press Start). Don't run them if flashing light affects you, and never show them to anyone without warning.

```bash
node demo/serve.mjs
```

Then open http://localhost:8080/ with the extension loaded. For judging, http://localhost:8080/showcase/ is **Grain**, a pretend video site with a video, a canvas, a CSS animation and a script-driven banner on one screen. To check every page against the real extension without anything flashing on screen (headless Chrome):

```bash
node harness/run.mjs
```

Unit tests: `npm test` (Node built-in test runner, no dependencies; 180 tests). Run the harness with the laptop plugged in: on battery, Windows throttling can break the video demo's own in-page recording. To check a real page: `node harness/run.mjs --headed --url <page> --seconds 30 --shots <dir>`.

### Website and download

```bash
node site/build.mjs   # packages extension/ into site/download/flashban-<version>.zip + SHA-256
node site/serve.mjs   # http://localhost:8090/ (the demos are at /demo/)
```

The zip is reproducible: building the same commit always gives the same SHA-256, so anyone can check a download against the source. The site is deployed at https://flashban.vercel.app/ (redeployed from main by the site owner).

## Security

Using a seizure shield reveals a health condition, so FlashBan collects almost nothing: no accounts, no identifiers, no keys, and a local log of domains and basic detector metrics. Threats and mitigations are in the [threat model](security/THREAT_MODEL.md). Test evidence for the judging build (tag `final`, 129e645): `node harness/run.mjs` on our Windows laptop, plugged in, three runs on main `d474896` (same detection), plus one run each on `3b9557c` and `final`. **Every run matched 29 of 29** expected verdicts: **16 attack pages protected**, **8 benign/control pages allowed**. [Full results on the board](https://github.com/dribeiro0/FlashBan/issues/1). These are results for this build and test set, not proof for every website.

- Page that deletes the cover every frame: locked down in 1.22–1.25 s, every run.
- Red-only flashes: blocked in 1.25–1.27 s. Scroll-linked strobe: blocked in 0.42–0.43 s.
- Strobes timed between samples (12.5 and 30 Hz): dimmed in 0.42–0.50 s. Strobe from page load: dimmed in 1.23–1.25 s. Video raised above our layer: dimmed in 1.24–1.27 s.
- Source flip/swap: dimmed in 0.83–1.26 s. CPU flood: dimmed in 1.46–1.52 s. Tainted canvas: dimmed (fail closed). Late start: dimmed about 0.8 s after its strobe begins.
- Pages that undo protection: CSS attack blocked in 0.47–0.83 s; DOM attack locked down in 4.5–4.6 s.
- Video demo: dimmed about 1 s into playback. All 8 benign/control pages allowed in every run (no false positives in this test set).
- Unit-tested: every protection-strength step stays under the flash threshold; the image probe refuses 13 forms of local/private address; every message's sender and shape is validated.

## Accessibility

Checked with axe-core 4.10 (WCAG 2.0, 2.1, 2.2 A and AA plus best practices) using Playwright:

- Popup: 0 violations in light and dark mode, on a fresh install and with the log open.
- Overlay (cover, "can't verify" dim, video check): 0 violations (run before the strength slider; the slider is a native range input with an announced value). Contrast was checked by hand because axe can't read the top layer: overlay text sits on opaque chips, white on #121212 (18:1) and dark on olive (10.0:1).
- Keyboard: the one bypass control, "Show original on this site" in the FlashBan bar at the top right, is a real button (32 px tall, 3 px focus ring) reached with Tab and activated with Enter. Pages can't press it for you (trusted clicks only, closed shadow root). It remembers the site; the popup's per-site switch turns protection back on.
- Covers are announced to screen readers as they appear (`aria-live`); dimmed items carry a "Content dimmed by FlashBan" label but aren't announced. The overlay never flashes, turns its fades off under `prefers-reduced-motion`, and switches to system colours in forced-colours mode.

The overlay's shadow root is closed in the shipped build; the axe run used a test build with it open.

## Known limits

- DRM and cross-origin video (no CORS) can't be measured, only dimmed.
- Websites can detect that FlashBan is installed by probing its extension files, which can reveal a health condition. The fix is bundling the content scripts; not done yet.
- The first frames of a new flash can reach the screen before detection reacts (response time depends on the page, source and machine).
- Content outside the browser isn't covered.
- Whole-screen colour washes (mood-light videos) and moving content get the same dim + greyscale; telling them apart is future work. Slow colour fades can trip the red-flash rule and be dimmed when they needn't be.
- The WebP/APNG still-or-animated probe can be fooled by the image's server (it can tell the probe from the page's own request), and image hosts can see that this browser runs FlashBan. The probe follows redirects, so a public link that redirects to a local address is still fetched; the planned fix is to refuse redirects (the image then stays dimmed). GIFs are never probed, so an animated GIF is always dimmed.
- Flashes split across iframes aren't added together: each frame is judged on its own (the cross-element area sum works within one frame).
- Brightness is computed from sRGB pixel values. HDR, display colour profiles and screen brightness aren't modelled, and the area rule assumes WCAG's typical viewing distance (a 341 by 256 px field at 100% zoom).
- Red flash uses WCAG's formula on linear-light values; tools that use gamma-encoded values can disagree at the edges.
- Near-black has no hue (so video compression noise isn't read as red): a flash between black and a very dark red (sRGB red below about 60) doesn't count as a red flash, though it still counts as an ordinary flash if it is big enough.

More in the threat model's [Known limits](security/THREAT_MODEL.md#known-limits).

## Team

Avery Lee (lead, extension core and safe mode), David Ribeiro (detector and harness), Jun (demo, website, slides), Yaovi (security, adversarial pages, Devpost, presenter). Who did what: [docs/TEAM.md](docs/TEAM.md).

## Team workflow: the agent board

Our coding agents coordinate on a pinned GitHub issue (#1). Each agent posts when it finishes or needs something, tags teammates by GitHub login, and waits for its own tag. Rules for agents are in [AGENTS.md](AGENTS.md). Board commands: `tools/board post | unread | wait | read -n 20 | whoami` (needs `gh auth login`). Based on [azizu06/hackathon-agent-board](https://github.com/azizu06/hackathon-agent-board).
