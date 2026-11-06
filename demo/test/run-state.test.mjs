import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunController, validateConfig, phaseAt, LIMITS, PHASE, REST_PHASE } from '../js/run-state.js';

const CFG = { frequencyHz: 4, durationMs: 3000 };

function harness(hookOverrides = {}) {
  let t = 1000;
  let nextId = 1;
  const pending = new Map();
  const phases = [];
  const stops = [];
  const hooks = {
    now: () => t,
    requestFrame: (cb) => { const id = nextId++; pending.set(id, cb); return id; },
    cancelFrame: (id) => { pending.delete(id); },
    onPhase: (p) => phases.push(p),
    onStop: (s) => stops.push(s),
    ...hookOverrides,
  };
  return {
    hooks, phases, stops, pending,
    advance(ms) { t += ms; },
    /** Run one frame every `stepMs` for `totalMs`. */
    frames(stepMs, totalMs) {
      for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        t += stepMs;
        const cbs = [...pending.values()];
        pending.clear();
        cbs.forEach((cb) => cb(t));
      }
    },
  };
}

test('validateConfig rejects invalid or out-of-bound inputs', () => {
  for (const bad of [undefined, null, {}, { frequencyHz: 0, durationMs: 100 },
    { frequencyHz: -1, durationMs: 100 }, { frequencyHz: 5, durationMs: 100 },
    { frequencyHz: NaN, durationMs: 100 }, { frequencyHz: '4', durationMs: 100 },
    { frequencyHz: 4, durationMs: 0 }, { frequencyHz: 4, durationMs: 3001 },
    { frequencyHz: 4, durationMs: Infinity }]) {
    assert.throws(() => validateConfig(bad), RangeError);
  }
  assert.deepEqual(validateConfig(CFG), CFG);
  assert.equal(LIMITS.maxDurationMs, 3000);
});

test('hooks are required functions', () => {
  assert.throws(() => createRunController(CFG, {}), TypeError);
  assert.throws(() => createRunController(CFG, { ...harness().hooks, onPhase: 3 }), TypeError);
});

test('phaseAt pairs light/dark halves from elapsed time', () => {
  assert.equal(phaseAt(0, 4), PHASE.LIGHT);
  assert.equal(phaseAt(124.9, 4), PHASE.LIGHT);
  assert.equal(phaseAt(125, 4), PHASE.DARK);
  assert.equal(phaseAt(250, 4), PHASE.LIGHT);
  assert.equal(phaseAt(-5, 4), REST_PHASE);
  assert.equal(phaseAt(NaN, 4), REST_PHASE);
});

test('starts idle and does nothing until start()', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  assert.equal(c.state, 'idle');
  assert.equal(h.pending.size, 0);
  assert.equal(h.phases.length, 0);
});

test('run is bounded to durationMs and ends static', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  assert.deepEqual(c.start(), { ok: true });
  h.frames(16, 5000);
  assert.equal(c.state, 'stopped');
  assert.equal(h.pending.size, 0, 'no frame left scheduled');
  assert.equal(h.stops.length, 1);
  assert.equal(h.stops[0].reason, 'complete');
  assert.ok(h.stops[0].elapsedMs >= 3000 && h.stops[0].elapsedMs < 3016);
  const ts = h.stops[0].transitionTimestampsMs;
  assert.ok(ts.length >= 22 && ts.length <= 24, `transitions: ${ts.length}`);
  assert.ok(ts.every((x) => x < 3000));
  assert.equal(h.phases.at(-1), REST_PHASE);
});

test('timing follows real time, not frame count (dropped frames)', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  c.start();
  h.frames(100, 1000); // slow frames
  const before = h.phases.length;
  h.advance(1000); // long stall, no frames
  h.frames(100, 100);
  assert.ok(h.phases.length <= before + 1);
  c.stop();
});

test('a stalled frame stops without another stimulus and reports actual latency', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  c.start();
  h.advance(4500);
  h.frames(16, 16);
  assert.equal(c.state, 'stopped');
  assert.equal(h.pending.size, 0);
  assert.equal(h.stops[0].elapsedMs, 4516);
  assert.equal(h.stops[0].requestedDurationMs, 3000);
  assert.equal(h.stops[0].deadlineOverrunMs, 1516);
  assert.deepEqual(h.stops[0].transitionTimestampsMs, [0]);
  assert.equal(h.phases.at(-1), REST_PHASE);
});

test('a user stop after a stall preserves its reason and discloses deadline overrun', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  c.start();
  h.advance(4500);
  c.stop('escape');
  assert.equal(h.stops[0].reason, 'escape');
  assert.equal(h.stops[0].elapsedMs, 4500);
  assert.equal(h.stops[0].deadlineOverrunMs, 1500);
});

test('stop cancels scheduling and restores rest phase', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  c.start();
  h.frames(16, 200);
  assert.equal(c.stop('escape'), true);
  assert.equal(c.state, 'stopped');
  assert.equal(h.pending.size, 0);
  assert.equal(h.stops[0].reason, 'escape');
  assert.equal(h.phases.at(-1), REST_PHASE);
  assert.equal(c.stop('again'), false, 'second stop is a no-op');
  h.frames(16, 500);
  assert.equal(h.stops.length, 1);
});

test('no duplicate loops on repeated start()', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  c.start();
  assert.deepEqual(c.start(), { ok: false, reason: 'already-running' });
  assert.equal(h.pending.size, 1);
  h.frames(16, 100);
  assert.equal(h.pending.size, 1);
  c.stop();
});

test('explicit restart works; never restarts by itself', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  c.start();
  h.frames(16, 4000);
  h.frames(16, 4000);
  assert.equal(c.state, 'stopped');
  assert.equal(h.pending.size, 0);
  assert.deepEqual(c.start(), { ok: true });
  assert.equal(h.pending.size, 1);
  h.frames(16, 4000);
  assert.equal(h.stops.length, 2);
  assert.ok(h.stops[1].transitionTimestampsMs.length <= 24, 'transitions reset per run');
});

test('reduced motion blocks start and stops an active run', () => {
  const h = harness();
  const c = createRunController(CFG, h.hooks);
  c.start();
  h.frames(16, 100);
  c.setReducedMotion(true);
  assert.equal(c.state, 'stopped');
  assert.equal(h.stops[0].reason, 'reduced-motion');
  assert.equal(h.pending.size, 0);
  assert.deepEqual(c.start(), { ok: false, reason: 'reduced-motion' });
  assert.equal(h.pending.size, 0);
  c.setReducedMotion(false);
  assert.equal(c.state, 'stopped', 'clearing reduced motion does not restart');
});

test('onPhase error fails closed to stopped', () => {
  let calls = 0;
  const h = harness({ onPhase: () => { calls += 1; if (calls === 1) throw new Error('draw failed'); } });
  const c = createRunController(CFG, h.hooks);
  c.start();
  assert.equal(c.state, 'stopped');
  assert.equal(h.stops[0].reason, 'error');
  assert.equal(h.pending.size, 0);
});
