# Contracts between owners

These are the interfaces where one person's code meets another's. Agents must not change a contract silently: post the proposed change on the board, tag the affected owner, and wait for an OK. Bump the `v` field when a shape changes.

## 1. Detector API (owner: Detection) used by Content script

```ts
// extension/src/detect/index.ts
export type DetectorOptions = {
  preset: "strict" | "wcag" | "relaxed";
  sampleWidth: number;          // e.g. 128
  sampleHeight: number;         // e.g. 72
  realAreaScale: number;        // CSS px per sample px (accounts for element size and zoom; NOT devicePixelRatio)
};

export type FrameSample = {
  t: number;                    // ms timestamp (performance.now or rVFC mediaTime*1000)
  pixels: Uint8ClampedArray;    // RGBA, sampleWidth * sampleHeight * 4
  // Additive (Nov 7, v stays 1): false = no presented frame was missed since the
  // last sample (rVFC presentedFrames jumped by 1), so a gap over 100 ms is the
  // content's own frame rate and isn't "undersampled". Absent/true = fail closed.
  dropped?: boolean;
};

export type FlashReport = {
  v: 1;
  flashesPerSecond: number;     // general flashes in the last 1000 ms
  redFlashesPerSecond: number;
  areaPx: number;               // CSS px of pixels over the preset's flash limit in this window (the violation uses this)
  areaPct: number;              // areaPx / element visible area (display only)
  violation: boolean;           // true when the active preset is exceeded
  severity: "none" | "warn" | "block";
  reason?: "general" | "red" | "both";
  // Additive fields, approved by the lead on 2026-11-06 (v stays 1):
  windowMs?: number;            // window used, normally 1000
  sampleRateHz?: number;        // measured input rate, for the HUD and aliasing checks
  undersampled?: boolean;       // gaps > 100 ms seen; severity is at least "warn"
  redAreaPx?: number;           // CSS px of red-flashing pixels
};

export function createDetector(opts: DetectorOptions): {
  push(sample: FrameSample): FlashReport;
  peek(): FlashReport;          // last report without a new sample (HUD polling)
  mask(): Uint8Array | null;    // additive (Nov 7): copy, 1 = sample pixel over the flash limit (general or red); null if the detector always blocks
  reset(): void;
};

// Soften filter #2 (additive, Nov 7): brightness clamp inside the detector's mask.
// No mask = whole frame clamped. Never throws; bad input returns grey and sets failed (caller blocks).
export function createClampSoftener(opts: { width: number; height: number; maskWidth?: number; maskHeight?: number }): {
  push(pixels: Uint8ClampedArray, t: number, mask?: Uint8Array): Uint8ClampedArray;
  readonly failed: boolean;
  reset(): void;
};

// Cross-element area (threat T2). Pure; called by the content script, which knows element rects.
export function createAggregator(preset: DetectorOptions["preset"]): {
  update(r: { id: string; t: number; areaPx: number; redAreaPx?: number; rect?: DOMRectReadOnly }): void;
  result(t: number): { violation: boolean; totalAreaPx: number; ids: string[] }; // ids = sources to guard
};

// HUD reads only: flashesPerSecond, redFlashesPerSecond, areaPx, areaPct, severity, reason,
// sampleRateHz, undersampled. Label them "detector estimates", not display measurements.

// CSS path, no pixels needed
export function analyzeAnimation(a: Animation): {
  cyclesPerSecond: number;
  maxLuminanceDelta: number;    // between keyframes, 0..1
  violation: boolean;
};
```

Rules: detector code is pure (no DOM, no `chrome.*`), runs in Node for tests, never throws on bad input (returns `severity: "block"` with `violation: true` if input is unreadable, which keeps it fail-closed).

**Module format (decided at kickoff):** plain JavaScript ES modules with JSDoc types, no TypeScript and no build step, so `index.ts` above means `extension/src/detect/index.js`. Imports inside `extension/src/` are relative and end in `.js`; runtime files never import Node built-ins (tests may). The content script loads modules with `import(chrome.runtime.getURL("src/content/main.js"))`, and `src/content/*.js` and `src/detect/*.js` are listed in the manifest's `web_accessible_resources`. Tests run with `npm test` (`node --test`, no dependencies) from the repo root.

## 2. Safe mode API (owner: Content/UI) used by everything that hides content

```ts
// extension/src/content/safemode.ts
export function guard(el: Element, mode: "dim" | "cover", reason: string): void;
export function release(el: Element): void;   // only after user action or a clean warm-up
export function isGuarded(el: Element): boolean;
```

## 3. Messages: content script to background (owner: Extension core)

All messages are `chrome.runtime.sendMessage` objects. The background checks `sender.id === chrome.runtime.id` and validates the shape before using it.

```ts
type Msg =
  | { type: "violation"; v: 1; domain: string; source: "video" | "canvas" | "css" | "gif" | "dom"; report: FlashReport; at: number }
  | { type: "getSettings"; v: 1 }
  | { type: "settings"; v: 1; preset: DetectorOptions["preset"]; guardedStart: boolean; failClosed: boolean; allowlist: string[]; hud: boolean };
```

Settings live in `chrome.storage.local` under `settings` and are normalized by `extension/src/shared/settings.js` (`normalizeSettings`); content scripts read them directly and follow `storage.onChanged`. The popup asks the top frame for status with `{ type: "getStatus", v: 1 }` and gets `{ type: "status", v: 1, domain, enabled, detector: "loaded" | "error", sources, dimmed, covered, lockdown }`.

**Page lockdown (threat T6):** when a page keeps removing or restyling the overlay (5 times in 2 s), the content script sends `{ type: "lockdown", v: 1, on: true }` and the background applies a fixed stylesheet with `chrome.scripting.insertCSS({ origin: "USER" })` to that frame: media hidden, animations paused, page dimmed and grey, plus a banner. Pages can't see or remove it. `{ ..., on: false }` removes it when the user turns protection off for the site. The message never carries CSS.

**Media we can't check (lead decision, Sat 4:10 PM: option B, replacing 3:34 PM option A):** media the content script can't read (cross-origin without CORS, DRM, tainted canvas, unreadable styles) is always dimmed, playing or not (`UNVERIFIABLE_POLICY = "always"` in main.js; `"while-active"` restores option A and the image probe).

**Soften first for "another site" video (lead priority, Sat 7:38 PM):** on hosts whose media CDN answers CORS (YouTube family for now, `CORS_VIDEO_HOSTS`), the content script sets `crossorigin="anonymous"` on video elements as they appear, so videos served as plain files become readable and get softened instead of dimmed; a CORS-refused source gets the attribute removed so the player can retry. An unverifiable element whose effective opacity is under 0.5 (an ambient-light glow drawn from an unreadable video) is faded to opacity 0.08 instead of getting a panel. A panel is hidden while its element sits under a modal or lightbox (a fixed layer from another branch of the page).

**Bypass (lead decision, Sat 7:01 PM, David's proposal):** no per-element "Show anyway". Whenever anything on the page is softened, dimmed or hidden, one slim bar at the top right (inside the overlay's closed shadow root) says "Softening N, dimming M items on this page" with a single "Show original on this site" button: trusted clicks only, adds the site to `settings.allowlist` (so the shield turns off here through the normal settings path), and the popup's per-site switch is the undo.

**Checking (same decision):** no per-element checking dim. The first time media appears, the page gets one light page-wide dim (1.2 s, never blocks clicks); a video that starts gets a light see-through dim for 2 s (held a little longer while the detector is unsure, but never past 3.5 s, and never re-applied to that video). Media is sampled at most ~12 times a second (a 720p readback costs about 5 ms); a sampling gap alone never covers a video, but if more than half the samples in 4 s missed frames the video is dimmed as unverifiable. Soften draws the filtered copy at the media's own resolution (GPU, `globalAlpha` path from SOFTEN_DESIGN section 4) and the verifier reads the on-screen output back at 160x90, 15 times a second. The detector still covers or softens anything that flashes. Sites with a past violation in the local log are repeat offenders: strict preset, guarded start, and unverifiable media always dimmed. `status` also carries `repeatOffender: boolean`.

**Image probe (used under option B too, lead decision Sat 5:35 PM):** a cross-origin WebP/APNG image is dimmed only if the probe says it is animated or can't tell; a still is left alone (sites serve most photos as .webp). GIFs are never probed and always count as animated. For cross-origin animated-format images the content script sends `{ type: "probeImage", v: 1, url }` (http/https only, at most 2048 chars) and gets `{ type: "probeResult", v: 1, animated: true | false | null }`. The background fetches at most 512 KB without cookies (4 s timeout, 4 at a time, cached) and reads only container headers. `null` means unknown, treated as animated.

**DOM flicker:** elements whose class/style/hidden attributes keep changing are sampled as `source: "dom"`: a 1x1 frame of their estimated on-screen colour, with `realAreaScale = sqrt(visible area)`.

`domain` is the registrable domain only (for example `example.com`), never a full URL.

### 3a. HUD read path (owner: Extension core; reader: Demo HUD)

The HUD is an **extension page** (`extension/hud/hud.html`, opened from the popup), not part of a web page, so a malicious page can never read or spoof detector numbers. It is off unless the "Demo HUD" setting is on.

- HUD connects with `chrome.runtime.connect({ name: "hud" })` and sends `{ type: "hudSubscribe", v: 1, tabId: number }`.
- Background relays reports for that tab only, throttled to at most 10 per second per source:

```ts
type HudMsg =
  | { type: "report"; v: 1; tabId: number; sourceId: string; source: "video" | "canvas" | "css" | "gif" | "dom"; preset: DetectorOptions["preset"]; report: FlashReport; at: number }
  | { type: "page"; v: 1; tabId: number; aggregate: { violation: boolean; totalAreaPx: number; ids: string[] }; at: number };
```

- Content scripts send the same `report` objects to the background on the existing runtime channel; the background checks `sender.id === chrome.runtime.id` and drops them if the Demo HUD setting is off.
- The HUD shows only the fields listed in section 1, labelled "detector estimates", and "unavailable" when no report has arrived for 1 s.
- `sourceId` is an opaque per-element id from the content script. No URLs, selectors or page text are sent. The background prefixes it with the frame (`f0-s1`).
- After `hudSubscribe`, and whenever the setting changes, the background sends `{ type: "hudStatus", v: 1, enabled: boolean }` so the HUD can say "Demo HUD is off" instead of waiting.

## 4. Local log (owner: Extension core), stored in `chrome.storage.local`

Entries older than 30 days are deleted (on every write and when the worker starts). The popup shows the log (site and date only) and can clear it ("Clear my data").

```json
{ "v": 1, "domains": { "example.com": { "count": 3, "firstSeen": 1731000000000, "lastSeen": 1731003600000, "maxFps": 7.5, "sources": ["video", "css"] } } }
```

## 5. Backend API (owner: Backend/Security)

`POST /api/reports`
```json
{ "v": 1, "install": "random-uuid-per-install", "domain": "example.com", "source": "video", "flashesPerSecond": 7.5, "areaPct": 0.42, "red": false, "at": 1731000000000 }
```
- 202 on accept, 400 on invalid shape, 413 over 2 KB, 429 when rate limited.
- Validation: `domain` must match a hostname regex and be at most 253 chars; numbers in range; unknown fields rejected.

`GET /api/domains`
```json
{ "v": 1, "updated": 1731000000000, "domains": [ { "domain": "example.com", "severity": "block", "reports": 12, "installs": 5, "lastSeen": 1731000000000 } ] }
```
- A domain is listed only with reports from at least N distinct installs (start with N = 3) within 7 days.

## 6. Demo pages (owner: Demo/Docs)

Each page in `demo/` sets `<meta name="shield-expected" content="block|allow">` and a short description, so the extension can be checked automatically.
