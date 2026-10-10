import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES, getDifficulty, SHOWS } from '../src/content.js';
import {
  advanceRhythmRuntime,
  createRhythmRuntime,
  getRhythmSummary,
  processRhythmInput,
} from '../src/rhythm.js';
import { getStageGeometry, pointOnLine } from '../src/stage-geometry.js';

test('arranges each show into an intro, playable phrases and an audible ending', () => {
  for (const show of SHOWS) {
    assert.ok(Array.isArray(show.sections), 'show exposes its musical sections');
    assert.deepEqual(show.sections.map(({ id }) => id), ['intro', 'verse', 'chorus', 'outro']);
    assert.equal(show.durationMs, Math.round(64 * 60_000 / show.bpm));
    assert.ok(show.chart[0].hitMs >= show.sections[1].startMs);
    assert.ok(show.chart.at(-1).hitMs < show.sections[3].startMs);
    assert.deepEqual(new Set(show.music.map(({ voice }) => voice)), new Set(['melody', 'bass', 'harmony', 'kick', 'snare', 'hat']));
    for (const note of show.chart) {
      const sound = show.music.find(event => event.voice === 'melody' && event.atMs === note.hitMs);
      assert.ok(sound, `${note.id} has a musical attack`);
      if (note.type === 'hold') assert.ok(sound.durationMs >= note.durationMs);
    }
    assert.ok(show.music.some(event => event.atMs === 0), 'intro plays before notes');
    assert.ok(show.music.some(event => event.atMs >= show.sections[3].startMs), 'ending is audible');
    const finalMelody = show.music.filter(event => event.voice === 'melody').at(-1);
    assert.ok(Math.abs(finalMelody.frequency - 523.25) < 0.01, 'each ending resolves to the home key');
  }
});

test('four-lane remapping preserves the original melody pitches', () => {
  const originalMidi = [[60, 64, 67, 64, 62, 67, 69, 64],
    [64, 69, 72, 69, 67, 72, 74, 69], [69, 74, 76, 74, 72, 76, 60, 74]];
  for (const [stageIndex, show] of SHOWS.entries()) {
    const melody = show.music.filter(event => event.voice === 'melody' && event.atMs >= show.chart[0].hitMs).slice(0, 8);
    assert.deepEqual(melody.map(event => Math.round(69 + 12 * Math.log2(event.frequency / 440))), originalMidi[stageIndex]);
  }
});

const fieldWidth = 400;
const fieldHeight = 400;
const geometry = getStageGeometry(fieldWidth, fieldHeight);
const lineY = x => pointOnLine(geometry, x).y / fieldHeight;

function completePerfectShow(show, stageIndex, difficulty) {
  const runtime = createRhythmRuntime(show.chart, stageIndex);
  let previousMs = 0;

  for (const note of show.chart) {
    const x = note.x;
    const input = (type, inputX = x, timeStamp = note.hitMs, inputY = lineY(inputX)) => processRhythmInput(runtime, {
      type,
      x: inputX,
      y: inputY,
      pointerType: 'mouse',
      timeStamp,
    }, note.hitMs, difficulty, fieldWidth, fieldHeight);

    input('pointer-down');
    if (note.type === 'hold') {
      advanceRhythmRuntime(runtime, note.hitMs + note.durationMs,
        note.hitMs + note.durationMs - previousMs, difficulty, fieldWidth, fieldHeight);
      previousMs = note.hitMs + note.durationMs;
    }
    input('pointer-up', x, note.hitMs + (note.durationMs ?? 0));
    if (note.type !== 'hold') {
      advanceRhythmRuntime(runtime, note.hitMs, note.hitMs - previousMs, difficulty, fieldWidth, fieldHeight);
      previousMs = note.hitMs;
    }
  }

  return runtime;
}

test('every show has a deterministic 32-note chart aligned to its beat anchors', () => {
  assert.equal(SHOWS.length, 3);

  for (const show of SHOWS) {
    assert.equal(show.beatsMs.length, 32, `${show.id} keeps 32 beat anchors`);
    assert.equal(show.chart?.length, 32, `${show.id} has 32 chart notes`);
    assert.deepEqual(show.chart.map((note) => note.hitMs), show.beatsMs);
    assert.equal(new Set(show.chart.map((note) => note.id)).size, 32);
    assert.deepEqual(show.chart.map((note) => note.id),
      show.chart.map((_, index) => `${show.id}-note-${String(index + 1).padStart(2, '0')}`));
    assert.ok(show.chart.every((note) => typeof note.id === 'string' && note.id.length > 0));
    assert.ok(show.chart.every((note) => Number.isFinite(note.hitMs)));
    assert.ok(show.chart.every((note, index, notes) => index === 0 || note.hitMs > notes[index - 1].hitMs));
    assert.ok(show.chart.every((note) => Number.isFinite(note.x) && note.x >= 0 && note.x <= 1));
    assert.deepEqual(new Set(show.chart.map((note) => note.type)), new Set(['tap', 'hold']));
    assert.ok(show.chart.every((note) => !('direction' in note) && !('path' in note)));

    const longNotes = show.chart.filter((note) => note.type === 'hold');
    for (const note of longNotes) {
      assert.ok(Number.isFinite(note.durationMs) && note.durationMs > 0, `${note.id} has a positive duration`);
    }

    for (const note of show.chart) {
      if (note.type !== 'hold') continue;
      const endMs = note.hitMs + note.durationMs;
      for (const other of show.chart) {
        if (other === note) continue;
        assert.ok(other.hitMs < note.hitMs || other.hitMs > endMs,
          `${note.id} contact [${note.hitMs}, ${endMs}] conflicts with ${other.id}`);
        if (other.type === 'hold') {
          const otherEndMs = other.hitMs + other.durationMs;
          assert.ok(endMs < other.hitMs || otherEndMs < note.hitMs,
            `${note.id} contact conflicts with ${other.id}`);
        }
      }
    }

    assert.deepEqual([...new Set(show.chart.map(({ x }) => x))].sort((a, b) => a - b),
      [0.125, 0.375, 0.625, 0.875], `${show.id} uses only the four lane centers`);
  }

  assert.equal(new Set(SHOWS.map((show) => JSON.stringify(show.chart))).size, SHOWS.length,
    'stage chart patterns vary');
});

test('difficulty speed multipliers are exact and existing judgment/economy values stay intact', () => {
  assert.deepEqual(DIFFICULTIES.map(({ speedMultiplier }) => speedMultiplier), [0.85, 1, 1.2]);
  assert.deepEqual(DIFFICULTIES.map(({ goodWindowMs, perfectWindowMs, scoreMultiplier, rewardMultiplier }) =>
    ({ goodWindowMs, perfectWindowMs, scoreMultiplier, rewardMultiplier })), [
    { goodWindowMs: 230, perfectWindowMs: 130, scoreMultiplier: 0.9, rewardMultiplier: 0.9 },
    { goodWindowMs: 170, perfectWindowMs: 90, scoreMultiplier: 1, rewardMultiplier: 1 },
    { goodWindowMs: 130, perfectWindowMs: 70, scoreMultiplier: 1.25, rewardMultiplier: 1.25 },
  ]);
});

test('completes every integrated chart perfectly at every difficulty and stage score rises without clamping', () => {
  for (const [stageIndex, show] of SHOWS.entries()) {
    for (const difficultyRecord of DIFFICULTIES) {
      const difficulty = getDifficulty(difficultyRecord.id);
      const runtime = completePerfectShow(show, stageIndex, difficulty);
      const summary = getRhythmSummary(runtime, difficulty);
      const multiplier = [1, 1.25, 1.5][stageIndex];
      const noteScore = Math.round(1000 * multiplier * difficulty.scoreMultiplier);

      assert.equal(runtime.finished, true, `${show.id}/${difficulty.id} finishes`);
      assert.equal(runtime.results.length, 32, `${show.id}/${difficulty.id} resolves each note once`);
      assert.deepEqual(runtime.results.map(({ noteIndex }) => noteIndex).sort((a, b) => a - b),
        Array.from({ length: show.chart.length }, (_, index) => index),
        `${show.id}/${difficulty.id} resolves every chart index exactly once`);
      assert.deepEqual(new Set(runtime.results.map(({ judgement }) => judgement)), new Set(['perfect']),
        `${show.id}/${difficulty.id} misses: ${runtime.results
          .filter(({ judgement }) => judgement !== 'perfect')
          .map(({ noteIndex, judgement }) => `${show.chart[noteIndex].type}:${noteIndex}:${judgement}`).join(', ')}`);
      assert.deepEqual(summary, {
        score: noteScore * 32 + 10 * (32 * 33 / 2),
        accuracy: 1,
        rank: 'S',
        comboMax: 32,
      });
      if (stageIndex > 0) {
        const previousStage = completePerfectShow(SHOWS[stageIndex - 1], stageIndex - 1, difficulty);
        assert.ok(summary.score > getRhythmSummary(previousStage, difficulty).score,
          `${show.id}/${difficulty.id} score rises with stage`);
      }
      assert.ok(summary.score > 32_000, `${show.id}/${difficulty.id} score is not display-clamped`);
    }
  }
});
