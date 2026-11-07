// Content-script entry point (loaded by loader.js as an ES module).
//
// Finds media (video, canvas, animated images, CSS animations), samples every
// rendered frame into the detector (docs/CONTRACTS.md section 1), and applies
// safe mode (section 2). Violations go to the background (section 3) and,
// when the Demo HUD is on, so do per-source reports (section 3a).

import * as safemode from "./safemode.js";
import { loadDetector } from "./detector.js";
import { backdropOf, effectiveColor, visibleArea, relativeLuminance } from "./domflicker.js";
import { startSoften } from "./soften.js";
import { normalizeSettings, registrableDomain } from "../shared/settings.js";

// ---------------------------------------------------------------- tuning

const SAMPLE_BUDGET_PX = 128 * 72; // pixels per sampled frame (aspect kept)
const DEGRADED_BUDGET_PX = 64 * 36;
const MIN_MEDIA_CSS_PX = 16; // ignore media smaller than this on either side
const GUARD_START_MIN_AREA = 64 * 64; // smaller media skip guarded start
const WARMUP_MS = 800; // guarded-start dim at least this long
const WARN_HOLD_MS = 1000; // keep a "warn" dim this long after the last warn
const HUD_INTERVAL_MS = 100; // max 10 reports per second per source
const VIOLATION_MSG_INTERVAL_MS = 10_000;
const MAX_ACTIVE = 24; // visible sources analysed at once (threat T5)
const STATIC_IMAGE_MS = 3000; // stop sampling images that never change
const RESIZE_MIN_GAP_MS = 2000; // rebuild the detector at most this often
const RESIZE_CHURN_LIMIT = 10; // more skipped resizes than this: fail closed
const ANIM_EXT = /\.(gif|webp|apng)(\?|#|$)/i;
// Script-driven DOM flicker (class / style / hidden toggles)
const DOM_HOT_MUTATIONS = 2; // mutations within 1 s before we start sampling an element
const DOM_HOT_MS = 1500; // keep sampling this long after the last mutation
const DOM_FORGET_MS = 10_000; // drop a quiet element's sampler after this
const DOM_MIN_AREA = 32 * 32; // CSS px; smaller boxes can't reach the area threshold alone
const MAX_DOM_SOURCES = 24; // CPU guard (threat T5)
const DOM_CHILD_SHARE = 0.25; // also watch direct children covering at least this share
const DOM_MAX_CHILDREN = 6;
const BACKDROP_CACHE_MS = 250;

const REASONS = {
  general: "It was flashing faster than is safe.",
  red: "It had rapid red flashes.",
  both: "It had rapid flashing, including red flashes.",
  unknown: "It was flashing faster than is safe.",
  checking: "Checking it for flashing before showing it.",
  crossOrigin: "It comes from another site, so it can't be checked for flashing.",
  protected: "It is protected video that can't be checked for flashing.",
  tooCostly: "FlashBan couldn't keep up checking this, so it's dimmed to be safe.",
  tooMany: "There is too much moving media on this page to check all of it.",
  error: "It couldn't be checked for flashing.",
  detectorError: "The flash detector failed to load, so media is dimmed to be safe.",
  css: "A rapidly flashing animation was paused.",
  unknownStyle: "It changes too fast to check, so it's dimmed to be safe.",
};

// ---------------------------------------------------------------- state

let settings = normalizeSettings(undefined);
let enabled = false;
/** @type {any} */ let detect = null;
/** @type {import("./detector.js").DetectorStatus | "loading"} */ let detectorStatus = "loading";
/** @type {Map<Element, Source>} */ const sources = new Map();
/** @type {any} */ let aggregator = null;
/** @type {IntersectionObserver | null} */ let io = null;
/** @type {MutationObserver | null} */ let mo = null;
/** @type {WeakSet<ShadowRoot>} */ const observedRoots = new WeakSet();
/** @type {WeakSet<Animation>} */ const seenAnims = new WeakSet();
/** @type {Map<Element, Animation[]>} */ const pausedAnims = new Map();
let canvasLoop = 0;
/** @type {Map<Element, DomSource>} */ const domSources = new Map();
/** @type {Map<Element, { times: number[], sources: DomSource[] | null }>} */ const domDrivers = new Map();
/** @type {MutationObserver | null} */ let amo = null;
let domLoop = 0;
let lastDriverPrune = 0;
let lockedDown = false; // page lockdown CSS applied (see onTamper)
let repeatOffender = false; // this site (or frame) has a past violation in the local log
/** @type {Set<Source>} */ const unverifiables = new Set();
let unverifiableTimer = 0;
let animTimer = 0;
let nextId = 1;
let lastPageHud = 0;

const isTop = window === window.top;
const frameDomain = registrableDomain(location.href) || "";
const siteDomain = topSiteDomain();

// ---------------------------------------------------------------- startup

init().catch((err) => console.warn("[FlashBan] init failed", err));

async function init() {
  const stored = await chrome.storage.local.get(["settings", "log"]);
  settings = normalizeSettings(stored.settings);
  repeatOffender = isRepeatOffender(stored.log);
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  safemode.onUserShow(onUserShow);
  safemode.onTamper(onTamper);

  const loaded = await loadDetector();
  detect = loaded.module;
  detectorStatus = loaded.status;
  if (typeof detect.createAggregator === "function") {
    try {
      aggregator = detect.createAggregator(effectivePreset());
    } catch {
      aggregator = null;
    }
  }
  applyEnabled();
}

function topSiteDomain() {
  if (isTop) return registrableDomain(location.href);
  const anc = location.ancestorOrigins;
  if (anc && anc.length) return registrableDomain(anc[anc.length - 1]);
  return registrableDomain(document.referrer || location.href);
}

function applyEnabled() {
  const should = !settings.allowlist.includes(siteDomain);
  if (should === enabled) return;
  enabled = should;
  if (enabled) start();
  else stop();
}

/** @param {Record<string, chrome.storage.StorageChange>} changes @param {string} area */
function onStorageChanged(changes, area) {
  if (area !== "local") return;
  const prevPreset = effectivePreset();
  if (changes.log) repeatOffender = isRepeatOffender(changes.log.newValue);
  if (changes.settings) settings = normalizeSettings(changes.settings.newValue);
  if (!changes.log && !changes.settings) return;
  for (const s of unverifiables) s.applyUnverifiableDim(); // settings or offender status may change the answer
  if (enabled && effectivePreset() !== prevPreset) {
    for (const s of allSources()) {
      s.detector = null; // rebuilt with the new preset on the next sample
      s.resetDetector();
    }
    if (typeof detect?.createAggregator === "function") {
      try {
        aggregator = detect.createAggregator(effectivePreset());
      } catch {
        aggregator = null;
      }
    }
  }
  applyEnabled();
}

/** @param {any} msg @param {chrome.runtime.MessageSender} sender @param {(r: any) => void} sendResponse */
function onRuntimeMessage(msg, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id || !msg || msg.type !== "getStatus" || !isTop) return false;
  const c = safemode.counts();
  sendResponse({
    type: "status",
    v: 1,
    domain: siteDomain,
    enabled,
    detector: detectorStatus,
    sources: sources.size + domSources.size,
    dimmed: c.dim,
    covered: c.cover,
    lockdown: lockedDown,
    repeatOffender,
  });
  return false;
}

function start() {
  io = new IntersectionObserver(onIntersect, { threshold: [0, 0.01] });
  mo = new MutationObserver(onMutations);
  amo = new MutationObserver(onAttrMutations);
  observeRoot(document);
  scan(document);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => enabled && scan(document), { once: true });
  }
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("animationstart", queueAnimScan, true);
  document.addEventListener("transitionrun", queueAnimScan, true);
  animTimer = setInterval(scanAnimations, 500);
}

function stop() {
  io?.disconnect();
  mo?.disconnect();
  amo?.disconnect();
  io = null;
  mo = null;
  amo = null;
  for (const s of domSources.values()) s.dispose();
  domSources.clear();
  domDrivers.clear();
  cancelAnimationFrame(domLoop);
  domLoop = 0;
  for (const s of sources.values()) s.dispose();
  sources.clear();
  cancelAnimationFrame(canvasLoop);
  canvasLoop = 0;
  clearInterval(animTimer);
  document.removeEventListener("visibilitychange", onVisibility);
  document.removeEventListener("animationstart", queueAnimScan, true);
  document.removeEventListener("transitionrun", queueAnimScan, true);
  for (const anims of pausedAnims.values()) for (const a of anims) safePlay(a);
  pausedAnims.clear();
  safemode.releaseAll();
  if (lockedDown) {
    lockedDown = false;
    send({ type: "lockdown", v: 1, on: false });
  }
  unverifiables.clear();
  clearInterval(unverifiableTimer);
  unverifiableTimer = 0;
}

// ---------------------------------------------------------------- discovery

/** @param {Document | ShadowRoot} root */
function observeRoot(root) {
  if (!mo) return;
  if (root instanceof ShadowRoot) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
  }
  const target = root instanceof Document ? root.documentElement || root : root;
  mo.observe(target, { childList: true, subtree: true });
  amo?.observe(target, { attributes: true, subtree: true, attributeFilter: ["class", "style", "hidden"] });
}

/** @param {ParentNode} root */
function scan(root) {
  if (!enabled) return;
  root.querySelectorAll?.("video, canvas, img").forEach(consider);
  // Media inside open or closed shadow roots (an evasion trick).
  root.querySelectorAll?.("*").forEach((el) => {
    const sr = shadowRootOf(el);
    if (sr) {
      observeRoot(sr);
      scan(sr);
    }
  });
}

/** @param {Element} el */
function shadowRootOf(el) {
  try {
    // chrome.dom.openOrClosedShadowRoot is available to content scripts.
    return /** @type {any} */ (chrome).dom?.openOrClosedShadowRoot?.(el) || el.shadowRoot || null;
  } catch {
    return el.shadowRoot || null;
  }
}

/** @param {MutationRecord[]} records */
function onMutations(records) {
  for (const r of records) {
    r.addedNodes.forEach((n) => {
      if (!(n instanceof Element)) return;
      consider(n);
      scan(n);
    });
    r.removedNodes.forEach((n) => {
      if (!(n instanceof Element)) return;
      for (const [el, s] of sources) if (!el.isConnected && (el === n || n.contains(el))) dropSource(el, s);
    });
  }
}

/** @param {Element} el */
function consider(el) {
  if (sources.has(el)) return;
  let kind = null;
  if (el instanceof HTMLVideoElement) kind = "video";
  else if (el instanceof HTMLCanvasElement) kind = "canvas";
  else if (el instanceof HTMLImageElement && looksAnimated(el)) kind = "gif";
  if (!kind) {
    if (el instanceof HTMLImageElement && !el.complete) {
      el.addEventListener("load", () => looksAnimated(el) && consider(el), { once: true });
    }
    return;
  }
  if (detectorStatus === "error") {
    // The detector failed to load: we can't analyse anything, so fail closed.
    if (settings.failClosed) safemode.guard(el, "dim", REASONS.detectorError, { canShow: true });
    return;
  }
  const s = new Source(el, /** @type {"video" | "canvas" | "gif"} */ (kind));
  sources.set(el, s);
  io?.observe(el);
}

/** @param {HTMLImageElement} img */
function looksAnimated(img) {
  const src = img.currentSrc || img.src || "";
  return ANIM_EXT.test(src) || /^data:image\/(gif|webp|apng)/i.test(src);
}

/** @param {Element} el @param {Source} s */
function dropSource(el, s) {
  s.dispose();
  sources.delete(el);
  io?.unobserve(el);
  safemode.release(el, { immediate: true });
}

/** @param {IntersectionObserverEntry[]} entries */
function onIntersect(entries) {
  for (const e of entries) {
    const s = sources.get(e.target);
    if (!s) continue;
    const visible = e.isIntersecting && e.intersectionRect.width > 0 && e.intersectionRect.height > 0;
    s.setVisible(visible);
  }
}

function onVisibility() {
  // Hidden tabs stop rendering; restart the windows cleanly when we come back.
  for (const s of allSources()) s.resetDetector();
}

// ---------------------------------------------------------------- sources

class Source {
  /** @param {Element} el @param {"video" | "canvas" | "gif"} kind */
  constructor(el, kind) {
    this.el = el;
    this.kind = kind;
    this.id = `s${nextId++}`;
    this.visible = false;
    this.detector = null;
    this.budgetPx = SAMPLE_BUDGET_PX;
    this.sw = 0;
    this.sh = 0;
    this.cssW = 0;
    this.cssH = 0;
    /** @type {OffscreenCanvas | null} */ this.canvas = null;
    /** @type {OffscreenCanvasRenderingContext2D | null} */ this.ctx = null;
    this.warmupUntil = 0;
    this.warnUntil = 0;
    this.guardedStartDone = false;
    this.prevHash = -1;
    this.lastHud = 0;
    this.lastViolationMsg = 0;
    // CPU budget (threat T5): readback judged on its median, the detector on
    // its mean, unchanged frames left out (David's createCostMeter, #43).
    /** @type {any} */ this.cost = typeof detect?.createCostMeter === "function" ? detect.createCostMeter() : null;
    this.stopped = false; // unverifiable, static or user-shown: no more sampling
    this.persistentDim = false;
    /** @type {string | null} */ this.unverifiable = null; // why we can't analyse it
    /** @type {boolean | null} */ this.animated = null; // cross-origin images: from the background probe
    this.lastChange = 0;
    this.lastRebuild = 0;
    this.resizeChurn = 0;
    this.vfcHandle = 0;
    this.lastT = 0;
    /** @type {{ stop(): void } | null} */ this.soft = null; // soften layer while active
    this.softFailed = false; // soften fell back to block once: don't retry on this element
    if (kind === "video") this.attachVideoListeners();
  }

  attachVideoListeners() {
    const v = /** @type {HTMLVideoElement} */ (this.el);
    this.onPlay = () => {
      this.checkVideoReadable();
      if (this.unverifiable) {
        this.applyUnverifiableDim(); // dim the moment playback starts
        return;
      }
      if (safemode.guardMode(v) === "cover" && !safemode.wasShownByUser(v)) {
        v.pause(); // the page may not restart covered flashing video
        return;
      }
      this.resetDetector();
      this.scheduleVideo();
    };
    this.onPauseOrSeek = () => {
      if (this.unverifiable) this.applyUnverifiableDim(); // paused or ended: show it again
      else this.resetDetector();
    };
    v.addEventListener("play", this.onPlay, true);
    v.addEventListener("playing", this.onPlay, true);
    v.addEventListener("pause", this.onPauseOrSeek, true);
    v.addEventListener("seeked", this.onPauseOrSeek, true);
    v.addEventListener("ended", this.onPauseOrSeek, true);
    this.onMeta = () => this.checkVideoReadable();
    v.addEventListener("loadedmetadata", this.onMeta, true);
    this.checkVideoReadable();
  }

  /**
   * Decide before the first frame whether we'll be able to read this video:
   * a cross-origin source without a crossorigin attribute will taint the
   * canvas, and encrypted (DRM) video reads as black. Marking it now means it
   * dims on the "play" event, before any frame is shown.
   */
  checkVideoReadable() {
    const v = /** @type {HTMLVideoElement} */ (this.el);
    if (this.unverifiable) return;
    if (v.mediaKeys) {
      this.markUnverifiable(REASONS.protected);
      return;
    }
    const src = v.currentSrc || v.src;
    if (!src || v.crossOrigin) return; // no source yet, or CORS requested (sampling will confirm)
    let u;
    try {
      u = new URL(src, location.href);
    } catch {
      return;
    }
    if (u.protocol === "blob:" || u.protocol === "data:" || u.origin === location.origin) return;
    this.markUnverifiable(REASONS.crossOrigin);
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      this.resetDetector();
      return;
    }
    let active = 0;
    for (const s of sources.values()) if (s.visible && !s.stopped) active++;
    if (active > MAX_ACTIVE) {
      this.markUnverifiable(REASONS.tooMany);
      return;
    }
    if (this.kind === "video") this.scheduleVideo();
    else startCanvasLoop();
  }

  scheduleVideo() {
    const v = /** @type {HTMLVideoElement} */ (this.el);
    if (this.stopped || !this.visible || this.vfcHandle || !enabled) return;
    if (typeof v.requestVideoFrameCallback === "function") {
      this.vfcHandle = v.requestVideoFrameCallback((now, meta) => {
        this.vfcHandle = 0;
        // Display time, not media time: playbackRate 2x flashes twice as fast for the viewer.
        this.sample(meta.expectedDisplayTime || now);
        if (!v.paused && !v.ended) this.scheduleVideo();
      });
    } else {
      startCanvasLoop(); // fall back to sampling on animation frames
    }
  }

  /** Create or resize the detector for the element's current CSS size. */
  /** @param {number} t */
  ensureDetector(t) {
    const r = this.el.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    if (w < MIN_MEDIA_CSS_PX || h < MIN_MEDIA_CSS_PX) return false;
    const resized = !this.detector || Math.abs(w - this.cssW) > this.cssW * 0.2 || Math.abs(h - this.cssH) > this.cssH * 0.2;
    if (!resized) return true;
    if (this.detector && t - this.lastRebuild < RESIZE_MIN_GAP_MS) {
      // Rebuilding resets the flash window, so a page could resize a strobe
      // every frame to dodge detection. Keep the old detector, and fail closed
      // if the resizing doesn't stop.
      if (++this.resizeChurn > RESIZE_CHURN_LIMIT) {
        this.markUnverifiable(REASONS.error);
        return false;
      }
      return true;
    }
    this.lastRebuild = t;
    this.cssW = w;
    this.cssH = h;
    const scale = Math.min(1, Math.sqrt(this.budgetPx / (w * h)));
    this.sw = Math.max(1, Math.round(w * scale));
    this.sh = Math.max(1, Math.round(h * scale));
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(this.sw, this.sh);
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true, alpha: false });
    } else {
      this.canvas.width = this.sw;
      this.canvas.height = this.sh;
    }
    try {
      this.detector = detect.createDetector({
        preset: effectivePreset(),
        sampleWidth: this.sw,
        sampleHeight: this.sh,
        realAreaScale: 1 / scale, // CSS px per sample px
      });
    } catch (err) {
      this.markUnverifiable(REASONS.error);
      return false;
    }
    return true;
  }

  resetDetector() {
    try {
      this.detector?.reset();
    } catch {}
    this.prevHash = -1;
    this.lastT = 0;
  }

  /** @param {number} t  display timestamp in ms */
  sample(t) {
    if (this.stopped || !this.visible || !enabled) return;
    const el = this.el;
    if (!el.isConnected) return;
    if (el instanceof HTMLVideoElement) {
      if (el.readyState < 2) return;
      if (el.mediaKeys) return this.markUnverifiable(REASONS.protected); // DRM frames read as black
    }
    if (el instanceof HTMLCanvasElement && (el.width === 0 || el.height === 0)) return;
    if (el instanceof HTMLImageElement && (!el.complete || el.naturalWidth === 0)) return;
    if (t <= this.lastT) return;
    this.lastT = t;
    if (!this.ensureDetector(t) || !this.ctx) return;

    const t0 = performance.now();
    let data;
    try {
      this.ctx.drawImage(/** @type {CanvasImageSource} */ (/** @type {unknown} */ (el)), 0, 0, this.sw, this.sh);
      data = this.ctx.getImageData(0, 0, this.sw, this.sh).data;
    } catch (err) {
      const name = /** @type {any} */ (err)?.name;
      return this.markUnverifiable(name === "SecurityError" ? REASONS.crossOrigin : REASONS.error);
    }

    const readMs = performance.now() - t0;
    let changed = true; // every video frame from requestVideoFrameCallback is new

    // Guarded start for canvases and images: dim as soon as the content moves.
    if (this.kind !== "video") {
      const hash = quickHash(data);
      changed = this.prevHash === -1 || hash !== this.prevHash;
      if (this.prevHash === -1 || hash !== this.prevHash) {
        if (this.prevHash !== -1 && !this.guardedStartDone) this.beginGuardedStart(t);
        this.lastChange = t;
      } else if (this.kind === "gif" && t - this.lastChange > STATIC_IMAGE_MS) {
        this.stopped = true; // a still image: nothing to watch
      }
      this.prevHash = hash;
    }
    if (this.kind === "video" && !this.guardedStartDone) {
      this.beginGuardedStart(t);
    }

    let report;
    const t1 = performance.now();
    try {
      report = this.detector.push({ t, pixels: data });
    } catch {
      report = null;
    }
    const detectMs = performance.now() - t1;
    if (!report) return this.markUnverifiable(REASONS.error);
    this.handleReport(report, t);
    this.trackCost(readMs, detectMs, changed);
  }

  /** @param {number} t */
  beginGuardedStart(t) {
    this.guardedStartDone = true;
    if (!(settings.guardedStart || repeatOffender) || this.cssW * this.cssH < GUARD_START_MIN_AREA) return;
    if (safemode.isGuarded(this.el) || safemode.wasShownByUser(this.el)) return;
    this.warmupUntil = t + WARMUP_MS;
    safemode.guard(this.el, "dim", REASONS.checking, { canShow: false });
  }

  /** @param {number} readMs @param {number} detectMs @param {boolean} changed */
  trackCost(readMs, detectMs, changed) {
    if (!this.cost || this.stopped) return;
    this.cost.add({ readMs, detectMs, changed });
    const c = this.cost.check();
    if (!c?.over) return;
    if (this.budgetPx > DEGRADED_BUDGET_PX) {
      // Step down once to a smaller sample (DESIGN section 7), then fail closed.
      this.budgetPx = DEGRADED_BUDGET_PX;
      this.detector = null;
      this.cost.reset?.();
    } else {
      this.markUnverifiable(REASONS.tooCostly);
    }
  }

  /** @param {any} report @param {number} t */
  handleReport(report, t) {
    const el = this.el;
    this.sendHud(report, t);
    if (aggregator) this.updateAggregate(report, t);

    if (safemode.wasShownByUser(el)) return;
    // While softening, the raw video keeps flashing underneath by design; the
    // soften layer's own verify detector decides (and falls back to block).
    if (this.soft) return;
    if (report.violation || report.severity === "block") {
      this.block(report, t);
      return;
    }
    if (report.severity === "warn") {
      this.warnUntil = t + WARN_HOLD_MS;
      if (!safemode.isGuarded(el)) safemode.guard(el, "dim", REASONS.checking, { canShow: false });
      return;
    }
    // Clean report: lift a temporary dim once warm-up and any warn hold are over.
    if (safemode.guardMode(el) === "dim" && !this.persistentDim && t >= this.warmupUntil && t >= this.warnUntil) {
      safemode.release(el);
    }
  }

  /**
   * Soften mode (default): keep a flagged video playing through the softening
   * filter instead of covering it. Returns false when soften can't be used
   * (setting is "block", not a video, unreadable, PiP/fullscreen, or soften
   * already failed on this element): the caller then covers it as before.
   * @param {any} report @param {number} t
   */
  trySoften(report, t) {
    const v = this.el;
    if (settings.onFlash !== "soften" || this.softFailed || !(v instanceof HTMLVideoElement)) return false;
    let soft = null;
    try {
      soft = startSoften(v, {
        detect,
        preset: effectivePreset(), // strict on repeat-offender sites, like everything else
        onFail: (failReport) => {
          this.soft = null;
          this.softFailed = true;
          this.block(failReport || report, performance.now());
        },
      });
    } catch {
      soft = null;
    }
    if (!soft) {
      this.softFailed = true;
      return false;
    }
    this.soft = soft;
    if (safemode.guardMode(v) === "dim") safemode.release(v, { immediate: true });
    if (t - this.lastViolationMsg >= VIOLATION_MSG_INTERVAL_MS || !this.lastViolationMsg) {
      this.lastViolationMsg = t;
      sendViolation(this.kind, report); // still logged: the site served flashing video
    }
    return true;
  }

  /** @param {any} report @param {number} t */
  block(report, t) {
    const el = this.el;
    if (this.soft) return; // softening; its verify detector falls back to block itself
    if (this.trySoften(report, t)) return;
    const reason = REASONS[/** @type {keyof typeof REASONS} */ (report.reason)] || REASONS.unknown;
    safemode.guard(el, "cover", reason, { canShow: true });
    if (el instanceof HTMLVideoElement && !el.paused) el.pause();
    if (t - this.lastViolationMsg >= VIOLATION_MSG_INTERVAL_MS || !this.lastViolationMsg) {
      this.lastViolationMsg = t;
      sendViolation(this.kind, report);
    }
  }

  /** @param {any} report @param {number} t */
  sendHud(report, t) {
    if (!settings.hud || t - this.lastHud < HUD_INTERVAL_MS) return;
    this.lastHud = t;
    send({ type: "report", v: 1, sourceId: this.id, source: this.kind, preset: effectivePreset(), report, at: Date.now() });
  }

  /** @param {any} report @param {number} t */
  updateAggregate(report, t) {
    let res;
    try {
      const rect = this.el.getBoundingClientRect();
      aggregator.update({ id: this.id, t, areaPx: report.areaPx || 0, redAreaPx: report.redAreaPx || 0, rect });
      res = aggregator.result(t);
    } catch {
      return;
    }
    if (!res) return;
    if (settings.hud && t - lastPageHud >= HUD_INTERVAL_MS) {
      lastPageHud = t;
      send({ type: "page", v: 1, aggregate: { violation: !!res.violation, totalAreaPx: res.totalAreaPx || 0, ids: res.ids || [] }, at: Date.now() });
    }
    if (!res.violation || !Array.isArray(res.ids)) return;
    // Threat T2: many small flashing elements together. Cover every contributor.
    for (const s of allSources()) {
      if (res.ids.includes(s.id) && !safemode.wasShownByUser(s.el)) s.block({ ...report, violation: true, severity: "block" }, t);
    }
  }

  /**
   * Media we can't analyse (threats T4, T5). Auto-dim (lead decision, Sat 3:34 PM):
   * dimmed while it plays or animates, even on a first visit; paused or still
   * media stays visible; sites with a past violation always dim it.
   * @param {string} reason
   */
  markUnverifiable(reason) {
    if (this.unverifiable) return;
    this.stopped = true; // no more sampling
    this.unverifiable = reason;
    this.persistentDim = true;
    unverifiables.add(this);
    if (this.kind === "gif" && reason === REASONS.crossOrigin) this.probeAnimation();
    this.applyUnverifiableDim();
    startUnverifiableTimer();
  }

  /** Is it moving right now (as far as we can tell without pixels)? */
  isActive() {
    const el = this.el;
    if (el instanceof HTMLVideoElement) return !el.paused && !el.ended;
    if (this.kind === "gif") return this.animated !== false; // animated or not known yet
    return true; // canvas and anything else we can't read: assume it may animate
  }

  applyUnverifiableDim() {
    const el = this.el;
    if (!this.unverifiable || safemode.wasShownByUser(el)) return;
    const dim = enabled && settings.failClosed && (repeatOffender || this.isActive());
    const mode = safemode.guardMode(el);
    if (dim) {
      if (mode !== "cover") safemode.guard(el, "dim", this.unverifiable, { canShow: true, announce: false });
    } else if (mode === "dim") {
      safemode.release(el);
    }
  }

  /**
   * Ask the background whether a cross-origin WebP/APNG file is animated.
   * Never for GIFs: a server can tell the probe from the page's own request and
   * cloak it (still frame to the probe, strobe to the page), and GIFs are
   * nearly always animated anyway, so a cross-origin GIF always counts as
   * animated (threat T4). WebP/APNG keep the probe for usability (most are
   * still images); the cloaking risk there is a documented limit.
   */
  probeAnimation() {
    const img = /** @type {HTMLImageElement} */ (this.el);
    const url = img.currentSrc || img.src;
    if (!/^https?:/i.test(url)) return;
    let path = "";
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      return;
    }
    if (path.endsWith(".gif")) return; // stays "animated or unknown": dimmed while visible
    try {
      chrome.runtime
        .sendMessage({ type: "probeImage", v: 1, url })
        .then((res) => {
          if (res && res.type === "probeResult" && typeof res.animated === "boolean") {
            this.animated = res.animated;
            this.applyUnverifiableDim();
          }
        })
        .catch(() => {});
    } catch {}
  }

  dispose() {
    this.stopped = true;
    this.soft?.stop();
    this.soft = null;
    const v = this.el;
    if (v instanceof HTMLVideoElement) {
      if (this.vfcHandle) v.cancelVideoFrameCallback?.(this.vfcHandle);
      if (this.onPlay) {
        v.removeEventListener("play", this.onPlay, true);
        v.removeEventListener("playing", this.onPlay, true);
      }
      if (this.onPauseOrSeek) {
        v.removeEventListener("pause", this.onPauseOrSeek, true);
        v.removeEventListener("seeked", this.onPauseOrSeek, true);
        v.removeEventListener("ended", this.onPauseOrSeek, true);
      }
      if (this.onMeta) v.removeEventListener("loadedmetadata", this.onMeta, true);
    }
  }
}

/** A page element whose class/style keeps changing. Its estimated colour is a 1x1 frame. */
class DomSource extends Source {
  /** @param {Element} el */
  constructor(el) {
    super(el, /** @type {any} */ ("dom"));
    this.visible = true;
    this.pixel = new Uint8ClampedArray([0, 0, 0, 255]);
    this.lastTouch = 0;
    this.hot = false;
    this.onScreen = false;
    /** @type {ReturnType<typeof backdropOf> | null} */ this.backdrop = null;
    this.backdropAt = -Infinity;
    this.area = 0;
  }

  /** @param {number} now */
  touch(now) {
    this.lastTouch = now;
    this.hot = true;
  }

  cool() {
    this.hot = false;
    this.resetDetector();
  }

  /** @param {number} t @param {number} area */
  ensureDomDetector(t, area) {
    const resized = !this.detector || Math.abs(area - this.area) > this.area * 0.5;
    if (!resized) return true;
    if (this.detector && t - this.lastRebuild < RESIZE_MIN_GAP_MS) {
      if (++this.resizeChurn > RESIZE_CHURN_LIMIT) {
        this.markUnverifiable(REASONS.error);
        return false;
      }
      return true;
    }
    this.lastRebuild = t;
    this.area = area;
    try {
      this.detector = detect.createDetector({ preset: effectivePreset(), sampleWidth: 1, sampleHeight: 1, realAreaScale: Math.sqrt(area) });
    } catch {
      this.markUnverifiable(REASONS.error);
      return false;
    }
    return true;
  }

  /** @param {number} t */
  sample(t) {
    if (this.stopped || !enabled || !this.el.isConnected || t <= this.lastT) return;
    const { area } = visibleArea(this.el);
    if (area < DOM_MIN_AREA) {
      // Off screen or tiny: nothing to protect right now; restart cleanly later.
      if (this.onScreen) {
        this.onScreen = false;
        this.resetDetector();
      }
      return;
    }
    this.onScreen = true;
    this.lastT = t;
    if (!this.ensureDomDetector(t, area)) return;
    if (!this.backdrop || t - this.backdropAt > BACKDROP_CACHE_MS) {
      this.backdrop = backdropOf(this.el);
      this.backdropAt = t;
    }
    let eff;
    try {
      eff = effectiveColor(this.el, this.backdrop);
    } catch {
      eff = { color: this.backdrop.color, ok: false };
    }
    if (!eff.ok) return this.markUnverifiable(REASONS.unknownStyle); // colours we can't read: fail closed
    this.pixel[0] = eff.color[0];
    this.pixel[1] = eff.color[1];
    this.pixel[2] = eff.color[2];
    let report;
    try {
      report = this.detector.push({ t, pixels: this.pixel });
    } catch {
      report = null;
    }
    if (!report) return this.markUnverifiable(REASONS.error);
    this.handleReport(report, t);
  }
}

/** Cheap change detector for guarded start (not a security check). @param {Uint8ClampedArray} d */
function quickHash(d) {
  let h = 0;
  const step = Math.max(4, ((d.length / 512) | 0) * 4);
  for (let i = 0; i < d.length; i += step) h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0;
  return h;
}

function startCanvasLoop() {
  if (!canvasLoop) canvasLoop = requestAnimationFrame(canvasTick);
}

/** One animation-frame loop samples every visible canvas / image (and video without rVFC). */
function canvasTick(/** @type {number} */ now) {
  canvasLoop = 0;
  if (!enabled) return;
  let active = 0;
  for (const s of sources.values()) {
    if (!s.visible || s.stopped) continue;
    if (s.kind === "video") {
      const v = /** @type {HTMLVideoElement} */ (s.el);
      if (typeof v.requestVideoFrameCallback === "function" || v.paused) continue;
    }
    active++;
    s.sample(now);
  }
  if (active) canvasLoop = requestAnimationFrame(canvasTick);
}

// ---------------------------------------------------------------- DOM flicker

function* allSources() {
  yield* sources.values();
  yield* domSources.values();
}

/** @param {Element} el */
function isMediaElement(el) {
  return el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement || el instanceof HTMLImageElement;
}

/** Class/style/hidden changes. Rapidly changing elements get a per-frame sampler. @param {MutationRecord[]} records */
function onAttrMutations(records) {
  if (!enabled) return;
  const now = performance.now();
  for (const r of records) {
    const el = r.target;
    if (!(el instanceof Element) || isMediaElement(el) || el.localName.startsWith("ss-shield-")) continue;
    let d = domDrivers.get(el);
    if (!d) {
      d = { times: [], sources: null };
      domDrivers.set(el, d);
    }
    d.times.push(now);
    while (d.times.length && d.times[0] < now - 1000) d.times.shift();
    if (!d.sources && d.times.length >= DOM_HOT_MUTATIONS) d.sources = makeDomSources(el);
    if (d.sources) for (const s of d.sources) s.touch(now);
  }
  if (now - lastDriverPrune > 5000) {
    lastDriverPrune = now;
    for (const [el, d] of domDrivers) {
      const last = d.times[d.times.length - 1] ?? 0;
      if (!el.isConnected || now - last > DOM_FORGET_MS) domDrivers.delete(el);
    }
  }
  if (domSources.size) startDomLoop();
}

/** The changing element plus its large direct children (a parent class can recolour them). @param {Element} el */
function makeDomSources(el) {
  const { area } = visibleArea(el);
  const candidates = [el];
  for (const child of el.children) {
    if (candidates.length > DOM_MAX_CHILDREN) break;
    if (isMediaElement(child)) continue;
    if (visibleArea(child).area >= Math.max(DOM_MIN_AREA, area * DOM_CHILD_SHARE)) candidates.push(child);
  }
  /** @type {DomSource[]} */
  const out = [];
  for (const c of candidates) {
    let s = domSources.get(c);
    if (!s) {
      if (domSources.size >= MAX_DOM_SOURCES) {
        // Too many flickering elements to check (threat T5): fail closed on this one.
        if (settings.failClosed && visibleArea(c).area >= DOM_MIN_AREA) safemode.guard(c, "dim", REASONS.tooMany, { canShow: true });
        continue;
      }
      s = new DomSource(c);
      domSources.set(c, s);
    }
    out.push(s);
  }
  return out;
}

function startDomLoop() {
  if (!domLoop) domLoop = requestAnimationFrame(domTick);
}

/** @param {number} now */
function domTick(now) {
  domLoop = 0;
  if (!enabled) return;
  let hot = 0;
  for (const [el, s] of domSources) {
    if (!el.isConnected) {
      s.dispose();
      domSources.delete(el);
      continue;
    }
    if (s.stopped) continue;
    if (now - s.lastTouch > DOM_HOT_MS) {
      if (s.hot) s.cool();
      if (now - s.lastTouch > DOM_FORGET_MS) domSources.delete(el);
      continue;
    }
    hot++;
    s.sample(now);
  }
  if (hot) domLoop = requestAnimationFrame(domTick);
}

/**
 * CSS-animation context for the detector: preset and backdrop brightness.
 * No per-element area on purpose: an area check per element would let many
 * small boxes blinking together through (threat T2).
 * @param {Animation} a
 */
function animationContext(a) {
  /** @type {{ preset: string, backdropLuminance?: number }} */
  const ctx = { preset: effectivePreset() };
  const target = /** @type {KeyframeEffect | null} */ (a.effect)?.target;
  if (target instanceof Element) {
    try {
      ctx.backdropLuminance = relativeLuminance(backdropOf(target).color);
    } catch {}
  }
  return ctx;
}

// ---------------------------------------------------------------- repeat offenders and auto-dim

/** Sites with a past violation get the strict preset (STRATEGY 7.6). */
function effectivePreset() {
  return repeatOffender ? "strict" : settings.preset;
}

/** @param {unknown} log */
function isRepeatOffender(log) {
  const domains = /** @type {any} */ (log)?.domains;
  if (!domains || typeof domains !== "object") return false;
  return (!!siteDomain && !!domains[siteDomain]) || (!!frameDomain && !!domains[frameDomain]);
}

/** Re-check media we can't analyse twice a second (play/pause events cover most changes). */
function startUnverifiableTimer() {
  if (unverifiableTimer) return;
  unverifiableTimer = setInterval(() => {
    for (const s of unverifiables) {
      if (!s.el.isConnected) unverifiables.delete(s);
      else s.applyUnverifiableDim();
    }
    if (unverifiables.size === 0) {
      clearInterval(unverifiableTimer);
      unverifiableTimer = 0;
    }
  }, 500);
}

// ---------------------------------------------------------------- CSS animations

let animScanQueued = false;
function queueAnimScan() {
  if (animScanQueued) return;
  animScanQueued = true;
  queueMicrotask(() => {
    animScanQueued = false;
    scanAnimations();
  });
}

function scanAnimations() {
  if (!enabled || typeof detect?.analyzeAnimation !== "function") return;
  let anims;
  try {
    anims = document.getAnimations();
  } catch {
    return;
  }
  for (const a of anims) {
    if (seenAnims.has(a)) continue;
    seenAnims.add(a);
    let res;
    try {
      res = detect.analyzeAnimation(a, animationContext(a));
    } catch {
      res = { violation: true }; // can't read it: fail closed
    }
    if (!res?.violation) continue;
    const target = /** @type {KeyframeEffect | null} */ (a.effect)?.target;
    if (!(target instanceof Element) || safemode.wasShownByUser(target)) continue;
    try {
      a.pause();
    } catch {}
    const list = pausedAnims.get(target) || [];
    list.push(a);
    pausedAnims.set(target, list);
    safemode.guard(target, "cover", REASONS.css, { canShow: true });
    sendViolation("css", {
      v: 1,
      flashesPerSecond: Number(res.cyclesPerSecond) || 0,
      redFlashesPerSecond: 0,
      areaPx: 0,
      areaPct: 0,
      violation: true,
      severity: "block",
      reason: "general",
    });
  }
}

/** @param {Animation} a */
function safePlay(a) {
  try {
    a.play();
  } catch {}
}

// ---------------------------------------------------------------- user + messaging

/**
 * The page keeps removing or restyling our overlay (threat T6). Ask the
 * background to apply page-lockdown CSS with user origin: page scripts can't
 * see or remove it, and it outranks every page style, inline !important included.
 */
function onTamper() {
  if (lockedDown || !enabled) return;
  lockedDown = true;
  send({ type: "lockdown", v: 1, on: true });
}

/** The user pressed "Show anyway". @param {Element} el */
function onUserShow(el) {
  const s = sources.get(el) || domSources.get(el);
  if (s) s.stopped = true; // don't sample or re-guard it again on this page
  const anims = pausedAnims.get(el);
  if (anims) {
    pausedAnims.delete(el);
    for (const a of anims) safePlay(a);
  }
}

/** @param {string} source @param {any} report */
function sendViolation(source, report) {
  send({ type: "violation", v: 1, domain: frameDomain, source, report, at: Date.now() });
}

/** @param {any} msg */
function send(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // Extension was reloaded; this old content script can no longer talk to it.
  }
}
