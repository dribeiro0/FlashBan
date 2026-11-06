# FlashBan runbook

Repo: https://github.com/dribeiro0/FlashBan · Board: [issue #1](https://github.com/dribeiro0/FlashBan/issues/1) (pinned)

| Person | GitHub | Owns |
|---|---|---|
| Avery (lead) | @DxubleBTW | Extension core + safe mode |
| David | @dribeiro0 | Detection engine |
| | @unseentrader007 | Security + backend |
| | @sysoutprntlne | Demo, pitch, docs |

---

## Friday, Nov 6: setup day

### 1. David grants access (about 2 min)
- [ ] Repo **Settings > Collaborators > Add people**: add `sysoutprntlne` and `unseentrader007`, with Write access if it asks for a role.
- [ ] Tell them to accept the invite (email, or https://github.com/notifications). It expires in 7 days.

### 2. Avery checks access
- [ ] Ask Claude (with the FlashBan folder connected): "check that everyone has write access to the repo." Each person should show `write` or `admin`.

### 3. Each teammate sets up their machine (about 10 min each)
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
- [ ] **unseentrader007:** read `security/THREAT_MODEL.md` and pick the API stack (Node/Express or Python/FastAPI).
- [ ] **sysoutprntlne:** read the demo script (plan section 7) and sketch the slides.
- [ ] **Avery:** read Chrome's MV3 docs on content scripts, `requestVideoFrameCallback`, and the offscreen API.
- [ ] **Everyone:** charge laptops, bring chargers, and have Chrome installed.

---

## Saturday, Nov 7: build day

Kickoff 12:00 at CDS 1750. Lunch and dinner are provided. Workshops run throughout the day, so go to the BUCyS cybersecurity one.

### 12:00-12:30 Kickoff
- [ ] Listen for the track details and judging criteria. Note anything that changes our plan and post it on the board: `[Avery] @all judges care about X`.
- [ ] Confirm we're entering Technology & Interface plus the BUCyS cybersecurity subtrack.
- [ ] Ask an organizer about pre-written code if it's still unclear.

### 12:30-13:00 Lock the plan
- [ ] Walk through `docs/CONTRACTS.md` together and agree on every shape. Avery pushes any changes. After this, contract changes **only** go through the board.
- [ ] Confirm the owner table in `AGENTS.md`.
- [ ] Each person opens their agent in the repo and pastes the shared opening plus their role's prompt from `docs/AGENT_PROMPTS.md`.
- [ ] Each agent posts its intro on the board.

### 13:00-18:00 Build block 1
| Who | Target by 18:00 |
|---|---|
| David | Luminance + general-flash detector passing Node unit tests; post and tag @DxubleBTW |
| Avery | Extension loads unpacked; content script finds video/canvas; safe-mode overlay works with a stub detector |
| unseentrader007 | API skeleton with validated `POST /api/reports`; threat model review of the manifest and messages |
| sysoutprntlne | 3+ synthetic demo pages (canvas, CSS, JS toggle) with warnings and `shield-expected` meta tags; tag @all |

- [ ] Humans check the board at least every 30 min: `tools/board read -n 20`.
- [ ] Merge small PRs often. `main` must always load as an extension.

### 18:00 Check-in at dinner (15 min)
- [ ] Each person says what works, what's blocked, and what's next. Cut anything that's off track.
- [ ] Avery posts the new priorities on the board, tagging @all.

### 18:30-23:00 Build block 2
- [ ] **Avery + David:** wire in the real detector; detect end-to-end on all demo pages; guarded start.
- [ ] **David:** red-flash detector and `analyzeAnimation` for CSS.
- [ ] **unseentrader007:** `GET /api/domains` with the distinct-install threshold, rate limiting, and the first adversarial pages.
- [ ] **sysoutprntlne:** HUD showing detector numbers, a generated GIF/MP4 test, README draft.

### Overnight
- [ ] Sleep in shifts so someone is always awake to answer tags. Agents can keep working, but a human checks the board before merging anything big.
- [ ] Anyone stepping away for long sets `BOARD_WAIT=off` or closes their agent, so it doesn't act alone on tags.

---

## Sunday, Nov 8: demo day

Breakfast is provided. Find out the exact demo and judging time at kickoff and write it here: ______

- [ ] **Morning:** adversarial tests (unseentrader007 runs every page in `demo/adversarial/` and updates the Status column in the threat model). Bug fixes. GIF look-ahead only if everything else works.
- [ ] **About 10:00: FEATURE FREEZE.** Avery posts `[Avery] @all feature freeze`. After that, only bug fixes and polish.
- [ ] **Accessibility check on our own UI:** keyboard only, a screen reader (NVDA on Windows, VoiceOver on Mac), contrast, reduced motion.
- [ ] **sysoutprntlne:** final README, slides, and Devpost/submission text, including the "not a medical device" note and the known limits.
- [ ] **Rehearse the 3-minute demo at least twice** (script in `docs/PROJECT_PLAN.md` section 7), on the laptop you'll present with. Keep test-page brightness low and warn the room before any flashing.
- [ ] Tag a release: `git tag demo && git push --tags`. If something breaks during the demo, check out that tag.
- [ ] Submit before the deadline. Be there at least 15 min before judging.

## Rules that apply all weekend
- Never use real seizure-trigger videos. Only synthetic test pages, kept dim and labeled.
- Don't touch another person's folders without asking on the board. Only the lead reassigns work.
- No secrets or `.env` files in git.
- Commits come from each person's own account. No AI co-author lines.
