// Soften mode (extension/src/detect/SOFTEN_DESIGN.md), for video, canvas and
// same-origin animated images.
//
// Instead of covering flagged media, we keep it running underneath (audio,
// captions, controls and clicks keep working) and draw a softened copy on
// top: each frame goes through the pure two-stage low-pass filter
// (createSoftener) and is shown on a canvas that sits exactly over the media.
//
// Safety: a SECOND detector checks every softened frame. If it still sees a
// violation, if the filter fails, if a frame can't be read (cross-origin, DRM,
// tainted canvas) or if a video leaves our canvas (picture-in-picture,
// fullscreen), we call onFail and the caller falls back to the normal cover
// (fail closed).
//
// "Checking" mode (guarded start): the layer can also run while new media is
// being checked, instead of dimming it. If the media turns out calm, the
// caller calls release() and the layer fades away; if it flashes, promote()
// switches the label to "Flashing softened" and it stays.
//
// The canvas lives in its own closed shadow root inside a top-layer popover,
// like the safe-mode overlay, so page CSS can't hide or restyle it. It takes
// no pointer events, so the page's own controls stay usable.

import { createSoftener, DEFAULT_TAU } from "../detect/soften.js";

const MAX_SIDE = 256; // detector limit per side
const BUDGET_PX = 240 * 135; // filter + verify cost per frame stays around 1 ms
const FADE_MS = 300;
const TAG = `ss-soft-${Math.random().toString(36).slice(2, 10)}`;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const CSS = `
  .layer { position: fixed; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0;
           background: transparent; overflow: hidden; pointer-events: none; }
  .layer::backdrop { display: none; }
  canvas { position: absolute; left: 0; top: 0; display: block; pointer-events: none; image-rendering: auto;
           opacity: 1; transition: opacity ${FADE_MS}ms linear; }
  .badge { position: absolute; margin: 8px; padding: 4px 10px; border-radius: 4px; pointer-events: none;
           font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
           color: #ffffff; background: rgba(0, 0, 0, 0.78); border: 1px solid #ffd54a; }
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
 * @param {{ detect: any, preset: string, onFail: (report?: any) => void, checking?: boolean }} opts
 * @returns {{ stop(): void, release(): void, promote(): void, readonly checking: boolean } | null}
 */
export function startSoften(el, { detect, preset, onFail, checking = false }) {
  if (!detect || typeof detect.createDetector !== "function" || !softenable(el)) return null;
  const isVideo = el instanceof HTMLVideoElement;
  if (isVideo && /** @type {HTMLVideoElement} */ (el).mediaKeys) return null; // DRM: frames can't be read
  if (document.pictureInPictureElement === el) return null;
  if (document.fullscreenElement && document.fullscreenElement.contains(el)) return null;

  const r = el.getBoundingClientRect();
  if (r.width < 16 || r.height < 16) return null;
  const scale = Math.min(1, Math.sqrt(BUDGET_PX / (r.width * r.height)), MAX_SIDE / r.width, MAX_SIDE / r.height);
  const w = Math.max(1, Math.round(r.width * scale));
  const h = Math.max(1, Math.round(r.height * scale));

  // Work canvas: read frames at the filter size.
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

  const softener = createSoftener({ width: w, height: h, tau: DEFAULT_TAU });
  let verify;
  try {
    verify = detect.createDetector({ preset, sampleWidth: w, sampleHeight: h, realAreaScale: 1 / scale });
  } catch {
    return null;
  }

  // Display layer.
  const host = document.createElement(TAG);
  for (const [p, v] of [
    ["display", "block"], ["position", "fixed"], ["top", "0"], ["left", "0"], ["width", "0"], ["height", "0"],
    ["margin", "0"], ["padding", "0"], ["border", "0"], ["overflow", "visible"], ["visibility", "visible"],
    ["opacity", "1"], ["filter", "none"], ["transform", "none"], ["pointer-events", "none"], ["z-index", "2147483646"],
  ]) host.style.setProperty(p, v, "important");
  const hostStyle = host.getAttribute("style") || "";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const layer = document.createElement("div");
  layer.className = "layer";
  layer.setAttribute("popover", "manual");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
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
  const dctx = canvas.getContext("2d");
  if (!dctx) return null;
  const frame = new ImageData(w, h);

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

  function attach() {
    if (!host.isConnected) document.documentElement.append(host);
    if ((host.getAttribute("style") || "") !== hostStyle) host.setAttribute("style", hostStyle);
    if (!layer.matches(":popover-open")) {
      try {
        layer.showPopover();
      } catch {}
    }
  }

  function place() {
    const b = el.getBoundingClientRect();
    canvas.style.left = `${b.left}px`;
    canvas.style.top = `${b.top}px`;
    canvas.style.width = `${b.width}px`;
    canvas.style.height = `${b.height}px`;
    badge.style.left = `${b.left}px`;
    badge.style.top = `${b.top}px`;
  }

  /** @param {any} [report] */
  function fail(report) {
    if (stopped) return;
    stop();
    onFail(report);
  }

  /** @param {number} t */
  function onFrame(t) {
    if (stopped) return;
    if (el instanceof HTMLImageElement && (!el.complete || el.naturalWidth === 0)) return;
    if (el instanceof HTMLCanvasElement && (el.width === 0 || el.height === 0)) return;
    let data;
    try {
      wctx.drawImage(el, 0, 0, w, h);
      data = wctx.getImageData(0, 0, w, h).data;
    } catch {
      return fail();
    }
    const out = softener.push(data, t);
    if (softener.failed) return fail();
    const rep = verify.push({ t, pixels: out });
    if (rep.violation || rep.severity === "block") return fail(rep);
    frame.data.set(out);
    dctx.putImageData(frame, 0, 0);
  }

  // Video: one softened frame per decoded video frame. Canvas and images:
  // one per animation frame (that's when they can change).
  const useVfc = isVideo && typeof (/** @type {HTMLVideoElement} */ (el).requestVideoFrameCallback) === "function";
  function scheduleVideo() {
    if (stopped) return;
    vfc = /** @type {HTMLVideoElement} */ (el).requestVideoFrameCallback((now, meta) => {
      vfc = 0;
      onFrame(meta.expectedDisplayTime || now);
      scheduleVideo();
    });
  }
  /** @param {number} now */
  function frameTick(now) {
    if (stopped) return;
    onFrame(now);
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
    if (document.pictureInPictureElement === el || (document.fullscreenElement && document.fullscreenElement.contains(el))) fail();
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
  attach();
  place();
  onFrame(performance.now());
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
