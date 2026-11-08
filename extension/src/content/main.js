// Content-script entry point (loaded by loader.js as an ES module).
//
// Finds media (video, canvas, animated images, CSS animations), samples every
// rendered frame into the detector (docs/CONTRACTS.md section 1), and applies
// safe mode (section 2). Violations go to the background (section 3) and,
// when the Demo HUD is on, so do per-source reports (section 3a).

import * as safemode from "./safemode.js";
import { loadDetector } from "./detector.js";
import { backdropOf, effectiveColor, visibleArea, relativeLuminance, parseComputedColor } from "./domflicker.js";
import { startSoften, softenable } from "./soften.js";
import { readAsync } from "./glread.js";
import { normalizeSettings, registrableDomain, STRENGTH_DIM, STRENGTH_BLOCK } from "../shared/settings.js";

// ---------------------------------------------------------------- tuning

const SAMPLE_BUDGET_PX = 128 * 72; // pixels per sampled frame (aspect kept)
const DEGRADED_BUDGET_PX = 64 * 36;
const MIN_MEDIA_CSS_PX = 16; // ignore media smaller than this on either side
const GUARD_START_MIN_AREA = 64 * 64; // smaller media skip guarded start
const VIDEO_CHECK_MS = 2000; // a video that starts gets a light, see-through dim for this long
const VIDEO_CHECK_MAX_MS = 3500; // ...and never longer than this, whatever the detector is unsure about
// Media is sampled on EVERY presented frame (and every animation frame for
// canvases and images). Any fixed skip aliases: sampling every 80 ms let a
// 7.5 Hz strobe look like 1-2 flashes a second, and every other frame at
// 60 fps never saw a strobe that flips on each frame (David, Sat 7:03 PM).
// The cost meter (T5) steps the sample size down and then fails closed if
// the readbacks get too slow.
const MIN_SAMPLE_MS = 0;
const GAP_WINDOW_MS = 4000; // video: judge sampling gaps over this long...
const GAP_MAX_SHARE = 0.5; // ...and if more than this share of samples came after a long gap, we can't keep up (fail closed, T5)
const LONG_GAP_MS = 250; // a sample this long after the previous one means we were blind in between
const GAP_MIN_SAMPLES = 12; // ...judged once the window holds at least this many samples
const DOM_TICK_MS = 50; // DOM flicker sampling runs at most 20 times a second...
const DOM_TICK_BUDGET_MS = 3; // ...and stops early when a tick has used this much time (threat T5)
const PAGE_CHECK_MS = 1200; // the one page-wide "checking" dim, once per page
// Media we can't analyse (lead decision, Sat 4:10 PM: option B): "always" dims
// it whether it plays or not; "while-active" is option A (dim only while it
// plays or animates). Under both, a cross-origin WebP/APNG image is asked
// about through the background probe first: a still photo in an animated-
// capable format can't flash, and sites serve most photos as .webp, so dimming
// every one of them would make the page unusable. GIFs are never probed and
// always count as animated (threat T4; the probe's limits are in the threat model).
const UNVERIFIABLE_POLICY = "always";
const WARN_HOLD_MS = 500; // keep a "warn" dim this long after the last warn
const GAP_WARNS_TO_DIM = 2; // video: ignore one isolated sampling gap; dim when gaps repeat within 1 s
const HUD_INTERVAL_MS = 100; // max 10 reports per second per source
const VIOLATION_MSG_INTERVAL_MS = 10_000;
const MAX_ACTIVE = 24; // visible sources analysed at once (threat T5)
const STATIC_IMAGE_MS = 3000; // stop sampling images that never change
const RESIZE_MIN_GAP_MS = 2000; // rebuild the detector at most this often
const RESIZE_CHURN_LIMIT = 10; // more skipped resizes than this: fail closed
const ANIM_EXT = /\.(gif|webp|apng)(\?|#|$)/i;
// Sites whose media CDN answers CORS requests (their own players fetch it with
// CORS): we ask for their videos with crossorigin="anonymous" so the pixels are
// readable and the video can be SOFTENED instead of dimmed as "another site".
// YouTube serves some uploads as a plain file from googlevideo.com; the usual
// streaming path (blob:) is readable anyway. If a CORS request fails, the
// attribute is removed so the player can recover (lead priority: soften first).
const CORS_VIDEO_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;
const CLEAR_GLOW_OPACITY = 0.5; // unverifiable elements this see-through get faded, not covered
const BOOT_DIM_MAX_MS = 1500; // the loader's load-time media dim lifts by this long after start, verdict or not
const BOOT_VERDICT_MS = 1000; // ...or once a source has a full detector window of calm samples (Yaovi: a 4 Hz strobe needs ~0.75-1 s to be called)
// Script-driven DOM flicker (class / style / hidden toggles)
const DOM_HOT_MUTATIONS = 2; // mutations within 1 s before we start sampling an element
const DOM_HOT_MS = 1500; // keep sampling this long after the last mutation
const DOM_FORGET_MS = 10_000; // drop a quiet element's sampler after this
// Soften for DOM flicker: the browser fades class/style toggles over 2 s.
const DOM_SOFT_TRANSITION = ["background-color", "color", "opacity", "filter", "border-color", "outline-color", "fill", "stroke", "box-shadow"]
  .map((p) => `${p} 3s ease-out`)
  .join(", ");
const DOM_SOFT_GRACE_MS = 3000; // David's go (Sat 8:23 PM): longer, stronger transition before a cover; the window still holds pre-soften flashes
const CSS_SOFT_CYCLES = 1; // slowed CSS animations run at about 1 cycle per second
const DOM_MIN_AREA = 32 * 32; // CSS px; smaller boxes can't reach the area threshold alone
const MAX_DOM_SOURCES = 24; // CPU guard (threat T5)
const DOM_CHILD_SHARE = 0.25; // also watch direct children covering at least this share
const DOM_MAX_CHILDREN = 6;
const BACKDROP_CACHE_MS = 250;
const SOURCE_RESET_MIN_MS = 1500; // a video element's verdict resets on a new source at most this often
const PAUSE_RESET_MS = 1000; // a video's flash history resets only after a pause this long
const RECHECK_CALM_MS = 1500; // a covered video's new source must be calm this long before the cover lifts
const MEDIA_OVERLAP_SHARE = 0.5; // a DOM layer this much over a measured video/canvas is player chrome
const MEDIA_OVERLAP_CACHE_MS = 500;
const LAYER_ALPHA_WATCH = 0.2; // a layer over media seen this opaque even once is always watched
// How "soften" keeps flashing media watchable (David, Sun 2:40 AM).
// "dim": the safemode dim layer, an 80% black click-through layer with a greyscale
// backdrop. Safe by arithmetic, not by tracking: the brightest pixel left is
// sRGB 0.20 (relative luminance ~0.033), under the 0.10 a flash needs, and
// greyscale leaves no red to flash. No frame readback or averaging, so motion
// stays sharp with no trails, ghosting or blocks. Per-pixel temporal filtering
// (the GPU soften) can't tell a moving bright object from a flash, so it always
// smeared or hid moving content; it is kept behind "gpu" for reference.
const SOFTEN_STYLE = "dim";
// Severe flashing is blocked (covered and paused), not dimmed (David, Sun 3:50 AM,
// on a red neon-tunnel video): any red flashing (the most provoking kind), or a
// flash rate at least this high (twice the WCAG limit). Ordinary over-the-limit
// flashing stays dimmed + greyscale so it remains watchable.
const SEVERE_FLASHES_PER_S = 6;

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
  glow: "A decorative glow was faded.",
  softDim: "It was flashing, so it's dimmed and in greyscale, where it can't flash. It keeps playing.",
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
/** @type {Map<Animation, { rate: number, original: number }>} CSS animations we slowed down (soften) */ const slowedAnims = new Map();
let canvasLoop = 0;
/** @type {Map<Element, DomSource>} */ const domSources = new Map();
/** @type {Map<Element, { times: number[], sources: DomSource[] | null }>} */ const domDrivers = new Map();
/** @type {MutationObserver | null} */ let amo = null;
let softCountTimer = 0;
let domLoop = 0;
let lastDriverPrune = 0;
let lockedDown = false; // page lockdown CSS applied (see onTamper)
let repeatOffender = false; // this site (or frame) has a past violation in the local log
let pageCheckDone = false; // the page-wide "checking" dim has been shown on this page
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
  safemode.onBypass(onBypass);

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
  // The loader's static media dim covers the load window. It lifts at the
  // first detector verdict on this page (a strobe that started at load is
  // softened or covered by then), or after BOOT_DIM_MAX_MS, or at once when
  // the site is allowlisted.
  if (!enabled) liftBootDim();
  else setTimeout(liftBootDim, BOOT_DIM_MAX_MS);
}

let bootLifted = false;
function liftBootDim() {
  if (bootLifted) return;
  bootLifted = true;
  try {
    /** @type {any} */ (globalThis).__flashbanBoot?.remove();
  } catch {}
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
    // Last detector report per media source: numbers and kind only, no URLs
    // or page content. Lets the team measure slow machines without the HUD.
    reports: [...sources.values()].slice(0, 20).map((s) => {
      const r = s.lastRaw;
      return {
        kind: s.kind,
        severity: r?.severity ?? null,
        reason: r?.reason ?? null,
        flashesPerSecond: typeof r?.flashesPerSecond === "number" ? r.flashesPerSecond : null,
        sampleRateHz: typeof r?.sampleRateHz === "number" ? r.sampleRateHz : null,
        undersampled: typeof r?.undersampled === "boolean" ? r.undersampled : null,
        ageMs: s.lastRawAt ? Math.round(performance.now() - s.lastRawAt) : null,
      };
    }),
  });
  return false;
}

function start() {
  safemode.resetBar();
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
  softCountTimer = setInterval(() => {
    let n = 0;
    for (const s of allSources()) if (s.soft) n++;
    if (isTop) safemode.setSoftened(n);
  }, 500);
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
  clearInterval(softCountTimer);
  document.removeEventListener("visibilitychange", onVisibility);
  document.removeEventListener("animationstart", queueAnimScan, true);
  document.removeEventListener("transitionrun", queueAnimScan, true);
  for (const anims of pausedAnims.values()) for (const a of anims) safePlay(a);
  pausedAnims.clear();
  for (const [a, s] of slowedAnims) {
    try {
      if (a.playbackRate === s.rate) a.playbackRate = s.original;
    } catch {}
  }
  slowedAnims.clear();
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
  if (el instanceof HTMLVideoElement && !el.crossOrigin && CORS_VIDEO_HOSTS.test(location.hostname)) {
    // Set as soon as we see the element (YouTube reuses one <video> across
    // videos, so waiting for an empty one would never happen). Changing the
    // attribute doesn't restart a load in progress; it applies to the next one.
    try {
      el.crossOrigin = "anonymous";
      el.addEventListener("error", () => {
        // A CORS-refused source: drop the request and restart the load plainly.
        if (el.crossOrigin === "anonymous" && el.error && (el.error.code === 2 || el.error.code === 4)) {
          el.removeAttribute("crossorigin");
          try {
            const wasPlaying = !el.paused;
            el.load();
            if (wasPlaying) el.play().catch(() => {});
          } catch {}
        }
      }, true);
    } catch {}
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
    // Dim timers run on performance.now(), never on frame timestamps: video
    // frame times (rVFC expectedDisplayTime) can be on a different footing.
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
    this.lastPresented = -1; // video: rVFC presentedFrames of the last sample
    this.callbacksSinceSample = 0;
    this.checkDeadline = 0; // video: the light check never outlasts this (performance.now())
    /** @type {number[]} */ this.sampleTimes = []; // video: recent samples (performance.now())...
    /** @type {number[]} */ this.missTimes = []; // ...and those where presented frames were missed
    this.completeFrames = false;
    /** @type {{ stop(): void } | null} */ this.soft = null; // soften layer while active
    this.recheckSince = 0; // video: a new source is being checked behind the cover (performance.now())
    this.recheckCalmFrom = 0;
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
      // A different video in the same element (YouTube reuses one <video> and
      // changes the page address per video; its source change isn't always seen):
      // judge the new content instead of keeping the old verdict forever.
      if (this.verdictHref && location.href !== this.verdictHref && !safemode.wasShownByUser(v)) {
        this.verdictHref = "";
        if (safemode.guardMode(v) === "cover") {
          // Stay covered; the cover lifts after RECHECK_CALM_MS of calm frames.
          const now = performance.now();
          this.softFailed = false;
          this.recheckSince = now;
          this.recheckCalmFrom = now;
        } else if (this.persistentDim && !this.unverifiable && safemode.guardMode(v) === "dim") {
          // Flashing dim from the old video: drop it and check the new one
          // from the start (guarded start dims it briefly while it is checked).
          this.persistentDim = false;
          this.flatDim = false;
          safemode.release(v, { immediate: true });
          this.guardedStartDone = false;
        }
      }
      if (safemode.guardMode(v) === "cover" && !safemode.wasShownByUser(v) && !this.recheckSince) {
        v.pause(); // the page may not restart covered flashing video
        this.pausedByUsAt = performance.now();
        return;
      }
      // No detector reset here: pausing, flipping sources or seeking every
      // half second used to wipe the flash history each time, so a strobe cut
      // into short pieces was never caught (demo: srcflip). A real pause
      // resets it (onPauseOrSeek); the detector's gap rule covers the rest.
      this.lastPresented = -1;
      this.callbacksSinceSample = 0;
      // Guarded start from the "play" event, before the first frame is shown.
      if (!this.guardedStartDone) this.beginGuardedStart(performance.now());
      this.scheduleVideo();
    };
    this.onPauseOrSeek = () => {
      if (this.unverifiable) {
        this.applyUnverifiableDim(); // paused or ended: show it again
        return;
      }
      // Forget the flash history only after a real pause (still paused after
      // PAUSE_RESET_MS), never on a seek or a quick pause/play.
      clearTimeout(this.pauseResetTimer);
      this.pauseResetTimer = setTimeout(() => {
        if (v.paused || v.ended) this.resetDetector();
      }, PAUSE_RESET_MS);
    };
    v.addEventListener("play", this.onPlay, true);
    v.addEventListener("playing", this.onPlay, true);
    v.addEventListener("pause", this.onPauseOrSeek, true);
    v.addEventListener("seeked", this.onPauseOrSeek, true);
    v.addEventListener("ended", this.onPauseOrSeek, true);
    this.onMeta = () => this.checkVideoReadable();
    v.addEventListener("loadedmetadata", this.onMeta, true);
    // A new source in the same element is new media (Sat 11:40 PM): YouTube
    // reuses one <video> for the ad, the video, and every video you click
    // next, so one verdict (a covered ad, a DRM movie) stuck to every later
    // video in the tab: covered, and paused whenever it tried to play.
    this.lastSrcKey = v.src || v.currentSrc || "";
    this.lastSourceReset = -Infinity;
    this.onNewSource = () => this.resetForNewSource();
    v.addEventListener("emptied", this.onNewSource, true);
    v.addEventListener("loadstart", this.onNewSource, true);
    this.checkVideoReadable();
  }

  /** Forget the old media's verdict when the element loads a different source. */
  resetForNewSource() {
    const v = /** @type {HTMLVideoElement} */ (this.el);
    // The src attribute changes at once ("emptied"); currentSrc only on "loadstart".
    const src = v.src || v.currentSrc || "";
    if (!src || src === this.lastSrcKey) return;
    const now = performance.now();
    const wait = SOURCE_RESET_MIN_MS - (now - this.lastSourceReset);
    if (wait > 0) {
      // Swapping sources faster than this keeps the old verdict (a page can't
      // shed a cover by reloading a strobe); look again once it settles.
      clearTimeout(this.srcResetTimer);
      this.srcResetTimer = setTimeout(() => this.resetForNewSource(), wait + 10);
      return;
    }
    this.lastSrcKey = src;
    this.lastSourceReset = now;
    if (safemode.wasShownByUser(v)) return;
    if (this.unverifiable) {
      // "Can't check" belonged to the old source (a DRM movie, a cross-origin
      // file): judge the new one from scratch.
      unverifiables.delete(this);
      this.unverifiable = null;
      this.persistentDim = false;
      this.stopped = false;
      this.fadeGlow(false);
      if (safemode.guardMode(v)) safemode.release(v, { immediate: true });
      this.resetDetector();
      this.detector = null;
      this.budgetPx = SAMPLE_BUDGET_PX;
      this.cost?.reset?.();
      this.sampleTimes = [];
      this.missTimes = [];
      this.guardedStartDone = false;
      this.checkVideoReadable();
      return;
    }
    if (safemode.guardMode(v) === "cover") {
      // Covered for flashing: the new source may play (under the cover) and
      // the cover lifts after RECHECK_CALM_MS of calm frames. The flash
      // history is kept, so flipping between a strobe and a calm file keeps
      // it covered (demo: srcflip).
      this.softFailed = false;
      this.recheckSince = now;
      this.recheckCalmFrom = now;
      // We may have just paused its play() (the events race): let it play.
      if (v.paused && now - (this.pausedByUsAt || -Infinity) < 3000) v.play().catch(() => {});
    }
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
        const t = meta.expectedDisplayTime || now;
        const presented = typeof meta.presentedFrames === "number" ? meta.presentedFrames : -1;
        this.callbacksSinceSample++;
        // Every presented frame (MIN_SAMPLE_MS is 0): any skip aliases strobes away.
        if (t - this.lastT > MIN_SAMPLE_MS || this.lastT === 0) {
          // "Complete": every presented frame since the last sample came with a
          // callback (none were skipped by a blocked main thread). Then a long
          // gap is the video's own frame rate, not missed frames.
          const complete = presented >= 0 && this.lastPresented >= 0 && presented - this.lastPresented === this.callbacksSinceSample;
          this.lastPresented = presented;
          this.callbacksSinceSample = 0;
          this.sample(t, complete);
        } else if (this.lastPresented < 0) {
          this.lastPresented = presented;
          this.callbacksSinceSample = 0;
        }
        if (!v.paused && !v.ended) this.scheduleVideo();
      });
    } else {
      startCanvasLoop(); // fall back to sampling on animation frames
    }
  }

  /**
   * Effective opacity (the element's own times its ancestors') and the colour
   * behind it, cached for BACKDROP_CACHE_MS. Used to composite samples the way
   * the viewer sees them, and by the soften layer to look like the element.
   * @param {number} now  performance.now()
   * @returns {{ opacity: number, backdrop: [number, number, number] }}
   */
  appearance(now) {
    if (this.look && now - this.lookAt < BACKDROP_CACHE_MS) return this.look;
    this.lookAt = now;
    let opacity = 1;
    /** @type {[number, number, number]} */ let backdrop = [0, 0, 0];
    try {
      const cs = getComputedStyle(this.el);
      opacity = Number(cs.opacity);
      if (!Number.isFinite(opacity)) opacity = 1;
      if (this.glowFaded) {
        // Our own fade is in the computed value; use what the page asked for.
        opacity = this.lookBeforeFade ?? 1;
      } else {
        this.lookBeforeFade = opacity;
      }
      const bd = backdropOf(this.el);
      opacity *= bd.opacity;
      backdrop = /** @type {[number, number, number]} */ (bd.color);
    } catch {}
    this.look = { opacity: Math.min(1, Math.max(0, opacity)), backdrop };
    return this.look;
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

  /**
   * @param {number} t  display timestamp in ms
   * @param {boolean} [complete]  video only: no presented frame was skipped since the last sample
   */
  sample(t, complete = false) {
    this.completeFrames = complete;
    if (this.stopped || !this.visible || !enabled) return;
    // Softened: the soften layer reads and verifies every frame itself, so
    // skip the raw read (saves a second readback). While it's only checking
    // (guarded start), keep sampling: the raw detector decides calm or not.
    const el = this.el;
    // An ambient glow (a small canvas blown up 3x or more, like YouTube's
    // ambient mode, which starts at the default 300x150) is faded, never
    // measured: its crossfades read as flashing and covered or softened half
    // the page (Sat 11:55 PM, 12:18 AM). The fade caps anything it could show
    // at 0.08 of its swing.
    if (isStretchedCanvas(el)) {
      if (this.soft) {
        const sft = this.soft;
        this.soft = null;
        try {
          sft.stop();
        } catch {}
      }
      if (safemode.guardMode(el)) safemode.release(el, { immediate: true });
      return this.markUnverifiable(REASONS.glow);
    }
    if (this.soft && !this.soft.checking) return;
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
    // Video: read the frame back asynchronously on the GPU (glread.js). The
    // 2D path below stalls the main thread 16-20 ms per frame on real laptops,
    // which made the cost guard cover ordinary videos (Sat 10:53 PM).
    if (this.kind === "video" && !this.noAsyncRead) {
      let p = null;
      try {
        p = readAsync(/** @type {CanvasImageSource} */ (/** @type {unknown} */ (el)), this.sw, this.sh);
      } catch (err) {
        const name = /** @type {any} */ (err)?.name;
        return this.markUnverifiable(name === "SecurityError" ? REASONS.crossOrigin : REASONS.error);
      }
      if (p) {
        const issueMs = performance.now() - t0;
        const det = this.detector;
        p.then(
          (data) => {
            if (this.stopped || this.detector !== det || !enabled || data.length !== this.sw * this.sh * 4) return;
            this.consume(data, t, complete, issueMs);
          },
          () => {
            this.noAsyncRead = true; // context lost or readback failed: use the 2D path from now on
          },
        );
        return;
      }
    }
    let data;
    try {
      this.ctx.drawImage(/** @type {CanvasImageSource} */ (/** @type {unknown} */ (el)), 0, 0, this.sw, this.sh);
      data = this.ctx.getImageData(0, 0, this.sw, this.sh).data;
    } catch (err) {
      const name = /** @type {any} */ (err)?.name;
      return this.markUnverifiable(name === "SecurityError" ? REASONS.crossOrigin : REASONS.error);
    }
    this.consume(data, t, complete, performance.now() - t0);
  }

  /**
   * Composite a sample the way the viewer sees it, run the detector, act.
   * @param {Uint8ClampedArray} data @param {number} t @param {boolean} complete
   * @param {number} readMs main-thread time spent reading the frame
   */
  consume(data, t, complete, readMs) {
    if (this.stopped || !enabled) return;
    if (this.soft && !this.soft.checking) return;
    this.completeFrames = complete; // the async read may land after the next sample() set it
    // What the viewer sees is the element composited at its effective opacity
    // over what's behind it (a 30%-opacity "ambient light" canvas flashes a
    // third as much as its raw pixels), so blend the sample the same way
    // before the detector sees it. Invisible elements are skipped.
    const look = this.appearance(performance.now());
    if (look.opacity < 0.02) return;
    if (look.opacity < 0.98) {
      const op = look.opacity;
      const [br, bg, bb] = look.backdrop;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = br + (data[i] - br) * op;
        data[i + 1] = bg + (data[i + 1] - bg) * op;
        data[i + 2] = bb + (data[i + 2] - bb) * op;
      }
    }
    let changed = true; // every video frame from requestVideoFrameCallback is new

    // Guarded start for canvases and images: dim as soon as the content moves.
    if (this.kind !== "video") {
      const hash = quickHash(data);
      changed = this.prevHash === -1 || hash !== this.prevHash;
      if (this.prevHash === -1 || hash !== this.prevHash) {
        if (this.prevHash !== -1 && !this.guardedStartDone) this.beginGuardedStart(performance.now());
        this.lastChange = t;
      } else if (this.kind === "gif" && t - this.lastChange > STATIC_IMAGE_MS) {
        this.stopped = true; // a still image: nothing to watch
      }
      this.prevHash = hash;
    }
    if (this.kind === "video" && !this.guardedStartDone) {
      this.beginGuardedStart(performance.now());
    }

    let report;
    const t1 = performance.now();
    try {
      // Video only: FrameSample.dropped (CONTRACTS s1) comes from rVFC
      // presentedFrames, which a page can't forge. false relaxes the gap rule
      // for low-frame-rate video; canvases and images leave it absent (fail closed).
      report = this.detector.push(this.kind === "video" ? { t, pixels: data, dropped: !complete } : { t, pixels: data });
    } catch {
      report = null;
    }
    const detectMs = performance.now() - t1;
    if (!report) return this.markUnverifiable(REASONS.error);
    this.handleReport(report, t);
    this.trackCost(readMs, detectMs, changed);
  }

  /**
   * Guarded start (lead decision, Sat 4:10 PM): one light page-wide dim the
   * first time media appears, instead of a dim on every element, and a light
   * see-through dim for a few seconds on a video that starts. The detector
   * still covers or softens anything that flashes, usually within 0.3-1 s.
   * @param {number} now  performance.now()
   */
  beginGuardedStart(now) {
    this.guardedStartDone = true;
    if (!(settings.guardedStart || repeatOffender)) return;
    if (this.kind !== "video") {
      pageCheckOnce();
      return;
    }
    let area = this.cssW * this.cssH;
    if (!area) {
      const r = this.el.getBoundingClientRect(); // before the first sample (e.g. on "play")
      area = r.width * r.height;
    }
    if (area < GUARD_START_MIN_AREA) return;
    if (safemode.isGuarded(this.el) || safemode.wasShownByUser(this.el)) return;
    this.warmupUntil = now + VIDEO_CHECK_MS;
    this.checkDeadline = now + VIDEO_CHECK_MAX_MS;
    safemode.guard(this.el, "dim", REASONS.checking, { canShow: false, light: true });
    // The check is "a few seconds, see-through" (lead decision): it lifts at the
    // deadline even if no clean report arrived (buffering, a busy page). The
    // detector keeps watching and softens or covers anything that flashes.
    setTimeout(() => {
      if (this.persistentDim || safemode.guardMode(this.el) !== "dim" || this.soft) return;
      if (safemode.wasShownByUser(this.el)) return;
      safemode.release(this.el);
    }, VIDEO_CHECK_MAX_MS);
  }

  /** @param {any} report @param {number} t */
  noteViolation(report, t) {
    if (t - this.lastViolationMsg >= VIOLATION_MSG_INTERVAL_MS || !this.lastViolationMsg) {
      this.lastViolationMsg = t;
      sendViolation(this.kind, report);
    }
  }

  /**
   * DOM flicker soften: an inline !important transition makes the browser fade
   * class/style toggles over 2 s. The DOM detector keeps measuring the result;
   * if it still violates after a grace period, we cover it as before. A page
   * stripping our transition counts as tampering (toward page lockdown).
   * @param {any} report @param {number} t
   */
  softenDom(report, t) {
    const el = this.el;
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    const prev = el.style.getPropertyValue("transition");
    const prevPriority = el.style.getPropertyPriority("transition");
    try {
      el.style.setProperty("transition", DOM_SOFT_TRANSITION, "important");
    } catch {
      return false;
    }
    const ours = el.style.getPropertyValue("transition");
    // Checked often: with a 3 s transition before any cover, a page that
    // strips it must reach the lockdown quickly (5 tampers within 2 s).
    const guardTimer = setInterval(() => {
      if (!el.isConnected) return;
      if (el.style.getPropertyValue("transition") !== ours || el.style.getPropertyPriority("transition") !== "important") {
        safemode.reportTamper();
        el.style.setProperty("transition", DOM_SOFT_TRANSITION, "important");
      }
    }, 100);
    const stop = () => {
      clearInterval(guardTimer);
      if (el.style.getPropertyValue("transition") === ours) {
        if (prev) el.style.setProperty("transition", prev, prevPriority);
        else el.style.removeProperty("transition");
      }
    };
    this.soft = { dom: true, since: t, checking: false, stop, release: stop, promote() {} };
    this.noteViolation(report, t);
    return true;
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
    this.lastRaw = report; // for getStatus diagnostics (numbers only)
    this.lastRawAt = performance.now();
    // Page elements: only a measured flash counts. The DOM tick samples a
    // quiet element about once a second, so the detector's gap rule ("blind
    // for a whole window": block with no reason) fired on YouTube's player
    // box and covered the whole player (Sat 12:12 AM, Avery's laptop). An
    // element we can't watch closely is left alone, never dimmed (see drop()).
    if (this.kind === "dom" && !report.reason && (report.violation || report.severity !== "none")) {
      report = { ...report, severity: "none", violation: false, undersampled: false };
    }
    // A video sampled on every presented frame can't hide flashes between
    // samples, so the detector's gap rule ("undersampled", and the block after a
    // full-window gap, which carries no reason) doesn't apply: a 10 fps video
    // legitimately has 100 ms between frames. Without this, low-frame-rate
    // videos stayed in "checking" for good.
    if (this.kind === "video" && this.completeFrames && report.undersampled && !report.reason) {
      report = { ...report, severity: "none", violation: false, undersampled: false };
    }
    // Busy pages: the compositor keeps showing video frames while the page's
    // main thread is blocked, so we sometimes miss a few. A gap-only report
    // (no flash reason) never covers a video: one isolated gap can't hide a
    // flash pattern (that needs 5-7 transitions in a second), repeated gaps
    // keep the short "checking" dim on, and if most samples in GAP_WINDOW_MS
    // missed frames we can't keep up, so the video is dimmed as unverifiable (T5).
    if (this.kind === "video") {
      // Our own sampling rate is what matters, not whether every presented
      // frame got a callback (a busy page misses callbacks all the time; we
      // only sample ~12 Hz anyway). A long gap between SAMPLES is blindness.
      const nowMs = performance.now();
      const prev = this.sampleTimes[this.sampleTimes.length - 1];
      this.sampleTimes.push(nowMs);
      if (prev !== undefined && nowMs - prev > LONG_GAP_MS) this.missTimes.push(nowMs);
      while (this.sampleTimes.length && this.sampleTimes[0] < nowMs - GAP_WINDOW_MS) this.sampleTimes.shift();
      while (this.missTimes.length && this.missTimes[0] < nowMs - GAP_WINDOW_MS) this.missTimes.shift();
      const full = this.sampleTimes.length >= GAP_MIN_SAMPLES;
      if (full && this.missTimes.length > this.sampleTimes.length * GAP_MAX_SHARE) return this.markUnverifiable(REASONS.tooCostly);
    }
    if (this.kind === "video" && report.undersampled && !report.reason) {
      this.gapTimes = (this.gapTimes || []).filter((x) => x > t - 1000);
      this.gapTimes.push(t);
      report = { ...report, violation: false, severity: this.gapTimes.length < GAP_WARNS_TO_DIM ? "none" : "warn" };
    }
    const el = this.el;
    // The load-time media dim lifts once this page has a real verdict: a
    // violation (handled below) or BOOT_VERDICT_MS of calm samples.
    if (!bootLifted) {
      if (!this.firstReportAt) this.firstReportAt = t;
      if (report.violation || report.severity === "block" || t - this.firstReportAt >= BOOT_VERDICT_MS) liftBootDim();
    }
    this.sendHud(report, t);
    if (aggregator) this.updateAggregate(report, t);

    if (safemode.wasShownByUser(el)) return;
    const violating = report.violation || report.severity === "block";
    if (this.recheckSince) {
      // A new source behind a cover (resetForNewSource): lift it once the
      // new media has been calm for RECHECK_CALM_MS.
      const nowMs = performance.now();
      if (violating || report.severity === "warn") this.recheckCalmFrom = nowMs;
      if (safemode.guardMode(el) !== "cover") {
        this.recheckSince = 0;
      } else if (!violating && nowMs - this.recheckCalmFrom >= RECHECK_CALM_MS) {
        this.recheckSince = 0;
        safemode.release(el);
        return;
      }
    }
    if (this.soft) {
      if (this.soft.dom) {
        // DOM soften: this detector IS the verifier. Still flashing after the
        // grace period (or the page beat the transition): cover as before.
        if (violating && t - this.soft.since > DOM_SOFT_GRACE_MS) {
          const s = this.soft;
          this.soft = null;
          s.stop();
          this.softFailed = true;
          this.block(report, t);
        }
        return;
      }
      if (this.soft.checking) {
        // Checking (guarded start): flashing -> keep softening; calm -> fade out.
        if (violating) {
          this.soft.promote();
          this.noteViolation(report, t);
        } else if (report.severity === "warn") {
          this.warnUntil = t + WARN_HOLD_MS;
        } else if (t >= this.warmupUntil && t >= this.warnUntil) {
          const s = this.soft;
          this.soft = null;
          s.release();
        }
        return;
      }
      // Softening: the raw media keeps flashing underneath by design; the
      // soften layer's own verify detector decides (and falls back to block).
      return;
    }
    if (violating) {
      this.block(report, t);
      return;
    }
    if (report.severity === "warn") {
      // Only videos get a (light) dim for a warn; other elements keep being
      // checked without a dim on every piece. A real violation still covers.
      // A warn holds the light check a little longer, but the check never
      // outlasts its deadline, and a video is never re-dimmed after it
      // (lead decision: a few seconds, once). Real violations still soften or cover.
      if (this.kind === "video") {
        const nowMs = performance.now();
        if (nowMs < this.checkDeadline) {
          this.warnUntil = Math.min(nowMs + WARN_HOLD_MS, this.checkDeadline);
          if (!safemode.isGuarded(el)) safemode.guard(el, "dim", REASONS.checking, { canShow: false, light: true });
        }
      }
      return;
    }
    // Clean report: lift a temporary dim once warm-up and any warn hold are over.
    const nowMs = performance.now();
    if (safemode.guardMode(el) === "dim" && !this.persistentDim && nowMs >= this.warmupUntil && nowMs >= this.warnUntil) {
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
    if (settings.onFlash !== "soften" || this.softFailed) return false;
    if (this.kind === "dom") return this.softenDom(report, t);
    if (!softenable(v)) return false;
    const severe = report.reason === "red" || report.reason === "both" || (report.flashesPerSecond || 0) >= SEVERE_FLASHES_PER_S;
    if (severe) return false; // block() covers and pauses it
    if (settings.strength >= STRENGTH_BLOCK) return false; // the popup's top step: block
    if (SOFTEN_STYLE === "dim") {
      // Dim + greyscale: the content stays visible and playing, darker and grey,
      // and nothing in it can reach a flash. Stays for this element (no on/off).
      const alpha = STRENGTH_DIM[/** @type {1|2|3|4} */ (settings.strength)] ?? 0.94;
      safemode.guard(v, "dim", REASONS.softDim, { canShow: true, alpha });
      this.verdictHref = location.href; // a later video at another address is judged afresh
      this.persistentDim = true;
      this.noteViolation(report, t); // still logged: the site served flashing media
      return true;
    }
    let soft = null;
    try {
      soft = startSoften(/** @type {any} */ (v), {
        onTamper: () => safemode.reportTamper(),
        appearance: () => this.appearance(performance.now()),
        detect,
        preset: effectivePreset(), // the user's preset, like everything else
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
    this.noteViolation(report, t); // still logged: the site served flashing media
    return true;
  }

  /** @param {any} report @param {number} t */
  block(report, t) {
    const el = this.el;
    if (this.soft) {
      // Already softening. A checking layer becomes a real one ("Flashing
      // softened"); otherwise its verify detector falls back to block itself.
      if (this.soft.checking) {
        this.soft.promote();
        this.noteViolation(report, t);
      }
      return;
    }
    if (this.trySoften(report, t)) return;
    const reason = REASONS[/** @type {keyof typeof REASONS} */ (report.reason)] || REASONS.unknown;
    safemode.guard(el, "cover", reason, { canShow: true });
    this.verdictHref = location.href; // a later video at another address is judged afresh
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

  /** Could it flash at all? A cross-origin image the probe found to be a still can't. */
  canAnimate() {
    return this.kind !== "gif" || this.animated !== false;
  }

  applyUnverifiableDim() {
    const el = this.el;
    if (!this.unverifiable || safemode.wasShownByUser(el)) return;
    const dim = enabled && settings.failClosed && this.canAnimate() && (UNVERIFIABLE_POLICY === "always" || repeatOffender || this.isActive());
    const mode = safemode.guardMode(el);
    // A see-through element we can't read (a site's "ambient light" canvas
    // drawn from a video we can't read) is decorative: a panel the size of its
    // scaled-up box blacked out most of the page. Fade it instead (0.08 of its
    // own opacity leaves at most ~0.04 of a strobe's swing on screen).
    // YouTube's ambient mode (Sat 11:05 PM, Avery's laptop) is two 110x75
    // canvases drawn from cross-origin thumbnails, stretched to 979x734 and
    // crossfaded, so one is fully opaque: a small bitmap blown up 3x or more is
    // a glow too. The fade caps any flash it could carry at 0.08 of its swing.
    const glow = (isStretchedCanvas(el) || this.appearance(performance.now()).opacity < CLEAR_GLOW_OPACITY) && el instanceof HTMLElement;
    if (dim && glow) {
      if (mode === "dim") safemode.release(el, { immediate: true });
      this.fadeGlow(true);
      return;
    }
    this.fadeGlow(false);
    if (dim) {
      if (mode !== "cover") safemode.guard(el, "dim", this.unverifiable, { canShow: true, announce: false });
    } else if (mode === "dim") {
      safemode.release(el);
    }
  }

  /**
   * Fade a decorative glow we don't measure: a marker attribute plus one
   * stylesheet rule with !important, which beats the page's own inline
   * opacity (YouTube's ambient crossfade rewrites it several times a second,
   * Sat 11:58 PM). The unverifiable timer re-applies both if the page strips them.
   * @param {boolean} on
   */
  fadeGlow(on) {
    const el = /** @type {HTMLElement} */ (this.el);
    if (!(el instanceof HTMLElement)) return;
    if (on) {
      ensureGlowStyle();
      if (!el.hasAttribute(GLOW_ATTR)) el.setAttribute(GLOW_ATTR, "");
      this.glowFaded = true;
    } else if (this.glowFaded) {
      this.glowFaded = false;
      el.removeAttribute(GLOW_ATTR);
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
    this.fadeGlow(false);
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
    this.overMediaAt = -Infinity;
    this.overMediaVal = false;
    this.layerSeenOpaque = false;
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

  /**
   * A page element we can't measure is DROPPED, never dimmed: these are the
   * page's own layout (headers, sidebars, content columns whose classes a
   * framework keeps toggling), and dimming them as "unverifiable" blacked out
   * whole sites (YouTube, Sat 6:29 PM). Only an element measured flashing is
   * softened or covered. Media (video, canvas, images) keeps failing closed.
   */
  drop() {
    this.stopped = true;
    this.resetDetector();
    domSources.delete(this.el);
  }

  /** @param {number} t @param {number} area */
  ensureDomDetector(t, area) {
    const resized = !this.detector || Math.abs(area - this.area) > this.area * 0.5;
    if (!resized) return true;
    if (this.detector && t - this.lastRebuild < RESIZE_MIN_GAP_MS) {
      if (++this.resizeChurn > RESIZE_CHURN_LIMIT) {
        this.drop();
        return false;
      }
      return true;
    }
    this.lastRebuild = t;
    this.area = area;
    try {
      this.detector = detect.createDetector({ preset: effectivePreset(), sampleWidth: 1, sampleHeight: 1, realAreaScale: Math.sqrt(area) });
    } catch {
      this.drop();
      return false;
    }
    return true;
  }

  /**
   * Is this element a see-through layer over (or the box around) a video or
   * canvas we're already measuring? The overlap is cached for
   * MEDIA_OVERLAP_CACHE_MS; the background is checked on every sample, and a
   * layer seen with a background at least LAYER_ALPHA_WATCH opaque even once
   * is page content for good: toggling a layer between see-through and solid
   * can't hide a strobe over a video (demo/adversarial/overlay-strobe*.html).
   * @param {number} t
   */
  overMedia(t) {
    const el = this.el;
    if (this.layerSeenOpaque) return false;
    try {
      const bg = parseComputedColor(getComputedStyle(el).backgroundColor);
      if (!bg || bg[3] >= LAYER_ALPHA_WATCH) {
        this.layerSeenOpaque = true;
        return false;
      }
    } catch {
      this.layerSeenOpaque = true;
      return false;
    }
    if (t - this.overMediaAt < MEDIA_OVERLAP_CACHE_MS) return this.overMediaVal;
    this.overMediaAt = t;
    this.overMediaVal = false;
    try {
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (!(a > 0)) return false;
      for (const m of sources.values()) {
        if (m.kind !== "video" && m.kind !== "canvas") continue;
        if (!m.el.isConnected) continue;
        const mr = m.el.getBoundingClientRect();
        const ow = Math.min(r.right, mr.right) - Math.max(r.left, mr.left);
        const oh = Math.min(r.bottom, mr.bottom) - Math.max(r.top, mr.top);
        if (ow > 0 && oh > 0 && (ow * oh) / a >= MEDIA_OVERLAP_SHARE) {
          this.overMediaVal = true;
          break;
        }
      }
    } catch {}
    return this.overMediaVal;
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
    if (this.overMedia(t)) {
      // Player chrome over a video we measure by its pixels (Sat 11:25 PM,
      // Rick Astley on Avery's laptop): YouTube's controls, overlays and end
      // cards fade in and out over the video, their computed colours swung
      // against the player's black background (not the video actually seen
      // through them), so they read as flashing, got softened, and their area
      // pushed the page aggregate over the limit, covering the video. What
      // shows there is the video, which its own detector checks.
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
    if (!eff.ok) return this.drop(); // colours we can't read: stop watching this element (see drop)
    this.pixel[0] = eff.color[0];
    this.pixel[1] = eff.color[1];
    this.pixel[2] = eff.color[2];
    let report;
    try {
      report = this.detector.push({ t, pixels: this.pixel });
    } catch {
      report = null;
    }
    if (!report) return this.drop();
    this.handleReport(report, t);
  }
}

const GLOW_ATTR = `data-fb-glow-${Math.random().toString(36).slice(2, 8)}`;
/** @type {HTMLStyleElement | null} */ let glowStyle = null;
function ensureGlowStyle() {
  if (glowStyle && glowStyle.isConnected) return;
  glowStyle = document.createElement("style");
  glowStyle.textContent = `[${GLOW_ATTR}] { opacity: 0.08 !important; transition: none !important; }`;
  (document.head || document.documentElement).append(glowStyle);
}

/** A small bitmap (<= 320 px) shown 3x or more its size on both axes: a blurred ambient glow. @param {Element} el */
function isStretchedCanvas(el) {
  if (!(el instanceof HTMLCanvasElement) || el.width <= 0 || el.height <= 0 || el.width > 320 || el.height > 320) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 3 * el.width && r.height >= 3 * el.height;
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
    if (now - s.lastT > MIN_SAMPLE_MS) s.sample(now);
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
      if (domSources.size >= MAX_DOM_SOURCES) continue; // CPU guard (T5): page elements beyond the cap are not watched, never dimmed (see DomSource.drop)
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

let lastDomTick = -Infinity;
let domCursor = 0; // round-robin start, so a tick that runs out of budget doesn't starve the same sources

/** @param {number} now */
function domTick(now) {
  domLoop = 0;
  if (!enabled) return;
  // Reading an element's computed colour forces a style recalc, which costs
  // real time on a big page (a 10k-node video site), so this runs at most
  // every DOM_TICK_MS and stops after DOM_TICK_BUDGET_MS, picking up where
  // it left off on the next tick.
  if (now - lastDomTick < DOM_TICK_MS) {
    domLoop = requestAnimationFrame(domTick);
    return;
  }
  lastDomTick = now;
  let hot = 0;
  const entries = [...domSources];
  const start = performance.now();
  for (let i = 0; i < entries.length; i++) {
    const [el, s] = entries[(domCursor + i) % entries.length];
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
    if (performance.now() - start > DOM_TICK_BUDGET_MS) {
      domCursor = (domCursor + i) % entries.length;
      break;
    }
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

/** The single page-wide check: shown the first time media appears on this page. */
function pageCheckOnce() {
  if (pageCheckDone || !enabled) return;
  pageCheckDone = true;
  safemode.checkPage("Checking this page for flashing…", PAGE_CHECK_MS);
}

/** Sites with a past violation get the strict preset (STRATEGY 7.6). */
/**
 * The detector preset is the user's choice. Repeat-offender sites used to get
 * "strict" automatically (Sat 11:45 PM, lead decision): one flagged ad on
 * youtube.com made the whole site strict for 30 days, and strict's "any red
 * flash pair" rule fires on ordinary video (a few hundred px of red shirt
 * changing colour), so most videos were covered for "rapid red flashes".
 * Repeat offenders keep guarded start and always-dimmed unverifiable media.
 */
function effectivePreset() {
  return settings.preset;
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
  checkSlowedAnimations();
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
    // Soften first: slow the animation down so it keeps moving but can't flash.
    if (settings.onFlash === "soften" && slowAnimation(a, res)) {
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
      continue;
    }
    coverAnimation(a, target, res);
  }
}

/**
 * Soften a CSS / Web Animation by slowing it to about CSS_SOFT_CYCLES per
 * second, then re-check it at the new rate with analyzeAnimation. Returns
 * false (caller pauses and covers) if it can't be slowed enough.
 * @param {Animation} a @param {any} res
 */
function slowAnimation(a, res) {
  const cps = Number(res?.cyclesPerSecond);
  if (!(cps > CSS_SOFT_CYCLES)) return false;
  let original;
  try {
    original = a.playbackRate;
    const rate = original * (CSS_SOFT_CYCLES / cps);
    a.playbackRate = rate;
    const again = detect.analyzeAnimation(a, animationContext(a));
    if (again?.violation) {
      a.playbackRate = original;
      return false;
    }
    slowedAnims.set(a, { rate: a.playbackRate, original });
    return true;
  } catch {
    try {
      if (original !== undefined) a.playbackRate = original;
    } catch {}
    return false;
  }
}

/** Slowed animations the page sped back up: tampering. Pause and cover them. */
function checkSlowedAnimations() {
  for (const [a, s] of slowedAnims) {
    let rate;
    try {
      if (a.playState === "finished" || a.playState === "idle") {
        slowedAnims.delete(a);
        continue;
      }
      rate = a.playbackRate;
    } catch {
      continue;
    }
    if (Math.abs(rate - s.rate) > 1e-9) {
      slowedAnims.delete(a);
      safemode.reportTamper();
      const target = /** @type {KeyframeEffect | null} */ (a.effect)?.target;
      if (target instanceof Element && !safemode.wasShownByUser(target)) {
        coverAnimation(a, target, { cyclesPerSecond: 0 });
      }
    }
  }
}

/** Pause a flashing animation and cover its element (block). @param {Animation} a @param {Element} target @param {any} res */
function coverAnimation(a, target, res) {
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
  // The lockdown CSS hides the page's media; stop soften layers so we don't
  // keep re-inserting them for the attacker's MutationObserver to delete.
  for (const s of allSources()) {
    if (s.soft && !s.soft.dom) {
      const soft = s.soft;
      s.soft = null;
      try {
        soft.stop();
      } catch {}
    }
  }
}

/**
 * The user pressed "Show original on this site" in the bar: remember the site
 * (allowlist), which turns the shield off here through the normal settings
 * path; the popup's per-site switch turns it back on.
 */
function onBypass() {
  if (!siteDomain) return;
  chrome.storage.local
    .get("settings")
    .then(({ settings: raw }) => {
      const cur = normalizeSettings(raw);
      if (cur.allowlist.includes(siteDomain)) return;
      return chrome.storage.local.set({ settings: { ...cur, allowlist: [...cur.allowlist, siteDomain] } });
    })
    .catch(() => {});
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
