// Safe-mode overlay (docs/CONTRACTS.md section 2).
//
// Design notes (threat model T6, T13):
// - Every panel lives in ONE overlay layer inside a CLOSED shadow root, and the
//   layer is a popover in the browser's top layer, so page CSS (z-index,
//   ::backdrop, generic selectors) can't reach it or stack above it.
// - The light-DOM wrapper is the only thing the page can see. Its inline styles
//   are !important (inline important beats any page stylesheet), and a check on
//   every frame re-attaches it, re-opens the layer and restores the styles if
//   the page tampers with them.
// - Panels are static: no animation except an optional slow opacity fade when a
//   temporary dim is released, which is skipped under prefers-reduced-motion.
// - "Show anyway" only works for trusted (real user) clicks or key presses.

const FADE_MS = 250;
const ANNOUNCE_GAP_MS = 5000;
const COMPACT_W = 220;
const COMPACT_H = 110;
const TAMPER_LIMIT = 5; // overlay removed or restyled this many times...
const TAMPER_WINDOW_MS = 2000; // ...within this window means the page is attacking it

const TAG = `ss-shield-${Math.random().toString(36).slice(2, 10)}`;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const WRAPPER_STYLE = [
  ["display", "block"],
  ["position", "fixed"],
  ["top", "0"],
  ["left", "0"],
  ["width", "0"],
  ["height", "0"],
  ["margin", "0"],
  ["padding", "0"],
  ["border", "0"],
  ["overflow", "visible"],
  ["visibility", "visible"],
  ["content-visibility", "visible"],
  ["opacity", "1"],
  ["filter", "none"],
  ["transform", "none"],
  ["zoom", "1"],
  ["clip-path", "none"],
  ["mask", "none"],
  ["contain", "none"],
  ["pointer-events", "none"],
  ["z-index", "2147483647"],
];

const SHADOW_CSS = `
  .layer {
    position: fixed; inset: 0; width: 100%; height: 100%;
    margin: 0; padding: 0; border: 0; background: transparent;
    overflow: hidden; pointer-events: none; color-scheme: normal;
  }
  .layer::backdrop { display: none; }
  .panel {
    position: absolute; left: 0; top: 0; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 12px; overflow: hidden; text-align: center;
    pointer-events: auto; opacity: 1; transition: opacity ${FADE_MS}ms linear;
    font: 600 15px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #ffffff;
  }
  .panel[hidden] { display: none; }
  /* Dim: the content stays visible but clearly darker, with a small label in
     the corner. Clicks go through to the page (only the "Show anyway" button
     catches them), so a dimmed thumbnail or player still works. Safety math:
     a 72% black layer leaves at most 28% of the sRGB value, so even a
     white/black strobe swings relative luminance by under 0.07 (WCAG's flash
     threshold is 0.10), and grayscale takes the colour out of red flashes.
     Cover: opaque, centred message, blocks clicks. No frames (lead, Sat 6:33 PM). */
  .panel.dim {
    justify-content: flex-start; align-items: flex-start; text-align: left;
    gap: 6px; padding: 8px;
    background: rgba(0, 0, 0, 0.72);
    -webkit-backdrop-filter: grayscale(1);
    backdrop-filter: grayscale(1);
    pointer-events: none;
  }
  .panel.dim button { pointer-events: auto; }
  .panel.dim .title, .panel.dim .reason {
    background: #121212; padding: 3px 8px; border-radius: 4px; max-width: calc(100% - 16px);
  }
  .panel.dim .title { font-size: 14px; }
  .panel.dim.checking .reason { display: none; }
  /* Light dim: a short, see-through check on a video that just started.
     Clicks go through to the video's own controls. */
  .panel.dim.light {
    background: rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    pointer-events: none;
  }
  /* One page-wide check, shown once per page. Never blocks clicks. */
  .pagecheck {
    position: absolute; inset: 0; display: flex; justify-content: center; align-items: flex-start;
    padding-top: 12px; background: rgba(0, 0, 0, 0.45); pointer-events: none;
    opacity: 1; transition: opacity ${FADE_MS}ms linear;
  }
  .pagecheck.fading { opacity: 0; }
  .pagecheck p {
    margin: 0; padding: 6px 12px; border-radius: 6px; background: #121212; color: #ffffff;
    font: 600 14px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .pagecheck .brand { margin-right: 8px; display: inline-block; }
  @media (prefers-reduced-motion: reduce) { .pagecheck { transition: none; } }
  /* The one bypass control for the page (lead decision, Sat 7:01 PM, David's
     proposal): a slim bar at the top right, never over the content it
     protects, with one button that shows the original on this site. */
  .bar {
    position: fixed; top: 8px; right: 8px; max-width: calc(100vw - 16px); box-sizing: border-box;
    display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px;
    background: #121212; color: #ffffff; border-radius: 999px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
    pointer-events: auto; font: 600 13px/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    text-align: left;
  }
  .bar[hidden] { display: none; }
  .bar .brand { margin: 0; }
  .bar .text { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar button { min-height: 32px; padding: 4px 12px; font-size: 13px; white-space: nowrap; }
  .panel.cover { background: #121212; }
  .brand {
    margin: 0; padding: 2px 8px; border-radius: 4px;
    background: #ffd84d; color: #121212; font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
  }
  .panel.fading { opacity: 0; }
  .title { margin: 0; font-size: 16px; }
  .reason { margin: 0; font-weight: 400; font-size: 13px; color: #e8e8e8; max-width: 36em; }
  .panel.compact { gap: 4px; padding: 6px; }
  .panel.compact .reason { display: none; }
  .panel.compact .title { font-size: 13px; }
  .panel.compact button { min-height: 32px; padding: 4px 10px; font-size: 13px; }
  button {
    font: inherit; font-size: 14px; min-height: 44px; min-width: 44px;
    padding: 8px 16px; border-radius: 6px; cursor: pointer;
    border: 2px solid #ffd84d; background: #ffd84d; color: #121212;
  }
  button:focus-visible { outline: 3px solid #ffffff; outline-offset: 3px; }
  .sr {
    position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  @media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
  @media (forced-colors: active) {
    .panel.dim, .panel.cover { background: Canvas; color: CanvasText; }
    .reason { color: CanvasText; }
    button { border-color: ButtonText; background: ButtonFace; color: ButtonText; }
  }
`;

/**
 * @typedef {Object} Guard
 * @property {Element} el
 * @property {"dim" | "cover"} mode
 * @property {string} reason
 * @property {boolean} canShow
 * @property {HTMLDivElement} panel
 * @property {number} fadeTimer   0 when not fading
 * @property {boolean} rendered
 * @property {number} [coverCheckAt]
 * @property {boolean} [coveredByLayer]
 * @property {DOMRect[] | null} [clipRects]
 */

/** @type {Map<Element, Guard>} */
const guards = new Map();
/** @type {WeakSet<Element>} */
const userShown = new WeakSet();
/** @type {((el: Element) => void) | null} */
let userShowHandler = null;
/** @type {(() => void) | null} */
let tamperHandler = null;
/** @type {number[]} */
let tamperTimes = [];
let tamperLocked = false;

/** @type {HTMLElement | null} */ let wrapper = null;
/** @type {ShadowRoot | null} */ let root = null;
/** @type {HTMLDivElement | null} */ let layer = null;
/** @type {HTMLDivElement | null} */ let live = null;
/** @type {HTMLDivElement | null} */ let bar = null;
/** @type {HTMLParagraphElement | null} */ let barText = null;
/** @type {(() => void) | null} */ let bypassHandler = null;
let softened = 0;
let barDismissed = false;
let barShownAt = 0; // clicks in the first BAR_ARM_MS after it appears are ignored (clickjacking)
const BAR_ARM_MS = 1000;
let wrapperStyleText = "";
let loopHandle = 0;
let lastAnnounce = 0;
let lastRaiseCheck = 0;

// ---------------------------------------------------------------- public API

/**
 * Hide an element behind a static panel.
 * @param {Element} el
 * @param {"dim" | "cover"} mode
 * @param {string} reason   plain-language text shown and announced to the user
 * @param {{ canShow?: boolean, announce?: boolean, light?: boolean }} [opts]
 *   canShow: offer a "Show anyway" button (default: true for cover, false for dim)
 *   light: a see-through dim that doesn't block clicks (a video's short check)
 */
export function guard(el, mode, reason, opts = {}) {
  if (!(el instanceof Element) || userShown.has(el)) return;
  ensureLayer();
  let g = guards.get(el);
  if (g && g.mode === "cover" && mode === "dim" && !g.fadeTimer) return; // never downgrade
  if (!g) {
    const panel = document.createElement("div");
    panel.className = "panel";
    g = { el, mode, reason, canShow: false, panel, fadeTimer: 0, rendered: false, light: false };
    guards.set(el, g);
    /** @type {HTMLDivElement} */ (layer).append(panel);
  }
  const wasFading = !!g.fadeTimer;
  if (wasFading) {
    clearTimeout(g.fadeTimer);
    g.fadeTimer = 0;
  }
  const canShow = opts.canShow ?? mode === "cover";
  const light = mode === "dim" && !!opts.light;
  const isNew = !g.rendered;
  const changed = isNew || wasFading || g.mode !== mode || g.reason !== reason || g.canShow !== canShow || g.light !== light;
  // Callers may guard the same element on every frame; only rebuild the panel
  // when something changed, or keyboard focus on its button would be lost.
  if (!changed) return;
  const escalated = g.mode !== mode && mode === "cover";
  g.mode = mode;
  g.reason = reason;
  g.canShow = canShow;
  g.light = light;
  g.rendered = true;
  render(g);
  position(g);
  openLayer();
  if (mode === "cover" && opts.announce !== false && (isNew || escalated)) {
    announce(`FlashBan hid flashing content on this page. ${reason}`);
  }
  refreshBar();
  startLoop();
}

/**
 * Remove a guard. Call only after a user action or a clean warm-up.
 * @param {Element} el
 * @param {{ immediate?: boolean }} [opts]
 */
export function release(el, opts = {}) {
  const g = guards.get(el);
  if (!g || g.fadeTimer) return;
  if (opts.immediate || reducedMotion.matches) {
    removeGuard(g);
    return;
  }
  g.panel.classList.add("fading");
  g.fadeTimer = setTimeout(() => removeGuard(g), FADE_MS);
}

/** @param {Element} el */
export function isGuarded(el) {
  const g = guards.get(el);
  return !!g && !g.fadeTimer;
}

/** @param {Element} el @returns {"dim" | "cover" | null} */
export function guardMode(el) {
  const g = guards.get(el);
  return g && !g.fadeTimer ? g.mode : null;
}

/** @param {Element} el */
export function wasShownByUser(el) {
  return userShown.has(el);
}

/** Called after the user chooses "Show anyway" for an element. */
export function onUserShow(/** @type {(el: Element) => void} */ fn) {
  userShowHandler = fn;
}

/** Called when the user presses "Show original on this site" in the bar. */
export function onBypass(/** @type {() => void} */ fn) {
  bypassHandler = fn;
}

/** The shield was turned back on for this page: the bar may show again. */
export function resetBar() {
  barDismissed = false;
  refreshBar();
}

/** How many elements are being softened right now (the bar counts them). @param {number} n */
export function setSoftened(n) {
  if (n === softened) return;
  softened = n;
  if (n > 0) ensureLayer();
  refreshBar();
}

/** The bar shows whenever anything on the page is softened, dimmed or hidden. */
function refreshBar() {
  if (!bar || !barText) return;
  const c = counts();
  const total = softened + c.dim + c.cover;
  const show = total > 0 && !barDismissed;
  if (!show) {
    if (!bar.hidden) {
      bar.hidden = true;
      if (guards.size === 0 && !pagePanel && softened === 0) closeLayer();
    }
    return;
  }
  const parts = [];
  if (softened) parts.push(`softening ${softened}`);
  if (c.dim) parts.push(`dimming ${c.dim}`);
  if (c.cover) parts.push(`hiding ${c.cover}`);
  barText.textContent = `${capitalize(parts.join(", "))} ${total === 1 ? "item" : "items"} on this page`;
  if (bar.hidden) {
    bar.hidden = false;
    barShownAt = performance.now();
  }
  openLayer();
  startLoop();
}

/** @param {string} t */
function capitalize(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Called once when the page keeps removing or restyling the overlay (threat T6).
 * The caller then locks the page down with CSS the page can't touch.
 */
export function onTamper(/** @type {() => void} */ fn) {
  tamperHandler = fn;
}

/** True once tampering was detected on this page. */
export function isTamperLocked() {
  return tamperLocked;
}

/** Count tampering with something other than the overlay (e.g. a page undoing a soften step). */
export function reportTamper() {
  noteTamper(performance.now());
}

function noteTamper(/** @type {number} */ now) {
  if (tamperLocked) return;
  tamperTimes.push(now);
  tamperTimes = tamperTimes.filter((t) => t > now - TAMPER_WINDOW_MS);
  if (tamperTimes.length >= TAMPER_LIMIT) {
    tamperLocked = true;
    try {
      tamperHandler?.();
    } catch {}
  }
}

export function counts() {
  let dim = 0;
  let cover = 0;
  for (const g of guards.values()) {
    if (g.fadeTimer) continue;
    if (g.mode === "cover") cover++;
    else dim++;
  }
  return { dim, cover };
}

/** Remove every guard (used when the user turns the shield off for this site). */
export function releaseAll() {
  for (const g of [...guards.values()]) removeGuard(g);
  softened = 0;
  refreshBar();
  hidePageCheck(true);
}

/** @type {HTMLDivElement | null} */ let pagePanel = null;
let pageTimer = 0;

/**
 * One light, page-wide "checking" dim, shown once per page instead of a dim on
 * every element. It lifts by itself after `ms` and never blocks clicks. Not
 * announced: it's brief and would be noise for screen-reader users.
 * @param {string} text @param {number} ms
 */
export function checkPage(text, ms) {
  ensureLayer();
  if (pagePanel) return;
  pagePanel = document.createElement("div");
  pagePanel.className = "pagecheck";
  pagePanel.setAttribute("aria-hidden", "true");
  const chip = document.createElement("p");
  const brand = document.createElement("span");
  brand.className = "brand";
  brand.textContent = "FlashBan";
  chip.append(brand, document.createTextNode(text));
  pagePanel.append(chip);
  /** @type {HTMLDivElement} */ (layer).append(pagePanel);
  openLayer();
  pageTimer = setTimeout(() => hidePageCheck(false), ms);
}

/** @param {boolean} immediate */
function hidePageCheck(immediate) {
  clearTimeout(pageTimer);
  const p = pagePanel;
  if (!p) return;
  const done = () => {
    p.remove();
    if (pagePanel === p) pagePanel = null;
    if (guards.size === 0 && (!bar || bar.hidden)) closeLayer();
  };
  if (immediate || reducedMotion.matches) return done();
  p.classList.add("fading");
  setTimeout(done, FADE_MS);
}

// ---------------------------------------------------------------- internals

function ensureLayer() {
  if (wrapper) return;
  wrapper = document.createElement(TAG);
  for (const [prop, value] of WRAPPER_STYLE) wrapper.style.setProperty(prop, value, "important");
  wrapperStyleText = wrapper.getAttribute("style") || "";
  root = wrapper.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = SHADOW_CSS;

  live = document.createElement("div");
  live.className = "sr";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "assertive");

  layer = document.createElement("div");
  layer.className = "layer";
  layer.setAttribute("popover", "manual");

  bar = document.createElement("div");
  bar.className = "bar";
  bar.hidden = true;
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "FlashBan");
  const brand = document.createElement("p");
  brand.className = "brand";
  brand.textContent = "FlashBan";
  brand.setAttribute("aria-hidden", "true");
  barText = document.createElement("p");
  barText.className = "text";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Show original on this site";
  btn.setAttribute("aria-label", "Show the original on this site. FlashBan stops softening and dimming here until you turn it back on in the FlashBan popup.");
  btn.addEventListener("click", (e) => {
    if (!e.isTrusted) return; // the page can't press this for the user (T6/T7)
    // A page could start a strobe while the user is clicking something it put
    // at the top right, so the next click lands here. Like Chrome's permission
    // prompts, the button only arms after it has been visible for a second.
    if (performance.now() - barShownAt < BAR_ARM_MS) return;
    barDismissed = true;
    announce("Showing the original on this site. Turn FlashBan back on for this site in the FlashBan popup.");
    try {
      bypassHandler?.();
    } catch {}
    refreshBar();
  });
  bar.append(brand, barText, btn);
  layer.append(bar);

  root.append(style, live, layer);
  attachWrapper();
  document.addEventListener("fullscreenchange", raise, true);
}

function attachWrapper() {
  if (!wrapper) return;
  const parent = document.documentElement;
  if (parent && wrapper.parentNode !== parent) parent.append(wrapper);
}

function openLayer() {
  if (!layer || !wrapper || !wrapper.isConnected) return;
  if (!layer.matches(":popover-open")) {
    try {
      layer.showPopover();
    } catch {
      // Popover API unavailable or blocked: the wrapper's fixed position and
      // max z-index still put the panels above almost everything.
    }
  }
}

function closeLayer() {
  if (layer && layer.matches(":popover-open")) {
    try {
      layer.hidePopover();
    } catch {}
  }
}

/** Move our layer above top-layer content the page opened after us. */
function raise() {
  if (!layer || guards.size === 0) return;
  // Re-raising would drop keyboard focus inside our panel; skip while focused.
  if (document.activeElement === wrapper) return;
  closeLayer();
  openLayer();
}

/** @param {Guard} g */
function render(g) {
  const { panel } = g;
  panel.className = `panel ${g.mode}${g.mode === "dim" && !g.canShow ? " checking" : ""}${g.light ? " light" : ""}`;
  panel.replaceChildren();
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", g.mode === "cover" ? "Flashing content hidden by FlashBan" : "Content dimmed by FlashBan");

  const brand = document.createElement("p");
  brand.className = "brand";
  brand.textContent = "FlashBan";
  brand.setAttribute("aria-hidden", "true");

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = g.mode === "cover" ? "Flashing content hidden" : g.canShow ? "Dimmed for safety" : "Checking for flashing…";
  const reason = document.createElement("p");
  reason.className = "reason";
  reason.textContent = g.reason;
  panel.append(brand, title, reason);

  // No per-element "Show anyway" button any more (lead decision, Sat 7:01 PM):
  // the one bypass for the page is the bar's "Show original on this site".
}

/** @param {Guard} g */
function position(g) {
  const el = g.el;
  if (!el.isConnected) {
    removeGuard(g);
    return;
  }
  const r = el.getBoundingClientRect();
  let visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  // An element under a modal or lightbox (a fixed layer from another branch
  // of the page) isn't what the viewer sees: no panel for it while covered.
  // Checked a few times a second; video controls and captions inside the
  // same player are absolute, not fixed, and keep the panel.
  if (visible) {
    const now = performance.now();
    if (now - (g.coverCheckAt || 0) > 250) {
      g.coverCheckAt = now;
      const layers = coveringLayers(el, r);
      g.coveredByLayer = layers === "all";
      g.clipRects = layers === "all" ? null : layers;
    }
    if (g.coveredByLayer) visible = false;
  }
  if (!visible) {
    if (!g.panel.hidden) g.panel.hidden = true;
    return;
  }
  if (g.panel.hidden) g.panel.hidden = false;
  const s = g.panel.style;
  s.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
  s.width = `${Math.ceil(r.width)}px`;
  s.height = `${Math.ceil(r.height)}px`;
  // An element that starts above or left of the viewport (a scaled backdrop
  // canvas, a tall container) would put the label off screen: pad it in.
  // Parts of the media under a sticky header or other fixed layer are cut out
  // of the panel, so the page's own chrome stays on top of it (David, 8:27 PM).
  const holes = g.clipRects;
  if (holes && holes.length) {
    let d = `M0 0H${Math.ceil(r.width)}V${Math.ceil(r.height)}H0Z`;
    for (const h of holes) {
      const x1 = Math.max(0, h.left - r.left), y1 = Math.max(0, h.top - r.top);
      const x2 = Math.min(r.width, h.right - r.left), y2 = Math.min(r.height, h.bottom - r.top);
      if (x2 > x1 && y2 > y1) d += `M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
    }
    s.clipPath = `path(evenodd, "${d}")`;
  } else if (s.clipPath) s.clipPath = "";
  const padTop = r.top < 0 ? Math.min(-r.top, Math.max(0, r.height - 60)) : 0;
  const padLeft = r.left < 0 ? Math.min(-r.left, Math.max(0, r.width - 160)) : 0;
  s.paddingTop = padTop ? `${Math.round(padTop + 8)}px` : "";
  s.paddingLeft = padLeft ? `${Math.round(padLeft + 8)}px` : "";
  g.panel.classList.toggle("compact", r.width < COMPACT_W || r.height < COMPACT_H);
}

/**
 * Which fixed/sticky layers, dialogs or aria-modal layers from another branch
 * of the page (neither inside `el` nor an ancestor of it) paint over `el`'s
 * visible rect? Sampled on a 3x3 grid. Returns "all" when the centre is
 * covered (a modal or lightbox: no panel at all), else the covering layers'
 * rects (cut out of the panel), possibly empty.
 * @param {Element} el @param {DOMRect} r
 * @returns {"all" | DOMRect[]}
 */
function coveringLayers(el, r) {
  const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth);
  const y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight);
  /** @type {DOMRect[]} */ const rects = [];
  /** @type {Set<Element>} */ const seen = new Set();
  for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) {
    const px = x0 + ((ix + 0.5) / 3) * (x1 - x0);
    const py = y0 + ((iy + 0.5) / 3) * (y1 - y0);
    const layer = fixedLayerAt(el, px, py);
    if (!layer) continue;
    if (ix === 1 && iy === 1) return "all";
    if (seen.has(layer)) continue;
    seen.add(layer);
    rects.push(layer.getBoundingClientRect());
  }
  return rects;
}

/** The fixed/sticky/dialog layer painting at (x, y) that is unrelated to `el`, or null. @param {Element} el @param {number} x @param {number} y */
function fixedLayerAt(el, x, y) {
  let hit;
  try {
    hit = document.elementFromPoint(x, y);
  } catch {
    return null;
  }
  if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return null;
  if (hit.localName.startsWith("ss-")) return null; // our own layers take no pointer events anyway
  for (let p = /** @type {Element | null} */ (hit), depth = 0; p && p !== document.body && depth < 24; p = p.parentElement, depth++) {
    if (p.contains(el)) return null; // shared ancestor reached: same branch (player chrome)
    if (p.localName === "dialog" || p.getAttribute("aria-modal") === "true") return p;
    try {
      const pos = getComputedStyle(p).position;
      if (pos === "fixed" || pos === "sticky") return p;
    } catch {}
  }
  return null;
}

/** @param {Guard} g */
function removeGuard(g) {
  if (g.fadeTimer) clearTimeout(g.fadeTimer);
  g.fadeTimer = 0;
  g.panel.remove();
  guards.delete(g.el);
  refreshBar();
  if (guards.size === 0 && !pagePanel && (!bar || bar.hidden)) closeLayer();
}

/** @param {string} text */
function announce(text) {
  const now = performance.now();
  if (!live || now - lastAnnounce < ANNOUNCE_GAP_MS) return;
  lastAnnounce = now;
  live.textContent = "";
  setTimeout(() => {
    if (live) live.textContent = text;
  }, 50);
}

function startLoop() {
  if (!loopHandle) loopHandle = requestAnimationFrame(tick);
}

/** @param {number} now */
function tick(now) {
  loopHandle = 0;
  if (guards.size === 0 && (!bar || bar.hidden)) return;

  // Tamper checks (threat T6): re-attach, restore styles, re-open the layer.
  // Repeated tampering hands off to the page lockdown (CSS the page can't
  // remove); after that we stop re-inserting, which would only feed the
  // attacker's MutationObserver.
  if (wrapper && !tamperLocked) {
    if (!wrapper.isConnected) {
      noteTamper(now);
      attachWrapper();
    }
    if ((wrapper.getAttribute("style") || "") !== wrapperStyleText) {
      noteTamper(now);
      wrapper.setAttribute("style", wrapperStyleText);
    }
    for (const attr of [...wrapper.attributes]) if (attr.name !== "style") wrapper.removeAttribute(attr.name);
  }
  if (!tamperLocked) openLayer();
  if (now - lastRaiseCheck > 500) {
    lastRaiseCheck = now;
    let otherTopLayer = !!document.fullscreenElement;
    try {
      otherTopLayer ||= !!document.querySelector("dialog:modal, :popover-open");
    } catch {}
    if (otherTopLayer) raise();
  }

  for (const g of [...guards.values()]) position(g);
  loopHandle = requestAnimationFrame(tick);
}
