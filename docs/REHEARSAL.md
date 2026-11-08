# Demo-day rehearsal checklist

Owner: Jun (@sysoutprntlne). Presenter: Yaovi. Driver: Jun. Script: [PITCH.md](PITCH.md).
Devpost is due Sunday 9:00 AM; judging is at 9:30 AM.

## Final build on the demo laptop

The final build is the **`final` tag, commit `129e645`** (David, board Sun 09:38 UTC). Docs and the website on `main` are newer; that's fine, only the extension comes from the tag.

- [ ] **Laptop PLUGGED IN** the whole time (battery throttling broke the video path in David's tests).
- [ ] `git fetch --tags && git checkout final`, then `git rev-parse --short HEAD` must print `129e645`.
- [ ] `chrome://extensions` → Developer mode → reload FlashBan (or Load unpacked → `extension/`). The toolbar shows the olive eye icon.
- [ ] Play one YouTube video once (warms the video path, per David).
- [ ] `node harness/run.mjs --only video,overlay-killer` → both pass. Note the lockdown time: ______ s.
- [ ] Popup: Sensitivity **WCAG**; Protection strength on **Strong (94%)**, the 4th step; Demo HUD **on**.
- [ ] **Open the HUD before judging:** on the canvas tab, popup → "Open HUD for this tab". It opens as a new tab: drag that tab out into its own window and put it beside Chrome. During the demo never switch away from the canvas tab (hiding it stops the run).
- [ ] **Count the Tabs** for slide 5: on canvas.html after Start, how many Tab presses reach "Show original on this site"? ____ (write it into the cue below).
- [ ] `node demo/serve.mjs` → http://localhost:8080/.
- [ ] **Backup screenshots**, on the laptop and a phone: canvas dimmed with the HUD, popup with the slider, overlay-killer lockdown with the "!" badge, the harness 29/29 output.

## Driver cue sheet

Jun drives, Yaovi talks. Open these tabs left to right before judging: **1** `canvas.html?seconds=10` (the default run is only 3 s), **2** `benign/sunset.html`, **3** `adversarial/overlay-killer.html`. Brightness down, notifications off, no other tabs.

| Slide | Yaovi is saying… | Jun does | You should see |
|---|---|---|---|
| 1 | "…one in four thousand…" | Slides only. Nothing on screen moves. | |
| 2 | "**Warning:** the next test contains flashing light…" | Wait one second after the warning. Look at the table: anyone uncomfortable → screenshots for the rest. | |
| 2 | "This test canvas flashes four times a second…" | Tab 1: press **Start** (the HUD is already open in its own window to the right). | Within about 1 s: canvas dark and grey, bar top right "Dimming 1 item on this page", HUD counting. |
| 2 | "You choose how strong…" | Open the popup, **Tab** to **Protection strength**, then press the **Left arrow** step by step to **Lightest**, hold it up, then back to **Strong**, close the popup. | The description changes at each step, ending on "Dimmed 72% and in greyscale: the lightest level that still can't flash." The canvas does **not** change live: a new strength applies the next time FlashBan catches flashing (reload + Start). Don't claim it changes. |
| 3 | "We test the real extension…" | Tab 2 (sunset). Press Start if it has one. | Nothing happens: no bar, no dim. That is the point. |
| 4 | "This page attacks us…" | Tab 3 (overlay-killer), **Start**. | Whole page dims (lockdown) in about 1.25 s; "!" badge on the eye icon. |
| 5 | "Everything works by keyboard alone…" | Hands off the mouse. Back on tab 1, **Tab ×____** (the count from setup) to "Show original on this site" (bar, top right), wait one second, press **Enter**. | White focus ring on the button; the dim lifts. Then turn protection back on in the popup (switch "Protect localhost"). |
| 6 | "FlashBan reduces exposure…" | Slides only. | |

The "Show original" button only works after it has been on screen for a second, and only for real clicks or key presses. If Enter does nothing, wait a moment and press it again.

## Rehearsals

- [ ] **Rehearsal 1:** full run with a timer. Target 2:45–3:00. Too long → cut words from slides 3 and 4, never the warning or slide 6.
- [ ] **Rehearsal 2:** the one-minute security demo, then three questions from the "Likely questions" table in PITCH.md, asked by Jun in random order.
- [ ] Yaovi can say from memory: "not a medical device", "one in four thousand", "16 of 16 attacks, 8 of 8 everyday, 29 of 29", "about a second", "94%, down to 72%".
- [ ] Don't let anyone test the keyboard route on a long real site: FlashBan's bar comes last in Tab order there. The popup switch is the keyboard answer.

## Sunday morning, at the venue

- [ ] Laptop charged and **plugged in**. Chrome restarted, extension reloaded, demo server running, three tabs open in order.
- [ ] Popup back on Strong (94%), protection on for localhost, HUD on.
- [ ] Screen brightness down. Notifications off.
- [ ] Before the first Start: **say the warning** and wait a second. If anyone objects, screenshots.
- [ ] At the table 15 minutes before judging.

## If something goes wrong

| Problem | Do this |
|---|---|
| The extension doesn't react | Reload it at `chrome://extensions`, then reload the page. Still nothing: screenshots. |
| The HUD says "unavailable" | Check Demo HUD is on in the popup and reopen the HUD from that tab. Otherwise skip the numbers. |
| The demo server won't start | Stop it in its own terminal with Ctrl+C and restart it, or use another port: `node demo/serve.mjs 8081`. Or screenshots. |
| A run stops by itself | Escape or switching tabs stops a run (opening the popup doesn't). Press Start again. |
| Canvas looks almost black | That's the 94% default working. To show a lighter level, set the slider first, then reload the page and press Start. |
| Out of time | Skip slide 3's second paragraph, keep slide 6 (limits). Never skip the warning or the limits. |
