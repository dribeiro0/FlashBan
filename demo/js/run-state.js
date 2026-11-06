// Pure run-state and timing logic for demo fixtures. No DOM access here, so it
// runs under `node --test`. Scheduling and clock are injected.
//
// This module bounds and schedules a synthetic stimulus. It does NOT measure
// luminance, flash area or detector behavior, and makes no WCAG or safety claim.

export const LIMITS = Object.freeze({ maxFrequencyHz: 4, maxDurationMs: 3000 });

export const PHASE = Object.freeze({ LIGHT: 'light', DARK: 'dark' });

/** Resting (static) phase shown before Start and after every stop. */
export const REST_PHASE = PHASE.DARK;

export function validateConfig(config) {
  const { frequencyHz, durationMs } = config ?? {};
  if (typeof frequencyHz !== 'number' || !Number.isFinite(frequencyHz) ||
      frequencyHz <= 0 || frequencyHz > LIMITS.maxFrequencyHz) {
    throw new RangeError(`frequencyHz must be in (0, ${LIMITS.maxFrequencyHz}]`);
  }
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) ||
      durationMs <= 0 || durationMs > LIMITS.maxDurationMs) {
    throw new RangeError(`durationMs must be in (0, ${LIMITS.maxDurationMs}]`);
  }
  return Object.freeze({ frequencyHz, durationMs });
}

/**
 * Phase for a given elapsed real time. One cycle = one light half + one dark
 * half, so a cycle produces a paired light/dark transition.
 */
export function phaseAt(elapsedMs, frequencyHz) {
  if (!(elapsedMs >= 0)) return REST_PHASE;
  const half = Math.floor((elapsedMs * frequencyHz * 2) / 1000);
  return half % 2 === 0 ? PHASE.LIGHT : PHASE.DARK;
}

const noop = () => {};

function requireFn(value, name, optional = false) {
  if (value === undefined && optional) return noop;
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Creates a bounded run controller.
 * hooks: now() -> ms, requestFrame(cb) -> id, cancelFrame(id),
 *        onPhase(phase)?, onStart()?, onStop(summary)?
 * Explicit start() only; nothing here ever restarts a run by itself.
 */
export function createRunController(config, hooks = {}) {
  const cfg = validateConfig(config);
  const now = requireFn(hooks.now, 'now');
  const requestFrame = requireFn(hooks.requestFrame, 'requestFrame');
  const cancelFrame = requireFn(hooks.cancelFrame, 'cancelFrame');
  const onPhase = requireFn(hooks.onPhase, 'onPhase', true);
  const onStart = requireFn(hooks.onStart, 'onStart', true);
  const onStop = requireFn(hooks.onStop, 'onStop', true);

  let state = 'idle'; // idle | running | stopped
  let reducedMotion = false;
  let frameId = null;
  let startedAt = 0;
  let lastPhase = REST_PHASE;
  let transitions = [];
  let lastSummary = null;

  function finish(reason) {
    if (frameId !== null) { cancelFrame(frameId); frameId = null; }
    state = 'stopped';
    const elapsedMs = Math.max(0, now() - startedAt);
    lastSummary = Object.freeze({
      reason,
      // Preserve real stop latency: a stalled browser may resume after the
      // deadline. Clamping would falsely report an on-time stop.
      elapsedMs,
      requestedDurationMs: cfg.durationMs,
      deadlineOverrunMs: Math.max(0, elapsedMs - cfg.durationMs),
      transitionTimestampsMs: Object.freeze(transitions.slice()),
    });
    lastPhase = REST_PHASE;
    try { onPhase(REST_PHASE); } catch { /* already stopping */ }
    try { onStop(lastSummary); } catch { /* reporting only */ }
    return true;
  }

  function tick() {
    frameId = null;
    if (state !== 'running') return;
    const elapsed = now() - startedAt;
    if (!(elapsed < cfg.durationMs)) { finish('complete'); return; }
    const phase = phaseAt(elapsed, cfg.frequencyHz);
    if (phase !== lastPhase) {
      try { onPhase(phase); } catch { finish('error'); return; }
      lastPhase = phase;
      transitions.push(elapsed);
    }
    if (state === 'running') frameId = requestFrame(tick);
  }

  return Object.freeze({
    config: cfg,
    start() {
      if (reducedMotion) return { ok: false, reason: 'reduced-motion' };
      if (state === 'running') return { ok: false, reason: 'already-running' };
      state = 'running';
      startedAt = now();
      lastPhase = REST_PHASE;
      transitions = [];
      lastSummary = null;
      try { onStart(); } catch { finish('error'); return { ok: false, reason: 'error' }; }
      if (state === 'running') tick();
      return state === 'running' ? { ok: true } : { ok: false, reason: lastSummary?.reason };
    },
    stop(reason = 'stopped') {
      if (state !== 'running') return false;
      return finish(String(reason));
    },
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
      if (reducedMotion && state === 'running') finish('reduced-motion');
    },
    get state() { return state; },
    get reducedMotion() { return reducedMotion; },
    get pendingFrame() { return frameId !== null; },
    get lastSummary() { return lastSummary; },
  });
}
