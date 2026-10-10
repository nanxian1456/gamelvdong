import test from 'node:test';
import assert from 'node:assert/strict';
import * as content from '../src/content.js';
import * as views from '../src/views.js';
import { createRhythmRuntime, processRhythmInput, advanceRhythmRuntime, getRhythmSummary } from '../src/rhythm.js';

test('tutorial teaches sparse taps, four lanes, then holds in a separate playable chart', () => {
  const show = content.TUTORIAL_SHOW;
  assert.ok(show, 'independent tutorial chart is available');
  assert.ok(!content.SHOWS.includes(show));
  assert.equal(content.SHOWS.length, 3);
  assert.ok(show.durationMs >= 28000 && show.durationMs <= 32000);
  assert.ok(show.chart.length < 20);
  assert.deepEqual(show.chart.slice(0, 3).map(n => n.x), [0.125, 0.125, 0.125]);
  assert.deepEqual(show.chart.slice(3, 7).map(n => n.x), [0.125, 0.375, 0.625, 0.875]);
  assert.ok(show.chart.slice(7).every(n => n.type === 'hold'));
  assert.ok(show.chart.every((n, i, all) => !i || n.hitMs - all[i - 1].hitMs >= 1500));
  for (const n of show.chart) {
    assert.ok(n.hitMs + (n.durationMs ?? 0) < show.durationMs);
    assert.ok(show.music.some(tone => tone.voice === 'melody' && tone.atMs === n.hitMs
      && tone.durationMs === (n.durationMs ?? 300)));
  }
});

test('tutorial tolerates beginner timing and still supports real long holds and missed notes', () => {
  assert.ok(content.TUTORIAL_SHOW);
  assert.ok(content.TUTORIAL_DIFFICULTY);
  const { chart } = content.TUTORIAL_SHOW;
  const difficulty = content.TUTORIAL_DIFFICULTY;
  assert.ok(difficulty.speedMultiplier < content.getDifficulty('easy').speedMultiplier);
  const runtime = createRhythmRuntime(chart);
  for (const [i, n] of chart.entries()) {
    const key = ['d', 'f', 'j', 'k'][Math.floor(n.x * 4)];
    processRhythmInput(runtime, { type: 'key-down', key }, n.hitMs + 260, difficulty);
    if (n.type === 'hold') advanceRhythmRuntime(runtime, n.hitMs + n.durationMs, n.durationMs, difficulty);
    processRhythmInput(runtime, { type: 'key-up', key }, n.hitMs + (n.durationMs ?? 260), difficulty);
    assert.notEqual(runtime.results[i]?.judgement, 'miss');
  }
  assert.equal(getRhythmSummary(runtime, difficulty).accuracy, 0.65);
  const missed = createRhythmRuntime(chart);
  advanceRhythmRuntime(missed, 33000, 33000, difficulty);
  assert.equal(missed.finished, true);
  assert.equal(getRhythmSummary(missed, difficulty).accuracy, 0);
});

test('tutorial entry is available even with a season in progress and its result offers no rewards', () => {
  const campaign = { phase: 'management', showIndex: 1, showResults: [{}], actionHistory: [],
    members: 3, credits: 44, popularity: 25, difficulty: 'standard' };
  const before = structuredClone(campaign);
  const home = views.renderHomeView({ campaign, seasonArchive: [], shows: content.SHOWS, saveNotice: '' });
  assert.match(home, /id="open-tutorial"/);
  assert.equal(typeof views.renderTutorialResultView, 'function');
  const html = views.renderTutorialResultView({ score: 0, accuracy: 0, comboMax: 0 });
  assert.match(html, /id="retry-tutorial"/);
  assert.match(html, /id="exit-tutorial"/);
  assert.match(html, /不影响.*赛季/);
  assert.doesNotMatch(html, /经费\s*\+|热度\s*\+/);
  assert.deepEqual(campaign, before);
});

test('tutorial preparation exposes its own note total to players and assistive technology', () => {
  const html = views.renderPerformanceView({ campaign: { showIndex: 0 },
    show: content.TUTORIAL_SHOW, preferences: { muted: false }, tutorial: true });
  assert.match(html, /00 \/ 11/);
  assert.match(html, /aria-valuemax="11"/);
});
