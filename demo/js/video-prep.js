// Pure preparation and playback logic for the video fixture. No DOM access here,
// so it runs under `node --test`. Canvas capture, MediaRecorder, timers, clock and
// object URLs are all injected by the page (js/video-fixture.js).
//
// It records a short synthetic clip and bounds its playback. It does NOT measure
// luminance, flash area, encoded frame timing or detector behavior, and makes no
// WCAG or safety claim.
import { createRunController, phaseAt, REST_PHASE, validateConfig } from './run-state.js';

export const PREP = Object.freeze({
  leadMs: 250, // dark lead-in, so the paused first frame is the rest color
  maxTickMs: 33, // redraw at least this often so capture keeps producing frames
  finalizeTimeoutMs: 2000, // recorder must deliver data within this after stop()
});

export const MIME_CANDIDATES = Object.freeze([
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
]);

/** First supported MIME type, or null. Any thrown check counts as unsupported. */
export function pickMimeType(isTypeSupported, candidates = MIME_CANDIDATES) {
  if (typeof isTypeSupported !== 'function') return null;
  for (const type of candidates) {
    try { if (isTypeSupported(type)) return type; } catch { /* unsupported */ }
  }
  return null;
}

const noop = () => {};
function requireFn(value, name, optional = false) {
  if (value === undefined && optional) return noop;
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}
const safe = (fn, ...args) => { try { fn(...args); } catch { /* cleanup/reporting only */ } };

/**
 * Next real-time boundary after `elapsed` where the drawn phase changes, so draws
 * land on half-cycle edges instead of drifting with the timer cadence.
 */
function nextBoundaryMs(elapsed, frequencyHz, leadMs, endMs) {
  if (elapsed < leadMs) return leadMs;
  const halfMs = 500 / frequencyHz;
  const next = leadMs + (Math.floor((elapsed - leadMs) / halfMs) + 1) * halfMs;
  return Math.min(next, endMs);
}

/**
 * Creates a preparation controller. Nothing runs until prepare().
 * hooks: now(), setTimer(cb, ms) -> id, clearTimer(id),
 *        createCapture() -> { stream, draw(phase), stop() },
 *        createRecorder(stream) -> MediaRecorder-like { start(), stop(), state,
 *          mimeType?, ondataavailable, onstop, onerror },
 *        createUrl(chunks, mimeType) -> url, revokeUrl(url),
 *        onRelease(url)? (detach the URL from media before it is revoked),
 *        onReady(info)?, onEnd(result)?
 */
export function createVideoPreparer(config, hooks = {}) {
  const cfg = validateConfig(config);
  const now = requireFn(hooks.now, 'now');
  const setTimer = requireFn(hooks.setTimer, 'setTimer');
  const clearTimer = requireFn(hooks.clearTimer, 'clearTimer');
  const createCapture = requireFn(hooks.createCapture, 'createCapture');
  const createRecorder = requireFn(hooks.createRecorder, 'createRecorder');
  const createUrl = requireFn(hooks.createUrl, 'createUrl');
  const revokeUrl = requireFn(hooks.revokeUrl, 'revokeUrl');
  const onRelease = requireFn(hooks.onRelease, 'onRelease', true);
  const onReady = requireFn(hooks.onReady, 'onReady', true);
  const onEnd = requireFn(hooks.onEnd, 'onEnd', true);

  const endMs = PREP.leadMs + cfg.durationMs;
  let state = 'idle'; // idle | preparing | ready
  let generation = 0;
  let reducedMotion = false;
  let capture = null;
  let recorder = null;
  let timer = null;
  let finalizeTimer = null;
  let chunks = [];
  let startedAt = 0;
  let recordedMs = 0;
  let stopping = false;
  let lastDrawn = null;
  let drawTransitions = [];
  let url = null;
  let lastResult = null;

  function releaseResources() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (finalizeTimer !== null) { clearTimer(finalizeTimer); finalizeTimer = null; }
    const r = recorder;
    recorder = null;
    if (r) {
      // Detach first so late events from this recorder are ignored.
      r.ondataavailable = null; r.onstop = null; r.onerror = null;
      try { if (r.state !== 'inactive') r.stop(); } catch { /* already stopped */ }
    }
    const c = capture;
    capture = null;
    if (c) safe(() => c.stop());
    chunks = [];
    stopping = false;
  }

  function releaseUrl() {
    if (url === null) return false;
    const u = url;
    url = null;
    safe(onRelease, u);
    safe(revokeUrl, u);
    return true;
  }

  function end(result) {
    lastResult = Object.freeze(result);
    safe(onEnd, lastResult);
    return lastResult;
  }

  function fail(reason) {
    generation += 1;
    releaseResources();
    state = 'idle';
    end({ ok: false, reason });
    return { ok: false, reason };
  }

  function draw(phase, elapsed) {
    capture.draw(phase);
    if (phase !== lastDrawn) {
      if (lastDrawn !== null) drawTransitions.push(elapsed);
      lastDrawn = phase;
    }
  }

  function finalize(gen) {
    if (gen !== generation || state !== 'preparing') return;
    if (!stopping) { fail('recorder-stopped-early'); return; }
    const data = chunks;
    const mimeType = recorder?.mimeType || hooks.mimeType || '';
    chunks = [];
    releaseResources(); // stops tracks; recorder is already inactive
    if (data.length === 0) { fail('no-data'); return; }
    let made;
    try { made = createUrl(data, mimeType); } catch { fail('url-failed'); return; }
    url = made;
    state = 'ready';
    const info = Object.freeze({
      ok: true,
      reason: 'ready',
      url: made,
      mimeType,
      chunkCount: data.length,
      byteSize: data.reduce((n, c) => n + (Number(c?.size) || 0), 0),
      configuredDurationMs: cfg.durationMs,
      configuredLeadMs: PREP.leadMs,
      recordedWallMs: recordedMs,
      drawTransitionTimestampsMs: Object.freeze(drawTransitions.slice()),
    });
    safe(onReady, info);
    end(info);
  }

  function stopRecording(gen, elapsed) {
    stopping = true;
    recordedMs = elapsed;
    finalizeTimer = setTimer(() => {
      finalizeTimer = null;
      if (gen === generation) fail('finalize-timeout');
    }, PREP.finalizeTimeoutMs);
    try { recorder.stop(); } catch { fail('recorder-error'); }
  }

  function tick(gen) {
    timer = null;
    if (gen !== generation || state !== 'preparing' || stopping) return;
    const elapsed = now() - startedAt;
    try {
      if (!(elapsed < endMs)) {
        draw(REST_PHASE, elapsed);
        stopRecording(gen, elapsed);
        return;
      }
      draw(elapsed < PREP.leadMs ? REST_PHASE : phaseAt(elapsed - PREP.leadMs, cfg.frequencyHz), elapsed);
    } catch { fail('draw-failed'); return; }
    const wait = Math.min(PREP.maxTickMs, nextBoundaryMs(elapsed, cfg.frequencyHz, PREP.leadMs, endMs) - elapsed);
    timer = setTimer(() => tick(gen), Math.max(1, wait));
  }

  function abort(reason = 'stopped') {
    if (state !== 'preparing') return false;
    generation += 1;
    releaseResources();
    state = 'idle';
    end({ ok: false, reason: String(reason), aborted: true });
    return true;
  }

  return Object.freeze({
    config: cfg,
    prepare() {
      if (reducedMotion) return { ok: false, reason: 'reduced-motion' };
      if (state === 'preparing') return { ok: false, reason: 'already-preparing' };
      releaseUrl(); // replacing a previous clip
      state = 'preparing';
      const gen = ++generation;
      chunks = [];
      drawTransitions = [];
      lastDrawn = null;
      recordedMs = 0;
      lastResult = null;
      try {
        capture = createCapture();
        recorder = createRecorder(capture.stream);
      } catch { return fail('setup-failed'); }
      recorder.ondataavailable = (e) => {
        if (gen === generation && e?.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onerror = () => { if (gen === generation) fail('recorder-error'); };
      // Let a final dataavailable event (fired before stop) land first.
      recorder.onstop = () => finalize(gen);
      try {
        startedAt = now();
        draw(REST_PHASE, 0);
        recorder.start();
      } catch { return fail('setup-failed'); }
      if (gen !== generation) return { ok: false, reason: lastResult?.reason ?? 'error' };
      timer = setTimer(() => tick(gen), 1);
      return { ok: true };
    },
    abort,
    /** Abort any preparation and revoke the current clip (pagehide). */
    dispose(reason = 'disposed') {
      const aborted = abort(reason);
      const released = releaseUrl();
      if (state === 'ready') state = 'idle';
      return aborted || released;
    },
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
      if (reducedMotion) abort('reduced-motion');
    },
    get state() { return state; },
    get url() { return url; },
    get reducedMotion() { return reducedMotion; },
    get pendingTimers() { return (timer !== null ? 1 : 0) + (finalizeTimer !== null ? 1 : 0); },
    get lastResult() { return lastResult; },
  });
}

/**
 * Bounded playback of a prepared clip, reusing the shared run controller for the
 * deadline, stop reasons and reduced-motion handling.
 * hooks: now(), requestFrame(cb), cancelFrame(id), isReady()?,
 *        media: { play() -> Promise|void, pause(), reset() },
 *        onStart()?, onStop(summary)?
 */
export function createVideoPlayback(config, hooks = {}) {
  const media = hooks.media;
  if (!media || typeof media.play !== 'function' || typeof media.pause !== 'function' ||
      typeof media.reset !== 'function') {
    throw new TypeError('media must provide play, pause and reset');
  }
  const readyCheck = hooks.isReady === undefined ? () => true : requireFn(hooks.isReady, 'isReady');
  const onStart = requireFn(hooks.onStart, 'onStart', true);
  const onStop = requireFn(hooks.onStop, 'onStop', true);
  let run = 0;

  const controller = createRunController(config, {
    now: hooks.now,
    requestFrame: hooks.requestFrame,
    cancelFrame: hooks.cancelFrame,
    onStart: () => {
      const myRun = ++run;
      media.reset();
      const played = media.play();
      if (played && typeof played.then === 'function') {
        played.then(null, () => { if (myRun === run) controller.stop('play rejected'); });
      }
      onStart();
    },
    onStop: (summary) => {
      run += 1; // stale play() rejections must not touch a later run
      safe(() => media.pause());
      safe(() => media.reset());
      safe(onStop, summary);
    },
  });

  return Object.freeze({
    config: controller.config,
    start() {
      if (!readyCheck()) return { ok: false, reason: 'not-ready' };
      return controller.start();
    },
    stop: (reason) => controller.stop(reason),
    setReducedMotion: (value) => controller.setReducedMotion(value),
    get state() { return controller.state; },
    get pendingFrame() { return controller.pendingFrame; },
    get lastSummary() { return controller.lastSummary; },
  });
}
