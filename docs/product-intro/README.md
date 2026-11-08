# FlashBan product intro

Ten seconds, 1920×1080, 30 fps, silent. The editable HyperFrames project uses real FlashBan website captures and local brand fonts. The existing export is [renders/flashban-intro.mp4](renders/flashban-intro.mp4).

From this directory:

```bash
npm run dev       # editable preview
npm run check     # runtime, layout, contrast and timeline validation
npm run render -- --quality delivery -o renders/flashban-intro.mp4
```

The CLI is pinned in package.json. Node 22+, Chrome and FFmpeg are required for local rendering. HyperFrames caches and edit history stay local under .hyperframes/.

Source assets: the FlashBan website eye and protection-state panel captured on November 8, 2026. Fonts and their OFL notices are in assets/fonts/. The end-card letter cascade adapts HyperFrames registry component logo-brand-close; its source and registry checksum are included. No flashing footage or live detection claims. See STORYBOARD.md and REVIEW.md for the creative and verification scope.

Verify the exact export with the current FlashBan detector:

```bash
node verify-video.mjs
```

The checked-in verification.json records the MP4 SHA-256 and an offline 160×90 scan of every decoded frame at 30 fps, mapped to a 1920×1080 display. Both WCAG and Strict report zero violations; peak general-flash estimate is 2/s and red-flash estimate is 0/s. This is detector evidence, not a browser playback check or medical safety certification.
