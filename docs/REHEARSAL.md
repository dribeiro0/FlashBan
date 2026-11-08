# Demo-day rehearsal checklist

Owner: Jun (@sysoutprntlne). Presenter: Yaovi. Driver: Jun. Script: [PITCH.md](PITCH.md).
Devpost is due Sunday 9:00 AM; judging is at 9:30 AM.

## Saturday night, right after the 11:00 PM freeze

- [ ] `git pull` on the demo laptop and note the commit: ______. Avery tags the release (`git tag demo && git push --tags`). If anything breaks on Sunday, run `git checkout demo`.
- [ ] `chrome://extensions` → Developer mode → Load unpacked → `extension/`. Reload it after every pull.
- [ ] Popup: preset is **WCAG** (older installs kept Strict). Turn on **Demo HUD**.
- [ ] Start the demo server: `node demo/serve.mjs` and open http://localhost:8080/.
- [ ] Run each slide's step once:
  - [ ] Slide 2: `canvas.html` with the HUD open ("Open HUD for this tab") → softened, numbers show.
  - [ ] Slide 3: one benign page (`demo/benign/`) → nothing happens.
  - [ ] Slide 4: `demo/adversarial/overlay-killer.html` → lockdown, badge on the icon.
  - [ ] Slide 5: keyboard only: Tab reaches FlashBan's button, with a visible focus ring, and Enter works.
- [ ] **Screenshots for backup**, saved on the laptop and on a phone: canvas softened with the HUD, overlay-killer lockdown, the harness table, the popup.
- [ ] Fill in every [bracket] in PITCH.md from the harness run on the frozen build (Yaovi's agent posts the numbers). Delete any sentence whose number we don't have.
- [ ] **Rehearsal 1:** time it. Target 2:45–3:00. Cut words, not slides.
- [ ] **Rehearsal 2:** with the one-minute security demo and three questions from the "Likely questions" table.

## Sunday morning, at the venue

- [ ] Laptop charged, charger packed. Chrome closed and reopened, extension reloaded, demo server running.
- [ ] Turn screen brightness down. Close every other tab and turn notifications off.
- [ ] Open the tabs in order: canvas + HUD, benign page, overlay-killer, popup.
- [ ] Before the first Start: **say the warning** and wait a second. If anyone objects, use the screenshots.
- [ ] Be at the table 15 minutes before judging.

## If something goes wrong

| Problem | Do this |
|---|---|
| The extension doesn't react | Reload it at `chrome://extensions`, then reload the page. Still nothing: screenshots. |
| The HUD says "unavailable" | Check that Demo HUD is on in the popup and reopen the HUD from that tab. Otherwise skip the numbers. |
| The demo server won't start | `pkill -f serve.mjs`, then start it again. Or show the screenshots. |
| A run stops by itself | Escape or switching tabs stops a run (opening the popup doesn't). Press Start again. |
| Out of time | Skip slide 3's second paragraph, keep slide 6 (limits). Never skip the warning or the limits. |
