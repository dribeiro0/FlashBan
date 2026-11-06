import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoPreparer, createVideoPlayback, pickMimeType, PREP } from '../js/video-prep.js';
import { PHASE, REST_PHASE } from '../js/run-state.js';

const CFG = { frequencyHz: 4, durationMs: 3000 };

function fakeRecorder() {
  return {
    state: 'inactive', mimeType: 'video/webm', ondataavailable: null, onstop: null, onerror: null,
    startCalls: 0, stopCalls: 0,
    start() { this.startCalls += 1; this.state = 'recording'; },
    stop() { this.stopCalls += 1; this.state = 'inactive'; },
    // Simulate the browser delivering data then stop, asynchronously.
    deliver(size = 10) {
      this.ondataavailable?.({ data: { size } });
      this.onstop?.();
    },
  };
}

function harness(overrides = {}) {
  let t = 0;
  let nextId = 1;
  const timers = new Map();
  const log = { draws: [], captures: [], recorders: [], urls: [], revoked: [], released: [], ready: [], ends: [] };
  const hooks = {
    now: () => t,
    setTimer: (cb, ms) => { const id = nextId++; timers.set(id, { cb, at: t + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    createCapture: () => {
      const cap = { stream: { id: log.captures.length }, stopped: 0, draw: (p) => log.draws.push(p), stop() { this.stopped += 1; } };
      log.captures.push(cap);
      return cap;
    },
    createRecorder: () => { const r = fakeRecorder(); log.recorders.push(r); return r; },
    createUrl: () => { const u = `blob:${log.urls.length + 1}`; log.urls.push(u); return u; },
    revokeUrl: (u) => log.revoked.push(u),
    onRelease: (u) => log.released.push(u),
    onReady: (info) => log.ready.push(info),
    onEnd: (r) => log.ends.push(r),
    ...overrides,
  };
  return {
    hooks, log, timers,
    get t() { return t; },
    /** Advance time, firing due timers in order. */
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].cb();
      }
      t = end;
    },
  };
}

function prepareToReady(h, p) {
  assert.deepEqual(p.prepare(), { ok: true });
  h.advance(PREP.leadMs + CFG.durationMs + 50);
  const rec = h.log.recorders.at(-1);
  assert.equal(rec.stopCalls, 1, 'recorder stopped at the configured end');
  rec.deliver();
  assert.equal(p.state, 'ready');
}

test('pickMimeType returns first supported type, null when none or check throws', () => {
  assert.equal(pickMimeType((t) => t === 'video/webm'), 'video/webm');
  assert.equal(pickMimeType(() => false), null);
  assert.equal(pickMimeType(() => { throw new Error('x'); }), null);
  assert.equal(pickMimeType(undefined), null);
});

test('preparer does nothing until prepare()', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  assert.equal(p.state, 'idle');
  assert.equal(h.log.captures.length, 0);
  assert.equal(h.timers.size, 0);
});

test('preparer requires hooks and validates config', () => {
  assert.throws(() => createVideoPreparer(CFG, {}), TypeError);
  assert.throws(() => createVideoPreparer({ frequencyHz: 9, durationMs: 100 }, harness().hooks), RangeError);
});

test('prepare records a bounded clip, releases tracks and produces one URL', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  prepareToReady(h, p);
  assert.equal(h.log.captures[0].stopped, 1, 'capture tracks stopped after recording');
  assert.equal(h.timers.size, 0, 'no timers left');
  assert.equal(p.url, 'blob:1');
  assert.equal(h.log.ready.length, 1);
  const info = h.log.ready[0];
  assert.equal(info.configuredDurationMs, 3000);
  assert.ok(info.recordedWallMs >= PREP.leadMs + CFG.durationMs);
  assert.equal(h.log.draws[0], REST_PHASE, 'clip starts on the rest color');
  assert.equal(h.log.draws.at(-1), REST_PHASE, 'clip ends on the rest color');
  assert.ok(h.log.draws.includes(PHASE.LIGHT));
  const ts = info.drawTransitionTimestampsMs;
  assert.ok(ts.length >= 23 && ts.length <= 25, `draw transitions: ${ts.length}`);
  assert.equal(ts[0], PREP.leadMs, 'first light draw lands on the lead-in boundary');
});

test('abort mid-preparation cancels timers, stops recorder and tracks, ignores late events', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  p.prepare();
  h.advance(600);
  const rec = h.log.recorders[0];
  const onstop = rec.onstop;
  const ondata = rec.ondataavailable;
  assert.equal(p.abort('escape'), true);
  assert.equal(p.state, 'idle');
  assert.equal(h.timers.size, 0);
  assert.equal(rec.stopCalls, 1);
  assert.equal(rec.onstop, null, 'handlers detached');
  assert.equal(h.log.captures[0].stopped, 1);
  ondata({ data: { size: 5 } });
  onstop();
  assert.equal(p.state, 'idle', 'late stop event does not produce a clip');
  assert.equal(h.log.urls.length, 0);
  assert.deepEqual(h.log.ends.at(-1), { ok: false, reason: 'escape', aborted: true });
  assert.equal(p.abort('again'), false);
});

test('abort during finalization cancels the finalize timeout', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  p.prepare();
  h.advance(PREP.leadMs + CFG.durationMs + 50);
  assert.equal(h.timers.size, 1, 'finalize timeout pending');
  p.abort('window blur');
  assert.equal(h.timers.size, 0);
  h.log.recorders[0].deliver();
  assert.equal(p.state, 'idle');
});

test('reduced motion aborts preparation and blocks prepare()', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  p.prepare();
  h.advance(300);
  p.setReducedMotion(true);
  assert.equal(p.state, 'idle');
  assert.equal(h.timers.size, 0);
  assert.equal(h.log.ends.at(-1).reason, 'reduced-motion');
  assert.deepEqual(p.prepare(), { ok: false, reason: 'reduced-motion' });
  assert.equal(h.log.captures.length, 1, 'no new capture');
});

test('no duplicate preparation while one is in progress', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  p.prepare();
  assert.deepEqual(p.prepare(), { ok: false, reason: 'already-preparing' });
  assert.equal(h.log.captures.length, 1);
  assert.equal(h.timers.size, 1);
  p.abort();
});

test('re-preparing releases and revokes the previous URL first; dispose revokes current', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  prepareToReady(h, p);
  prepareToReady(h, p);
  assert.deepEqual(h.log.released, ['blob:1']);
  assert.deepEqual(h.log.revoked, ['blob:1']);
  assert.equal(p.url, 'blob:2');
  assert.equal(p.dispose('page hide'), true);
  assert.deepEqual(h.log.revoked, ['blob:1', 'blob:2']);
  assert.equal(p.url, null);
  assert.equal(p.state, 'idle');
  assert.equal(p.dispose('again'), false);
});

test('dispose during preparation aborts and leaves nothing pending', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  p.prepare();
  h.advance(100);
  assert.equal(p.dispose('page hide'), true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.log.captures[0].stopped, 1);
});

test('setup failures and missing data fail closed without a URL', () => {
  for (const [override, reason] of [
    [{ createCapture: () => { throw new Error('no capture'); } }, 'setup-failed'],
    [{ createRecorder: () => { throw new Error('no recorder'); } }, 'setup-failed'],
  ]) {
    const h = harness(override);
    const p = createVideoPreparer(CFG, h.hooks);
    assert.deepEqual(p.prepare(), { ok: false, reason });
    assert.equal(p.state, 'idle');
    assert.equal(h.timers.size, 0);
    assert.ok(h.log.captures.every((c) => c.stopped === 1), 'capture released');
  }
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  p.prepare();
  h.advance(PREP.leadMs + CFG.durationMs + 50);
  h.log.recorders[0].onstop();
  assert.equal(p.state, 'idle');
  assert.equal(h.log.ends.at(-1).reason, 'no-data');
  assert.equal(h.log.urls.length, 0);
});

test('recorder that never finishes hits the finalize timeout', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  p.prepare();
  h.advance(PREP.leadMs + CFG.durationMs + PREP.finalizeTimeoutMs + 100);
  assert.equal(p.state, 'idle');
  assert.equal(h.log.ends.at(-1).reason, 'finalize-timeout');
  assert.equal(h.timers.size, 0);
  assert.equal(h.log.captures[0].stopped, 1);
});

test('recorder stopping early or erroring fails closed', () => {
  const h = harness();
  const p = createVideoPreparer(CFG, h.hooks);
  p.prepare();
  h.advance(500);
  h.log.recorders[0].deliver();
  assert.equal(p.state, 'idle');
  assert.equal(h.log.ends.at(-1).reason, 'recorder-stopped-early');
  p.prepare();
  h.log.recorders[1].onerror();
  assert.equal(p.state, 'idle');
  assert.equal(h.log.ends.at(-1).reason, 'recorder-error');
  assert.equal(h.timers.size, 0);
});

function playbackHarness(extra = {}) {
  let t = 0;
  let nextId = 1;
  const pending = new Map();
  const media = { calls: [], playResult: undefined };
  media.play = () => { media.calls.push('play'); return media.playResult; };
  media.pause = () => media.calls.push('pause');
  media.reset = () => media.calls.push('reset');
  const stops = [];
  const hooks = {
    now: () => t,
    requestFrame: (cb) => { const id = nextId++; pending.set(id, cb); return id; },
    cancelFrame: (id) => pending.delete(id),
    media,
    onStop: (s) => stops.push(s),
    ...extra,
  };
  return {
    hooks, media, stops, pending,
    frames(step, total) {
      for (let e = 0; e < total; e += step) {
        t += step;
        const cbs = [...pending.values()];
        pending.clear();
        cbs.forEach((cb) => cb(t));
      }
    },
  };
}

test('playback needs readiness, starts from frame 0, and is bounded', () => {
  let ready = false;
  const h = playbackHarness({ isReady: () => ready });
  const pb = createVideoPlayback(CFG, h.hooks);
  assert.deepEqual(pb.start(), { ok: false, reason: 'not-ready' });
  assert.deepEqual(h.media.calls, []);
  ready = true;
  assert.deepEqual(pb.start(), { ok: true });
  assert.deepEqual(h.media.calls, ['reset', 'play']);
  h.frames(16, 5000);
  assert.equal(pb.state, 'stopped');
  assert.equal(h.stops[0].reason, 'complete');
  assert.deepEqual(h.media.calls.slice(-2), ['pause', 'reset'], 'stop pauses and resets');
  assert.equal(h.pending.size, 0);
});

test('stop and reduced motion pause and reset; no auto restart', () => {
  const h = playbackHarness();
  const pb = createVideoPlayback(CFG, h.hooks);
  pb.start();
  h.frames(16, 200);
  assert.equal(pb.stop('escape'), true);
  assert.deepEqual(h.media.calls, ['reset', 'play', 'pause', 'reset']);
  pb.start();
  pb.setReducedMotion(true);
  assert.equal(h.stops[1].reason, 'reduced-motion');
  assert.deepEqual(pb.start(), { ok: false, reason: 'reduced-motion' });
  h.frames(16, 4000);
  assert.equal(h.media.calls.filter((c) => c === 'play').length, 2);
});

test('rejected play() stops the run; stale rejection does not stop a later run', async () => {
  const h = playbackHarness();
  const pb = createVideoPlayback(CFG, h.hooks);
  let rejectFirst;
  h.media.playResult = new Promise((_, rej) => { rejectFirst = rej; });
  pb.start();
  pb.stop('stop button');
  h.media.playResult = Promise.resolve();
  pb.start();
  rejectFirst(new Error('NotAllowedError'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pb.state, 'running', 'stale rejection ignored');
  pb.stop();
  h.media.playResult = Promise.reject(new Error('NotAllowedError'));
  pb.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pb.state, 'stopped');
  assert.equal(h.stops.at(-1).reason, 'play rejected');
  assert.equal(h.pending.size, 0);
});

test('media errors on start fail closed', () => {
  const h = playbackHarness();
  h.media.play = () => { throw new Error('boom'); };
  const pb = createVideoPlayback(CFG, h.hooks);
  assert.equal(pb.start().ok, false);
  assert.equal(pb.state, 'stopped');
  assert.equal(h.stops[0].reason, 'error');
  assert.throws(() => createVideoPlayback(CFG, { ...h.hooks, media: {} }), TypeError);
});
