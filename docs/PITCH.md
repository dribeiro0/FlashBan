# FlashBan pitch: slides and speaker notes

For: Yaovi (@unseentrader007), presenter. Prepared by Jun (@sysoutprntlne).
Judging: Sunday 9:30 AM. Track: Tech Access, plus the Built To Be Trusted security award. Criteria: Accessibility Impact, Technical Depth, Design, Presentation, Creativity.
Everything here matches what shipped (README.md, docs/DEVPOST.md). Numbers in [brackets] are filled from the harness run on the frozen build. If a number is still in brackets on Sunday morning, leave that sentence out.

## How to use this

- **3 minutes, 6 slides.** About 30 seconds each. Say the notes in your own words; you don't need to memorise them.
- **You talk, Jun drives the laptop.** Lines in *[brackets and italics]* are cues for the driver, not things to say.
- **Safety first.** Say the warning on slide 2 before anything moves on screen. If anyone asks us not to show flashing, the driver shows the screenshots instead. That is still a complete pitch.
- **Never claim more than we have.** FlashBan is not a medical device and doesn't guarantee protection. Say "reduces", "softens", "catches", never "prevents seizures".

Words you might hear, in plain terms:

| Word | Meaning |
|---|---|
| Photosensitive epilepsy | Flashing or flickering light can cause a seizure. About 1 in 4,000 people have it. |
| WCAG 2.3.1 | The web accessibility rule: nothing should flash more than three times in any one second over a large part of the screen. |
| Soften | We smooth the flashing out so the video or animation keeps playing, just without the strobe. |
| Cover | When softening isn't enough, we pause it and put a plain panel over it. |
| Lockdown | If a page keeps attacking our protection, we dim the whole page with styles the page can't touch. |
| Fail closed | If we can't check something, we dim it to be safe instead of letting it through. |
| Harness | Our automated test: it opens every test page in Chrome with FlashBan on and checks what a user would actually see. |
| Epilepsy trolling | Sending flashing images to people with epilepsy on purpose. It's a crime in England under Zach's Law. |

---

## Slide 1: The problem (0:00 to 0:25)

**On the slide:** "FlashBan". One line: "For 1 in 4,000 people, a flashing screen can cause a seizure." A still image only.

**Say:**
> About one in four thousand people have photosensitive epilepsy. For them, a strobing ad, video or GIF can trigger a seizure. The web has a rule against this: nothing should flash more than three times a second. But nothing in the browser enforces it, and by the time you see a strobe, it's too late.
> It's also used as a weapon. People send flashing images to people with epilepsy on purpose. In England that's now a crime. We built FlashBan to treat flashing as both an accessibility barrier and a security threat.

---

## Slide 2: Soften, don't break the page (0:25 to 1:10)

**On the slide:** "FlashBan watches every page and softens flashing before it reaches you."

**Say first, before anything moves:**
> Quick warning: next is a short, dimmed flashing pattern we made ourselves. If you'd rather not see it, look away for about five seconds.

*[Driver: open the canvas demo page with the HUD open beside it. Press Start. FlashBan softens it. Point at the HUD numbers.]*

**Say:**
> This test page flashes four times a second, over the limit. FlashBan caught it in under a second and softened it: it keeps playing, but the strobe is smoothed out. The numbers on the side are what our detector measured, using the exact WCAG formulas.
> Most tools protect you by taking content away. We wanted people to keep using the page, so we soften first, and only cover it when softening isn't enough.
> Okay, the flashing part is done.

**If the live demo fails:** *[Driver: show the screenshot.]* "Here's the same test from last night."

---

## Slide 3: It works everywhere, and it doesn't cry wolf (1:10 to 1:40)

**On the slide:** two columns. "Caught: video, canvas, animated images, CSS animations, flickering page elements." "Not flagged: scene cuts, a camera flash, slow fades, dark mode, a sunset."

**Say:**
> Flashing can come from a video, an image, a page animation, or a script flicking colours on and off. FlashBan checks every one of them.
> Just as important: it leaves normal content alone. Our automated test runs every page in a real Chrome browser. It passes [17 of 17] pages, three runs in a row, including [7] everyday pages, like a camera flash or a sunset, that must never be touched. Zero false alarms.
> Content we can't look inside, like protected video, is dimmed and labelled "can't verify". We'd rather be careful than guess.

---

## Slide 4: Security: a page can't switch it off (1:40 to 2:10)

**On the slide:** "Epilepsy trolling is an attack. We test FlashBan like a security tool." Three bullets: "Attack pages for every trick we found", "Lockdown when a page fights back", "No accounts, no server, data stays on your computer".

*[Driver: open the overlay-killer attack page and press Start.]*

**Say:**
> We treat this as an attack, so we attacked FlashBan ourselves. This page deletes our protection many times a second. FlashBan notices, and locks the page down with browser-level styles the page can't see or remove: in [0.9] seconds, the flashing is gone.
> Every trick we found became a permanent test page: strobes that hide between our checks, red-only flashes, a page that waits ten seconds before strobing, and pages that undo our softening.
> And it's private. Using a seizure shield reveals a health condition, so there are no accounts and no server. FlashBan only keeps a list of site names on your own computer, and you can clear it with one click.

---

## Slide 5: Built for the people who need it (2:10 to 2:35)

**On the slide:** "Keyboard. Screen reader. Reduced motion. Never flashes itself."

*[Driver: put the mouse down. Tab to the FlashBan button and press Enter.]*

**Say:**
> An accessibility tool has to be accessible itself. Everything works with just a keyboard, with a clear focus outline. Screen readers announce what FlashBan did and why. Our own design never flashes and respects reduced-motion settings. Automated accessibility checks found zero problems in the popup and the overlay.

---

## Slide 6: Honest limits, and what's next (2:35 to 3:00)

**On the slide:** "Not a medical device." Limits: "Protected and cross-origin video can't be measured, so it's dimmed." "The first fraction of a second of a new flash can reach the screen." "Websites can detect that FlashBan is installed." Next: "Hide FlashBan from websites, check protected video by screen capture, Firefox."

**Say:**
> We want to be honest. FlashBan is not a medical device and can't promise to stop every seizure. Protected video can't be measured, so we dim it. A brand-new flash can show for a fraction of a second before we catch it. And today a website could tell FlashBan is installed, which could reveal someone's condition. Fixing that is first on our list, then checking protected video and a Firefox version.
> Thank you. We're happy to take questions.

---

## One-minute security demo (for the Built To Be Trusted judges)

*[Driver: overlay-killer page, HUD optional.]*

> A troll controls the page, so they can run code against us. This page tries to delete FlashBan's protection many times a second. *[Start.]* FlashBan counts the attacks, and after a few it locks the whole page down with styles from the browser itself, which the page can't see or remove. The flashing is gone in under a second, and the badge on the FlashBan icon shows why.
> We also tested pages that undo our softening; they get covered every time. Every one of these attacks is in our automated test, and it passes [17 of 17] pages three runs in a row.

---

## Likely questions

| Question | Answer |
|---|---|
| Did you test it on people with epilepsy? | No, and we never would; it would be unsafe. We only use patterns we generated, and we check the detector's numbers against the WCAG formulas. |
| Does it work on YouTube? | Yes for detection on the page itself, but much video comes from other servers or is protected, and then we can't read the pixels. In that case we dim it instead of guessing. |
| How fast does it react? | Usually within about half a second to a second. That's why we say "reduces", not "prevents". |
| Does it slow my browser? | It checks a small, shrunk copy of each frame and measures its own cost. If it can't keep up, it dims what it couldn't check instead of freezing the page. |
| What data do you collect? | None leaves your computer. There's a local list of site names and dates with a "Clear my data" button, and old entries delete themselves after 30 days. |
| Where are your API keys? | There are none. No server, no accounts, no secrets. |
| How would a screen-reader user use it? | There's no login. Everything works by keyboard, and the overlay announces itself to screen readers. |
| Why not just stop all animation? | That breaks most of the web. We only step in when something actually flashes too fast, and we soften rather than remove. |

If you don't know: "Good question, Jun or Avery built that part," and hand over.
