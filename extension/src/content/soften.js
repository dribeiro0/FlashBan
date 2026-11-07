// Soften mode (extension/src/detect/SOFTEN_DESIGN.md), for video, canvas and
// same-origin animated images.
//
// Instead of covering flagged media, we keep it running underneath (audio,
// captions, controls and clicks keep working) and draw a softened copy on
// top: a canvas that sits exactly over the media and shows the two-stage
// low-pass filter from SOFTEN_DESIGN.md (s1 += a (x - s1); s2 += a (s1 - s2),
// a = 1 - exp(-dt / tau)). The filter runs at the media's own resolution on the
// GPU: drawing a frame with globalAlpha = a over the previous output IS the
// update s += a (x - s), so there is no per-pixel work on the main thread and
// no blur (an earlier version filtered a 240x135 copy and scaled it up).
//
// Safety: a SECOND detector checks what is actually on screen: it reads the
// output canvas back at a small size VERIFY_HZ times a second. If it still sees
// a violation, if a frame can't be read (cross-origin, DRM, tainted canvas) or
// if a video leaves our canvas (picture-in-picture, fullscreen), we call onFail
// and the caller falls back to the normal cover (fail closed).
//
// "Checking" mode (guarded start): the layer can also run while new media is
// being checked, instead of dimming it. If the media turns out calm, the
// caller calls release() and the layer fades away; if it flashes, promote()
// switches the label to "Flashing softened" and it stays.
//
// Placement: the canvas lives in its own closed shadow root and takes no
// pointer events, so the page's controls keep working. By default ("inline")
// the host sits right after the media in the DOM, absolutely positioned over
// it at the media's own stacking level, so a player's controls, captions and
// menus (later siblings, higher z-index) stay VISIBLE above the softened
// picture. If the layout doesn't line up (transforms, unusual containing
// blocks) it falls back to "fixed": a top-layer popover over the media's
// viewport rect, like the safe-mode overlay, which covers the controls too.

import { DEFAULT_TAU } from "../detect/soften.js";

const MAX_SIDE = 256; // detector limit per side
const VERIFY_PX = 160 * 90; // the verifier's readback size
const VERIFY_HZ = 15; // readbacks per second (a 3 Hz flash needs about 6 samples per second)
const MAX_DISPLAY_PX = 2560 * 1440; // output canvas cap (device pixels)
const MAX_STEP = 0.25; // largest share of the way to a new frame any one update may move
const RESIZE_PCT = 0.1; // rebuild the output canvas when the media grows or shrinks this much
const FADE_MS = 300;
const TAG = `ss-soft-${Math.random().toString(36).slice(2, 10)}`;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const CSS = `
  .layer { position: fixed; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0;
           background: transparent; overflow: hidden; pointer-events: none; }
  .layer:not([popover]) { position: absolute; overflow: visible; }
  .layer::backdrop { display: none; }
  canvas { position: absolute; left: 0; top: 0; display: block; pointer-events: none; image-rendering: auto;
           opacity: 1; transition: opacity ${FADE_MS}ms linear; }
  .badge { position: absolute; margin: 8px; padding: 4px 10px; border-radius: 4px; pointer-events: none;
           font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
           color: #ffffff; background: rgba(0, 0, 0, 0.78); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) { canvas { transition: none; } }
`;

/**
 * Can this element be softened at all (before trying to read it)?
 * @param {Element} el
 */
export function softenable(el) {
  return el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement || el instanceof HTMLImageElement;
}

/**
 * Start softening a video, canvas or image. Returns null if it can't (the
 * caller then blocks or dims as before).
 * @param {HTMLVideoElement | HTMLCanvasElement | HTMLImageElement} el
 * @param {{ detect: any, preset: string, onFail: (report?: any) => void, checking?: boolean, onTamper?: () => void }} opts
 *   onTamper: called whenever the page removed or restyled the soften layer (threat T6)
 * @returns {{ stop(): void, release(): void, promote(): void, readonly checking: boolean } | null}
 */
export function startSoften(el, { detect, preset, onFail, checking = false, onTamper }) {
  if (!detect || typeof detect.createDetector !== "function" || !softenable(el)) return null;
  const isVideo = el instanceof HTMLVideoElement;
  if (isVideo && /** @type {HTMLVideoElement} */ (el).mediaKeys) return null; // DRM: frames can't be read
  if (document.pictureInPictureElement === el) return null;
  if (document.fullscreenElement && document.fullscreenElement.contains(el)) return null;

  const r = el.getBoundingClientRect();
  if (r.width < 16 || r.height < 16) return null;
  const scale = Math.min(1, Math.sqrt(VERIFY_PX / (r.width * r.height)), MAX_SIDE / r.width, MAX_SIDE / r.height);
  const w = Math.max(1, Math.round(r.width * scale));
  const h = Math.max(1, Math.round(r.height * scale));

  // Work canvas: the verifier reads the output back at this size.
  const work = new OffscreenCanvas(w, h);
  const wctx = work.getContext("2d", { willReadFrequently: true, alpha: false });
  if (!wctx) return null;
  try {
    // Probe one read now: cross-origin media or a tainted canvas throws here,
    // before we show anything.
    wctx.drawImage(el, 0, 0, w, h);
    wctx.getImageData(0, 0, 1, 1);
  } catch {
    return null;
  }

  let verify;
  try {
    verify = detect.createDetector({ preset, sampleWidth: w, sampleHeight: h, realAreaScale: 1 / scale });
  } catch {
    return null;
  }

  // Output size: the media's size in device pixels, never more than its own
  // resolution (upscaling adds nothing) and never above MAX_DISPLAY_PX.
  function outputSize(b) {
    const dpr = Math.max(1, devicePixelRatio || 1);
    let ow = b.width * dpr;
    let oh = b.height * dpr;
    const nat = el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight]
      : el instanceof HTMLCanvasElement ? [el.width, el.height] : [el.naturalWidth, el.naturalHeight];
    if (nat[0] > 0 && nat[1] > 0 && (nat[0] < ow || nat[1] < oh)) {
      const k = Math.min(nat[0] / ow, nat[1] / oh);
      ow *= k;
      oh *= k;
    }
    if (ow * oh > MAX_DISPLAY_PX) {
      const k = Math.sqrt(MAX_DISPLAY_PX / (ow * oh));
      ow *= k;
      oh *= k;
    }
    return [Math.max(1, Math.round(ow)), Math.max(1, Math.round(oh))];
  }

  // Display layer.
  const host = document.createElement(TAG);
  /** @type {"inline" | "fixed"} */
  let mode = el.parentNode ? "inline" : "fixed";
  let hostStyle = "";
  const COMMON_STYLE = [
    ["display", "block"], ["margin", "0"], ["padding", "0"], ["border", "0"], ["overflow", "visible"],
    ["visibility", "visible"], ["opacity", "1"], ["filter", "none"], ["transform", "none"], ["pointer-events", "none"],
    ["box-sizing", "border-box"], ["max-width", "none"], ["max-height", "none"], ["inset", "auto"],
  ];
  /** Write the host's style for the current mode; the tamper check compares against it. */
  function styleHost() {
    host.removeAttribute("style");
    for (const [p, v] of COMMON_STYLE) host.style.setProperty(p, v, "important");
    if (mode === "fixed") {
      for (const [p, v] of [["position", "fixed"], ["top", "0"], ["left", "0"], ["width", "0"], ["height", "0"], ["z-index", "2147483646"]]) host.style.setProperty(p, v, "important");
    } else {
      const he = /** @type {HTMLElement} */ (el);
      let z = "auto";
      try {
        const cs = getComputedStyle(el);
        if (cs.position !== "static" && /^-?\d+$/.test(cs.zIndex)) z = cs.zIndex;
      } catch {}
      for (const [p, v] of [
        ["position", "absolute"], ["left", `${he.offsetLeft}px`], ["top", `${he.offsetTop}px`],
        ["width", `${he.offsetWidth}px`], ["height", `${he.offsetHeight}px`], ["z-index", z],
      ]) host.style.setProperty(p, v, "important");
    }
    hostStyle = host.getAttribute("style") || "";
  }
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const layer = document.createElement("div");
  layer.className = "layer";
  const canvas = document.createElement("canvas");
  let [ow, oh] = outputSize(r);
  let sizedW = r.width;
  let sizedH = r.height;
  canvas.width = ow;
  canvas.height = oh;
  canvas.setAttribute("role", "img");
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.setAttribute("aria-hidden", "true");
  const live = document.createElement("div");
  live.className = "sr";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  layer.append(canvas, badge);
  root.append(style, live, layer);
  const dctx = canvas.getContext("2d", { alpha: false });
  if (!dctx) return null;
  // Stage 1 of the filter lives in its own canvas; the visible canvas is stage 2.
  let stage1 = new OffscreenCanvas(ow, oh);
  let s1ctx = stage1.getContext("2d", { alpha: false });
  if (!s1ctx) return null;
  let lastT = NaN; // first frame: a = 1, so the output equals the current frame (no jump: T13)
  let lastVerify = -Infinity;

  let isChecking = checking;
  const what = isVideo ? "Video" : "Animation";
  function label() {
    if (isChecking) {
      canvas.setAttribute("aria-label", `${what} being checked for flashing by FlashBan`);
      badge.textContent = "Checking for flashing";
    } else {
      canvas.setAttribute("aria-label", `${what} with flashing softened by FlashBan`);
      badge.textContent = "Flashing softened";
    }
  }
  label();

  let stopped = false;
  let vfc = 0;
  let frameRaf = 0;
  let placeRaf = 0;

  let attachedOnce = false;
  function attach() {
    // After the first attach, a missing or restyled host means the page is
    // attacking the layer (like overlay-killer does to the cover). Report it so
    // repeated attacks reach the page lockdown, which the page can't undo.
    // (A player re-rendering its DOM once also lands here; the lockdown needs
    // several hits within two seconds, so a one-off doesn't trigger it.)
    if (!host.isConnected || (mode === "inline" && host.previousSibling !== el)) {
      if (attachedOnce) onTamper?.();
      if (mode === "inline" && el.parentNode) el.parentNode.insertBefore(host, el.nextSibling);
      else {
        mode = "fixed";
        styleHost();
        document.documentElement.append(host);
      }
    }
    if ((host.getAttribute("style") || "") !== hostStyle) {
      if (attachedOnce) onTamper?.();
      host.setAttribute("style", hostStyle);
    }
    attachedOnce = true;
    if (mode === "fixed" && !layer.matches(":popover-open")) {
      try {
        layer.showPopover();
      } catch {}
    }
  }

  /** Switch to the top-layer placement (covers the player's controls too). */
  function goFixed() {
    if (mode === "fixed") return;
    mode = "fixed";
    try {
      layer.hidePopover();
    } catch {}
    layer.setAttribute("popover", "manual");
    host.remove();
    styleHost();
    attach();
  }

  let lastAlign = -Infinity;
  let misaligned = 0;
  function place() {
    const b = el.getBoundingClientRect();
    if (mode === "inline") {
      // Keep the host on the media's box (offsets change on resize or theatre
      // mode) and check now and then that it really lines up; if it doesn't,
      // the containing block or a transform defeated us: fall back to fixed.
      const he = /** @type {HTMLElement} */ (el);
      const now = performance.now();
      const wantLeft = `${he.offsetLeft}px`;
      if (host.style.getPropertyValue("left") !== wantLeft || host.style.getPropertyValue("top") !== `${he.offsetTop}px` ||
          host.style.getPropertyValue("width") !== `${he.offsetWidth}px` || host.style.getPropertyValue("height") !== `${he.offsetHeight}px`) {
        styleHost();
        lastAlign = -Infinity;
      }
      if (now - lastAlign > 500) {
        lastAlign = now;
        const hb = host.getBoundingClientRect();
        const off = Math.abs(hb.left - b.left) + Math.abs(hb.top - b.top) + Math.abs(hb.width - b.width) + Math.abs(hb.height - b.height);
        if (off > 2) {
          if (++misaligned >= 2) goFixed();
        } else misaligned = 0;
      }
    }
    if (Math.abs(b.width - sizedW) > sizedW * RESIZE_PCT || Math.abs(b.height - sizedH) > sizedH * RESIZE_PCT) {
      // The media changed size (theatre mode, a resized window): new output
      // canvases at the new size, restarted from the next frame.
      [ow, oh] = outputSize(b);
      sizedW = b.width;
      sizedH = b.height;
      canvas.width = ow;
      canvas.height = oh;
      stage1 = new OffscreenCanvas(ow, oh);
      s1ctx = stage1.getContext("2d", { alpha: false });
      if (!s1ctx) return fail();
      lastT = NaN;
    }
    const left = mode === "fixed" ? b.left : 0;
    const top = mode === "fixed" ? b.top : 0;
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.width = `${b.width}px`;
    canvas.style.height = `${b.height}px`;
    badge.style.left = `${left}px`;
    badge.style.top = `${top}px`;
  }

  /** @param {any} [report] */
  function fail(report) {
    if (stopped) return;
    stop();
    onFail(report);
  }

  /**
   * One filter update. Timing uses the wall clock, not the frame's own
   * timestamp: after a blocked main thread, queued video-frame callbacks
   * replay in a burst with timestamps 33 ms apart but the same frame on
   * screen, and the exact filter would then step the same way several times.
   */
  function onFrame() {
    if (stopped) return;
    const t = performance.now();
    if (el instanceof HTMLImageElement && (!el.complete || el.naturalWidth === 0)) return;
    if (el instanceof HTMLCanvasElement && (el.width === 0 || el.height === 0)) return;
    // Filter update on the GPU: s1 += a (x - s1), s2 += a (s1 - s2).
    // After a long gap (a blocked main thread) the exact filter would jump
    // most of the way to the new frame in one step; MAX_STEP keeps every
    // update a gentle fraction instead. The first frame is a = 1 on purpose.
    const dt = Number.isFinite(lastT) ? Math.max(0, t - lastT) : Infinity;
    const a = dt === Infinity ? 1 : Math.min(MAX_STEP, 1 - Math.exp(-dt / 1000 / DEFAULT_TAU));
    lastT = t;
    try {
      s1ctx.globalAlpha = a;
      s1ctx.drawImage(el, 0, 0, ow, oh);
      dctx.globalAlpha = a;
      dctx.drawImage(stage1, 0, 0, ow, oh);
    } catch {
      return fail();
    }
    // Verify what is on screen: read the OUTPUT back at a small size and run
    // the second detector on it. Not every frame: a readback costs about a
    // millisecond, and the detector needs about 6 samples a second for 3 Hz.
    if (t - lastVerify < 1000 / VERIFY_HZ) return;
    lastVerify = t;
    let data;
    try {
      wctx.drawImage(canvas, 0, 0, w, h);
      data = wctx.getImageData(0, 0, w, h).data;
    } catch {
      return fail();
    }
    const rep = verify.push({ t, pixels: data });
    // Flashing that got through the filter: fall back to the cover. A "block"
    // with no reason is the detector's sampling-gap rule (a busy page delayed
    // our frames); the output is low-passed by construction, so that alone
    // doesn't fail it.
    if ((rep.violation || rep.severity === "block") && rep.reason) return fail(rep);
  }

  // Video: one softened frame per decoded video frame. Canvas and images:
  // one per animation frame (that's when they can change).
  const useVfc = isVideo && typeof (/** @type {HTMLVideoElement} */ (el).requestVideoFrameCallback) === "function";
  function scheduleVideo() {
    if (stopped) return;
    vfc = /** @type {HTMLVideoElement} */ (el).requestVideoFrameCallback(() => {
      vfc = 0;
      onFrame();
      scheduleVideo();
    });
  }
  function frameTick() {
    if (stopped) return;
    onFrame();
    frameRaf = requestAnimationFrame(frameTick);
  }

  function tick() {
    if (stopped) return;
    if (!el.isConnected) return fail();
    attach();
    place();
    placeRaf = requestAnimationFrame(tick);
  }

  const onLeave = () => {
    if (document.pictureInPictureElement === el) return fail();
    const fs = document.fullscreenElement;
    // A player container going fullscreen with our inline host inside it is
    // fine (the host comes along); the media itself, or a container we're
    // outside of, is not.
    if (fs && fs.contains(el) && !(mode === "inline" && fs !== el && fs.contains(host))) fail();
  };
  el.addEventListener("enterpictureinpicture", onLeave);
  document.addEventListener("fullscreenchange", onLeave, true);

  function stop() {
    if (stopped) return;
    stopped = true;
    if (vfc) /** @type {HTMLVideoElement} */ (el).cancelVideoFrameCallback?.(vfc);
    cancelAnimationFrame(frameRaf);
    cancelAnimationFrame(placeRaf);
    el.removeEventListener("enterpictureinpicture", onLeave);
    document.removeEventListener("fullscreenchange", onLeave, true);
    try {
      layer.hidePopover();
    } catch {}
    host.remove();
  }

  /** Calm after all: fade the layer out (no sudden jump: threat T13), then stop. */
  function release() {
    if (stopped) return;
    if (reducedMotion.matches) return stop();
    canvas.style.opacity = "0";
    badge.textContent = "";
    setTimeout(stop, FADE_MS + 50);
  }

  /** It is flashing: keep softening and say so. */
  function promote() {
    if (stopped || !isChecking) return;
    isChecking = false;
    label();
    live.textContent = "";
    setTimeout(() => {
      if (!stopped) live.textContent = `Flashing in this ${what.toLowerCase()} is being softened. It keeps playing.`;
    }, 50);
  }

  // Show the first softened frame immediately (it equals the current frame,
  // so there is no sudden jump: threat T13), then keep filtering.
  if (mode === "fixed") layer.setAttribute("popover", "manual");
  styleHost();
  attach();
  place();
  if (mode === "inline") {
    // First alignment check right away, before anything is shown.
    const hb = host.getBoundingClientRect();
    if (Math.abs(hb.left - r.left) + Math.abs(hb.top - r.top) + Math.abs(hb.width - r.width) + Math.abs(hb.height - r.height) > 2) goFixed();
    place();
  }
  onFrame();
  if (stopped) return null;
  if (useVfc) scheduleVideo();
  else frameRaf = requestAnimationFrame(frameTick);
  placeRaf = requestAnimationFrame(tick);
  if (!checking) {
    setTimeout(() => {
      if (!stopped) live.textContent = `Flashing in this ${what.toLowerCase()} is being softened. It keeps playing.`;
    }, 50);
  }

  return {
    stop,
    release,
    promote,
    get checking() {
      return isChecking;
    },
  };
}
