import test from 'node:test';
import assert from 'node:assert/strict';
import * as progression from '../src/progression.js';
import { SHOWS } from '../src/content.js';
import { renderManagementView, renderPerformanceView } from '../src/views.js';
import { createRhythmRuntime, processRhythmInput, advanceRhythmRuntime, getRhythmSummary } from '../src/rhythm.js';
import { saveCampaign, loadCampaign } from '../src/storage.js';

const performance = { accuracy: 1, rank: 'S', score: 32000, comboMax: 32 };
const management = () => progression.settleShow(progression.startCampaign(progression.newCampaign()), performance);
const hit = (runtime, at) => {
  processRhythmInput(runtime, { type: 'key-down', key: 'd' }, at);
  processRhythmInput(runtime, { type: 'key-up', key: 'd' }, at);
};

test('training protects one active combo while preserving original score and accuracy', () => {
  const chart = [1000, 2000, 3000, 4000].map(hitMs => ({ hitMs, x: 0.125, type: 'tap' }));
  const protectedRun = createRhythmRuntime(chart, 0, { comboShields: 1 });
  const normalRun = createRhythmRuntime(chart);
  for (const runtime of [protectedRun, normalRun]) { hit(runtime, 1000); advanceRhythmRuntime(runtime, 2200, 0); }
  assert.equal(protectedRun.combo, 1);
  assert.equal(protectedRun.results[1].judgement, 'miss');
  assert.equal(protectedRun.results[1].comboProtected, true);
  assert.equal(protectedRun.comboShields, 0);
  for (const runtime of [protectedRun, normalRun]) hit(runtime, 3000);
  assert.equal(protectedRun.combo, 2);
  assert.equal(protectedRun.score, normalRun.score);
  assert.equal(getRhythmSummary(protectedRun).accuracy, getRhythmSummary(normalRun).accuracy);
  advanceRhythmRuntime(protectedRun, 4200, 0);
  assert.equal(protectedRun.combo, 0, 'second miss is not protected');
});

test('a miss before the first hit does not spend combo protection', () => {
  const runtime = createRhythmRuntime([{ hitMs: 1000, x: 0.125, type: 'tap' }], 0, { comboShields: 1 });
  advanceRhythmRuntime(runtime, 1200, 0);
  assert.equal(runtime.comboShields, 1);
  assert.equal(runtime.results[0].judgement, 'miss');
});

test('an early hold release spends protection once and stays a miss', () => {
  const runtime = createRhythmRuntime([
    { hitMs: 1000, x: 0.125, type: 'tap' },
    { hitMs: 2000, x: 0.125, type: 'hold', durationMs: 1000 },
  ], 0, { comboShields: 1 });
  hit(runtime, 1000);
  processRhythmInput(runtime, { type: 'key-down', key: 'd' }, 2000);
  processRhythmInput(runtime, { type: 'key-up', key: 'd' }, 2100);
  advanceRhythmRuntime(runtime, 2300, 0);
  assert.equal(runtime.results[1].judgement, 'miss');
  assert.equal(runtime.combo, 1);
  assert.equal(runtime.comboShields, 0);
  assert.equal(getRhythmSummary(runtime).accuracy, 0.5);
});

test('pending training survives saves and retries but does not leak into the following show', () => {
  assert.equal(typeof progression.getShowEffects, 'function');
  const trained = progression.applyAction(management(), 'train').campaign;
  assert.equal(progression.getShowEffects(trained).comboShields, 1);
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.equal(saveCampaign(trained, storage), true);
  assert.equal(progression.getShowEffects(loadCampaign(storage).campaign).comboShields, 1);
  const settled = progression.settleShow(trained, performance);
  assert.equal(progression.getShowEffects(settled).comboShields, 0);
  assert.equal(progression.getShowEffects(progression.retryLastShow(settled)).comboShields, 1);
  assert.equal(progression.getShowEffects(progression.applyAction(settled, 'rest').campaign).comboShields, 0);
});

test('management previews resulting resources and effect duration without charging the player', () => {
  const base = management();
  const before = JSON.stringify(base);
  const html = renderManagementView({ campaign: base, saveNotice: '' });
  assert.match(html, /选择后经费 20/);
  assert.match(html, /仅下一场/);
  assert.match(html, /连击保护/);
  assert.match(html, /4 人/);
  assert.equal(JSON.stringify(base), before);
});

test('formal performance displays recruited roles and training status, tutorial remains isolated', () => {
  const base = { ...progression.applyAction(management(), 'train').campaign, members: 5 };
  const html = renderPerformanceView({ campaign: base, show: SHOWS[1], preferences: {}, runtime: null });
  assert.match(html, /本场阵容 · 5 人/);
  assert.match(html, /贝斯/);
  assert.match(html, /采样/);
  assert.match(html, /id="combo-shield-status"/);
  const tutorial = renderPerformanceView({ campaign: base, show: SHOWS[1], preferences: {}, runtime: null, tutorial: true });
  assert.doesNotMatch(tutorial, /id="combo-shield-status"|本场阵容/);
});
