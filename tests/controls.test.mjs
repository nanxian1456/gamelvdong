import test from 'node:test';
import assert from 'node:assert/strict';
import { bindRhythmControls } from '../src/controls.js';

class FakeTarget {
  listeners = new Map();
  captured = new Set();

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
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    event.stopPropagation ??= () => {};
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  closest(selector) {
    if (selector === '[data-lane-key]' && this.dataset?.laneKey != null) return this;
    return this.matches(selector) ? this : null;
  }
  contains(target) { return target === this || target?.parent === this; }
  matches(selector) {
    return selector.split(', ').some(part => part === this.tagName?.toLowerCase()
      || (part === '[contenteditable="true"]' && this.contentEditable === 'true')
      || (part === '[role="button"]' && this.role === 'button'));
  }
  getBoundingClientRect() { return { left: 100, top: 50, width: 400, height: 200 }; }
}

function setup() {
  const surface = new FakeTarget();
  const windowTarget = new FakeTarget();
  const events = [];
  const controls = bindRhythmControls({ surface, windowTarget, onEvent: event => events.push(event) });
  return { surface, windowTarget, events, controls };
}

test('A S D F H J K L emit one key edge per press and release', () => {
  const { windowTarget, events } = setup();
  for (const key of ['a', 's', 'd', 'f', 'h', 'j', 'k', 'l']) {
    windowTarget.dispatch('keydown', { code: `Key${key.toUpperCase()}`, key });
    windowTarget.dispatch('keydown', { code: `Key${key.toUpperCase()}`, key, repeat: true });
    windowTarget.dispatch('keyup', { code: `Key${key.toUpperCase()}`, key });
  }
  windowTarget.dispatch('keydown', { code: 'Space', key: ' ' });
  windowTarget.dispatch('keyup', { code: 'Space', key: ' ' });

  assert.deepEqual(events, ['a', 's', 'd', 'f', 'h', 'j', 'k', 'l'].flatMap(key => [
    { type: 'key-down', key },
    { type: 'key-up', key },
  ]));
});

test('pointer coordinates are normalized and pointer capture is released', () => {
  const { surface, events } = setup();
  surface.dispatch('pointerdown', { button: 0, pointerId: 7, clientX: 300, clientY: 100, pointerType: 'pen', timeStamp: 12 });
  surface.dispatch('pointermove', { pointerId: 7, clientX: 500, clientY: 200, pointerType: 'pen', timeStamp: 22 });
  surface.dispatch('pointerup', { button: 0, pointerId: 7, clientX: 500, clientY: 200, pointerType: 'pen', timeStamp: 32 });
  assert.deepEqual(events, [
    { type: 'pointer-down', x: 0.5, y: 0.25, pointerType: 'pen', pointerId: 7, timeStamp: 12 },
    { type: 'pointer-move', x: 1, y: 0.75, pointerType: 'pen', pointerId: 7, timeStamp: 22 },
    { type: 'pointer-up', x: 1, y: 0.75, pointerType: 'pen', pointerId: 7, timeStamp: 32 },
  ]);
  assert.equal(surface.captured.size, 0);
});

test('touching a lane pad emits its fixed lane instead of relying on pointer position', () => {
  const { surface, events } = setup();
  const laneButton = new FakeTarget();
  laneButton.dataset = { laneKey: '6' };
  laneButton.tagName = 'BUTTON';
  laneButton.role = 'button';
  laneButton.parent = surface;
  surface.dispatch('pointerdown', { button: 0, pointerId: 9, clientX: 102, clientY: 55, pointerType: 'touch', timeStamp: 1, target: laneButton });
  surface.dispatch('pointerup', { pointerId: 9, clientX: 102, clientY: 55, pointerType: 'touch', timeStamp: 2, target: surface });

  assert.equal(events[0].lane, 6);
  assert.equal(events[0].pointerId, 9);
});

test('keyboard activation of a lane pad emits one tap edge pair', () => {
  const { surface, events } = setup();
  const laneButton = new FakeTarget();
  laneButton.dataset = { laneKey: '3' };
  laneButton.tagName = 'BUTTON';
  laneButton.role = 'button';
  laneButton.parent = surface;
  surface.dispatch('click', { detail: 0, timeStamp: 15, target: laneButton });

  assert.deepEqual(events.map(({ type, lane, pointerId }) => [type, lane, pointerId]), [
    ['pointer-down', 3, 'keypad:3'],
    ['pointer-up', 3, 'keypad:3'],
  ]);
});

test('cancelling one touch releases only its lane contact', () => {
  const { surface, events } = setup();
  surface.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 120, clientY: 100, pointerType: 'touch', timeStamp: 1 });
  surface.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: 180, clientY: 100, pointerType: 'touch', timeStamp: 2 });
  surface.dispatch('pointercancel', { pointerId: 1, clientX: 120, clientY: 100, pointerType: 'touch', timeStamp: 3 });

  assert.deepEqual([...surface.captured], [2]);
  assert.deepEqual(events.map(({ type, pointerId }) => [type, pointerId]), [
    ['pointer-down', 1], ['pointer-down', 2], ['pointer-up', 1],
  ]);

  surface.dispatch('pointerup', { pointerId: 2, clientX: 180, clientY: 100, pointerType: 'touch', timeStamp: 4 });
  assert.deepEqual(events.slice(-1).map(({ type, pointerId }) => [type, pointerId]), [['pointer-up', 2]]);
});

test('pointer cancel and window blur reset held state', () => {
  const { surface, windowTarget, events } = setup();
  windowTarget.dispatch('keydown', { code: 'KeyD' });
  surface.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 50, pointerType: 'touch', timeStamp: 1 });
  surface.dispatch('pointercancel', { pointerId: 1, clientX: 100, clientY: 50, pointerType: 'touch', timeStamp: 2 });
  surface.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 50, pointerType: 'touch', timeStamp: 3 });
  assert.equal(surface.captured.size, 0);
  windowTarget.dispatch('keydown', { code: 'KeyA' });
  surface.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: 200, clientY: 50, pointerType: 'touch', timeStamp: 4 });
  windowTarget.dispatch('blur');
  surface.dispatch('pointermove', { pointerId: 2, clientX: 300, clientY: 50, pointerType: 'touch', timeStamp: 5 });
  assert.equal(surface.captured.size, 0);
  assert.deepEqual(events, [
    { type: 'key-down', key: 'd' },
    { type: 'pointer-down', x: 0, y: 0, pointerType: 'touch', pointerId: 1, timeStamp: 1 },
    { type: 'pointer-up', x: 0, y: 0, pointerType: 'touch', pointerId: 1, timeStamp: 2 },
    { type: 'key-down', key: 'a' },
    { type: 'pointer-down', x: 0.25, y: 0, pointerType: 'touch', pointerId: 2, timeStamp: 4 },
    { type: 'reset' },
  ]);
});

test('pointer activation suppresses its synthesized click', () => {
  const { surface, events } = setup();
  surface.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 200, clientY: 100, pointerType: 'mouse', timeStamp: 10 });
  surface.dispatch('pointerup', { button: 0, pointerId: 1, clientX: 200, clientY: 100, pointerType: 'mouse', timeStamp: 20 });
  surface.dispatch('click', { detail: 1 });
  assert.equal(events.filter(event => event.type.startsWith('pointer-')).length, 2);
});

test('inputs from unrelated controls are ignored', () => {
  const { surface, windowTarget, events } = setup();
  const input = new FakeTarget();
  input.tagName = 'INPUT';
  windowTarget.dispatch('keydown', { code: 'KeyA', target: input });
  windowTarget.dispatch('keydown', { code: 'Space', target: input });
  assert.deepEqual(events, []);
});

test('a held key is released if focus moves to an unrelated input before keyup', () => {
  const { windowTarget, events } = setup();
  const input = new FakeTarget();
  input.tagName = 'INPUT';
  windowTarget.dispatch('keydown', { code: 'KeyA' });
  windowTarget.dispatch('keyup', { code: 'KeyA', target: input });
  assert.deepEqual(events, [
    { type: 'key-down', key: 'a' },
    { type: 'key-up', key: 'a' },
  ]);
});

test('reset emits reset and disposal removes listeners then resets once', () => {
  const { surface, windowTarget, events, controls } = setup();
  windowTarget.dispatch('keydown', { code: 'KeyD' });
  surface.dispatch('pointerdown', { button: 0, pointerId: 3, clientX: 200, clientY: 100, pointerType: 'mouse', timeStamp: 1 });
  controls.reset();
  windowTarget.dispatch('keydown', { code: 'KeyA' });
  surface.dispatch('pointerdown', { button: 0, pointerId: 4, clientX: 200, clientY: 100, pointerType: 'mouse', timeStamp: 2 });
  controls.dispose();
  surface.dispatch('pointermove', { pointerId: 4, clientX: 300, clientY: 100, pointerType: 'mouse', timeStamp: 3 });
  windowTarget.dispatch('keydown', { code: 'KeyD' });
  assert.deepEqual(events, [
    { type: 'key-down', key: 'd' },
    { type: 'pointer-down', x: 0.25, y: 0.25, pointerType: 'mouse', pointerId: 3, timeStamp: 1 },
    { type: 'reset' },
    { type: 'key-down', key: 'a' },
    { type: 'pointer-down', x: 0.25, y: 0.25, pointerType: 'mouse', pointerId: 4, timeStamp: 2 },
    { type: 'reset' },
  ]);
  assert.equal(surface.captured.size, 0);
  assert.equal([...surface.listeners.values()].flatMap(set => [...set]).length, 0);
  assert.equal([...windowTarget.listeners.values()].flatMap(set => [...set]).length, 0);
});
