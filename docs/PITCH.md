# Pitch: slides and speaker notes

For: @unseentrader007 (presenter). Prepared by @sysoutprntlne. Draft, November 6, 2026.
Follows the demo script in [PROJECT_PLAN.md section 7](PROJECT_PLAN.md#7-demo-script-about-3-minutes). Timings and the evidence behind each claim are in [DEMO_PLAN.md](DEMO_PLAN.md).

## How to use this

- About 3 minutes, 6 slides, roughly 30 seconds each. The notes are written to be said out loud; say them in your own words.
- **You talk, a teammate drives the laptop.** Lines in *[brackets]* are cues for the driver, not things to say.
- Lines marked **ONLY IF TESTED** are said only if the team has confirmed on Sunday morning that the feature works. If it hasn't been confirmed, skip that line. Never describe something as working if we haven't seen it work.
- **Safety rule:** before anything flashes on screen, say the warning on slide 2. If anyone in the room asks us not to, we show the screenshots instead. That's fine and still a complete pitch.

Words you might hear from judges, in plain terms:

| Word | What it means |
|---|---|
| Photosensitive epilepsy | A condition where flashing or flickering light can cause a seizure. |
| WCAG | The web's main accessibility guidelines. Rule 2.3.1 says content shouldn't flash more than three times a second. |
| Extension | An add-on you install in Chrome. Ours watches every page you open. |
| Overlay | The grey cover we put over flashing content, with a message on it. |
| Screen reader | Software that reads the screen out loud for blind and low-vision users. |
| Fail closed | If we can't check something, we cover it to be safe instead of letting it through. |
| Epilepsy trolling | Sending flashing images to people with epilepsy on purpose to hurt them. |

---

## Slide 1: The problem (0:00 to 0:25)

**On the slide:** title "Seizure Shield"; one line: "Flashing content can cause seizures. Online, you see it before you can look away." A still image, nothing moving.

**Say:**
> For people with photosensitive epilepsy, flashing light on a screen can trigger a seizure. The web's own accessibility rules say content shouldn't flash more than three times a second, but sites, ads and videos break that rule all the time. And by the time you see it, it's too late to look away.
> It's also used as a weapon. People send flashing GIFs and videos to people with epilepsy on purpose. That's called epilepsy trolling, and it has really happened.

---

## Slide 2: Turning the shield on (0:25 to 1:10)

**On the slide:** "Seizure Shield watches the page, measures flashing, and covers it before it reaches you." Then switch to the live browser.

**Say first, before anything moves:**
> Quick warning: the next part has a short, dimmed flashing test pattern that we made ourselves. If you'd rather not see it, look away for about five seconds and I'll tell you when it's done.

*[Driver: open the canvas test page with the shield OFF. Press Start for about 2 seconds, then Stop. Turn the shield ON, then press Start again.]*

**Say:**
> This is a test page we built. It flashes four times a second, just over the limit. Now the shield is on. Same page: the flashing is covered by a plain grey box, and the animation is stopped. The numbers on the side are what our detector measured: how many flashes per second, and how much of the screen was flashing.
> Okay, the flashing part is done.

**If the live demo isn't working:** *[Driver: show the evidence screenshot.]*
> Here's a recording of the same test from this morning. You can see the cover and the detector's numbers.

---

## Slide 3: It catches every kind of flashing (1:10 to 1:40)

**On the slide:** three or four labeled icons: Video, Drawing (canvas), Page animations (CSS). "Look-ahead for GIFs" only if tested.

*[Driver: show the video page and the CSS page being covered, or their screenshots.]*

**Say:**
> Flashing can come from a lot of places on a web page: a video, a drawing area that a website paints on, or an animation built into the page's design. The shield checks each of them in a different way, and you can see each one getting covered.

**ONLY IF TESTED (GIF look-ahead):**
> For animated GIFs, we can go one step further: we check the whole GIF before it plays, so the flashing part never shows up at all.

---

## Slide 4: Security: attackers try to get around it (1:40 to 2:05)

**On the slide:** "Epilepsy trolling is an attack. We built it like a security tool." Three bullets: "Logs which sites served flashing", "Tested against tricks", "Shared warning list, protected from abuse" (that last one only if tested).

*[Driver: show the domain log. Then, if tested, one attack page, for example the page that tries to delete our cover.]*

**Say:**
> We treat epilepsy trolling as an attack, so we built the shield like a security tool. It keeps a private log, on your own computer, of which websites showed you flashing content. We only keep the site's name, never the page you were on.
> We also built attack pages that try to sneak flashing past us: hiding the flashes between our checks, splitting them into lots of tiny pieces, or running code that tries to delete our cover.

**ONLY IF TESTED (attack page):**
> This page tries to delete our cover many times a second. The cover comes right back, and the flashing stays hidden.

**ONLY IF TESTED (shared list):**
> If you choose to, the shield can report a site to a shared warning list, so other people are protected sooner. To stop someone from getting an innocent site listed, a site only goes on the list after reports from several different people.

---

## Slide 5: Built for the people who need it (2:05 to 2:35)

**On the slide:** "Works by keyboard. Works with a screen reader. Never flashes itself."

*[Driver: put the mouse down, use Tab and Enter to reach the cover's "show anyway" button. If tested, turn on the screen reader so the room hears the announcement.]*

**Say:**
> An accessibility tool has to be accessible itself. Everything works with just the keyboard: you can see where you are, and you can choose to show the content again on purpose. A screen reader announces when something has been covered, so blind users know why. And our own design never flashes or moves quickly.

---

## Slide 6: What it can't do, and what's next (2:35 to 3:00)

**On the slide:** "Not a medical device." Three short limits: "Some protected videos can't be checked, so we cover them." "The first moment of flashing can sometimes get through." "No tool catches everything."

**Say:**
> We want to be honest about the limits. This is not a medical device, and it can't promise to stop every seizure. Some videos, like protected movies, don't let us look at them. When that happens, we cover them to be safe. Sometimes the first instant of flashing can get through before we catch it.
> Next, we'd test it with accessibility experts, and bring it to more browsers. Thank you, we're happy to take questions.

---

## Likely questions

| Question | Answer |
|---|---|
| Did you test it on people with epilepsy? | No, and we never would. That would be unsafe. We test only with patterns we made ourselves, and we check the numbers the detector measures. |
| Does it work on YouTube or Netflix? | Some of it. Videos from other sites or with copy protection often can't be measured, so we cover them instead of guessing. We say that up front. |
| Does it slow down my browser? | It checks a small, shrunk-down copy of each frame to stay light. If a page is too heavy, it covers what it can't check rather than freezing your browser. |
| What data do you collect? | Nothing leaves your computer unless you turn on reporting. Even then, only the site's name and the numbers are sent, never the page address or anything about you. |
| What stops someone from getting a site banned? | A site is only listed after reports from several different people on different networks. And being listed only makes the shield more careful on that site. It doesn't block the site. |
| Why not just pause all animations? | That would break a lot of the web for everyone. We only step in when something actually flashes too fast. |

If you don't know an answer, say "Good question. My teammate who built that part can answer," and hand over.
