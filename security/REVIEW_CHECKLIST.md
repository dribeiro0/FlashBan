# Security review checklist (extension)

Owner: @sysoutprntlne. Planning draft, November 6, 2026. Nothing here has been checked yet: the extension does not exist on `main`.

Run this once @DxubleBTW posts the manifest and message format, and again at feature freeze (Sunday about 10:00). For each item, record **pass / fail / n/a**, the commit, and the file and line that shows it. Post failures on the board tagging the file's owner; do not fix other owners' files directly. Threat numbers (T1 to T13) refer to [THREAT_MODEL.md](THREAT_MODEL.md).

## 1. Manifest and permissions (`extension/manifest.json`)

| # | Check | How to check | Threats |
|---|---|---|---|
| M1 | `manifest_version` is 3. | Read the manifest. | T12 |
| M2 | `permissions` lists only what is used: expect `storage`, possibly `offscreen`. No `tabs`, `history`, `cookies`, `webRequest`, `debugger`, `management`, `<all_urls>` in `permissions`. Each permission has a one-line justification in the PR. | Compare each permission with a `grep` for its API (`chrome.storage`, `chrome.offscreen`, ...). | T11, T12 |
| M3 | Host access is limited to what detection needs (content scripts on `http`/`https` pages; host permissions only if the service worker fetches GIF/MP4 bytes). No `file://` unless the user enables it. | Read `content_scripts.matches` and `host_permissions`. | T4, T12 |
| M4 | No `externally_connectable`, or it is limited to our API origin. No `web_accessible_resources`, or each one is listed with a reason and `matches` is as narrow as possible (so pages can't fingerprint or frame our UI). If detector modules are loaded with dynamic `import()` through `web_accessible_resources`, any page can fetch them and detect the extension; bundling them into the content script avoids that. | Read the manifest. | T6, T7 |
| M5 | `content_security_policy.extension_pages` is at least `script-src 'self'; object-src 'self'`, with no `unsafe-eval`, `unsafe-inline`, `wasm-unsafe-eval` (unless a decoder needs it and it is justified), or remote hosts. | Read the manifest. | T12 |
| M6 | Content scripts run in the isolated world (no `"world": "MAIN"`). | Read `content_scripts`. | T6, T7 |

## 2. Code (no remote code, no dynamic code)

| # | Check | How to check | Threats |
|---|---|---|---|
| C1 | No `eval`, `new Function`, string `setTimeout`/`setInterval`, or `import()` of a computed URL. | `grep -rnE "eval\(|new Function|setTimeout\(\s*['\"\`]|setInterval\(\s*['\"\`]|import\(" extension/` | T12 |
| C2 | No script, style or module loaded from a remote URL; all code ships in the package. | `grep -rnE "https?://" extension/` and review every hit (the API base URL is the only expected one). | T12 |
| C3 | No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` with page-derived strings. The overlay is built with `createElement` and `textContent`. | `grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write" extension/` | T6 |
| C4 | Dependencies (if any) are pinned with a lockfile; no CDN imports. | Check `package.json` / lockfile. | T12 |
| C5 | Detector code stays pure: no DOM or `chrome.*` in `extension/src/detect/`. | `grep -rnE "document\.|window\.|chrome\." extension/src/detect/` | T5 (a crash can't escape into the page) |

## 3. Messages (`chrome.runtime` content script to background)

| # | Check | How to check | Threats |
|---|---|---|---|
| G1 | Every `onMessage` handler first checks `sender.id === chrome.runtime.id` and drops anything else. | Read each `chrome.runtime.onMessage.addListener`. | T7 |
| G2 | Every message is validated against the `docs/CONTRACTS.md` section 3 shape before use: known `type`, `v === 1`, every field type and range checked, unknown fields rejected. Invalid messages are dropped (no throw that leaves state half-updated). | Read the validator; send a malformed message from the service-worker console and confirm it is ignored. | T7 |
| G3 | No `onMessageExternal` / `onConnectExternal` listener, unless needed and also validated. | `grep -rn "External" extension/` | T7 |
| G4 | The content script never trusts `window.postMessage`, DOM events or page globals as commands (pages can forge them). | `grep -rnE "addEventListener\(['\"]message|postMessage" extension/src/content/` | T6, T7 |
| G5 | `domain` in a `violation` message is the registrable domain computed by the extension, never taken from page input. | Read where `domain` is set. | T7, T11 |
| G6 | HUD path (`docs/CONTRACTS.md` section 3a): `onConnect` accepts the `hud` port only from our own extension page (`sender.id === chrome.runtime.id`, `sender.url` under `chrome-extension://<our id>/hud/`, no `sender.tab` content script). `hudSubscribe` is validated (integer `tabId`). Reports are relayed only while the Demo HUD setting is on, for that one tab, throttled to 10 per second per source. Relayed messages contain no URL, selector or page text. | Read the `onConnect` handler; connect from a content script and confirm it is refused; turn the setting off and confirm the relay stops. | T6, T7, T11 |

## 4. Safe-mode overlay (`extension/src/content/safemode.ts`)

| # | Check | How to check | Threats |
|---|---|---|---|
| O1 | The overlay lives in a **closed** shadow root (`attachShadow({ mode: "closed" })`) and its styles are inside the shadow root. | Read `guard()`. | T6 |
| O2 | It uses the top layer (`<dialog>`/popover) where possible, so page `z-index` and `overflow` can't hide it. | Read `guard()`; test on a page with `z-index: 2147483647` content. | T6 |
| O3 | A `MutationObserver` re-applies the guard if the overlay host is removed, hidden or restyled, and guard state is kept in content-script memory, not in DOM attributes the page can edit. | Run `demo/adversarial/overlay-killer.html`. | T6 |
| O4 | The overlay is static: no animation, flicker or fast transition; slow fade or none under `prefers-reduced-motion`. | Inspect computed styles; toggle reduced motion. | T13 |
| O5 | "Show anyway" needs a real user action (`event.isTrusted`), applies to that one element for the session only, and can't be triggered by page script. | Dispatch a synthetic click from the page console; confirm nothing happens. | T6 |
| O6 | Fail closed: tainted canvas, DRM video, detector error and over-budget all lead to dim + "can't verify", never to release. | Run `tainted.html` and `cpu-flood.html`. | T4, T5 |

## 5. Storage and privacy

| # | Check | How to check | Threats |
|---|---|---|---|
| P1 | The local log matches `docs/CONTRACTS.md` section 4: registrable domain plus counts and metrics only. No full URL, path, query string, page title or content anywhere in `chrome.storage`. | Visit `https://example.com/a?b=c` with a fixture; dump `chrome.storage.local.get()`. | T11 |
| P2 | Reporting to the API is off by default and opt-in in the UI. Reports carry only the section 5 fields; the install id is a random UUID, not derived from the user or device. | Read the report code; watch the network tab. | T11 |
| P3 | No secrets, API keys or `.env` files in the repo or the package. | `git grep -nIE "api[_-]?key|secret|token|BEGIN .*PRIVATE"`; check `.gitignore`. | T12 |
| P4 | Settings and allowlist from storage are validated on read (a corrupted or hand-edited value can't crash the worker or disable the shield). | Write a bad value to storage; reload. | T7 |

## 6. Detection integrity (shared with detection and core)

These are mainly proven by the adversarial pages (see [ADVERSARIAL_PLAN.md](ADVERSARIAL_PLAN.md)); the review only checks the code path exists.

| # | Check | Threats |
|---|---|---|
| D1 | Video sampled with `requestVideoFrameCallback`, canvas with `requestAnimationFrame`; no timer slower than 30 Hz; timestamps from rVFC/`performance.now()`, not frame counts. | T1 |
| D2 | Flash area is summed across elements in the viewport (the proposed `createAggregator()`), not judged per element. | T2 |
| D3 | Red-flash detector is wired in, not only general flash. | T3 |
| D4 | Detection keeps running after guarded start ends. | T8 |
| D5 | A per-page CPU budget exists and exceeding it fails closed. | T5 |

## Threat coverage

| Threat | Checklist items |
|---|---|
| T1 aliasing | D1 |
| T2 split area | D2 |
| T3 red-only | D3 |
| T4 unreadable pixels | M3, O6 |
| T5 CPU exhaustion | C5, O6, D5 |
| T6 overlay removal | M4, M6, C3, G4, G6, O1, O2, O3, O5 |
| T7 message spoofing | M4, M6, G1 to G6, P4 |
| T8 late start | D4 |
| T9 report poisoning | backend: see [api/DESIGN.md](../api/DESIGN.md) |
| T10 API spam | backend: see [api/DESIGN.md](../api/DESIGN.md) |
| T11 privacy leak | M2, G5, G6, P1, P2 |
| T12 supply chain / remote code | M1, M2, M3, M5, C1, C2, C4, P3 |
| T13 overlay flicker | O4 |
