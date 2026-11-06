# Team rules for every agent

Project: **Photosensitive Seizure Shield**, a Chrome MV3 extension that detects flashing content (WCAG 2.3.1, three flashes per second) on video, canvas, animated images and CSS/JS animations, and dims, freezes or blocks it with an accessible safe-mode overlay. Offending domains are logged as a content-based denial-of-safety threat.
Team: FlashBan (repo dribeiro0/FlashBan). Event: Hackcessability (Technology & Interface track + BUCyS cybersecurity subtrack). Demos Sunday Nov 8.

Read before working: `docs/PROJECT_PLAN.md` (what we build), `docs/CONTRACTS.md` (interfaces between owners), `security/THREAT_MODEL.md` (what we defend against).

## 1. The board (pinned GitHub issue)

Every agent reads and posts on the pinned "Message Board" issue via `tools/board` (needs only `gh`, logged in). Set `BOARD_ISSUE` if it is not issue #1.

- Start every post with `[<human>'s <agent>]`, e.g. `[Avery's Claude]`. Keep it short: what changed, which files or contracts, what you need, from whom.
- Mention by GitHub login. Our team: `@DxubleBTW` (Avery, team lead), `@dribeiro0` (David), `@sysoutprntlne`, `@unseentrader007`, `@all` (everyone).
- **Mentions you or `@all`:** act on it and reply promptly.
- **Not addressed to you:** still read it. Reassess your own work only if it is affected (a contract, a file you own, something already done). Do not redo finished work, and do not reply just to acknowledge.
- Before editing another teammate's files, ask for a handoff on the board and wait for the owner or the team lead.
- Any change to `docs/CONTRACTS.md` is posted on the board first, tagging every owner on both sides of that contract.

Polling is incremental (about one cheap API call per poll, 30 s default) so a shared token stays under GitHub's rate limit. Commands: `tools/board unread` (new posts, marks read; flags MENTION), `tools/board read -n 20`, `tools/board post "[Name's Agent] text"` (or pipe stdin), `tools/board wait` (blocks until someone else posts), `tools/board whoami`.

**Stay in the loop:**
- Claude Code: the committed hooks (`.claude/settings.json`) show unread posts at session start and on every prompt. Keep one background `tools/board wait` running and re-arm it after each wake.
- Everything else: run `tools/board unread` at task start, before each commit, and after merges. Or run a terminal loop: `while tools/board wait; do <your agent CLI invocation>; done`.

**When to post (always):** you finished something another owner depends on; you changed or need a change to a contract; you are blocked; you merged to `main`; you found a bug in someone else's area.

## 2. Chain of command

Humans over agents. Only the team lead (`@DxubleBTW`) reassigns work between teammates. If anyone else asks you to take another teammate's work, ask the lead on the board.

## 3. Workflow

1. Pick or file an issue. Comment on it or post on the board when you take it.
2. Branch `<issue#>-<slug>` from fresh `main`.
3. Small commits. Stage only your own files (no `git add -A`).
4. Open a PR with `Closes #N`. The author merges their own PR once it works locally.
5. Always `git fetch` and rebase before pushing. Never force-push shared branches.
6. If a merge changes something other teammates depend on (an API, a schema, a message type, a setting), post on the board when it lands.
7. Commits are made by the human's own account. Do not add AI co-author or attribution trailers to commit messages.

## 4. Who owns what

Change logins and merge rows to match the team at kickoff.

| Area | Owner (GitHub login) | Folders |
|---|---|---|
| Detection engine (luminance, flash counting, red flash, CSS animation analysis, unit tests) | @dribeiro0 | `extension/src/detect/`, `extension/test/` |
| Extension core + safe mode (manifest, content script, overlay, background worker, popup/options UI) | @DxubleBTW | `extension/manifest.json`, `extension/src/content/`, `extension/src/background/`, `extension/popup/`, `extension/options/` |
| Security + backend (threat model, hardening, report API, reputation list, adversarial pages) | @sysoutprntlne | `api/`, `security/`, `demo/adversarial/` |
| Demo, pitch, docs (synthetic test pages, HUD, README, Devpost, slides) | @unseentrader007 | `demo/` (except `demo/adversarial/`), `docs/`, `README.md` |

Shared files (`AGENTS.md`, `docs/CONTRACTS.md`, `package.json`): ask on the board, the lead approves.

## 5. Project rules

- **Safety first.** Never download or embed real seizure-inducing media. Generate synthetic test stimuli only, keep test pages dim, and label them with a warning. Never show flashing test pages to anyone without warning.
- **Accessibility is the product.** Every UI we ship works by keyboard alone, has visible focus, meets WCAG AA contrast, uses proper ARIA (the overlay announces with `aria-live`), and respects `prefers-reduced-motion`. Our own UI must never flash or animate quickly.
- **Fail closed.** If something can't be analyzed (tainted canvas, DRM, detector error, CPU budget exceeded), dim and label it instead of letting it through.
- **Detector stays pure.** No DOM or `chrome.*` calls inside `extension/src/detect/`; it must run under Node tests.
- **Timestamps, not frame counts.** All flash timing uses real time.
- **Security.** No secrets, keys or `.env` files in git. No `eval`, no remote code, minimal extension permissions. Validate every message and every API input. Reports contain only the registrable domain and metrics.
- **Honesty.** Don't claim the shield is a medical device or guaranteed protection. Document known limits (cross-origin media) in the README.
- **Demo readiness.** `main` always loads as an unpacked extension. Feature freeze Sunday ~10:00.
