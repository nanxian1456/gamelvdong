import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOWS, getDifficulty } from '../src/content.js';
import * as content from '../src/content.js';
import { createPerformanceController } from '../src/performance-controller.js';

class FakeClassList {
  values = new Set();

  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    if (force === true) this.values.add(name);
    else if (force === false) this.values.delete(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
    return this.values.has(name);
  }
}

class FakeTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    event.target ??= this;
    event.currentTarget ??= this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return event;
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function createCanvasContext() {
  return new Proxy({}, {
    get(target, property) {
      if (!(property in target)) target[property] = () => {};
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

class FakeElement extends FakeTarget {
  attributes = new Map();
  classList = new FakeClassList();
  dataset = {};
  hidden = false;
  style = {};
  textContent = '';
  ownerDocument = null;

  constructor(id = '') {
    super();
    this.id = id;
    this.context = id === 'stage-art' ? createCanvasContext() : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'hidden') this.hidden = true;
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'hidden') this.hidden = false;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 400 }; }
  getContext() { return this.context; }
  focus() { this.focused = true; }
  contains(target) { return target === this; }
  closest(selector) {
    if (selector === '[data-lane-key]' && this.dataset.laneKey != null) return this;
    return null;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
}

class FakeRoot {
  elements = new Map();
  _html = '';

  constructor(documentTarget) {
    this.documentTarget = documentTarget;
  }

  set innerHTML(value) {
    this._html = value;
    this.elements.clear();
    for (const [, id] of value.matchAll(/id="([^"]+)"/g)) {
      const element = new FakeElement(id);
      element.ownerDocument = this.documentTarget;
      this.elements.set(`#${id}`, element);
    }
    const progressbar = new FakeElement('progressbar');
    progressbar.ownerDocument = this.documentTarget;
    this.elements.set('[role="progressbar"]', progressbar);
    const countdownText = value.match(/id="countdown-label"[^>]*>([^<]*)</)?.[1] ?? '';
    const countdown = this.elements.get('#countdown-label');
    if (countdown) countdown.textContent = countdownText;
  }

  get innerHTML() { return this._html; }
  querySelector(selector) { return this.elements.get(selector) ?? null; }
  click(selector) { this.querySelector(selector)?.dispatch('click'); }
  text(selector) { return this.querySelector(selector)?.textContent ?? ''; }
}

function createFrames() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    request(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) { callbacks.delete(id); },
    runNext() {
      const [id, callback] = callbacks.entries().next().value ?? [];
      if (!callback) return false;
      callbacks.delete(id);
      callback();
      return true;
    },
    get pendingCount() { return callbacks.size; },
  };
}

function createFakeEngine({ startGate } = {}) {
  return {
    available: true,
    destroyCalls: 0,
    feedbackCalls: [],
    mutedValues: [],
    pauseCalls: 0,
    playhead: -3000,
    resumeCalls: 0,
    startCalls: 0,
    updateCalls: 0,
    volumeValues: [],
    async start() {
      this.startCalls += 1;
      await startGate?.promise;
    },
    async pause() { this.pauseCalls += 1; },
    async resume() { this.resumeCalls += 1; },
    async destroy() { this.destroyCalls += 1; },
    setMuted(value) { this.mutedValues.push(value); },
    setVolume(value) { this.volumeValues.push(value); },
    update() { this.updateCalls += 1; },
    getPlayhead() { return this.playhead; },
    getCountdown() { return Math.max(0, Math.ceil(-this.playhead / 1000)); },
    isAvailable() { return this.available; },
    feedback(judgement) { this.feedbackCalls.push(judgement); },
  };
}

function createHarness({ engineSetup, onComplete, startGate } = {}) {
  const documentTarget = new FakeTarget();
  documentTarget.hidden = false;
  documentTarget.body = new FakeElement('body');
  documentTarget.documentElement = new FakeElement('html');
  const root = new FakeRoot(documentTarget);
  const frames = createFrames();
  const windowTarget = new FakeTarget();
  windowTarget.devicePixelRatio = 1;
  windowTarget.performance = { now: () => 1000 };
  windowTarget.matchMedia = () => ({ matches: false });
  windowTarget.requestAnimationFrame = callback => frames.request(callback);
  windowTarget.cancelAnimationFrame = id => frames.cancel(id);
  windowTarget.setTimeout = callback => { callback(); return 1; };
  windowTarget.clearTimeout = () => {};
  windowTarget.reportedErrors = [];
  windowTarget.reportError = error => windowTarget.reportedErrors.push(error);

  const engines = [];
  const preferenceChanges = [];
  const completeSummaries = [];
  const controller = createPerformanceController({
    root,
    windowTarget,
    documentTarget,
    createEngine: () => {
      const engine = createFakeEngine({ startGate });
      engineSetup?.(engine);
      engines.push(engine);
      return engine;
    },
    onComplete: async summary => {
      completeSummaries.push(summary);
      await onComplete?.(summary);
    },
    onPreferenceChange: changes => preferenceChanges.push(changes),
  });
  const options = {
    campaign: { showIndex: 0 },
    show: SHOWS[0],
    difficulty: getDifficulty('normal'),
    preferences: { muted: false, volume: 80, reduceMotion: false, offsetMs: 0 },
    saveUnavailable: false,
    restoredActiveShow: false,
  };
  return {
    completeSummaries,
    controller,
    documentTarget,
    engines,
    frames,
    options,
    preferenceChanges,
    root,
    windowTarget,
  };
}

const flushAsync = () => new Promise(resolve => setImmediate(resolve));

test('tutorial controller shows phased hints and cues from its own chart rather than season notes', async () => {
  assert.ok(content.TUTORIAL_SHOW);
  const h = createHarness();
  await h.controller.enter({ ...h.options, show: content.TUTORIAL_SHOW,
    difficulty: content.TUTORIAL_DIFFICULTY, tutorial: true, autoStart: true });
  assert.match(h.root.innerHTML, /id="exit-tutorial"/);
  h.engines[0].playhead = 3200;
  h.frames.runNext();
  assert.match(h.root.text('#tutorial-hint'), /按一下/);
  assert.match(h.root.text('#next-beat-label'), /0.8 秒/);
  h.engines[0].playhead = 10500;
  h.frames.runNext();
  assert.match(h.root.text('#tutorial-hint'), /四.*键|四.*轨/);
  h.engines[0].playhead = 20000;
  h.frames.runNext();
  assert.match(h.root.text('#tutorial-hint'), /按住/);
  h.engines[0].playhead = 30000;
  h.frames.runNext();
  await flushAsync();
  assert.equal(h.completeSummaries.length, 1);
  assert.equal(h.completeSummaries[0].accuracy, 0);
  assert.equal(h.windowTarget.listenerCount('keydown'), 0);
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

test('exposes only the four lifecycle methods and waits for manual start', async () => {
  const { controller, engines, options, root } = createHarness();
  assert.deepEqual(Object.keys(controller).sort(), ['dispose', 'enter', 'leave', 'setPreferences']);
  await controller.enter({ ...options, autoStart: false });
  assert.equal(engines.length, 0);
  root.click('#start-performance');
  await flushAsync();
  assert.equal(engines.length, 1);
  assert.equal(engines[0].startCalls, 1);
});

test('coalesces concurrent automatic entry into one session', async () => {
  const { controller, engines, frames, options, windowTarget } = createHarness();
  await Promise.all([
    controller.enter({ ...options, autoStart: true }),
    controller.enter({ ...options, autoStart: true }),
  ]);
  assert.equal(engines.length, 1);
  assert.equal(engines[0].startCalls, 1);
  assert.equal(frames.pendingCount, 1);
  assert.equal(windowTarget.listenerCount('keydown'), 1);
});

test('stores preferences before a session and syncs an active engine', async () => {
  const { controller, engines, options } = createHarness();
  controller.setPreferences({ muted: true, volume: 35, reduceMotion: true, offsetMs: 20 });
  await controller.enter({ ...options, preferences: undefined, autoStart: true });
  assert.deepEqual(engines[0].mutedValues, [true]);
  assert.deepEqual(engines[0].volumeValues, [0.35]);
  controller.setPreferences({ muted: false, volume: 60, reduceMotion: false, offsetMs: -10 });
  assert.equal(engines[0].mutedValues.at(-1), false);
  assert.equal(engines[0].volumeValues.at(-1), 0.6);
});

test('routes the performance mute control through the preference callback', async () => {
  const { controller, options, preferenceChanges, root } = createHarness();
  await controller.enter({ ...options, autoStart: false });
  root.click('#mute-toggle');
  assert.deepEqual(preferenceChanges, [{ muted: true }]);
});

test('leave pauses, detaches input, cancels frames, and enter resumes the same session', async () => {
  const { controller, engines, frames, options, windowTarget } = createHarness();
  await controller.enter({ ...options, autoStart: true });
  await controller.leave();
  assert.equal(engines[0].pauseCalls, 1);
  assert.equal(frames.pendingCount, 0);
  assert.equal(windowTarget.listenerCount('keydown'), 0);

  await controller.enter({ ...options, autoStart: false });
  assert.equal(engines.length, 1);
  assert.equal(engines[0].resumeCalls, 1);
  assert.equal(frames.pendingCount, 1);
  assert.equal(windowTarget.listenerCount('keydown'), 1);
});

test('leaving during a pending start cannot revive a detached page', async () => {
  const startGate = createDeferred();
  const { controller, engines, frames, options, windowTarget } = createHarness({ startGate });
  const entering = controller.enter({ ...options, autoStart: true });
  const leaving = controller.leave();
  startGate.resolve();
  await Promise.all([entering, leaving]);
  assert.equal(engines[0].pauseCalls, 1);
  assert.equal(frames.pendingCount, 0);
  assert.equal(windowTarget.listenerCount('keydown'), 0);
});

test('hidden-page pause and repeated cleanup are idempotent', async () => {
  const {
    controller,
    documentTarget,
    engines,
    options,
    windowTarget,
  } = createHarness();
  await controller.enter({ ...options, autoStart: true });
  assert.equal(documentTarget.listenerCount('visibilitychange'), 1);
  assert.equal(windowTarget.listenerCount('resize'), 1);
  documentTarget.hidden = true;
  documentTarget.dispatch('visibilitychange');
  await flushAsync();
  assert.equal(engines[0].pauseCalls, 1);

  await controller.leave();
  await controller.leave();
  await controller.dispose();
  await controller.dispose();
  assert.equal(engines[0].pauseCalls, 1);
  assert.equal(engines[0].destroyCalls, 1);
  assert.equal(documentTarget.listenerCount('visibilitychange'), 0);
  assert.equal(windowTarget.listenerCount('resize'), 0);
});

test('a disposed controller applies the latest preferences to its next session', async () => {
  const { controller, engines, options } = createHarness();
  await controller.enter({ ...options, autoStart: true });
  await controller.dispose();
  controller.setPreferences({ muted: true, volume: 20, reduceMotion: false, offsetMs: 0 });
  await controller.enter({
    ...options,
    campaign: { showIndex: 1 },
    show: SHOWS[1],
    preferences: undefined,
    autoStart: true,
  });
  assert.equal(engines.length, 2);
  assert.equal(engines[1].mutedValues.at(-1), true);
  assert.equal(engines[1].volumeValues.at(-1), 0.2);
});

test('processes lane input at the engine playhead and updates the HUD', async () => {
  const { controller, engines, options, root, windowTarget } = createHarness();
  await controller.enter({ ...options, autoStart: true });
  engines[0].playhead = 4800;
  windowTarget.dispatch('keydown', { code: 'KeyD', key: 'd' });
  assert.deepEqual(engines[0].feedbackCalls, ['perfect']);
  assert.equal(root.text('#progress-value'), '01 / 32');
});

test('advances from the engine playhead and freezes the frame loop while paused', async () => {
  const { controller, engines, frames, options, root } = createHarness();
  await controller.enter({ ...options, autoStart: true });
  engines[0].playhead = 5200;
  frames.runNext();
  assert.equal(root.text('#progress-value'), '01 / 32');
  root.click('#pause-toggle');
  await flushAsync();
  const updateCalls = engines[0].updateCalls;
  assert.equal(frames.pendingCount, 0);
  assert.equal(engines[0].updateCalls, updateCalls);
});

test('clears the countdown label when returning to an in-progress show', async () => {
  const { controller, engines, frames, options, root } = createHarness();
  await controller.enter({ ...options, autoStart: true });
  engines[0].playhead = 1000;
  frames.runNext();
  await controller.leave();
  await controller.enter({ ...options, autoStart: false });
  assert.equal(root.text('#countdown-label'), '');
});

test('processes reset during leave before the paused-input guard', async () => {
  const { completeSummaries, controller, engines, frames, options, windowTarget } = createHarness();
  const holdShow = {
    ...options.show,
    durationMs: 0, music: [],
    beatsMs: [0],
    chart: [{ id: 'hold-1', type: 'hold', hitMs: 0, durationMs: 1000, x: 0.05 }],
  };
  await controller.enter({ ...options, show: holdShow, autoStart: true });
  engines[0].playhead = 0;
  windowTarget.dispatch('keydown', { code: 'KeyD', key: 'd' });
  await controller.leave();
  await controller.enter({ ...options, show: holdShow, autoStart: false });
  engines[0].playhead = 200;
  frames.runNext();
  engines[0].playhead = 400;
  frames.runNext();
  await flushAsync();
  assert.equal(completeSummaries.length, 1);
  assert.equal(completeSummaries[0].accuracy, 0);
});

test('completes once and destroys resources before notifying the caller', async () => {
  let engine;
  let destroyedAtComplete = false;
  const harness = createHarness({
    onComplete: () => { destroyedAtComplete = engine.destroyCalls === 1; },
  });
  const { completeSummaries, controller, engines, frames, options } = harness;
  const shortShow = {
    ...options.show,
    durationMs: 0, music: [],
    beatsMs: [0],
    chart: [{ id: 'tap-1', type: 'tap', hitMs: 0, x: 0.05 }],
  };
  await controller.enter({ ...options, show: shortShow, autoStart: true });
  [engine] = engines;
  engine.playhead = 1000;
  frames.runNext();
  await flushAsync();
  assert.equal(engine.destroyCalls, 1);
  assert.equal(completeSummaries.length, 1);
  assert.equal(frames.pendingCount, 0);
  assert.equal(destroyedAtComplete, true);
});

test('reports a completion callback error after cleaning up exactly once', async () => {
  const harness = createHarness({
    onComplete: () => { throw new Error('settlement failed'); },
  });
  const { controller, engines, frames, options, windowTarget } = harness;
  const shortShow = {
    ...options.show,
    durationMs: 0, music: [],
    beatsMs: [0],
    chart: [{ id: 'tap-1', type: 'tap', hitMs: 0, x: 0.05 }],
  };
  await controller.enter({ ...options, show: shortShow, autoStart: true });
  engines[0].playhead = 1000;
  frames.runNext();
  await flushAsync();
  assert.equal(engines[0].destroyCalls, 1);
  assert.equal(harness.completeSummaries.length, 1);
  assert.match(windowTarget.reportedErrors[0].message, /settlement failed/);
});

test('finishes with a visual-beat notice when audio is unavailable', async () => {
  const harness = createHarness({ engineSetup: engine => { engine.available = false; } });
  const { completeSummaries, controller, engines, frames, options, root } = harness;
  const shortShow = {
    ...options.show,
    durationMs: 0, music: [],
    beatsMs: [0],
    chart: [{ id: 'tap-1', type: 'tap', hitMs: 0, x: 0.05 }],
  };
  await controller.enter({ ...options, show: shortShow, autoStart: true });
  assert.match(root.text('#audio-note'), /视觉节拍/);
  engines[0].playhead = 1000;
  frames.runNext();
  await flushAsync();
  assert.equal(completeSummaries.length, 1);
});

test('lets the musical ending finish before settling the show', async () => {
  const { controller, engines, frames, options, completeSummaries } = createHarness();
  await controller.enter({ ...options, show: {
    ...options.show, durationMs: 2000,
    chart: [{ id: 'tap-1', type: 'tap', hitMs: 0, x: 0.05 }], beatsMs: [0],
  }, autoStart: true });
  engines[0].playhead = 1000;
  frames.runNext();
  await flushAsync();
  assert.equal(completeSummaries.length, 0);
  assert.equal(frames.pendingCount, 1);
  engines[0].playhead = 2000;
  frames.runNext();
  await flushAsync();
  assert.equal(completeSummaries.length, 1);
});

test('pause retry clears score and starts one fresh session without completing or duplicating listeners', async () => {
  const { controller, engines, frames, options, root, windowTarget, completeSummaries } = createHarness();
  await controller.enter({ ...options, autoStart: true });
  engines[0].playhead = 4800;
  windowTarget.dispatch('keydown', { code: 'KeyD', key: 'd' });
  windowTarget.dispatch('keyup', { code: 'KeyD', key: 'd' });
  root.click('#pause-toggle');
  await flushAsync();
  root.click('#retry-performance');
  root.click('#retry-performance');
  await flushAsync();
  assert.equal(engines[0].destroyCalls, 1);
  assert.equal(engines.length, 2);
  assert.equal(engines[1].playhead, -3000);
  assert.equal(root.text('#score-value'), '0');
  assert.equal(root.text('#progress-value'), '00 / 32');
  assert.equal(frames.pendingCount, 1);
  assert.equal(windowTarget.listenerCount('keydown'), 1);
  assert.equal(completeSummaries.length, 0);
});

test('leaving while retry tears down audio cannot revive the abandoned stage', async () => {
  const gate = createDeferred();
  const { controller, engines, frames, options, root, windowTarget } = createHarness({
    engineSetup: engine => { engine.destroy = async () => { engine.destroyCalls += 1; await gate.promise; }; },
  });
  await controller.enter({ ...options, autoStart: true });
  root.click('#pause-toggle');
  await flushAsync();
  root.click('#retry-performance');
  await flushAsync();
  await controller.leave();
  root.innerHTML = '<section id="settings-page">Settings</section>';
  gate.resolve();
  await flushAsync();
  assert.equal(engines.length, 1);
  assert.equal(frames.pendingCount, 0);
  assert.equal(windowTarget.listenerCount('keydown'), 0);
  assert.match(root.innerHTML, /settings-page/);
});

test('returning during retry destruction waits for teardown and keeps the new entry startable', async () => {
  const gate = createDeferred();
  const { controller, engines, frames, options, root } = createHarness({
    engineSetup: engine => { engine.destroy = async () => { engine.destroyCalls += 1; await gate.promise; }; },
  });
  await controller.enter({ ...options, autoStart: true });
  root.click('#pause-toggle');
  await flushAsync();
  root.click('#retry-performance');
  await flushAsync();
  await controller.leave();
  const entering = controller.enter({ ...options, autoStart: false });
  gate.resolve();
  await entering;
  await flushAsync();
  root.click('#start-performance');
  await flushAsync();
  assert.equal(engines.length, 2);
  assert.equal(engines[1].startCalls, 1);
  assert.equal(frames.pendingCount, 1);
});

test('a pending return during destruction cannot render after another navigation away', async () => {
  const gate = createDeferred();
  const { controller, options, root, frames } = createHarness({
    engineSetup: engine => { engine.destroy = async () => { await gate.promise; }; },
  });
  await controller.enter({ ...options, autoStart: true });
  const disposing = controller.dispose();
  await flushAsync();
  const entering = controller.enter({ ...options, autoStart: false });
  await controller.leave();
  root.innerHTML = '<section id="settings-page">Settings</section>';
  gate.resolve();
  await Promise.all([disposing, entering]);
  assert.match(root.innerHTML, /settings-page/);
  assert.equal(frames.pendingCount, 0);
});
