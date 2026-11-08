# Who did what

Team FlashBan at Hackcessability (Nov 7–8, 2026): four people, each working with an AI coding agent under their own GitHub account. The humans set direction, made the calls and tested on real machines; the agents wrote and tested most of the code. Everything was coordinated on the pinned message board (issue #1). Counts below are merged commits on `main`.

## Avery Lee — team lead, extension core and safe mode (@DxubleBTW, 42 commits)

- **Team setup and coordination:** repo rules (AGENTS.md), the agent message board, ownership table, schedule, freeze calls, and assigning and reassigning work as people came and went.
- **Extension core:** manifest, content script, background service worker and popup. Detecting every video, canvas, image and animated page element; sending frames to the detector; deciding whether to soften, dim or cover.
- **Safe mode:** the overlay and covers, the single "Show original on this site" bar (keyboard reachable, guarded against clickjacking), page lockdown when a site attacks the overlay, auto-dimming media that can't be checked, and the local log with 30-day retention and "Clear my data".
- **Real-world fixes on his own laptop (Sat night):** found and fixed why ordinary YouTube videos were being covered:
  - slow frame reads on a real GPU, fixed with asynchronous WebGL readback;
  - video compression noise read as red;
  - YouTube's player controls and ambient glow;
  - one flagged ad switching the whole site to Strict;
  - one cover sticking to every later video in the same player.
- Product decisions: WCAG as the default sensitivity, soften first, one page-wide check instead of many.

## David Ribeiro — detection engine and test harness (@dribeiro0, 73 commits)

- **Detector** (`extension/src/detect/`, pure and unit tested):
  - WCAG 2.3.1 general and red flash rules with real-time timing;
  - area rules (the 10-degree field);
  - the gap and fail-closed rules;
  - CSS / Web Animations analysis;
  - cross-element area aggregation (T2);
  - the cost meter and the clamp softener.
  - false-positive fixes (low-frame-rate video, looping clips, github.com's scroll-linked animations).
- **Attack harness** (`harness/run.mjs`): runs every demo, benign and adversarial page against the real extension and scores what is actually visible.
  - attack pages for a tainted canvas (T4) and a CPU flood (T5); a `--url` mode for checking real sites such as YouTube.
- **Softening:** the soften design and its final look (dim plus greyscale, the "Protection strength" slider, severe flashing blocked), tuned from his real-GPU checks.
- **Late-stage work:**
  - the extension restyle with a shared theme and the eye icon;
  - the image probe's local-network guard;
  - README final-build evidence;
  - YouTube's reused video player and previews re-checked instead of keeping an old verdict;
  - the How it works and Privacy pages restyled to the Grain look;
  - tagging `final` and the verification runs behind the Devpost numbers (29/29 every run);
  - submitting the Devpost.
- Backup decider overnight while Avery slept.

## Jun (Juno) — demo, website, slides and rehearsal (@sysoutprntlne, 22 commits)

- **Presentation:** presenter slides, speaker notes, the pitch script (`docs/PITCH.md`) and the rehearsal checklist and driver cue sheet (`docs/REHEARSAL.md`). Did a final pass against the judging rubric.
- **Grain demo site** (`demo/showcase/`): video, canvas, CSS and script clips on one screen, built to the fixture safety rules.
- **FlashBan website** (`site/`, flashban.vercel.app):
  - pages: Home, How it works, Privacy & security, Download;
  - a strict CSP with hashed inline code;
  - a reproducible download zip whose SHA-256 anyone can rebuild and check.
- HUD restyle and its tab-selection validation fix; the scroll-timeline benign page (the github.com false positive); real-site bug reports.
- Drives the demo at judging.

## Yaovi — security, adversarial pages, Devpost, presenter (@unseentrader007, 31 commits)

- **Security:** the threat model (`security/THREAT_MODEL.md`) with status per threat and honest known limits, and the 150–250 word security answer.
- **Adversarial pages** (`demo/adversarial/`), each mapped to a threat:
  - page attacks: overlay-killer, soften-killers (CSS and DOM), raise-media, scroll-strobe;
  - timing tricks: aliasing at 12.5 Hz and every frame, early start and late start;
  - other evasions: red-only, opaque and see-through strobe layers, source swap and flip (cpu-flood and the tainted canvas are David's, #73).
- **Security reviews** of other owners' PRs, which found real holes: the fail-open detector stub and fingerprinting (#8), overlay-killer beating the overlay before lockdown (#27, fixed in #33), the cloakable image probe (#41), the stale-report fail-open on video, the post-#102 strobe-layer gap (#103), click-timing on the bypass bar (#64), no fade-in on protective layers (#121), and the public autostart page (#136).
- **Docs:** README (what shipped, how to try it, security results, accessibility evidence), the Devpost draft, and the final numbers from 3x harness runs on the frozen build.
- Early work: demo fixtures and the demo HUD page. Covered Jun's whole area while Jun was offline Saturday afternoon.
- Presents at judging.
