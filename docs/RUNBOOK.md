# FlashBan runbook

Repo: https://github.com/dribeiro0/FlashBan · Board: [issue #1](https://github.com/dribeiro0/FlashBan/issues/1) (pinned)

| Person | GitHub | Owns |
|---|---|---|
| Avery (lead) | @DxubleBTW | Extension core + safe mode |
| David | @dribeiro0 | Detection engine |
| Jun | @sysoutprntlne | Demo, security + backend (covered by Yaovi's agent while Jun is offline) |
| Yaovi | @unseentrader007 | Presenter; slide polish, problem stats and Q&A prep; temporarily covering Jun's areas |

---

## Friday, Nov 6: setup day

### 1. David grants access (about 2 min)
- [ ] Repo **Settings > Collaborators > Add people**: add `sysoutprntlne` and `unseentrader007` (the presenter's access is optional: it lets them see the board and PRs).
- [ ] Tell them to accept the invite (email, or https://github.com/notifications). It expires in 7 days.

### 2. Avery checks access
- [ ] Ask Claude (with the FlashBan folder connected): "check that everyone has write access to the repo." Each person should show `write` or `admin`.

### 3. Each coding teammate sets up their machine (about 10 min each; the presenter skips this)
Windows: do all of this in **Git Bash** (install Git for Windows from https://git-scm.com if needed), because `tools/board` is a bash script.

- [ ] Install the GitHub CLI.
  - Mac: `brew install gh`
  - Windows: `winget install --id GitHub.cli`, then reopen Git Bash.
- [ ] `gh auth login`: choose GitHub.com, HTTPS, log in with a browser, **as your own account**.
- [ ] `git clone https://github.com/dribeiro0/FlashBan && cd FlashBan`
- [ ] `tools/board whoami`: must print your own GitHub login. If you get "permission denied", run `chmod +x tools/board .claude/hooks/*.sh`.
- [ ] `tools/board post "[<YourName>'s Claude] hello, setup works"`
- [ ] Install your coding agent (Claude Code, Codex, or Cursor) and open it **inside the FlashBan folder**. Claude Code: run `claude` in the folder and allow the project hooks if it asks. On startup it should mention the team board and say it's starting `tools/board wait` in the background.
- [ ] Set your git name: `git config user.name "<Your Name>"`. Your GitHub noreply email is at https://github.com/settings/emails; set it with `git config user.email "<noreply email>"`.
- [ ] Read `AGENTS.md` and skim `docs/PROJECT_PLAN.md`, especially your own area.

### 4. Tag test (about 10 min, any two people, then everyone)
This proves agents can hand work to each other without anyone texting.
- [ ] **Person B** opens their agent in the repo. If it didn't start a board wait itself, tell it: "Start `tools/board wait` in the background and re-arm it after every wake, per AGENTS.md."
- [ ] **Person A** tells their agent: "Post on the board tagging @<B's login>: please create `scratch/hello-<B>.txt` containing hi, commit it on a branch, and reply on the board when done."
- [ ] Within about 30 s, B's agent wakes up, sees `** MENTION **`, does it, and replies tagging A.
- [ ] A's agent (or A running `tools/board unread`) sees the reply.
- [ ] Repeat until every person's agent has received and answered at least one tag. Then delete the `scratch/` branches.

If an agent doesn't wake up: check that `tools/board whoami` prints the exact login that was tagged, that the agent is running inside the repo folder, and (for non-Claude agents) that you're using the loop `while tools/board wait; do <agent command>; done`.

### 5. Prep (no product code yet)
- [ ] **Everyone:** check the Hackcessability rules on code written before kickoff, or ask an organizer. Until then, plan and research only.
- [ ] **David:** read the WCAG 2.3.1 definitions of "general flash", "red flash" and "flash threshold", and confirm the constants in `docs/PROJECT_PLAN.md` section 3.
- [ ] **sysoutprntlne:** read `security/THREAT_MODEL.md`, pick the API stack (Node/Express or Python/FastAPI), and sketch the slides from the demo script (plan section 7).
- [ ] **unseentrader007 (presenter):** read the README and plan sections 1, 2 and 7 so you know the story you'll tell.
- [ ] **Avery:** read Chrome's MV3 docs on content scripts, `requestVideoFrameCallback`, and the offscreen API.
- [ ] **Everyone:** charge laptops, bring chargers, and have Chrome installed.

---

## Saturday, Nov 7: build day

Real schedule from the organizers (details, judging criteria and the security-award plan: `docs/STRATEGY.md`, PR #10). Hacking began 1:15 PM. Workshops at 3:00 PM (**Built To Be Trusted**, the security award, CDS 264; one of us goes) and 5:00 PM. Dinner 7:00 PM. **The venue closes about 7:30 PM, so evening work is remote.** We're entering the **Tech Access** track (tracks are chosen on Sunday) plus the Built To Be Trusted award.

| Time | Goal |
|---|---|
| 3:00 PM | Extension core (PR #8) reviewed and merged. One person at the Built To Be Trusted workshop. |
| 3:45 PM | David: real general-flash verdicts. Then area and timing 4:30, red 5:15, presets 5:45, aggregator 6:15, CSS animations 6:45 (one PR each, tag Avery). |
| 4:30 PM | **Checkpoint:** if detector + overlay work end to end, start soften mode (David: pure soften function + tests; Avery: canvas wiring, fade, second detector). Otherwise core work only. |
| 5:00-7:00 PM | Yaovi's agent (covering Jun): demo pages, HUD, adversarial pages. David: attack harness and false-positive pages once the detector tests pass. |
| 7:00 PM | Dinner check-in: what works, what's cut. **Soften mode hard stop.** Agree on the remote spot (Discord call, dorm or library). |
| 7:30 PM | Venue closes. Move to the remote spot; everyone stays on the board. |
| 8:00-10:45 PM | **Last feature work:** integration, harness run, false-positive check, design polish, accessibility pass on our own UI (keyboard only, screen reader, contrast, reduced motion), threat-model Status updates, performance numbers. Merge everything by 10:45 PM. |
| **11:00 PM** | **FEATURE FREEZE.** Avery posts `[Avery] @all feature freeze` and tags the demo release: `git tag demo && git push --tags` (if something breaks in the demo, check out that tag). After this, code gets bug fixes only; docs, slides and the Devpost text can still change. |
| 11:00 PM-midnight | Rehearse the 3-minute pitch twice on the frozen build (Yaovi presents) and record screenshot backups. Fill in the Devpost security answer with real, tested results (draft in `docs/STRATEGY.md` section 6.6; remove anything that didn't ship). |
| After midnight | Bug fixes only, then sleep. Anyone away closes their agent or sets `BOARD_WAIT=off`; a human checks the board before merging any fix. |

- [ ] Humans check the board at least every 30 minutes: `tools/board read -n 20`.
- [ ] Merge small PRs often. `main` must always load as an extension.

### Upgrades and cut order (accepted Sat 2:46 PM; details in `docs/STRATEGY.md` section 7)
Core detector, overlay and demo come first; upgrades are earned, not planned around. Then, in order:
1. **Attack harness** (David): opens every `demo/adversarial/` page with the extension loaded and compares the shield's verdict with the page's `shield-expected` tag (fail-closed dim counts as block).
2. **False-positive check** (David): benign pages that must *not* trigger (fast cuts, one camera flash, slow fade, dark-mode transitions, gradient timelapse).
3. **Soften mode** (stretch, only if the core works end to end by 4:30 PM; hard stop 7:00 PM) **or** the GIF pre-render scan, not both.
4. **Tamper-evident log** only if time remains. It changes the log contract, so post it on the board first.
5. Small ones: repeat-offender rule (strict preset + guarded start for domains with past violations), a check-before-you-send page, a caregiver lock.

**When behind, cut in this order:** tamper-evident log, then GIF scan or soften, then the reputation backend, then the repeat-offender rule, then the harness. **Never cut** the fail-closed paths, the general-flash tests, or rehearsal time.

**Security-award demo:** the overlay-killer page (the page keeps deleting and restyling our overlay; it stays up).

---

## Sunday, Nov 8: submit and judging

| Time | What |
|---|---|
| Before 8:00 AM | Final README and slides with speaker notes (product name **FlashBan**). No code changes except fixes to the frozen build. |
| 8:00 AM | Space opens. Set up the demo laptop: extension loaded from the `demo` tag, test pages dim, warning ready for the room. |
| 8:00-9:00 AM | Submit on Devpost: the project plus the 250-word security answer, and choose **Tech Access**. One final run-through. |
| **9:00 AM** | **Devpost deadline.** |
| 9:30 AM | Judging. Yaovi presents; a coding teammate drives the demo laptop. |
| ~11:15 AM | Prizes. The event closes at 12:00. |

## Rules that apply all weekend
- Never use real seizure-trigger videos. Only synthetic test pages, kept dim and labeled.
- Don't touch another person's folders without asking on the board. Only the lead reassigns work.
- No secrets or `.env` files in git.
- Commits come from each person's own account. No AI co-author lines.
