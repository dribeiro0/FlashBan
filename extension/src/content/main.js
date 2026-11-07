// Content-script entry point (loaded by loader.js as an ES module).
//
// Finds media (video, canvas, animated images, CSS animations), samples every
// rendered frame into the detector (docs/CONTRACTS.md section 1), and applies
// safe mode (section 2). Violations go to the background (section 3) and,
// when the Demo HUD is on, so do per-source reports (section 3a).

import * as safemode from "./safemode.js";
import { loadDetector } from "./detector.js";
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
const COST_LIMIT_MS = 3; // average sampling + detector cost per frame
const MAX_ACTIVE = 24; // visible sources analysed at once (threat T5)
const STATIC_IMAGE_MS = 3000; // stop sampling images that never change
const RESIZE_MIN_GAP_MS = 2000; // rebuild the detector at most this often
const RESIZE_CHURN_LIMIT = 10; // more skipped resizes than this: fail closed
const ANIM_EXT = /\.(gif|webp|apng)(\?|#|$)/i;

const REASONS = {
  general: "It was flashing faster than is safe.",
  red: "It had rapid red flashes.",
  both: "It had rapid flashing, including red flashes.",
  unknown: "It was flashing faster than is safe.",
  checking: "Checking it for flashing before showing it.",
  crossOrigin: "It comes from another site, so it can't be checked for flashing.",
  protected: "It is protected video that can't be checked for flashing.",
  tooCostly: "There is too much moving media to check all of it.",
  tooMany: "There is too much moving media on this page to check all of it.",
  error: "It couldn't be checked for flashing.",
  detectorError: "The flash detector failed to load, so media is dimmed to be safe.",
  css: "A rapidly flashing animation was paused.",
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
let animTimer = 0;
let nextId = 1;
let lastPageHud = 0;

const isTop = window === window.top;
const frameDomain = registrableDomain(location.href) || "";
const siteDomain = topSiteDomain();

// ---------------------------------------------------------------- startup

init().catch((err) => console.warn("[Seizure Shield] init failed", err));

async function init() {
  const stored = await chrome.storage.local.get("settings");
  settings = normalizeSettings(stored.settings);
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  safemode.onUserShow(onUserShow);

  const loaded = await loadDetector();
  detect = loaded.module;
  detectorStatus = loaded.status;
  if (typeof detect.createAggregator === "function") {
    try {
      aggregator = detect.createAggregator(settings.preset);
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
  if (area !== "local" || !changes.settings) return;
  const prevPreset = settings.preset;
  settings = normalizeSettings(changes.settings.newValue);
  if (enabled && settings.preset !== prevPreset) {
    for (const s of sources.values()) s.resetDetector();
    if (typeof detect?.createAggregator === "function") {
      try {
        aggregator = detect.createAggregator(settings.preset);
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
    sources: sources.size,
    dimmed: c.dim,
    covered: c.cover,
  });
  return false;
}

function start() {
  io = new IntersectionObserver(onIntersect, { threshold: [0, 0.01] });
  mo = new MutationObserver(onMutations);
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
  io = null;
  mo = null;
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
}

// ---------------------------------------------------------------- discovery

/** @param {Document | ShadowRoot} root */
function observeRoot(root) {
  if (!mo) return;
  if (root instanceof ShadowRoot) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
  }
  mo.observe(root instanceof Document ? root.documentElement || root : root, { childList: true, subtree: true });
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
  for (const s of sources.values()) s.resetDetector();
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
    this.costAvg = 0;
    this.costSamples = 0;
    this.stopped = false; // unverifiable, static or user-shown: no more sampling
    this.persistentDim = false;
    this.lastChange = 0;
    this.lastRebuild = 0;
    this.resizeChurn = 0;
    this.vfcHandle = 0;
    this.lastT = 0;
    if (kind === "video") this.attachVideoListeners();
  }

  attachVideoListeners() {
    const v = /** @type {HTMLVideoElement} */ (this.el);
    this.onPlay = () => {
      if (safemode.guardMode(v) === "cover" && !safemode.wasShownByUser(v)) {
        v.pause(); // the page may not restart covered flashing video
        return;
      }
      this.resetDetector();
      this.scheduleVideo();
    };
    this.onPauseOrSeek = () => this.resetDetector();
    v.addEventListener("play", this.onPlay, true);
    v.addEventListener("playing", this.onPlay, true);
    v.addEventListener("pause", this.onPauseOrSeek, true);
    v.addEventListener("seeked", this.onPauseOrSeek, true);
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
        preset: settings.preset,
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

    // Guarded start for canvases and images: dim as soon as the content moves.
    if (this.kind !== "video") {
      const hash = quickHash(data);
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
    try {
      report = this.detector.push({ t, pixels: data });
    } catch {
      report = null;
    }
    const cost = performance.now() - t0;
    this.trackCost(cost);
    if (!report) return this.markUnverifiable(REASONS.error);
    this.handleReport(report, t);
  }

  /** @param {number} t */
  beginGuardedStart(t) {
    this.guardedStartDone = true;
    if (!settings.guardedStart || this.cssW * this.cssH < GUARD_START_MIN_AREA) return;
    if (safemode.isGuarded(this.el) || safemode.wasShownByUser(this.el)) return;
    this.warmupUntil = t + WARMUP_MS;
    safemode.guard(this.el, "dim", REASONS.checking, { canShow: false });
  }

  /** @param {number} cost */
  trackCost(cost) {
    this.costSamples++;
    this.costAvg += (cost - this.costAvg) / Math.min(this.costSamples, 30);
    if (this.costSamples < 30 || this.costAvg <= COST_LIMIT_MS) return;
    if (this.budgetPx > DEGRADED_BUDGET_PX) {
      // Step down once (David's DESIGN section 7), then fail closed.
      this.budgetPx = DEGRADED_BUDGET_PX;
      this.detector = null;
      this.costSamples = 0;
      this.costAvg = 0;
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

  /** @param {any} report @param {number} t */
  block(report, t) {
    const el = this.el;
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
    send({ type: "report", v: 1, sourceId: this.id, source: this.kind, preset: settings.preset, report, at: Date.now() });
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
    for (const s of sources.values()) {
      if (res.ids.includes(s.id) && !safemode.wasShownByUser(s.el)) s.block({ ...report, violation: true, severity: "block" }, t);
    }
  }

  /** Fail closed for media we can't analyse (threat T4, T5). @param {string} reason */
  markUnverifiable(reason) {
    if (this.stopped) return;
    this.stopped = true;
    this.persistentDim = true;
    if (settings.failClosed && !safemode.wasShownByUser(this.el)) {
      safemode.guard(this.el, "dim", reason, { canShow: true });
    } else if (safemode.guardMode(this.el) === "dim") {
      safemode.release(this.el);
    }
  }

  dispose() {
    this.stopped = true;
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
      }
    }
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
      res = detect.analyzeAnimation(a);
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

/** The user pressed "Show anyway". @param {Element} el */
function onUserShow(el) {
  const s = sources.get(el);
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
