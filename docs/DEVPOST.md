# Devpost: as submitted (final build, tag `final` = 129e645)

Owner: @unseentrader007. This is the exact text David submitted on Sun Nov 8 (story, the 'What does your project do?' answer, and the two security answers), with one correction made before the deadline: the attack list says 'a flashing layer over a calm video' (a harness page) instead of 'a big flash split into tiles' (unit-tested, not a harness page). Numbers: harness 29/29 every run (3x on d474896, 1x each on 3b9557c and final), 180 unit tests.

---

# Project story

## Inspiration

Around **50 million people** live with epilepsy, and seizures aren't just frightening, they're dangerous: losing control during one can mean a fall, an injury, or a seizure that won't stop. People with epilepsy face **up to three times the risk of dying early** (WHO), and sudden unexpected death in epilepsy takes about **1 in 1,000 adults with epilepsy every year** (AAN/AES, 2017). The risk grows with every seizure: frequent major seizures are the biggest known risk factor (American Epilepsy Society). So every seizure that never happens matters.

For 3 to 5% of people with epilepsy, **flashing light is a trigger**, and screens are where it reaches them. In 1997, one strobing scene in a *Pokémon* episode sent **685 people in Japan to hospital** in a single evening.

It's also used as a weapon. In November 2019, during Epilepsy Awareness Month, **at least 30 accounts** flooded the Epilepsy Foundation's Twitter hashtags with strobing GIFs designed to cause seizures. "Epilepsy trolling" is now a crime in England under Zach's Law.

The web already has a rule against this: **WCAG 2.3.1**, no more than three flashes in any one second over a large part of the screen. But nothing enforces it in the browser, and by the time you see a strobe, it's too late. So we treated flashing content as two things at once: an **accessibility barrier** to remove, and a **security threat** to defend against.

## What it does

**FlashBan** is a Chrome extension that watches everything that can flash on a page (video, canvas, animated images, CSS animations and script-driven flicker), measures it against the WCAG general-flash and red-flash rules, and makes it safe while keeping the page usable.

- **Dims instead of breaking the page.** Flashing media keeps playing, but it is dimmed (94% by default) and turned greyscale. That makes a flash *arithmetically impossible*: the brightest pixel left can't change enough to count as one, and with no colour there's no red flash. Motion stays sharp, so you can still follow the video.
- **You choose how strong.** A **Protection strength** slider in the popup sets the dim from 72% to 94%. It can't go lighter than the level that still can't flash, and its top step blocks instead.
- **Blocks the worst.** Red flashing (the most provoking kind) and very fast flashing (6 or more a second) are paused behind a static panel.
- **Slows and smooths the rest.** Flashing CSS animations slow to about one cycle a second, and flickering page elements fade slowly instead of blinking.
- **Fails closed.** Media it can't read, like DRM or cross-origin video, is dimmed and labelled "can't verify" instead of let through.
- **Fights back.** If a page keeps deleting FlashBan's protection, FlashBan locks the page down with browser-level styles the page can't see or remove.
- **Stays out of the way.** One slim bar says what FlashBan is doing ("Dimming 2 items on this page") and has a single "Show original on this site" button, which only real clicks can press.
- **Respects privacy.** No account, no server, no tracking. It keeps only a local list of sites that flashed (domain, date and detector numbers), deleted after 30 days or with one click.

## How we built it

**A pure detection engine.** The detector has no DOM and no browser APIs, so it runs and is tested in Node. For every sampled pixel it computes WCAG relative luminance through a lookup table:

$$L = 0.2126\,R + 0.7152\,G + 0.0722\,B \quad\text{(linear-light } R,G,B\text{)}$$

A **general flash** is a pair of opposing luminance changes of at least $0.10$, where the darker state is below $0.80$. Content violates when there are more than 3 flashes in any one-second window over more than $21{,}824$ CSS px, which is 25% of WCAG's $341 \times 256$ px field. A **red flash** is a transition involving a saturated red ($R/(R+G+B) \ge 0.8$) with a chromaticity change of more than $0.2$ in CIE 1976 $u'v'$.

Getting this right took more than the formula:
- **Real timestamps, not frame counts**, so a slow computer can't make a strobe look slower than it is.
- **Every rendered frame** is sampled (`requestVideoFrameCallback`, `requestAnimationFrame`), because sampling on a timer lets a strobe hide between samples.
- **Flashing area is added up across elements**, so a big flash split into small tiles still counts.
- **The edges are pinned by tests:** 2.99 Hz passes and 3.01 Hz fails; a tie on the area threshold passes.

**Why dimming is safe.** The dim layer leaves at most a fraction $1-d$ of each pixel's brightness, where $d$ is the dim. The biggest possible change is then from black to the brightest remaining value:

$$\Delta L_{\max} = \text{lin}(1-d) \;\Rightarrow\; d = 0.94:\ \Delta L_{\max} \approx 0.005, \qquad d = 0.72:\ \Delta L_{\max} \approx 0.064$$

Both are below the $0.10$ a flash needs, so the 72% floor is a hard minimum. A unit test checks every slider step against it.

**The extension.** Plain JavaScript and Chrome Manifest V3, with no build step and no dependencies:
- A content script finds media, reads frames within a measured CPU budget, and fails closed if it can't keep up.
- The overlay lives in a **closed shadow root in the browser's top layer**, so page styles can't reach it.
- A service worker checks the sender and the shape of every message.
- Detection costs about 0.14 to 0.35 ms per frame.

**An automated attack harness.** It loads the real extension into headless Chrome, runs every demo and attack page, and scores only what a user would actually *see*. Nothing flashes on anyone's screen while it runs. It also has a mode for checking real sites, which we used on YouTube.

**Design.** Our own interface follows the rule it enforces: nothing blinks. FlashBan's labels, the popup, the website and our Grain demo site share one calm, dark, low-contrast "dither" look. All test stimuli are synthetic, dim grey, start only when you press Play, and carry a warning.

## Accessibility

Accessibility is the product, so we held FlashBan's own interface to the same standard:
- **0 axe-core violations** (WCAG 2.2 AA) on the popup and overlay.
- **Works by keyboard alone**, with a visible focus ring. The strength slider uses arrow keys, Home and End.
- **Screen readers:** covers are announced as they appear, dimmed items carry a "Content dimmed by FlashBan" label, and the slider reads out each step and what it does.
- **High contrast:** overlay text sits on solid chips, white on near-black (18:1) and dark on olive (10:1).
- **Reduced motion and forced colours** are supported. Labels may ease in once, slowly; anything that hides content appears at once, never faded in.
- **No login**, no CAPTCHA, nothing to set up. Install it and it protects you.

## Security: built to be trusted

Using a seizure shield **reveals a health condition**, and a list of flashing sites shows where someone browses. So our main protection is collecting almost nothing:
- No accounts, identifiers, API keys or server.
- The only record is site domains, dates and detector numbers, kept on the user's computer, deleted after 30 days or with Clear my data.
- The one network request reads the first bytes of an image the page is already loading, without cookies. It refuses any address on the user's own computer or network, so a page can't use FlashBan to probe a router.

We modelled attackers and built a page for each attack. **16 attack pages** cover:
- strobes timed between samples (12.5 Hz and 30 Hz)
- a flashing layer over a calm video
- red-only flashes
- strobes that start late or at page load
- flipping a video between strobe and calm sources
- scroll-linked strobes
- a page raising its video above our layer
- tainted canvases
- CPU floods
- pages that delete our overlay or undo our slowing

**Result: all 16 protected and all 8 everyday pages left alone, 29 of 29 pages, in every run of our harness.** The overlay-killer attack is locked down in about 1.25 s, every time.

## Challenges we ran into

- **Pages can delete our overlay faster than the browser paints it.** We caught this with our own attack page and answered with a page lockdown the page can't touch.
- **Smoothing video frame by frame doesn't work.** On real videos, a fast-moving bright object looks exactly like a flash to a single pixel, so every filter we tried left trails, blocks or ghosts. We switched to dim + greyscale, which is safe by arithmetic and keeps motion sharp.
- **Sites reuse one video player.** YouTube plays every video, and every home-page preview, in the same element, so our first version kept one video's verdict for all the next ones. Now each new video is checked again under the existing protection.
- **Real laptops are messy.** On battery, Windows throttling broke our own test recordings, and GPU readback stalls dimmed harmless canvases until we measured readback and detection separately.

## Accomplishments we're proud of

- **16 of 16 attacks protected, 0 of 8 everyday pages flagged**, 29 of 29 pages in every harness run, with protection 0.4 to 1.7 s after a strobe starts on the pages we time.
- **Safe by construction:** at every slider setting, a dimmed video can't produce a flash, and a unit test proves it for each step.
- **180 unit tests**, and every evasion we found became a permanent attack page.
- A fully accessible interface (0 axe violations), and a privacy design with nothing to leak.

## What we learned

The WCAG flash rules are precise enough to implement, but "protect the user" and "don't break the page" pull in opposite directions. Measuring both was the only honest way to tune it: tests for attacks, tests for false alarms, and real videos. We also learned that the simplest safe answer (dim it until a flash is impossible) beat clever filtering.

## Known limits

- FlashBan is **not a medical device**: it reduces exposure and can't guarantee protection.
- The first frames of a new flash can reach the screen before it reacts.
- DRM and cross-origin video can only be dimmed, not measured.
- Websites can detect that FlashBan is installed by probing its files, which could reveal a health condition.
- Apps and video outside Chrome aren't covered.

## What's next

- Bundle our scripts so websites can't detect FlashBan.
- Tell a whole-screen colour wash (mood lights) apart from moving content, so each gets the best treatment.
- A user-started screen-capture mode to check protected video.
- A Firefox build.

## Built with

JavaScript, Chrome Extensions (Manifest V3), Web Animations API, Canvas 2D, WebGL, Node.js test runner, Chrome DevTools Protocol.

---

# What does your project do? Who does it benefit? How?

**What it does.** FlashBan is a free Chrome extension that finds flashing content as you browse (video, GIFs, canvas, CSS animation and flickering page elements) and makes it safe before it can do harm. It measures every rendered frame against the web's own flash rule, WCAG 2.3.1: no more than three flashes in a second over a large area. Anything over the limit keeps playing but is dimmed (94% by default) and turned greyscale. That makes a flash arithmetically impossible: the brightest change left is about 0.005 in relative luminance, against the 0.10 a flash needs. Red flashing, the most provoking kind, and very fast flashing are blocked outright. Media it can't measure is dimmed and labelled, never let through.

**Who it benefits.** About 50 million people have epilepsy (WHO), and 3–5% of them are photosensitive, so flashing light can trigger their seizures. That's roughly 1.5 to 2.5 million people. It also helps parents and caregivers, and anyone targeted by "epilepsy trolling", where strobing images are sent on purpose to cause seizures. That's now a crime in England.

**How.** The web's rule exists, but nothing enforces it in the browser, and reduced-motion settings only work when sites choose to honour them. FlashBan enforces the rule itself, on every site, with no setup and no account:
- It's built to resist attackers. 16 attack pages, including strobes timed between samples, red-only flashes and pages that delete our protection, were all protected in every test run. A page that keeps removing FlashBan is locked down in about 1.25 s.
- It stays out of the way: 0 of 8 everyday pages flagged, an adjustable strength slider, and one-click "Show original on this site".
- It's private by design. Using it reveals a health condition, so it collects almost nothing: a local list of sites that flashed, deleted after 30 days, and no server.

FlashBan reduces exposure; it isn't a medical device and can't guarantee protection. Detection takes a fraction of a second, and protected video like Netflix can only be dimmed, not measured.

---

# Security (Built To Be Trusted)

### What did we protect, and how?

**The data:** an accessibility need. Installing a seizure shield reveals photosensitive epilepsy, a health condition, and a list of flashing sites shows where someone browses. So FlashBan keeps almost nothing: no account, name, identifier, key or server. It stores only the user's settings and a list of site domains, dates and detector numbers, locally in Chrome's extension storage, never uploaded, deleted after 30 days or with one click.

**Three things we built to keep users safe:**

1. **Protection a page can't switch off.** Our overlay lives in a closed shadow root in the browser's top layer. If a page keeps deleting it, FlashBan locks the page down with browser-level styles the page can't remove: in about 1.25 s, in every test run. All 16 of our attack pages were protected.
2. **Fail closed, safe by construction.** By default, media we can't check is dimmed, not let through, and dimmed media can't flash: the strength slider never goes below that floor (unit-tested).
3. **Untrusted input stays data.** Text is rendered with textContent, there's no remote code, every message's sender and shape is checked, and our one network request refuses addresses on the user's own computer or network.

None of this adds a login, CAPTCHA or extra step.

### What would we improve next?

Websites can detect FlashBan by probing its extension files, which could reveal someone's epilepsy. We'd fix this by bundling our scripts into one file and exposing nothing to web pages.
