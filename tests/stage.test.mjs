import test from 'node:test';
import assert from 'node:assert/strict';

const stage = await import('../src/stage.js');
const geometryTools = await import('../src/stage-geometry.js');

function makeStage(width = 320, height = 200) {
  const calls = [];
  const context = new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => calls.push({ name: property, args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle });
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width, height }),
    getContext: () => context,
  };
  const app = { querySelector: () => canvas };
  return { app, canvas, context, calls };
}

function drawCalls(width, height, show, rhythmRuntime, playheadMs, difficulty = { speedMultiplier: 1 }, options = {}) {
  const scene = makeStage(width, height);
  stage.drawStage(scene.app, show, rhythmRuntime, playheadMs, difficulty, options);
  return scene;
}

test('uses eight equal lanes and a fixed horizontal judgment line', () => {
  assert.equal(typeof stage.getStageGeometry, 'function');

  for (const [width, height] of [[1600, 200], [180, 600]]) {
    const geometry = stage.getStageGeometry(makeStage(width, height).app);
    const { lineStart, lineEnd } = geometry;

    assert.equal(geometry.laneCount, 8);
    assert.deepEqual([geometry.width, geometry.height], [width, height]);
    assert.equal(lineStart.y, lineEnd.y);
    assert.ok(Math.abs(lineStart.y - height * 0.84) < 0.01);
    assert.equal(geometry.laneWidth, width / 8);
    for (const point of [lineStart, lineEnd]) {
      assert.ok(point.x >= 0 && point.x <= width);
      assert.ok(point.y >= 0 && point.y <= height);
    }
  }
});

test('maps normalized chart positions to stable lane centers', () => {
  const geometry = stage.getStageGeometry(makeStage().app);

  for (const [chartX, lane] of [[0, 0], [0.25, 2], [0.5, 4], [0.999, 7], [1, 7]]) {
    const point = geometryTools.pointOnLine(geometry, chartX);
    assert.equal(point.lane, lane);
    assert.equal(point.x, (lane + 0.5) * geometry.laneWidth);
    assert.equal(point.y, geometry.lineStart.y);
  }
});

test('draws piano-block colors, lane separators, Tap blocks, and active lane feedback', () => {
  const hold = { id: 'hold', type: 'hold', hitMs: 1500, x: 0.5, durationMs: 300 };
  const tap = { id: 'tap', type: 'tap', hitMs: 1500, x: 0.25 };
  const scene = drawCalls(320, 200, { chart: [hold, tap] }, {
    noteStates: [{ status: 'pending' }, { status: 'pending' }],
    activeInputs: new Map([['key:d', { lane: 2, noteIndex: null }]]),
  }, 1500);

  assert.ok(scene.calls.some(({ name, args, fillStyle }) => name === 'fillRect'
    && args.join(',') === '0,0,320,200' && fillStyle === '#0b0714'));
  assert.ok(scene.calls.some(({ name, strokeStyle }) => name === 'stroke' && strokeStyle === '#f5f3ff'));
  assert.ok(scene.calls.some(({ name, strokeStyle }) => name === 'stroke' && strokeStyle === 'rgba(178,132,255,0.14)'));
  assert.ok(scene.calls.some(({ name, args, fillStyle }) => name === 'fillRect'
    && args[0] === 80 && fillStyle === '#43d8bc'));
  assert.ok(scene.calls.some(({ name, fillStyle }) => name === 'fillRect' && fillStyle === '#f2c64f'));
  assert.ok(scene.calls.some(({ name, fillStyle }) => name === 'fillRect' && fillStyle === '#22d8ee'));
  assert.equal(scene.calls.some(({ name }) => name === 'fillText'), false);
});

test('places tap targets on the judgment line at hit time for every speed multiplier', () => {
  const note = { id: 'tap', type: 'tap', hitMs: 2000, x: 0.25 };
  const geometry = stage.getStageGeometry(makeStage(320, 200).app);
  const targetY = geometry.lineStart.y;

  for (const speedMultiplier of [0.85, 1, 1.2]) {
    const scene = drawCalls(320, 200, { chart: [note] }, { noteStates: [{ status: 'pending' }] }, note.hitMs, { speedMultiplier });
    const tap = scene.calls.find((call) => call.name === 'fillRect' && call.fillStyle === '#f2c64f');

    assert.ok(tap);
    assert.ok(Math.abs(tap.args[1] + tap.args[3] / 2 - targetY) < 0.01);
  }
});

test('shows the note at the visible canvas top for the full difficulty-scaled preview interval', () => {
  const note = { id: 'tap', type: 'tap', hitMs: 2000, x: 0.5 };

  for (const [speedMultiplier, previewMs] of [[0.85, 1500 / 0.85], [1, 1500], [1.2, 1500 / 1.2]]) {
    const scene = drawCalls(800, 400, { chart: [note] }, { noteStates: [{ status: 'pending' }] }, note.hitMs - previewMs, { speedMultiplier });
    const tap = scene.calls.find((call) => call.name === 'fillRect' && call.fillStyle === '#f2c64f');

    assert.ok(tap, `${speedMultiplier}x note is drawn at spawn`);
    assert.ok(tap.args[1] >= 0, `${speedMultiplier}x note center is visible, got y=${tap.args[1]}`);
    assert.ok(tap.args[1] <= 12, `${speedMultiplier}x note starts at the canvas top, got y=${tap.args[1]}`);
  }
});

test('draws Tap blocks and sustained Hold bodies without other note types', () => {
  const chart = [
    { id: 'hold', type: 'hold', hitMs: 1500, x: 0.5, durationMs: 300 },
    { id: 'tap', type: 'tap', hitMs: 1500, x: 0.25 },
  ];
  const runtime = { noteStates: [{ status: 'sustaining' }, { status: 'pending' }], activeInputs: new Map() };
  const originalRuntime = structuredClone(runtime);
  const scene = drawCalls(320, 200, { chart }, runtime, 1550);
  assert.ok(scene.calls.some(({ name, fillStyle }) => name === 'fillRect' && fillStyle === '#22d8ee'));
  assert.ok(scene.calls.some(({ name, fillStyle }) => name === 'fillRect' && fillStyle === '#f2c64f'));
  assert.equal(scene.calls.some(({ name }) => name === 'fillText'), false);
  assert.deepEqual(runtime, originalRuntime);
});

test('anchors a sustaining Hold at the judgment line while its far end advances to it', () => {
  const note = { id: 'hold', type: 'hold', hitMs: 1500, x: 0.5, durationMs: 600 };
  const geometry = stage.getStageGeometry(makeStage(320, 200).app);
  const lineY = geometry.lineStart.y;
  const holdBody = (playheadMs) => {
    const scene = drawCalls(320, 200, { chart: [note] }, {
      noteStates: [{ status: 'sustaining' }], activeInputs: new Map([['key:h', { lane: 4, noteIndex: 0 }]]),
    }, playheadMs);
    return scene.calls.find(({ name, fillStyle }) => name === 'fillRect' && fillStyle === '#22d8ee');
  };

  const atHit = holdBody(1500);
  const midHold = holdBody(1800);
  const atEnd = holdBody(2100);

  assert.ok(Math.abs(atHit.args[1] + atHit.args[3] - lineY) < 0.01);
  assert.ok(Math.abs(midHold.args[1] + midHold.args[3] - lineY) < 0.01);
  assert.ok(Math.abs(atEnd.args[1] - lineY) < 0.01);
  assert.ok(atHit.args[3] > midHold.args[3]);
  assert.ok(midHold.args[3] > atEnd.args[3]);
  assert.ok(Math.abs(atEnd.args[3] - 4) < 0.01);
});

test('caps stage canvas pixel ratio at two while keeping geometry in CSS pixels', () => {
  const scene = makeStage(320, 200);
  stage.resizeStageCanvas(scene.app, 3);
  const geometry = stage.getStageGeometry(scene.app);

  assert.deepEqual([scene.canvas.width, scene.canvas.height], [640, 400]);
  assert.deepEqual([geometry.width, geometry.height], [320, 200]);
  assert.ok(scene.calls.some(({ name, args }) => name === 'setTransform' && args.join(',') === '2,0,0,2,0,0'));
});

test('reduced motion keeps note positions tied to playback time', () => {
  const chart = [{ id: 'tap', type: 'tap', hitMs: 1800, x: 0.6 }];
  const runtime = { noteStates: [{ status: 'pending' }], activeInputs: new Map() };
  const normal = drawCalls(320, 200, { chart }, runtime, 900);
  const reduced = drawCalls(320, 200, { chart }, runtime, 900, { speedMultiplier: 1 }, { reducedMotion: true });
  const positions = (scene) => scene.calls.filter(({ name }) => name === 'fillRect' || name === 'arc').map(({ args }) => args.slice(0, 2));

  assert.deepEqual(positions(reduced), positions(normal));
});
