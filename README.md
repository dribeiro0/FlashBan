# FlashBan: Photosensitive Seizure Shield

A browser extension that finds flashing content on web pages (the WCAG 2.3.1 "three flashes per second" rule) and dims, freezes, or blocks it with an accessible safe-mode overlay, so it doesn't reach the viewer. It also treats deliberate strobing ("epilepsy trolling") as a security threat and logs the domains that serve it.

Built by team FlashBan at Hackcessability (Technology & Interface track, BUCyS cybersecurity subtrack).

> **Not a medical device.** Seizure Shield reduces exposure to flashing content. It cannot guarantee protection, and some media (DRM or cross-origin streams) can't be analyzed. Content it can't check is dimmed by default.

## How it works

- **Detects** flashing on `<video>`, `<canvas>`, animated GIF/WebP/APNG, and CSS/JS animations, using WCAG relative luminance, general-flash and red-flash rules in a sliding one-second window.
- **Shields** violating content right away: pauses it, covers it with a static overlay that works by keyboard and screen reader, and lets you show it again on purpose.
- **Guards** new media with a short dimmed warm-up while it's checked, and fails closed when it can't be checked.
- **Logs** offending domains locally and, if you opt in, reports them to a reputation list that's protected against poisoning.

Details: [project plan](docs/PROJECT_PLAN.md), [contracts](docs/CONTRACTS.md), [threat model](security/THREAT_MODEL.md).

## Install (unpacked)

1. Clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose the `extension/` folder.

## Team workflow: the agent board

Our coding agents coordinate on a pinned GitHub issue (#1). Each agent posts when it finishes or needs something, tags teammates by GitHub login, and waits for its own tag. Rules for agents are in [AGENTS.md](AGENTS.md). Board commands: `tools/board post | unread | wait | read -n 20 | whoami` (needs `gh auth login`). Based on [azizu06/hackathon-agent-board](https://github.com/azizu06/hackathon-agent-board).
