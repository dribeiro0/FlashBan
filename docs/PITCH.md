# FlashBan pitch: slides and speaker notes

For: Yaovi (@unseentrader007), presenter. Driver: Jun (@sysoutprntlne). Prepared by Jun.
Judging: Sunday 9:30 AM. Track: Tech Access, plus the Built To Be Trusted security award. Criteria: Accessibility Impact, Technical Depth, Design, Presentation, Creativity.

**Build: the `final` tag, commit `129e645`.** Every number below comes from the harness (`node harness/run.mjs`) on our slower Windows laptop, plugged in: three runs in a row on `d474896`, then one confirmation run on the final tag (board, Sun 09:24 and 09:38 UTC). Nothing that changes detection landed between those two commits. Bracketed driver cues are not spoken claims.

## How to use this

- **3 minutes, 6 slides.** Spoken notes: 376 words (about 2:30 at 150 words a minute), which leaves time for the demo holds. Rehearse with a timer; if long, cut words, never the warning or the limits.
- **Yaovi talks, Jun drives the laptop.** Lines in *[brackets and italics]* are cues for Jun, not things to say. The full click-by-click is in [REHEARSAL.md](REHEARSAL.md#driver-cue-sheet).
- **Safety first.** Say the warning on slide 2 before anything moves on screen. If anyone asks us not to show flashing, Jun shows the screenshots instead. That is still a complete pitch.
- **Never claim more than we have.** FlashBan is not a medical device and doesn't guarantee protection. Say "reduces", "dims", "catches", never "prevents seizures" or "makes it safe".

Words you might hear, in plain terms:

| Word | Meaning |
|---|---|
| Photosensitive epilepsy | Flashing or flickering light can cause a seizure. About 1 in 4,000 people have it. |
| WCAG 2.3.1 | The web accessibility rule: nothing should flash more than three times in any one second over a large part of the screen. |
| Dim | Flashing video, canvas or animated images keep playing, but darker (94% by default) and in greyscale, so they can't swing far enough to count as a flash. |
| Protection strength | The popup slider: 72%, 80%, 88% or 94% dimming, or block. 72% is the floor: every step stays under the flash limit (unit-tested). |
| Block | Pause and cover with a plain panel. Red flashing and very fast flashing (6 or more a second) are always blocked. |
| Lockdown | If a page keeps deleting our protection, we dim the whole page with browser-level styles the page can't touch. |
| Fail closed | If we can't check something (another site's video, DRM), we dim it and say why, instead of letting it through. |
| Harness | Our automated test: it opens every test page in real Chrome with FlashBan on and checks what a user would actually see. |
| Epilepsy trolling | Sending flashing images to people with epilepsy on purpose. It's a crime in England under Zach's Law. |

---

## Slide 1: The problem (0:00 to 0:20)

**On the slide:** "FlashBan" with the eye icon. One line: "For 1 in 4,000 people, a flashing screen can cause a seizure." A still image only.

**Say:**
> About one in four thousand people have photosensitive epilepsy. For them a flashing ad or video is a barrier, and sometimes a deliberate attack. FlashBan is a free Chrome extension that finds flashing content and tones it down, while keeping the page usable.

---

## Slide 2: Dimmed, not stopped (0:20 to 1:05)

**On the slide:** "Finds flashing. Dims it. Keeps it playing."

**Say first, before anything moves:**
> Warning: the next test contains flashing light. If anyone would rather not see it, we'll use screenshots instead.

*[Jun: canvas.html, HUD open beside it. Press Start. Within about a second the canvas goes dark and grey; the bar says "Dimming 1 item on this page". Point at the HUD.]*

**Say:**
> This test canvas flashes four times a second, over the WCAG limit of three. FlashBan reads a small copy of every frame, counts the flashes by the clock, and dims it to 94% in greyscale. It keeps playing; it just can't flash any more.

*[Jun: open the popup, step Protection strength down to Lightest so its description shows, then back to Strong. The canvas doesn't change live; don't say it does.]*

> You choose how strong. Even the lightest setting stays under the flash limit; we test that. Red flashing, or anything faster than six a second, is blocked outright.

**If the live demo fails:** *[Jun: show the screenshot.]* "Here's the same test from this morning."

---

## Slide 3: Tested like a product (1:05 to 1:35)

**On the slide:** two columns. "Caught: video, canvas, animated images, CSS animations, flickering page elements." "Left alone: scene cuts, a camera flash, slow fades, dark mode, a sunset."

**Say:**
> We test the real extension in Chrome with an automated harness: 29 test pages, three runs in a row, and again on our final build. All 16 attack pages were caught, and all 8 everyday pages were left alone. Zero false alarms in that test set.
> And if we can't read a video, like protected or cross-site video, it stays dimmed and labelled. We never quietly let it through.

---

## Slide 4: Security: a page can't switch it off (1:35 to 2:10)

**On the slide:** "Epilepsy trolling is an attack. We test FlashBan like a security tool." Three bullets: "16 attack pages, one for every trick we found", "Lockdown when a page fights back", "No accounts, no server, data stays on your computer".

*[Jun: overlay-killer.html, press Start. Lockdown in about a second; the toolbar icon shows "!".]*

**Say:**
> This page attacks us: it deletes our protection every frame. FlashBan notices, puts it back, and locks the whole page down with styles from the browser itself. That took about a second and a quarter, every run.
> Using FlashBan reveals a health condition, so we collect almost nothing: no accounts, no server. The only record is site names, dates and detector numbers, on your own computer, cleared with one button or after 30 days.

---

## Slide 5: Built for the people who need it (2:10 to 2:35)

**On the slide:** "Keyboard. Screen reader. Reduced motion. Never flashes itself."

*[Jun: hands off the mouse. Tab to "Show original on this site" on FlashBan's bar, top right. Visible focus ring. Press Enter.]*

**Say:**
> Everything works by keyboard alone, with a visible focus ring. Every panel is labelled for screen readers, and when FlashBan hides something it tells them why. It respects reduced motion and never flashes itself. And a page can't press this button for you: it only counts real clicks.

---

## Slide 6: Honest limits, and what's next (2:35 to 3:00)

**On the slide:** "Not a medical device." Limits: "The first moments of a new flash can reach the screen before it reacts." "Protected and cross-site video can't be measured, so it's dimmed." "Websites can detect that FlashBan is installed." Next: "Hide FlashBan from websites, measure protected video, Firefox."

**Say:**
> FlashBan reduces exposure. It is not a medical device and not a guarantee: the first moments of a flash can reach the screen before it reacts. And websites can currently tell it's installed, which could reveal a health condition. Fixing that is our next step, then protected video and Firefox. Thank you.

---

## One-minute security demo (for the Built To Be Trusted judges)

*[Jun: overlay-killer.html, HUD optional. Say the warning first if anyone new is at the table.]*

> A troll controls the page, so they can run code against us. This page tries to delete FlashBan's protection every frame. *[Start.]* FlashBan puts it back each time, and when the page keeps fighting, it locks the whole page down with browser-level styles the page can't see or remove. In our harness that takes about a second and a quarter, three runs out of three, and the toolbar icon shows why.
> It's one of 16 attack pages: strobes timed between our samples, one big flash split into tiles, red-only flashes, flashing that starts late, pages that undo our dimming. All 16 are caught, three runs in a row. And FlashBan itself can't be turned against you: the one network check it makes, to see whether an image is animated, refuses your local network, so a page can't use us to poke your router.

---

## Likely questions

| Question | Answer |
|---|---|
| Did you test it on people with epilepsy? | No, and we never would; it would be unsafe. We only use patterns we generated, and we check the detector against the WCAG formulas. |
| What's the worst thing someone could do? | Slip a strobe past us: timed between samples, split into tiles, red only, or starting late. Each trick has an attack page in our harness, and all 16 are caught. |
| Where are your API keys? | There are none. No server, no accounts, no secrets. |
| How would a screen-reader user log in? | There's no login. Everything works by keyboard; every panel is labelled, and when FlashBan hides something it announces why. |
| Does it work on YouTube? | Yes: it reads YouTube video and dims it when it flashes. When the next video starts in the same player, it checks that one again. Video it can't read is dimmed instead. |
| How fast does it react? | About a second on our test pages; lockdown in about 1.25 s. It depends on the page and the machine, so we don't promise a number. |
| Why not just stop all animation? | That breaks most of the web. We only step in when something actually flashes too fast, and we dim rather than remove. |
| Does it slow my browser? | It checks a small, shrunk copy of each frame and measures its own cost. If it can't keep up, it dims what it couldn't check rather than freezing the page. |
| What data do you collect? | Only site names, dates and detector numbers, kept on your computer, with "Clear my data" and 30-day deletion. Nothing is uploaded. The animated-image check can contact the image's host; that's documented. |
| Why 94%? Isn't that nearly black? | It's the default because it's the strongest dim that keeps the video playing. If it's too dark for you, the slider goes down to 72%, which still can't flash. |

If you don't know: "Good question, Jun or David built that part," and hand over.
