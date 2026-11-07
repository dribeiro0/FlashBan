# Team rules for every agent

Project: **Photosensitive Seizure Shield**, a Chrome MV3 extension that detects flashing content (WCAG 2.3.1, three flashes per second) on video, canvas, animated images and CSS/JS animations, and dims, freezes or blocks it with an accessible safe-mode overlay. Offending domains are logged as a content-based denial-of-safety threat.
Team: FlashBan (repo dribeiro0/FlashBan). Event: Hackcessability (Tech Access track + the Built To Be Trusted security award). Feature freeze Saturday 11:00 PM, Devpost due Sunday 9:00 AM, judging 9:30 AM. Product name in slides and README: **FlashBan**.

Read before working: `docs/RUNBOOK.md` (schedule and checklists), `docs/PROJECT_PLAN.md` (what we build), `docs/CONTRACTS.md` (interfaces between owners), `security/THREAT_MODEL.md` (what we defend against).

## 1. The board (pinned GitHub issue)

Every agent reads and posts on the pinned "Message Board" issue via `tools/board` (needs only `gh`, logged in). Set `BOARD_ISSUE` if it is not issue #1.

- Start every post with `[<human>'s <agent>]`, e.g. `[Avery's Claude]`. Keep it short: what changed, which files or contracts, what you need, from whom.
- Mention by GitHub login. Our team: `@DxubleBTW` (Avery, team lead), `@dribeiro0` (David), `@sysoutprntlne` (Jun), `@unseentrader007` (Yaovi, presenter), `@all` (everyone).
- **Mentions you or `@all`:** act on it and reply promptly.
- **Not addressed to you:** still read it. Reassess your own work only if it is affected (a contract, a file you own, something already done). Do not redo finished work, and do not reply just to acknowledge.
- Before editing another teammate's files, ask for a handoff on the board and wait for the owner or the team lead.
- Any change to `docs/CONTRACTS.md` is posted on the board first, tagging every owner on both sides of that contract.

Polling is incremental (about one cheap API call per poll, 30 s default) so a shared token stays under GitHub's rate limit. Commands: `tools/board unread` (new posts, marks read; flags MENTION), `tools/board read -n 20`, `tools/board post "[Name's Agent] text"` (or pipe stdin), `tools/board wait` (blocks until someone else posts), `tools/board whoami`.

**Stay in the loop:**
- **Every agent checks for updates at least every 30 minutes, even when idle:** run `tools/board unread`, handle anything that affects you, and `git pull` on `main`. If your agent only acts when you message it (a regular Claude chat), message it at least every 30 minutes.
- Claude Code: the committed hooks (`.claude/settings.json`) show unread posts at session start and on every prompt. Keep one background `tools/board wait` running and re-arm it after each wake.
- Everything else: run `tools/board unread` at task start, before each commit, and after merges. Or run a terminal loop: `while tools/board wait; do <your agent CLI invocation>; done`.

**When to post (always):** you finished something another owner depends on; you changed or need a change to a contract; you are blocked; you merged to `main`; you found a bug in someone else's area.

## 2. Chain of command

Humans over agents. Only the team lead (`@DxubleBTW`) reassigns work between teammates. If anyone else asks you to take another teammate's work, ask the lead on the board.

**Lead's agent:** Avery's agent (posts as `[Avery's Claude]`) has standing permission to decide and approve for the lead (decisions, PR merges, contract changes) when Avery doesn't respond within 15 minutes. Its decisions count as the lead's and are posted on the board; Avery can reverse them later.

**Backup rule:** if a tag to `@DxubleBTW` goes unanswered for 15 minutes by both Avery and his agent, `@dribeiro0` decides so the build doesn't stall, and posts the decision on the board. The lead can reverse it later.

**Design owners:** `@DxubleBTW` for the popup and overlay (and soften-mode wiring); `@sysoutprntlne` for the HUD (covered by `@unseentrader007` while Jun is offline). **Weekend extras:** `@dribeiro0` builds the attack harness and false-positive pages once the detector tests pass, plus the pure soften function. Schedule, upgrade order and cut order: `docs/RUNBOOK.md`.

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
| Extension core + safe mode (manifest, content script, overlay, background worker, popup/options UI) | @DxubleBTW | `extension/manifest.json`, `extension/src/content/`, `extension/src/background/`, `extension/src/shared/`, `extension/popup/`, `extension/options/` |
| Demo, security + backend (synthetic test pages, HUD, threat model, hardening review, report API, reputation list, adversarial pages, README, Devpost, slides) | @sysoutprntlne | `demo/`, `extension/hud/`, `api/`, `security/`, `docs/`, `README.md` |
| Presenter (delivers the demo and pitch; no code) | @unseentrader007 | none |

Shared files (`AGENTS.md`, `docs/CONTRACTS.md`, `package.json`): ask on the board, the lead approves.

**Temporary reassignment (Sat Nov 7, 14:35, by the lead):** while Jun (`@sysoutprntlne`) is offline, Yaovi's agent (`@unseentrader007`) owns everything in Jun's row above: demo pages, the HUD, security review, the API, adversarial pages and docs. Tag `@unseentrader007` for those. Yaovi still presents. When Jun is back he posts on the board first, coordinates with `@unseentrader007` so no work is duplicated, and the lead hands the areas back.

## 5. Project rules

- **No product code before kickoff (Saturday Nov 7, 12:00).** Until then, planning docs only (designs, notes, test plans). After kickoff, write code fresh: do not copy code written before kickoff (for example from PR #3) into the project.

- **Safety first.** Never download or embed real seizure-inducing media. Generate synthetic test stimuli only, keep test pages dim, and label them with a warning. Never show flashing test pages to anyone without warning.
- **Accessibility is the product.** Every UI we ship works by keyboard alone, has visible focus, meets WCAG AA contrast, uses proper ARIA (the overlay announces with `aria-live`), and respects `prefers-reduced-motion`. Our own UI must never flash or animate quickly.
- **Fail closed.** If something can't be analyzed (tainted canvas, DRM, detector error, CPU budget exceeded), dim and label it instead of letting it through.
- **Detector stays pure.** No DOM or `chrome.*` calls inside `extension/src/detect/`; it must run under Node tests.
- **Timestamps, not frame counts.** All flash timing uses real time.
- **Security.** No secrets, keys or `.env` files in git. No `eval`, no remote code, minimal extension permissions. Validate every message and every API input. Reports contain only the registrable domain and metrics.
- **Honesty.** Don't claim the shield is a medical device or guaranteed protection. Document known limits (cross-origin media) in the README.
- **Demo readiness.** `main` always loads as an unpacked extension. Feature freeze Saturday 11:00 PM; after that, bug fixes only.

## 6. The security award (Built To Be Trusted): every agent's job

We're auto-entered in BUCyS's **Built To Be Trusted** award. It goes to the team that **best protects its users without making the app harder to use**, scored 1 to 5 (5 = security built in thoughtfully, and the team clearly explains the risks and fixes). Entry: a **150–250 word** Devpost security answer due **Sunday 9:00 AM**, plus one security feature shown live in about a minute at judging (the overlay-killer page). Full plan and draft answer: `docs/STRATEGY.md` sections 4.2 and 6.

**What we protect.** Using FlashBan reveals a health condition (photosensitive epilepsy), and the log shows where someone browses. So our main protection is collecting almost nothing. Every agent keeps it that way, in its own area:

1. **No accounts, logins, identifiers or secrets.** Don't add any. There are no API keys; `.env` is gitignored anyway.
2. **Minimal data, kept local.** Only the registrable domain and detector numbers, stored on the user's computer. Never full URLs, page content, screenshots or anything that identifies the person.
3. **Untrusted input stays data.** Use `textContent`, never `innerHTML`. No `eval` and no remote code. Check `sender.id` and the shape of every message and every API input.
4. **Fail closed, and never trade away accessibility.** Anything we can't check gets dimmed or covered and labelled. Security must not break keyboard use, screen readers or paste, and must never add CAPTCHAs.
5. **Permissions are a cost.** Post any new manifest permission on the board, with the reason, before merging it.
6. **Prove it or don't claim it.** Every security claim in the Devpost answer or the pitch must be backed by a passing test, or by a page in `demo/adversarial/` that passes `node harness/run.mjs`. If it doesn't pass, drop the claim.
7. **Leave evidence.** When you ship something security-relevant, post one board line starting `SECURITY:` with what it defends (a threat id from `security/THREAT_MODEL.md`) and a number (for example "overlay re-applied in 10/10 attack samples"). Those lines become the Devpost answer.
8. **Be honest about limits.** Known gaps (sites can detect the extension through its web-accessible files; cross-origin and DRM video can't be measured, only dimmed) go in the threat model's Known limits, not under the rug.

Judges may ask: "What's the worst thing someone could do with your app?", "Where are your API keys?", "How would a screen-reader user log in?" Answers are in STRATEGY 6.3. Know them.
