// Soften mode for video (extension/src/detect/SOFTEN_DESIGN.md).
//
// Instead of covering a flagged video, we keep it playing underneath (audio,
// captions and controls keep working) and draw a softened copy on top:
// each frame goes through the pure two-stage low-pass filter (createSoftener)
// and is shown on a canvas that sits exactly over the video.
//
// Safety: a SECOND detector checks every softened frame. If it still sees a
// violation, if the filter fails, if a frame can't be read (cross-origin, DRM)
// or if the video leaves our canvas (picture-in-picture, fullscreen), we call
// onFail and the caller falls back to the normal cover (fail closed).
//
// The canvas lives in its own closed shadow root inside a top-layer popover,
// like the safe-mode overlay, so page CSS can't hide or restyle it. It takes
// no pointer events, so the page's own video controls stay usable.

import { createSoftener, DEFAULT_TAU } from "../detect/soften.js";

const MAX_SIDE = 256; // detector limit per side
const BUDGET_PX = 240 * 135; // filter + verify cost per frame stays around 1 ms
const TAG = `ss-soft-${Math.random().toString(36).slice(2, 10)}`;

const CSS = `
  .layer { position: fixed; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: 0;
           background: transparent; overflow: hidden; pointer-events: none; }
  .layer::backdrop { display: none; }
  canvas { position: absolute; left: 0; top: 0; display: block; pointer-events: none; image-rendering: auto; }
  .badge { position: absolute; margin: 8px; padding: 4px 10px; border-radius: 4px; pointer-events: none;
           font: 600 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
           color: #ffffff; background: rgba(0, 0, 0, 0.78); border: 1px solid #ffd54a; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;

/**
 * Start softening a video. Returns null if it can't (the caller then blocks).
 * @param {HTMLVideoElement} video
 * @param {{ detect: any, preset: string, onFail: (report?: any) => void }} opts
 * @returns {{ stop(): void } | null}
 */
export function startSoften(video, { detect, preset, onFail }) {
  if (!detect || typeof detect.createDetector !== "function") return null;
  if (video.mediaKeys) return null; // DRM: frames can't be read
  if (document.pictureInPictureElement === video) return null;
  if (document.fullscreenElement && document.fullscreenElement.contains(video)) return null;

  const r = video.getBoundingClientRect();
  if (r.width < 16 || r.height < 16) return null;
  const scale = Math.min(1, Math.sqrt(BUDGET_PX / (r.width * r.height)), MAX_SIDE / r.width, MAX_SIDE / r.height);
  const w = Math.max(1, Math.round(r.width * scale));
  const h = Math.max(1, Math.round(r.height * scale));

  // Work canvas: read video frames at the filter size.
  const work = new OffscreenCanvas(w, h);
  const wctx = work.getContext("2d", { willReadFrequently: true, alpha: false });
  if (!wctx) return null;
  try {
    // Probe one read now: a cross-origin video throws here, before we show anything.
    wctx.drawImage(video, 0, 0, w, h);
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
  canvas.setAttribute("aria-label", "Video with flashing softened by FlashBan");
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = "Flashing softened";
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

  let stopped = false;
  let vfc = 0;
  let raf = 0;

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
    const b = video.getBoundingClientRect();
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
    let data;
    try {
      wctx.drawImage(video, 0, 0, w, h);
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

  function scheduleVideo() {
    if (stopped) return;
    vfc = video.requestVideoFrameCallback((now, meta) => {
      vfc = 0;
      onFrame(meta.expectedDisplayTime || now);
      scheduleVideo();
    });
  }

  function tick() {
    if (stopped) return;
    if (!video.isConnected) return fail();
    attach();
    place();
    raf = requestAnimationFrame(tick);
  }

  const onLeave = () => {
    if (document.pictureInPictureElement === video || (document.fullscreenElement && document.fullscreenElement.contains(video))) fail();
  };
  video.addEventListener("enterpictureinpicture", onLeave);
  document.addEventListener("fullscreenchange", onLeave, true);

  function stop() {
    if (stopped) return;
    stopped = true;
    if (vfc) video.cancelVideoFrameCallback?.(vfc);
    cancelAnimationFrame(raf);
    video.removeEventListener("enterpictureinpicture", onLeave);
    document.removeEventListener("fullscreenchange", onLeave, true);
    try {
      layer.hidePopover();
    } catch {}
    host.remove();
  }

  // Show the first softened frame immediately (it equals the current frame,
  // so there is no sudden jump: threat T13), then keep filtering.
  attach();
  place();
  onFrame(performance.now());
  if (stopped) return null;
  if (typeof video.requestVideoFrameCallback === "function") scheduleVideo();
  else return (stop(), null);
  raf = requestAnimationFrame(tick);
  setTimeout(() => {
    if (!stopped) live.textContent = "Flashing in this video is being softened. It keeps playing.";
  }, 50);

  return { stop };
}
