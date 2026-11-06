// DOM wiring shared by every fixture page. The page's <body data-kind="..."> picks
// the stimulus: canvas | css | dom | static. Nothing starts on load.
import { createRunController, LIMITS, PHASE, REST_PHASE } from './run-state.js';

export const COLORS = Object.freeze({ [PHASE.LIGHT]: '#8c8c8c', [PHASE.DARK]: '#2b2b2b' });
const CONFIG = Object.freeze({ frequencyHz: 4, durationMs: LIMITS.maxDurationMs });

const $ = (id) => document.getElementById(id);

function init() {
  const kind = document.body.dataset.kind;
  const target = $('target');
  const startBtn = $('start');
  const stopBtn = $('stop');
  const status = $('status');
  const observed = $('observed');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  $('cfg-frequency').textContent = kind === 'static' ? 'none (static control)' : `${CONFIG.frequencyHz} cycles/s`;
  $('cfg-duration').textContent = kind === 'static' ? 'n/a' : `${CONFIG.durationMs / 1000} s target`;

  const announce = (text) => { status.textContent = text; };

  let paint = () => {};
  let cssIterations = 0;
  if (kind === 'canvas') {
    const ctx = target.getContext('2d');
    paint = (phase) => { ctx.fillStyle = COLORS[phase]; ctx.fillRect(0, 0, target.width, target.height); };
  } else if (kind === 'dom') {
    paint = (phase) => { target.classList.toggle('is-light', phase === PHASE.LIGHT); };
  } else if (kind === 'css') {
    target.addEventListener('animationiteration', () => { cssIterations += 1; });
  }
  paint(REST_PHASE);

  function describeSummary(summary) {
    const deadline = summary.deadlineOverrunMs > 0
      ? ` Cleanup arrived ${Math.ceil(summary.deadlineOverrunMs)} ms after the configured deadline.` : '';
    if (kind === 'css') {
      return `CSS animationiteration events observed: ${cssIterations} (each is one completed keyframe cycle after the first). ` +
        `Run time ${Math.round(summary.elapsedMs)} ms. Reason: ${summary.reason}.` + deadline;
    }
    const ts = summary.transitionTimestampsMs;
    const list = ts.map((t) => Math.round(t)).join(', ') || 'none';
    return `Applied state changes: ${ts.length} in ${Math.round(summary.elapsedMs)} ms (reason: ${summary.reason}). ` +
      `Timestamps (ms from Start): ${list}. These are script-side apply times, not measured display frames.` + deadline;
  }

  const controller = kind === 'static' ? null : createRunController(CONFIG, {
    now: () => performance.now(),
    requestFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    onPhase: kind === 'css' ? undefined : paint,
    onStart: () => {
      cssIterations = 0;
      if (kind === 'css') target.classList.add('is-running');
      if (document.activeElement === startBtn) stopBtn.focus();
      startBtn.disabled = true;
      announce('Running. Press Escape or Stop to end early.');
    },
    onStop: (summary) => {
      if (kind === 'css') target.classList.remove('is-running');
      updateStartAvailability();
      if (document.activeElement === stopBtn && document.hasFocus() && !startBtn.disabled) startBtn.focus();
      observed.textContent = describeSummary(summary);
      const deadline = summary.deadlineOverrunMs > 0 ? ' Cleanup was delayed beyond the configured deadline.' : '';
      announce(`Stopped (${summary.reason}). Static state restored.${deadline} Start again only if you choose to.`);
    },
  });

  function updateStartAvailability() {
    const reduced = motionQuery.matches;
    startBtn.disabled = reduced || controller?.state === 'running';
    $('reduced-note').hidden = !reduced;
  }

  startBtn.addEventListener('click', () => {
    if (!controller) {
      announce('Static control: there is no stimulus to run. Content stays unchanged.');
      return;
    }
    const result = controller.start();
    if (!result.ok && result.reason === 'reduced-motion') {
      announce('Start unavailable: reduced motion is enabled.');
    }
  });
  stopBtn.addEventListener('click', () => {
    if (!controller?.stop('stop button')) announce('Not running. Content is static.');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') controller?.stop('escape'); });
  window.addEventListener('blur', () => controller?.stop('window blur'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) controller?.stop('document hidden'); });
  window.addEventListener('pagehide', () => controller?.stop('page hide'));
  motionQuery.addEventListener('change', () => {
    controller?.setReducedMotion(motionQuery.matches);
    updateStartAvailability();
  });
  controller?.setReducedMotion(motionQuery.matches);
  updateStartAvailability();
  // Initial status text lives in the HTML so nothing is announced on load.
}

init();
