import test from 'node:test';
import assert from 'node:assert/strict';
import { getDifficulty, SHOWS } from '../src/content.js';
import {
  advanceRhythmRuntime,
  createRhythmRuntime,
  getNextBeatCue,
  getRhythmSummary,
  getShowBeatCue,
  processRhythmInput,
} from '../src/rhythm.js';

const note = (type = 'tap', overrides = {}) => ({ id: 'n1', type, hitMs: 1000, x: 0.5, ...overrides });
const runtimeFor = (notes, stageIndex = 0) => createRhythmRuntime({ chart: notes }, stageIndex);
const laneY = 0.84;
const hitTap = (runtime, x = 0.5, playheadMs = 1000, width = 400, difficulty = getDifficulty('standard')) => {
  processRhythmInput(runtime, { type: 'pointer-down', x, y: laneY, pointerType: 'mouse', pointerId: 99 }, playheadMs, difficulty, width, 400);
  processRhythmInput(runtime, { type: 'pointer-up', pointerId: 99 }, playheadMs, difficulty, width, 400);
};

test('keeps three ascending 32-beat charts at the planned tempos', () => {
  assert.deepEqual(SHOWS.map(({ bpm }) => bpm), [100, 110, 120]);
  assert.equal(SHOWS.length, 3);
  for (const show of SHOWS) {
    assert.equal(show.beatsMs.length, 32);
    assert.ok(show.beatsMs.every((beat, index, beats) => index === 0 || beat > beats[index - 1]));
  }
});

test('judges inclusive Perfect and Good boundaries and misses just outside Good at every difficulty', () => {
  for (const [difficultyId, perfect, good] of [['easy', 130, 230], ['standard', 90, 170], ['spotlight', 70, 130]]) {
    const difficulty = getDifficulty(difficultyId);
    for (const offset of [-perfect, perfect]) {
      const runtime = runtimeFor([note()]);
      hitTap(runtime, 0.5, 1000 + offset, 400, difficulty);
      assert.equal(runtime.results[0]?.judgement, 'perfect', `${difficultyId} Perfect ${offset}`);
    }
    for (const offset of [-good, good]) {
      const runtime = runtimeFor([note()]);
      hitTap(runtime, 0.5, 1000 + offset, 400, difficulty);
      assert.equal(runtime.results[0]?.judgement, 'good', `${difficultyId} Good ${offset}`);
    }
    for (const offset of [-good - 1, good + 1]) {
      const runtime = runtimeFor([note()]);
      hitTap(runtime, 0.5, 1000 + offset, 400, difficulty);
      advanceRhythmRuntime(runtime, 1000 + good + 1, 0, difficulty, 400);
      assert.equal(runtime.results[0]?.judgement, 'miss', `${difficultyId} Miss ${offset}`);
    }
  }
});

test('accepts a touch anywhere in its lane and rejects an adjacent lane', () => {
  for (const width of [400, 800, 1600]) {
    const runtime = runtimeFor([note()]);
    processRhythmInput(runtime, { type: 'pointer-down', x: 0.5 + 1 / 32, y: 0.08, pointerId: 7 }, 1000, getDifficulty('standard'), width, 400);
    assert.equal(runtime.results[0]?.judgement, 'perfect', `${width}px same-lane contact`);

    const outside = runtimeFor([note()]);
    processRhythmInput(outside, { type: 'pointer-down', x: 0.5 + 1 / 8 + 0.001, y: 0.84, pointerId: 7 }, 1000, getDifficulty('standard'), width, 400);
    assert.equal(outside.results.length, 0, `${width}px adjacent lane is rejected`);
  }
});

test('maps ASDFHJKL to their matching lanes', () => {
  const keys = ['a', 's', 'd', 'f', 'h', 'j', 'k', 'l'];
  const chart = keys.map((_, lane) => note('tap', {
    id: `lane-${lane}`, x: (lane + 0.5) / 8,
  }));
  const runtime = runtimeFor(chart);

  for (const key of keys) {
    processRhythmInput(runtime, { type: 'key-down', key }, 1000, getDifficulty('standard'), 400);
    processRhythmInput(runtime, { type: 'key-up', key }, 1000, getDifficulty('standard'), 400);
  }

  assert.deepEqual(runtime.results.map(({ judgement }) => judgement), Array(8).fill('perfect'));
});

test('resolves Hold only after contact through its duration and treats early release as Miss', () => {
  const held = runtimeFor([note('hold', { durationMs: 200 })]);
  processRhythmInput(held, { type: 'key-down', key: 'h' }, 1000, getDifficulty('standard'), 400);
  assert.equal(held.results.length, 0);
  advanceRhythmRuntime(held, 1200, 200, getDifficulty('standard'), 400);
  assert.equal(held.results[0]?.judgement, 'perfect');

  const released = runtimeFor([note('hold', { durationMs: 200 })]);
  processRhythmInput(released, { type: 'key-down', key: 'h' }, 1000, getDifficulty('standard'), 400);
  processRhythmInput(released, { type: 'key-up', key: 'h' }, 1100, getDifficulty('standard'), 400);
  advanceRhythmRuntime(released, 1200, 100, getDifficulty('standard'), 400);
  assert.equal(released.results[0]?.judgement, 'miss');
});

test('reacquires a sustaining Hold after pause clears physical input', () => {
  const runtime = runtimeFor([note('hold', { durationMs: 200 })]);
  processRhythmInput(runtime, { type: 'key-down', key: 'h' }, 1000, getDifficulty('standard'), 400);
  processRhythmInput(runtime, { type: 'reset' }, 1100, getDifficulty('standard'), 400);
  processRhythmInput(runtime, { type: 'key-down', key: 'h' }, 1100, getDifficulty('standard'), 400);
  advanceRhythmRuntime(runtime, 1200, 100, getDifficulty('standard'), 400);

  assert.equal(runtime.results[0]?.judgement, 'perfect');
});

test('completes a Hold when release arrives after its tail before the next frame', () => {
  const runtime = runtimeFor([note('hold', { durationMs: 200 })]);
  processRhythmInput(runtime, { type: 'key-down', key: 'h' }, 1000, getDifficulty('standard'), 400, 400);
  processRhythmInput(runtime, { type: 'key-up', key: 'h' }, 1201, getDifficulty('standard'), 400, 400);

  assert.equal(runtime.results[0]?.judgement, 'perfect');
});

test('keeps simultaneous phone holds independent by touch identifier', () => {
  const chart = [
    note('hold', { id: 'left', x: 0.0625, durationMs: 200 }),
    note('hold', { id: 'right', x: 0.9375, durationMs: 200 }),
  ];
  const runtime = runtimeFor(chart);
  processRhythmInput(runtime, { type: 'pointer-down', x: 0.0625, y: 0.98, pointerId: 1 }, 1000, getDifficulty('standard'), 400, 400);
  processRhythmInput(runtime, { type: 'pointer-down', x: 0.9375, y: 0.98, pointerId: 2 }, 1000, getDifficulty('standard'), 400, 400);
  processRhythmInput(runtime, { type: 'pointer-up', pointerId: 1 }, 1100, getDifficulty('standard'), 400, 400);

  assert.equal(runtime.noteStates[0].status, 'sustaining');
  assert.equal(runtime.noteStates[1].status, 'sustaining');
  advanceRhythmRuntime(runtime, 1200, 100, getDifficulty('standard'), 400, 400);
  assert.deepEqual(runtime.results.map(({ judgement }) => judgement), ['miss', 'perfect']);
});

test('rejects pointer contact in a different lane', () => {
  const runtime = runtimeFor([note()]);
  processRhythmInput(runtime, { type: 'pointer-down', x: 0.1, y: 0.84, pointerId: 1 }, 1000, getDifficulty('standard'), 800, 400);

  assert.equal(runtime.results.length, 0);
});

test('expires each Miss once and finishes only when every chart note resolves', () => {
  const runtime = runtimeFor([note(), note('tap', { id: 'n2', hitMs: 2000, x: 0.3 })]);
  advanceRhythmRuntime(runtime, 1171, 1171, getDifficulty('standard'), 400);
  assert.equal(runtime.results.length, 1);
  advanceRhythmRuntime(runtime, 1172, 1, getDifficulty('standard'), 400);
  assert.equal(runtime.results.length, 1);
  assert.equal(runtime.finished, false);
  advanceRhythmRuntime(runtime, 2171, 999, getDifficulty('standard'), 400);
  assert.equal(runtime.finished, true);
  assert.equal(runtime.results.length, 2);
});

test('finishes an all-Miss show with zero score, zero accuracy, and C rank', () => {
  const runtime = runtimeFor([note(), note('tap', { id: 'n2', hitMs: 2000 })], 2);
  advanceRhythmRuntime(runtime, 2171, 2171, getDifficulty('standard'), 400);
  assert.deepEqual(getRhythmSummary(runtime, getDifficulty('standard')), {
    score: 0, accuracy: 0, rank: 'C', comboMax: 0,
  });
});

test('applies stage and difficulty multipliers to score while accuracy stays at base judgement value', () => {
  const runtime = runtimeFor([note(), note('tap', { id: 'n2', hitMs: 2000 })], 2);
  hitTap(runtime, 0.5, 1000, 400);
  advanceRhythmRuntime(runtime, 1171, 171, getDifficulty('standard'), 400);
  assert.equal(runtime.score, 1510);
  assert.equal(getRhythmSummary(runtime, getDifficulty('standard')).accuracy, 0.5);
});

test('stage three Spotlight Good at combo three scores 1249 while accuracy remains 0.65', () => {
  const runtime = runtimeFor([note()], 2);
  runtime.combo = 2;
  hitTap(runtime, 0.5, 1071, 400, getDifficulty('spotlight'));
  assert.equal(runtime.score, 1249);
  assert.equal(getRhythmSummary(runtime, getDifficulty('spotlight')).accuracy, 0.65);
});

test('preserves inclusive S, A, and B rank thresholds', () => {
  for (const [perfect, total, rank] of [[19, 20, 'S'], [17, 20, 'A'], [13, 20, 'B'], [12, 20, 'C']]) {
    const chart = Array.from({ length: total }, (_, index) => note('tap', {
      id: `n${index}`, hitMs: 1000 + index * 1000,
    }));
    const runtime = runtimeFor(chart);
    for (let index = 0; index < perfect; index += 1) {
      hitTap(runtime, 0.5, chart[index].hitMs, 400, getDifficulty('standard'));
    }
    advanceRhythmRuntime(runtime, chart.at(-1).hitMs + 171, 171, getDifficulty('standard'), 400);
    assert.equal(getRhythmSummary(runtime, getDifficulty('standard')).rank, rank);
  }
});

test('returns the advance cue for the nearest unresolved beat', () => {
  assert.equal(getNextBeatCue([500, 1000], [false, false], -400), null);
  assert.deepEqual(getNextBeatCue([500, 1000], [false, false], 200), {
    index: 0, beatMs: 500, remainingMs: 300, progress: 0.625,
  });
  assert.deepEqual(getNextBeatCue([500, 1000], [true, false], 900), {
    index: 1, beatMs: 1000, remainingMs: 100, progress: 0.875,
  });
  const firstBeat = SHOWS[1].beatsMs[0];
  assert.deepEqual(getShowBeatCue(1, Array(32).fill(false), firstBeat - 300), {
    index: 0, beatMs: firstBeat, remainingMs: 300, progress: 0.625,
  });
});

test('resets held input without clearing resolved chart progress', () => {
  const runtime = runtimeFor([note(), note('tap', { id: 'n2', hitMs: 2000 })]);
  assert.equal('pointerStart' in runtime, false);
  hitTap(runtime);
  runtime.heldKeys.add('d');

  processRhythmInput(runtime, { type: 'reset' }, 1100, getDifficulty('standard'), 400);

  assert.equal(runtime.results.length, 1);
  assert.equal(runtime.score, 1010);
  assert.deepEqual([...runtime.heldKeys], []);
  assert.equal(runtime.activeInputs.size, 0);
});

test('A and D select their fixed lanes instead of moving a cursor', () => {
  const runtime = runtimeFor([
    note('tap', { id: 'a-lane', x: 0.0625 }),
    note('tap', { id: 'd-lane', x: 0.3125 }),
  ]);
  processRhythmInput(runtime, { type: 'key-down', key: 'a' }, 1000, getDifficulty('standard'), 400);
  processRhythmInput(runtime, { type: 'key-down', key: 'd' }, 1000, getDifficulty('standard'), 400);

  assert.deepEqual(runtime.results.map(({ judgement }) => judgement), ['perfect', 'perfect']);
  assert.equal('cursorX' in runtime, false);
});

test('does not let Space trigger a lane note', () => {
  const runtime = runtimeFor([]);
  processRhythmInput(runtime, { type: 'key-down', key: 'space' }, 1000, getDifficulty('standard'), 400);
  assert.equal(runtime.results.length, 0);
});
