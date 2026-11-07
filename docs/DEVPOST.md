# Devpost draft (paste after the 11:00 PM freeze)

Owner: @unseentrader007 (covering Jun). Numbers in [brackets] come from `node harness/run.mjs` run three times on the frozen build. Refresh them after the freeze and delete anything that didn't ship. Every security claim here must match a passing harness page or test (AGENTS.md section 6).

## Tagline

FlashBan stops flashing web content before it can trigger a seizure, and keeps the page usable while it does.

## Inspiration

About 1 in 4,000 people have photosensitive epilepsy (Fisher et al., Epilepsia 2022), and for them a strobing ad, video or GIF can trigger a seizure. The web has a rule against this (WCAG 2.3.1: no more than three flashes a second), but nothing enforces it in the browser, and by the time you see a strobe it's too late. It's also used as a weapon: "epilepsy trolling", where people send flashing images to someone with epilepsy on purpose, is a crime in England under Zach's Law. We wanted a tool that treats flashing content as both an accessibility barrier and a security threat.

## What it does

FlashBan is a Chrome extension that watches video, canvas, animated images, CSS animations and script-driven flicker on every page, and measures them against the WCAG general-flash and red-flash rules.

- **Softens first.** When something flashes too fast, FlashBan smooths it so it can keep playing: video, canvas and animated images run through a filter (checked again by a second detector), CSS animations slow to about one cycle a second, and flickering elements fade slowly. People aren't interrupted.
- **Covers when it has to.** If softening can't bring the flashing under the limit, FlashBan pauses the content and puts a static panel over it. "Show anyway" brings it back, only when you choose to.
- **Fails closed.** Media it can't read, like DRM or cross-origin video, is dimmed and labelled "can't verify".
- **Fights back.** If a page keeps deleting FlashBan's protection, FlashBan locks the page down with browser-level styles the page can't see or remove, and explains why.
- **Respects privacy.** It keeps a local list of sites that flashed (site and date only), with a Clear my data button and 30-day deletion. There's no account and no server.

## How we built it

- Plain JavaScript, Chrome Manifest V3, no build step and no dependencies.
- A pure detection engine (no DOM) with [146] Node unit tests: a relative-luminance lookup table, per-pixel transition tracking, a one-second sliding window on real timestamps, a red-flash detector in CIE 1976 colour space, and flashing area judged within a 10-degree field of view, as WCAG defines it.
- A content script that samples every rendered frame (`requestVideoFrameCallback`, `requestAnimationFrame`) within a measured CPU budget, a closed-shadow-root overlay in the browser's top layer, and a service worker that validates every message.
- An automated attack harness: it loads the real extension into headless Chrome, runs every demo and attack page, and scores only what the user would actually see. Nothing flashes on anyone's screen while it runs.

## Challenges we ran into

- Pages can delete our overlay faster than the browser paints it. We caught that with our own attack page, and answered with a page lockdown the page can't touch.
- Covering everything made real sites unusable. We moved to "soften first", then had to make sure a page couldn't simply undo the softening (it now counts as tampering).
- Real Chrome stalls on GPU readback. A strict CPU budget dimmed harmless canvases until we measured readback and detection separately.

## Accomplishments we're proud of

- Our harness passes [16 of 16] pages on three runs in a row, including [7] everyday pages (scene cuts, a camera flash, slow fades, a dark-mode toggle, a sunset) that must never be flagged.
- Every evasion we found became a permanent test page.
- Popup and overlay: [0] axe-core violations (WCAG 2.2 AA), full keyboard use, screen-reader announcements, reduced-motion and forced-colours support.

## What we learned

The WCAG flash rules are precise enough to implement, but "protect the user" and "don't break the page" pull in opposite directions. Measuring both, with tests for attacks and for false alarms, was the only way to tune it honestly.

## What's next

Bundle the content scripts so websites can't detect that FlashBan is installed (which could reveal a health condition), a user-started screen-capture mode to check protected video, and a Firefox build.

## Built with

JavaScript, Chrome Extensions (Manifest V3), Web Animations API, Canvas 2D, Node.js test runner, Chrome DevTools Protocol.

## Security question (150–250 words; count before pasting)

**What did we protect, and how?** Using a seizure shield reveals a health condition, and a list of flashing sites shows where someone browses. So FlashBan collects almost nothing: there are no accounts, identifiers or keys, and no server. The only record is a list of site domains and dates on the user's own computer, with a Clear my data button and automatic deletion after 30 days. Three things keep users safe:

1. Protection a page can't switch off. Our cover lives in a closed shadow root. If a page keeps deleting it, FlashBan locks the page down with browser-level styles the page can't see or remove. Our attack page is locked down within [0.9 s], and pages that undo our softening are covered every time.
2. Fail closed. Media we can't check, like DRM or cross-origin video, is dimmed and labelled "can't verify" instead of let through.
3. Untrusted input stays data. We render text with textContent, run no remote code, and validate the sender and shape of every message.

Our automated harness passes [16 of 16] attack and everyday pages on three runs in a row.

**What would we improve next?** Websites can detect that FlashBan is installed by probing its extension files, which could reveal that someone has photosensitive epilepsy. We'd fix this by bundling our scripts into one file so none of them is visible to web pages.
