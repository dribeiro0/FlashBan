// DOM wiring for video.html. Prepare records a short synthetic clip from a hidden,
// never-attached canvas (captureStream + MediaRecorder) into a same-origin blob URL.
// Nothing prepares or plays on load. The prepared clip starts paused; only Start plays it.
import { LIMITS, PHASE } from './run-state.js';
import { createVideoPlayback, createVideoPreparer, pickMimeType, PREP } from './video-prep.js';

const COLORS = Object.freeze({ [PHASE.LIGHT]: '#8c8c8c', [PHASE.DARK]: '#2b2b2b' });
const CONFIG = Object.freeze({ frequencyHz: 4, durationMs: LIMITS.maxDurationMs });
const CAPTURE_FPS = 30;
const SIZE = Object.freeze({ width: 480, height: 320 });

const $ = (id) => document.getElementById(id);

function detectSupport() {
  const Recorder = window.MediaRecorder;
  if (typeof Recorder !== 'function') return { ok: false, why: 'MediaRecorder is not available' };
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return { ok: false, why: 'canvas captureStream is not available' };
  }
  const mimeType = pickMimeType(typeof Recorder.isTypeSupported === 'function'
    ? (t) => Recorder.isTypeSupported(t) : undefined);
  if (!mimeType) return { ok: false, why: 'no supported WebM recording format' };
  return { ok: true, mimeType };
}

function init() {
  const video = $('target');
  const prepareBtn = $('prepare');
  const startBtn = $('start');
  const stopBtn = $('stop');
  const status = $('status');
  const prepObserved = $('prep-observed');
  const observed = $('observed');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const announce = (text) => { status.textContent = text; };

  $('cfg-frequency').textContent = `${CONFIG.frequencyHz} cycles/s (drawn into the recording)`;
  $('cfg-duration').textContent = `${CONFIG.durationMs / 1000} s target playback, after a ${PREP.leadMs} ms dark lead-in in the clip`;

  // Belt and braces: the element never autoplays, loops or exposes native controls.
  video.autoplay = false;
  video.loop = false;
  video.controls = false;
  video.muted = true;
  video.playsInline = true;
  video.disablePictureInPicture = true;

  const support = detectSupport();
  let videoLoaded = false;
  let lastMediaTimeS = 0;
  let frameCbId = null;
  let presented = { first: null, last: null };

  const preparer = createVideoPreparer(CONFIG, {
    mimeType: support.mimeType,
    now: () => performance.now(),
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
    clearTimer: (id) => window.clearTimeout(id),
    createCapture: () => {
      // Detached canvas: never added to the document, so it is never shown.
      const canvas = document.createElement('canvas');
      canvas.width = SIZE.width;
      canvas.height = SIZE.height;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(CAPTURE_FPS);
      return {
        stream,
        draw: (phase) => { ctx.fillStyle = COLORS[phase]; ctx.fillRect(0, 0, canvas.width, canvas.height); },
        stop: () => { stream.getTracks().forEach((t) => t.stop()); canvas.width = 0; canvas.height = 0; },
      };
    },
    createRecorder: (stream) => new window.MediaRecorder(stream, { mimeType: support.mimeType }),
    createUrl: (chunks, mimeType) => URL.createObjectURL(new Blob(chunks, { type: mimeType || support.mimeType })),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    onRelease: () => {
      videoLoaded = false;
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
    onReady: (info) => {
      videoLoaded = false;
      video.src = info.url;
      video.load(); // preload only; it stays paused
      const bytes = info.byteSize;
      prepObserved.textContent = `Recorded ${Math.round(info.recordedWallMs)} ms of wall time ` +
        `(configured: ${info.configuredLeadMs} ms lead-in + ${info.configuredDurationMs} ms) as ${info.mimeType}, ` +
        `${info.chunkCount} chunk(s), ${bytes} bytes. Canvas draws changed color ${info.drawTransitionTimestampsMs.length} times. ` +
        'These are script-side draw times; encoded frame timing was not measured.';
      announce('Preparing finished. Loading the clip; it stays paused.');
    },
    onEnd: (result) => {
      updateAvailability();
      if (result.ok) return;
      if (document.activeElement === stopBtn && document.hasFocus() && !prepareBtn.disabled) prepareBtn.focus();
      const verb = result.aborted ? 'Preparation stopped' : 'Preparation failed';
      announce(`${verb} (${result.reason}). Nothing was recorded or kept. Start stays unavailable.`);
    },
  });

  function cancelFrameCount() {
    if (frameCbId !== null && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(frameCbId);
    }
    frameCbId = null;
  }
  function countFrames() {
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    frameCbId = video.requestVideoFrameCallback((_now, meta) => {
      frameCbId = null;
      if (playback.state !== 'running') return;
      if (presented.first === null) presented.first = meta;
      presented.last = meta;
      countFrames();
    });
  }

  function describeSummary(summary) {
    const deadline = summary.deadlineOverrunMs > 0
      ? ` Cleanup arrived ${Math.ceil(summary.deadlineOverrunMs)} ms after the configured deadline.` : '';
    let frames = 'Presented frames: unavailable (requestVideoFrameCallback not supported).';
    if (typeof video.requestVideoFrameCallback === 'function') {
      const { first, last } = presented;
      frames = first && last
        ? `Presented frames reported by the browser: ${last.presentedFrames - first.presentedFrames + 1}, ` +
          `media time ${Math.round(first.mediaTime * 1000)}–${Math.round(last.mediaTime * 1000)} ms.`
        : 'Presented frames reported by the browser: none.';
    }
    const duration = Number.isFinite(video.duration) ? `${Math.round(video.duration * 1000)} ms` : 'not reported by the browser';
    return `Run time ${Math.round(summary.elapsedMs)} ms (reason: ${summary.reason}). ` +
      `Playback position at stop: ${Math.round(lastMediaTimeS * 1000)} ms. Clip duration: ${duration}. ${frames} ` +
      'These are browser playback reports, not measured display frames.' + deadline;
  }

  const playback = createVideoPlayback(CONFIG, {
    now: () => performance.now(),
    requestFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    isReady: () => preparer.state === 'ready' && videoLoaded,
    media: {
      reset: () => { video.currentTime = 0; },
      play: () => video.play(),
      pause: () => { video.pause(); lastMediaTimeS = video.currentTime; },
    },
    onStart: () => {
      presented = { first: null, last: null };
      lastMediaTimeS = 0;
      countFrames();
      if (document.activeElement === startBtn) stopBtn.focus();
      updateAvailability();
      announce('Running. Press Escape or Stop to end early.');
    },
    onStop: (summary) => {
      cancelFrameCount();
      updateAvailability();
      if (document.activeElement === stopBtn && document.hasFocus() && !startBtn.disabled) startBtn.focus();
      observed.textContent = describeSummary(summary);
      const deadline = summary.deadlineOverrunMs > 0 ? ' Cleanup was delayed beyond the configured deadline.' : '';
      announce(`Stopped (${summary.reason}). Video paused at its first (dark) frame.${deadline} Start again only if you choose to.`);
    },
  });

  // Any playback not started by our controller is paused at once (fail closed).
  video.addEventListener('play', () => {
    if (playback.state !== 'running') { video.pause(); video.currentTime = 0; }
  });
  video.addEventListener('ended', () => playback.stop('video ended'));
  video.addEventListener('loadeddata', () => {
    if (preparer.state !== 'ready' || video.src !== preparer.url) return;
    videoLoaded = true;
    video.pause();
    video.currentTime = 0;
    updateAvailability();
    if (document.activeElement === stopBtn && document.hasFocus() && !startBtn.disabled) startBtn.focus();
    announce('Prepared clip loaded and paused. Press Start to play it.');
  });
  video.addEventListener('error', () => {
    if (preparer.state !== 'ready' || video.src !== preparer.url) return;
    preparer.dispose('video load error');
    updateAvailability();
    announce('Prepared clip could not be loaded. Video fixture unavailable; Start stays disabled.');
  });

  function updateAvailability() {
    const reduced = motionQuery.matches;
    const preparing = preparer.state === 'preparing';
    const running = playback.state === 'running';
    prepareBtn.disabled = !support.ok || reduced || preparing || running;
    startBtn.disabled = !support.ok || reduced || preparing || running || !(preparer.state === 'ready' && videoLoaded);
    $('reduced-note').hidden = !reduced;
  }

  function stopAll(reason) {
    const aborted = preparer.abort(reason);
    const stopped = playback.stop(reason);
    return aborted || stopped;
  }

  if (!support.ok) {
    $('unavailable-note').hidden = false;
    $('unavailable-why').textContent = support.why;
    announce(`Video fixture unavailable: ${support.why}. Prepare and Start stay disabled.`);
  }

  prepareBtn.addEventListener('click', () => {
    if (!support.ok) return;
    if (motionQuery.matches) { announce('Prepare unavailable: reduced motion is enabled.'); return; }
    prepObserved.textContent = 'No clip prepared.';
    const result = preparer.prepare();
    if (result.ok && document.activeElement === prepareBtn) stopBtn.focus();
    updateAvailability();
    if (result.ok) {
      announce('Preparing a clip off-screen (about 3 seconds). Nothing is shown. Press Escape or Stop to cancel.');
    }
  });
  startBtn.addEventListener('click', () => {
    const result = playback.start();
    if (!result.ok && result.reason === 'not-ready') announce('Start unavailable: prepare a clip first.');
    else if (!result.ok && result.reason === 'reduced-motion') announce('Start unavailable: reduced motion is enabled.');
  });
  stopBtn.addEventListener('click', () => {
    if (!stopAll('stop button')) announce('Not running. Content is static.');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAll('escape'); });
  window.addEventListener('blur', () => stopAll('window blur'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll('document hidden'); });
  window.addEventListener('pagehide', () => {
    playback.stop('page hide');
    preparer.dispose('page hide');
  });
  const applyMotion = () => {
    preparer.setReducedMotion(motionQuery.matches);
    playback.setReducedMotion(motionQuery.matches);
    updateAvailability();
  };
  motionQuery.addEventListener('change', applyMotion);
  applyMotion();
}

init();
