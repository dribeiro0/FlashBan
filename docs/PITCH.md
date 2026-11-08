# FlashBan pitch: slides and speaker notes

For: Yaovi (@unseentrader007), presenter. Prepared by Jun (@sysoutprntlne).
Judging: Sunday 9:30 AM. Track: Tech Access, plus the Built To Be Trusted security award. Criteria: Accessibility Impact, Technical Depth, Design, Presentation, Creativity.
Behavior matches the dim + greyscale build. Evidence below is Yaovi’s three-run table on main `0c610e2` (board comment 6718973934): 29/29 pages, 16 attack pages and 8 benign/control pages. The final demo tag is still awaiting the lead/backup decision; re-check these numbers on that tag before judging. Bracketed driver cues are not spoken claims.

## How to use this

- **3 minutes, 6 slides.** Spoken notes: 314 words (about 126 seconds at 150 words/minute), leaving time for short demo holds. Actual timing must be rehearsed; cut words rather than the warning or limits.
- **You talk, Jun drives the laptop.** Lines in *[brackets and italics]* are cues for the driver, not things to say.
- **Safety first.** Say the warning on slide 2 before anything moves on screen. If anyone asks us not to show flashing, the driver shows the screenshots instead. That is still a complete pitch.
- **Never claim more than we have.** FlashBan is not a medical device and doesn't guarantee protection. Say "reduces", "softens", "catches", never "prevents seizures".

Words you might hear, in plain terms:

| Word | Meaning |
|---|---|
| Photosensitive epilepsy | Flashing or flickering light can cause a seizure. About 1 in 4,000 people have it. |
| WCAG 2.3.1 | The web accessibility rule: nothing should flash more than three times in any one second over a large part of the screen. |
| Soften | Video/canvas/animated images stay playing but are dimmed and turned grey. CSS animations are slowed; script-driven flicker is smoothed. |
| Cover | When softening isn't enough, we pause it and put a plain panel over it. |
| Lockdown | If a page keeps attacking our protection, we dim the whole page with styles the page can't touch. |
| Fail closed | If we can't check something, we dim it to be safe instead of letting it through. |
| Harness | Our automated test: it opens every test page in Chrome with FlashBan on and checks what a user would actually see. |
| Epilepsy trolling | Sending flashing images to people with epilepsy on purpose. It's a crime in England under Zach's Law. |

---

## Slide 1: The problem (0:00 to 0:25)

**On the slide:** "FlashBan". One line: "For 1 in 4,000 people, a flashing screen can cause a seizure." A still image only.

**Say:**
> About one in four thousand people have photosensitive epilepsy. A flashing ad or video can become an accessibility barrier, or a deliberate attack. FlashBan is a Chrome extension that detects flashing content and tones it down while keeping the page usable.

---


## Slide 2: Soften, don't break the page (0:25 to 1:10)

**On the slide:** "FlashBan detects flashing and tones it down to reduce exposure."

**Say first, before anything moves:**
> Warning: the next test contains flashing light. If anyone would rather not see it, we’ll use the static screenshots instead.

*[Driver: open the canvas demo page with the HUD open beside it. Press Start. FlashBan dims it and turns it grey. Point at the HUD estimates.]*

**Say:**
> This synthetic canvas flashes four times a second. FlashBan dims it and turns it grey; motion keeps playing while brightness changes are reduced. The HUD shows detector estimates, not measurements of your display.
> We also slow CSS animations and smooth script-driven flicker. Users can choose to hide flashing content instead.

**If the live demo fails:** *[Driver: show the screenshot.]* "Here's the same test from last night."

---


## Slide 3: Tested across sources and everyday pages (1:10 to 1:40)

**On the slide:** two columns. "Caught: video, canvas, animated images, CSS animations, flickering page elements." "Not flagged: scene cuts, a camera flash, slow fades, dark mode, a sunset."

**Say:**
> We tested the real extension in Chrome: 29 of 29 pages passed three runs on build 0c610e2. All 16 attack pages were protected, and eight everyday or control pages were left alone. That’s zero false alarms in this test set.
> Protected or unreadable video stays dimmed and labelled, rather than being silently allowed.

---


## Slide 4: Security: a page can't switch it off (1:40 to 2:10)

**On the slide:** "Epilepsy trolling is an attack. We test FlashBan like a security tool." Three bullets: "Attack pages for every trick we found", "Lockdown when a page fights back", "No accounts, no server, data stays on your computer".

*[Driver: open the overlay-killer attack page and press Start.]*

**Say:**
> This page repeatedly deletes our protection. FlashBan notices and applies browser-level lockdown styles. Our test reached lockdown in about 1.25 seconds on that build.
> Privacy is built in: no extension accounts or reporting server. Domains and basic detector metrics stay in a local log, with one-click clearing and 30-day deletion.

---


## Slide 5: Built for the people who need it (2:10 to 2:35)

**On the slide:** "Keyboard. Screen reader. Reduced motion. Never flashes itself."

*[Driver: put the mouse down. Tab to the "Show original on this site" button on FlashBan's bar at the top right and press Enter.]*

**Say:**
> The popup and bypass are designed for keyboard use, with visible focus. Protection announces itself to screen readers and respects reduced motion. Automated checks found zero violations in the tested popup states; the overlay has a previous test-build check. Manual accessibility checks still matter.

---


## Slide 6: Honest limits, and what's next (2:35 to 3:00)

**On the slide:** "Not a medical device." Limits: "Protected and cross-origin video can't be measured, so it's dimmed." "The first frames of a new flash can reach the screen before detection reacts." "Websites can detect that FlashBan is installed." Next: "Hide FlashBan from websites, check protected video by screen capture, Firefox."

**Say:**
> FlashBan reduces exposure; it is not a medical device or a guarantee. First frames can reach the screen before detection reacts. DRM and cross-origin video may only be dimmed. Websites can currently detect the extension, potentially revealing a health condition.
> Our next steps are reducing that fingerprinting risk, improving protected-video analysis, and supporting Firefox. Thank you.

---


## One-minute security demo (for the Built To Be Trusted judges)

*[Driver: overlay-killer page, HUD optional.]*

> A troll controls the page, so they can run code against us. This page tries to delete FlashBan's protection many times a second. *[Start.]* FlashBan counts the attacks, and after a few it locks the whole page down with styles from the browser itself, which the page can't see or remove. Our overlay-killer test reaches lockdown in about 1.25 seconds on build 0c610e2, and the badge on the FlashBan icon shows why.
> We also tested pages that undo our softening; they get covered or locked down every time. Every one of these attacks is in our automated test, and on build 0c610e2 it passes 29 of 29 pages three runs in a row, including all 16 attack pages.

---

## Likely questions

| Question | Answer |
|---|---|
| Did you test it on people with epilepsy? | No, and we never would; it would be unsafe. We only use patterns we generated, and we check the detector's numbers against the WCAG formulas. |
| Does it work on YouTube? | Yes for detection on the page itself, but much video comes from other servers or is protected, and then we can't read the pixels. In that case we dim it instead of guessing. |
| How fast does it react? | It depends on the source, page and machine. The overlay-killer test reached lockdown in about 1.25 seconds on build 0c610e2; that is not a universal reaction-time guarantee. |
| Does it slow my browser? | It checks a small, shrunk copy of each frame and measures its own cost. If it can't keep up, it dims what it couldn't check instead of freezing the page. |
| What data do you collect? | The local log keeps domains, dates, counts and basic detector metrics, with "Clear my data" and 30-day deletion. It is not uploaded. An image-animation probe can contact the image host; that privacy limit is documented. |
| Where are your API keys? | There are none. No server, no accounts, no secrets. |
| How would a screen-reader user use it? | There's no login. Everything works by keyboard, and the overlay announces itself to screen readers. |
| Why not just stop all animation? | That breaks most of the web. We only step in when something actually flashes too fast, and we soften rather than remove. |

If you don't know: "Good question, Jun or Avery built that part," and hand over.
