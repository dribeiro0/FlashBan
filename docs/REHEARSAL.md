# Demo-day rehearsal checklist

Owner: Jun (@sysoutprntlne). Presenter: Yaovi. Driver: Jun. Script: [PITCH.md](PITCH.md).
Devpost is due Sunday 9:00 AM; judging is at 9:30 AM.

## Final build handoff (cutoff and tag pending lead/backup confirmation)

- [ ] Confirm the final cutoff and `demo` tag with David/lead on the board. The old tag `47d9023` predates dim + greyscale; do not use it as the final build without confirmation. Final commit: ______. Latest canonical 3-run evidence: `0c610e2` (29/29); rerun on the final tag.
- [ ] On the demo laptop, fetch the confirmed final build, check out its tag/commit, and record `git rev-parse --short HEAD`.
- [ ] **Laptop PLUGGED IN** for video preparation, harness and rehearsal. Battery throttling broke the synthetic recording path in David’s tests. Run `node harness/run.mjs --only video,overlay-killer`, then the full harness on the final build.
- [ ] `chrome://extensions` → Developer mode → Load unpacked → `extension/`. Reload it after every pull.
- [ ] Popup: preset is **WCAG** (older installs kept Strict). Turn on **Demo HUD**.
- [ ] Start the demo server: `node demo/serve.mjs` and open http://localhost:8080/.
- [ ] Run each slide's step once:
  - [ ] Slide 2: `canvas.html` with the HUD open ("Open HUD for this tab") → dimmed and in greyscale, detector estimates show.
  - [ ] Slide 3: one benign page (`demo/benign/`) → nothing happens.
  - [ ] Slide 4: `demo/adversarial/overlay-killer.html` → lockdown, badge on the icon.
  - [ ] Slide 5: keyboard only: Tab reaches "Show original on this site" on FlashBan's bar, with a visible focus ring, and Enter works. Turn protection back on in the popup afterwards.
- [ ] **Screenshots for backup**, saved on the laptop and on a phone: canvas dimmed with the HUD, overlay-killer lockdown, the harness table, the popup.
- [ ] Compare the PITCH.md evidence with Yaovi’s rerun on the confirmed final tag. Keep the build id attached to numbers; bracketed driver cues are not measurements. Delete unsupported claims.
- [ ] **Rehearsal 1** (after the freeze, or Sunday 7:00 AM if we sleep first): time it. Target 2:45–3:00. Cut words, not slides.
- [ ] **Rehearsal 2:** with the one-minute security demo and three questions from the "Likely questions" table.

## Sunday morning, at the venue

- [ ] Laptop charged, charger packed and **plugged in**. Chrome closed and reopened, extension reloaded, demo server running.
- [ ] Turn screen brightness down. Close every other tab and turn notifications off.
- [ ] Open the tabs in order: canvas + HUD, benign page, overlay-killer, popup.
- [ ] Before the first Start: **say the warning** and wait a second. If anyone objects, use the screenshots.
- [ ] Be at the table 15 minutes before judging.

## If something goes wrong

| Problem | Do this |
|---|---|
| The extension doesn't react | Reload it at `chrome://extensions`, then reload the page. Still nothing: screenshots. |
| The HUD says "unavailable" | Check that Demo HUD is on in the popup and reopen the HUD from that tab. Otherwise skip the numbers. |
| The demo server won't start | Stop the known demo server in its own terminal with Ctrl+C, then restart it. Or show the screenshots. |
| A run stops by itself | Escape or switching tabs stops a run (opening the popup doesn't). Press Start again. |
| Out of time | Skip slide 3's second paragraph, keep slide 6 (limits). Never skip the warning or the limits. |
