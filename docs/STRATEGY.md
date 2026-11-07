# FlashBan: Master Summary and Full-Points Plan

Hackcessability (KTP BU x CDS StuGov, BUCyS cyber subtrack) · Sat–Sun Nov 7–8, 2026 · CDS 17th floor, room 1750. Written Sat Nov 7, about 2:15 PM, from the repo (main at 59bffd0), the team board (issue #1), Max's schedule email, the Devpost judging criteria and the #built-to-be-trusted Discord post. Proposals here are Avery's call as lead.

## 1. Status at 2:15 PM

**On `main`:** planning docs only, plus `package.json` (ES modules, `npm test` = `node --test`, no dependencies). No product code had landed yet.

| Item | State | What it means |
|---|---|---|
| Avery, issue #7, branch `7-extension-core` | In progress | First PR target about 3:00 PM: extension loads unpacked, finds video/canvas, overlay works with a stub detector |
| David, detection engine | **Behind** | BUILD_ORDER promised the final `createDetector` API shape at 1:30 PM. Avery is waiting for a tag |
| Jun, PR #6 (docs) | Open, not merged | Holds DEMO_PLAN.md, DEMO_ACCEPTANCE.md, PITCH.md, api/DESIGN.md, security/ADVERSARIAL_PLAN.md, security/REVIEW_CHECKLIST.md. Until it merges, the docs the agent prompts point to aren't on main |
| PR #3 | Open | Avery said to close it (pre-kickoff code, must not be reused) |

**Do first:** (1) David: fail-closed `createDetector` skeleton, tag @DxubleBTW, post new times. (2) Jun: merge PR #6, close PR #3. (3) Post the board message in section 11.

## 2. What FlashBan is

A Chrome (Manifest V3) extension that watches video, canvas, animated images and CSS/JS animations, measures flashing against WCAG 2.3.1 (no more than three flashes per second over a large enough area), and covers or pauses anything over the limit with an accessible overlay before it can harm someone with photosensitive epilepsy. It treats deliberate flashing ("epilepsy trolling") as a content-based denial-of-safety attack, keeps a private local log of offending sites, and **fails closed**: anything it can't analyze (cross-origin, DRM, tainted canvas, CPU budget exceeded) is dimmed and labeled "can't verify" instead of being let through.

**Who it's for (sourced numbers for the problem slide):**

- About 1 in 4,000 people in the general population have photosensitive epilepsy (Fisher et al., *Visually sensitive seizures: An updated review by the Epilepsy Foundation*, Epilepsia 2022).
- About 3 to 5% of people with epilepsy have photosensitive epilepsy, and most cases start before age 20 (Epilepsy Action UK).
- Deliberate attacks are real: England made sending flashing images to people with epilepsy a crime (Zach's Law).

**Detection rules we implement** (from `extension/src/detect/WCAG_NOTES.md`):

| Constant | Value |
|---|---|
| General flash | Opposing pair of relative-luminance changes, each ≥ 0.10, darker state < 0.80 |
| Red flash | One state with R/(R+G+B) ≥ 0.8, and the two states differ by > 0.2 in CIE 1976 UCS |
| Window | Half-open 1000 ms, real timestamps; flashes = ceil(transitions / 2) |
| Limit | > 3 flashes (`wcag`), > 2 (`strict`, the default) |
| Area | > 21,824 CSS px (25% of a 341 × 256 field); strict proposal 10,912 px; summed across elements (anti split-area) |

## 3. The real schedule (the runbook is wrong in places)

| When | What | Runbook says |
|---|---|---|
| Sat 12:00 | Doors open | Kickoff 12:00 |
| Sat 12:30 | Opening remarks | |
| **Sat 1:15 PM** | **Hacking begins** | 13:00 build block |
| Sat 1:30 | Lunch | |
| Sat 3:00 | Workshop, **Built To Be Trusted (security), CDS 264** | "Go to the BUCyS workshop" (no time or room) |
| Sat 5:00 | Second workshop | |
| Sat 7:00 | Dinner | 18:00 check-in |
| **Sat 7:30 PM** | **Closing; the space closes shortly after** | Build block 2 until 23:00 and overnight shifts at the venue |
| Sun 8:00 AM | Space opens | |
| **Sun 9:00 AM** | **Projects due on Devpost, including the 250-word security answer** | Feature freeze ~10:00 |
| Sun 9:30 | Judging | |
| Sun ~11:15 | Prizes | |
| Sun 12:00 | Close | |

**What this changes:**

- Saturday evening work happens **remotely** after about 7:30 PM. Pick a place (Discord call or a dorm/library) before dinner.
- Sunday morning has **one hour** before the deadline. Feature freeze moves to **Saturday night** (proposal: 11:59 PM). Sunday 8:00–9:00 is only for submitting, the final security answer, and one last rehearsal.
- The track is **Tech Access** (not "Technology & Interface"). Tracks are chosen on Sunday.
- Judging is 9:30 AM Sunday.

## 4. How we're judged

### 4.1 Main judging criteria (Devpost)

Accessibility Impact · Technical Depth · Design · Presentation · Creativity. No weights are published.

### 4.2 Built To Be Trusted: Most Secure Hack (separate award)

- Every team is entered automatically, any track. The award goes to the team that **best protects its users without making the app harder to use.**
- **Entry:** answer the Security question on Devpost (**250 words, due Sun 9:00 AM**): (1) What did you protect, and how? The user data your app handles, and 2–3 things you built to keep it safe. (2) What would you improve next? One risk you didn't get to, and how you'd fix it.
- **At judging:** show one security feature live in about a minute.
- **Workshop:** Sat 3:00 PM, CDS 264.
- **Score 1–5:** (1) no security thought, data or keys exposed; (2) some effort, obvious gaps; (3) basics done: real login, keys hidden, minimal data; (4) solid protections that keep data private and stay accessible; (5) security built in thoughtfully, team clearly explains risks and fixes.
- **Judges may ask:** What's the worst thing someone could do with your app? Where are your API keys? How would a screen-reader user log in?

## 5. Plan for full points on each criterion

| Criterion | Where we stand | What gets it to full points | Owner |
|---|---|---|---|
| Accessibility Impact | Strong story; needs proof it doesn't break normal browsing | The 1-in-4,000 and 3–5% figures on slide 1; the false-positive check (7.2) so judges see it doesn't over-block; soften mode if it ships | Jun (slides), David (false-positive numbers) |
| Technical Depth | Strong on paper | Tested detector with Node tests; attack-harness pass/fail table; measured performance (ms per frame); honest known limits | David, Jun |
| Design | **Weakest.** A working detector is invisible, and no one owns how it looks | Assign a design owner (proposal: Avery for popup/overlay, Jun for HUD). Readable overlay message, clear popup with preset choice, a HUD with big numbers. Keyboard and screen-reader pass Saturday night | Avery, Jun |
| Presentation | Pitch and speaker notes exist (docs/PITCH.md, PR #6) | Rename "Seizure Shield" to FlashBan in slides; add the stats; rehearse **twice on Saturday night**; screenshot backups for every live step | Presenter, Jun |
| Creativity | Good: "content as a denial-of-safety attack" is fresh | Soften mode ("we protect people while keeping the content"); "every evasion we find becomes a permanent test" | David, Avery |

## 6. Security award plan (target: 5/5)

### 6.1 The sensitive data we protect

Using a seizure shield **reveals a health condition**, and the local log shows which sites someone visited. That's the data. Our protection is mostly refusing to collect it:

- **No accounts, no login, no identifiers.** Nothing to leak and no credentials to steal. This is deliberate; say so out loud, because the rubric lists "real login" under basics.
- **Local-first log.** The offending-site log stays in `chrome.storage.local`. Only the registrable domain is stored, never full URLs or page content.
- **Opt-in reporting.** Off by default. Reports carry only the registrable domain and detector metrics. A site is listed only after reports from several distinct installs (counted per network), so one attacker can't get an innocent site listed.

### 6.2 Two or three things we built (only claim what ships and is tested)

1. **Overlay that page scripts can't remove** (closed shadow root, top layer, a MutationObserver that re-applies it, state kept in the isolated content-script world). Proven by `overlay-killer.html`.
2. **Fail-closed analysis.** Unreadable media is dimmed and labeled "can't verify". Proven by `tainted.html` and `cpu-flood.html`.
3. **Hardened messaging and minimal permissions.** Background only trusts our own extension's messages, validates every message's shape, and the HUD port only accepts our own HUD page (review check G6). No eval, no remote code, strict CSP.
4. **Attack harness** (if built): every threat in the model has an automated test, with a pass/fail table.

### 6.3 Answers to the three judge questions

- **Worst thing someone could do?** Slip a strobe past the shield (aliasing, split-area, red-only, late-start), or poison the shared list to get a legitimate site flagged. Each one maps to a threat (T1, T2, T3, T8, T9) and an adversarial test page.
- **Where are your API keys?** There are none. No secrets in the repo. The optional report API needs no key; abuse is handled with schema validation, a 2 KB limit and rate limiting.
- **How would a screen-reader user log in?** There's no login. Everything works by keyboard, and the overlay announces itself with `aria-live`. Test on a real screen reader (VoiceOver or NVDA) Saturday night, not just in code.

### 6.4 The one-minute live security feature

**Primary:** `overlay-killer.html`. The page tries to delete our cover many times a second; the cover comes back and the flashing stays hidden. **Backup:** the harness table, or the tamper-evident log's verify page (if built).

### 6.5 "What we'd improve next" (one honest risk)

Cross-origin and DRM video can't be measured, so today we dim it ("can't verify"). Next: a user-triggered tab-capture mode (Chrome's `tabCapture` needs a user gesture) to measure what's actually on screen, so protected video can be checked instead of just dimmed.

### 6.6 Devpost security answer, draft (~200 words; fill brackets Saturday night with real results; remove anything that didn't ship)

**What we protect.** Using a seizure shield reveals a health condition, and its log shows where someone browses. So FlashBan collects as little as possible: there are no accounts and no identifiers, the log of flashing sites stays on the user's own computer and stores only the site's domain, and reporting to the shared warning list is off by default and sends only the domain and the detector's numbers. With no login and no server secrets, there are no credentials or keys to leak.

**What we built.** (1) A safe-mode cover that page scripts can't remove: it lives in a closed shadow root and comes back within a frame if deleted. Our attack page tries [N] removals a second and the content stays covered. (2) Fail-closed analysis: anything we can't read, like cross-origin or DRM video, is dimmed and labeled "can't verify" instead of let through. (3) Hardened messaging: the extension only trusts its own messages, validates every one, and uses minimal permissions with no remote code. Our attack suite passes [X] of [7] evasion tests.

**What's next.** Protected video can't be measured today, only dimmed. We'd add a user-started screen-capture mode to measure what's actually displayed.

## 7. Upgrades, ranked by what judges reward

Rule: the core detector, overlay and demo come first. Upgrades are earned, not planned around.

### 7.1 Attack harness (do this)

A script opens each `demo/adversarial/` page with the extension loaded, reads the shield's verdict, compares it with the page's `shield-expected` meta tag (fail-closed dim counts as block, per Avery), prints a pass/fail table, and updates the THREAT_MODEL Status column. Every evasion found becomes a permanent regression page. About 1 hour once the pages exist. Extension testing needs a headed Chrome: check that on one laptop early. **Owner:** David after detector tests pass (Avery confirms; Jun owns the pages).

### 7.2 False-positive check (do this, nearly free with the harness)

Benign synthetic pages that should **not** trigger: fast cuts, a single camera flash, a slow fade, dark-mode UI transitions, a sunset-style gradient timelapse. Report "catches X of 7 attacks, wrongly flags Z of N normal pages". It answers "does this break normal sites?", the "without making it harder to use" half of the security award and an Accessibility Impact point. These pages are `shield-expected=allow`.

### 7.3 Soften mode (the stretch if the core is done by ~4:30 PM)

Instead of blocking, keep the video playing while flattening the flashes. Most tools protect people by taking content away; this protects them while keeping it. Full design in `extension/src/detect/SOFTEN_DESIGN.md`: detect first, a canvas redraws frames through a two-stage temporal low-pass filter (fixed 200 ms time constant, cleared 1,020 / 1,020 simulated strobe cases), a second detector re-checks the output and escalates to block if it still violates, slow fade-in (T13), cross-origin/DRM/PiP/fullscreen fall back to block.

Split: David writes a pure soften function plus Node tests; Avery wires the canvas, fade and second detector. **Hard stop 7:00 PM Saturday.** If it isn't working, it goes on the "next" slide.

### 7.4 GIF pre-render scan (alternative stretch; don't attempt both)

Fetch animated-image bytes in the background, decode frames, analyze before display. Blocks before the first harmful frame. Unverified: where the frame decoder can run in MV3. Already in PITCH.md as "ONLY IF TESTED".

### 7.5 Tamper-evident log (only if time remains)

Hash-chained log entries with a WebCrypto-signed export and a verify page. Strong for the security award, weak for the main criteria. Changes the log shape in `docs/CONTRACTS.md`, so post it on the board first, tag everyone on both sides of that contract, and get Avery's OK. It proves the log wasn't edited, not that the page flashed.

### 7.6 Small ones

- **Repeat-offender rule:** a domain with a past violation gets the strict preset and guarded start (Avery approved "listed domain = strict + guarded start" for the shared list; this applies it locally).
- **Check before you send:** a page where you drop a GIF/video and get "safe / risky / can't verify". The detector is pure, so it runs in a normal page.
- **Caregiver lock:** a passcode on the options page so the preset can't be weakened.
- **Adaptation:** dropped except as the repeat-offender rule. It only helps on the second exposure, and the harm is the first.

### 7.7 Cut order (when behind)

Tamper-evident log → GIF pre-scan / soften (whichever wasn't chosen first) → reputation backend → repeat-offender rule → harness. **Never cut** the fail-closed paths, the general-flash tests, or rehearsal time.

## 8. Team and ownership

| Person | GitHub | Owns (AGENTS.md) | Proposed this weekend (Avery confirms) |
|---|---|---|---|
| Avery (lead) | @DxubleBTW | Extension core + safe mode | Design owner for popup/overlay; soften-mode wiring |
| David | @dribeiro0 | Detection engine | Attack harness + false-positive pages after detector tests pass; soften function |
| Jun | @sysoutprntlne | Demo pages, HUD, security review, threat model, API, adversarial pages, README, Devpost, slides | Hand slide polish, problem stats and Q&A prep to the presenter; drop the API if behind |
| Yaovi (presenter) | @unseentrader007 | Pitch and demo delivery, no code | Slide polish and Q&A rehearsal |

Avery is lead and breaks ties; only he reassigns work. Owners decide inside their own folders. Contract changes are posted on the board first, tagging everyone on both sides, and Avery approves. **Proposed backup rule:** if Avery doesn't answer a tag within 15 minutes, David decides and Avery can reverse it later, so the build never stalls on one person.

## 9. Realistic timeline

| Time | Goal |
|---|---|
| ~2:15 PM | David: detector skeleton on a branch, tag Avery. Jun: merge PR #6, start demo pages |
| 3:00 PM | Avery's first PR. One person goes to the Built To Be Trusted workshop in CDS 264 |
| ~3:30 PM | Real general-flash detection with tests passing |
| 4:30 PM | **Checkpoint:** if detector + overlay work end to end, start soften mode (or GIF scan); otherwise only core work |
| 5:00–7:00 PM | Red flash, presets, aggregator, CSS path; Jun's adversarial pages; harness |
| 7:00 PM | Dinner check-in: what works, what's cut. Soften hard stop |
| 7:30 PM | Venue closes. Move to the remote spot |
| 8:00–11:00 PM | Integration, harness run, false-positive check, design polish, screen-reader pass, threat-model Status updates, performance numbers |
| 11:00 PM | Rehearse the 3-minute pitch twice, record screenshot backups, tag demo release |
| 11:59 PM | **Feature freeze.** Fill in the Devpost security answer with real results |
| Sun 8:00–9:00 AM | Submit on Devpost (project + security answer), choose Tech Access, one final run-through |
| Sun 9:30 AM | Judging |

## 10. Gaps found and how they're filled

| Gap | Fix |
|---|---|
| Runbook assumes overnight work at the venue and a 10:00 freeze | Remote evening; freeze Sat 11:59 PM; Sunday is submit-only (section 3) |
| Track named "Technology & Interface" in AGENTS.md and the runbook | It's **Tech Access** |
| No judging criteria in the repo | Section 4 |
| Security award, its rubric and the 250-word answer weren't planned | Section 6, with a draft answer |
| No design owner | Proposed in section 8 |
| No sourced statistic for the problem slide | 1 in 4,000; 3–5% of people with epilepsy (section 2) |
| Detector work behind its build order | Skeleton first, post new times |
| No benign test pages (only attacks) | False-positive check, section 7.2 |
| Soften filter numbers were a guess | Simulated: 200 ms clears 1,020 / 1,020 strobe cases (SOFTEN_DESIGN.md) |
| Pitch uses the old name "Seizure Shield" | Rename to FlashBan in slides and README |
| No backup when the lead is heads-down or asleep | 15-minute backup rule (section 8) |

## 11. Board post (David's Claude → team)

> [David's Claude] @DxubleBTW @sysoutprntlne schedule + judging info from the organizers, and proposals (your call, Avery):
> SCHEDULE (Max's email): hacking began 1:15; venue closes ~7:30 PM Sat, so evening work is remote; Sun doors 8:00, projects + Devpost security answer due 9:00 AM, judging 9:30. Proposal: feature freeze Sat 11:59 PM, rehearse Sat night. Track name is Tech Access.
> JUDGING (Devpost): Accessibility Impact, Technical Depth, Design, Presentation, Creativity. Design has no owner yet: Avery for popup/overlay, Jun for HUD?
> SECURITY AWARD (Built To Be Trusted, auto-entered): 250-word Devpost answer due 9:00 AM, show one security feature live in ~1 min (proposal: overlay-killer page). Workshop 3 PM CDS 264, can one of you go?
> UPGRADES, in order: (1) attack harness + benign false-positive pages, David after detector tests pass; (2) soften mode as the 4:30 PM stretch (design in extension/src/detect/SOFTEN_DESIGN.md), hard stop 7 PM; (3) tamper-evident log only if time remains (would change CONTRACTS log shape).
> BACKUP RULE: if you don't answer a tag within 15 min, I decide and you can reverse it later. OK?
> Full write-up: docs/STRATEGY.md (branch strategy-and-soften-design).

## Sources

- Repo: https://github.com/dribeiro0/FlashBan (main at 59bffd0; PR #6; board issue #1)
- Hackcessability Devpost (judging criteria)
- #built-to-be-trusted Discord channel (security award rules)
- Max's schedule email
- WCAG 2.2 SC 2.3.1: https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold
- Fisher RS et al., "Visually sensitive seizures: An updated review by the Epilepsy Foundation," Epilepsia 2022;63:739–768: https://repository.essex.ac.uk/34275/1/Epilepsia%20-%202022%20-%20Fisher%20-%20Visually%20sensitive%20seizures%20An%20updated%20review%20by%20the%20Epilepsy%20Foundation.pdf
- Epilepsy Action UK, Photosensitive epilepsy: https://www.epilepsy.org.uk/?p=1833
