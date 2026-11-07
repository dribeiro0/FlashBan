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
  | { type: "settings"; v: 1; preset: DetectorOptions["preset"]; guardedStart: boolean; failClosed: boolean; allowlist: string[] };
```

`domain` is the registrable domain only (for example `example.com`), never a full URL.

## 4. Local log (owner: Extension core), stored in `chrome.storage.local`

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
