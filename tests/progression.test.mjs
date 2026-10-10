import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../src/content.js';
import * as progression from '../src/progression.js';
import {
  applyAction,
  getEnding,
  newCampaign,
  settleShow,
  setCampaignDifficulty,
  startCampaign,
} from '../src/progression.js';

const performance = (accuracy, rank) => ({ accuracy, rank, score: Math.round(accuracy * 32_000), comboMax: 0 });

test('retry replaces only the latest result and restores the paid bonus without another charge', () => {
  assert.equal(typeof progression.retryLastShow, 'function');
  const { retryLastShow } = progression;
  let base = settleShow(startCampaign(newCampaign('easy')), performance(1, 'S'));
  base = applyAction(base, 'train').campaign;
  const completed = settleShow(base, performance(0, 'C'));
  const retry = retryLastShow(completed);
  assert.deepEqual(retry, base);
  assert.equal(completed.showResults.length, 2, 'does not mutate the settled record');
  const replaced = settleShow(retry, performance(1, 'S'));
  assert.equal(replaced.credits, 105);
  assert.equal(replaced.showResults.length, 2);
  assert.equal(replaced.actionHistory.length, 1);
  assert.equal(retryLastShow(retry), retry, 'cannot rollback an unsettled show twice');
});

test('final show retry preserves prior results, members and season identity', () => {
  assert.equal(typeof progression.retryLastShow, 'function');
  const { retryLastShow } = progression;
  let base = settleShow(startCampaign(newCampaign()), performance(1, 'S'));
  base = settleShow(applyAction(base, 'rest').campaign, performance(1, 'S'));
  base = applyAction(base, 'recruit').campaign;
  const final = settleShow(base, performance(0, 'C'));
  assert.equal(final.phase, 'ending');
  assert.deepEqual(retryLastShow(final), base);
});

function settleTrainedShow(difficulty) {
  let campaign = startCampaign(newCampaign(difficulty));
  campaign = settleShow(campaign, performance(0, 'C'));
  campaign = applyAction({ ...campaign, credits: 30 }, 'train').campaign;
  return settleShow(campaign, performance(1, 'S'));
}

test('starts with a fresh home campaign and starts only once', () => {
  const fresh = newCampaign();
  assert.deepEqual(fresh, {
    showIndex: 0,
    phase: 'home',
    credits: 0,
    popularity: 0,
    members: 3,
    nextShowCreditBonus: 0,
    showResults: [],
    actionHistory: [],
    difficulty: 'standard',
  });
  assert.equal(startCampaign(fresh).phase, 'show');
  assert.deepEqual(startCampaign({ ...fresh, phase: 'show' }), { ...fresh, phase: 'show' });
});

test('lets the player choose a difficulty before a season and locks it after starting', () => {
  const selected = setCampaignDifficulty(newCampaign(), 'spotlight');
  assert.equal(selected.difficulty, 'spotlight');
  assert.equal(setCampaignDifficulty(startCampaign(selected), 'easy').difficulty, 'spotlight');
});

test('settles 0%, 65%, and 95% shows with the planned rewards', () => {
  const start = { ...newCampaign(), phase: 'show' };
  const zero = settleShow(start, performance(0, 'C'));
  const mid = settleShow(start, performance(0.65, 'B'));
  const high = settleShow(start, performance(0.95, 'S'));
  assert.deepEqual([zero.credits, zero.popularity], [20, 5]);
  assert.deepEqual([mid.credits, mid.popularity], [39, 21]);
  assert.deepEqual([high.credits, high.popularity], [48, 28]);
  assert.equal(zero.phase, 'management');
});

test('adjusts show rewards by difficulty while keeping the standard economy unchanged', () => {
  const show = { ...newCampaign('spotlight'), phase: 'show' };
  const easy = settleShow({ ...show, difficulty: 'easy' }, performance(1, 'S'));
  const spotlight = settleShow(show, performance(1, 'S'));
  assert.equal(easy.credits, 45);
  assert.equal(spotlight.credits, 62);
});

test('easy training returns 45 on top of difficulty-scaled earnings', () => {
  assert.equal(settleTrainedShow('easy').credits, 90);
});

test('standard training returns 45 on top of base earnings', () => {
  assert.equal(settleTrainedShow('standard').credits, 95);
});

test('spotlight training returns the same fixed 45 bonus', () => {
  assert.equal(settleTrainedShow('spotlight').credits, 107);
});

test('applies all four management actions and advances after the choice', () => {
  const management = { ...newCampaign(), phase: 'management', credits: 100 };
  assert.deepEqual(ACTIONS.map(({ id }) => id), ['train', 'promote', 'recruit', 'rest']);

  const trained = applyAction(management, 'train').campaign;
  assert.deepEqual([trained.credits, trained.nextShowCreditBonus, trained.showIndex, trained.phase], [70, 45, 1, 'show']);
  const promoted = applyAction(management, 'promote').campaign;
  assert.deepEqual([promoted.credits, promoted.popularity, promoted.phase], [80, 20, 'show']);
  const recruited = applyAction(management, 'recruit').campaign;
  assert.deepEqual([recruited.credits, recruited.members, recruited.phase], [60, 4, 'show']);
  const rested = applyAction(management, 'rest').campaign;
  assert.deepEqual([rested.credits, rested.popularity, rested.members, rested.phase], [100, 0, 3, 'show']);
});

test('consumes a training bonus once when settling the next show', () => {
  const management = { ...newCampaign(), phase: 'management', credits: 100 };
  const afterTraining = applyAction(management, 'train').campaign;
  const afterShow = settleShow(afterTraining, performance(0, 'C'));
  assert.deepEqual([afterShow.credits, afterShow.nextShowCreditBonus], [135, 0]);
  assert.equal(settleShow(afterShow, performance(0, 'C')), afterShow);
});

test('training has a net benefit of 15 over resting even on all misses at every difficulty', () => {
  for (const difficulty of ['easy', 'standard', 'spotlight']) {
    const base = { ...newCampaign(difficulty), phase: 'management', credits: 100 };
    const trained = settleShow(applyAction(base, 'train').campaign, performance(0, 'C'));
    const rested = settleShow(applyAction(base, 'rest').campaign, performance(0, 'C'));
    assert.equal(trained.credits - rested.credits, 15);
  }
});

test('rejects unaffordable, unknown, and capped recruitment actions without mutation', () => {
  const poor = { ...newCampaign(), phase: 'management' };
  const noFunds = applyAction(poor, 'promote');
  assert.ok(noFunds.error);
  assert.deepEqual(noFunds.campaign, poor);

  const unknown = applyAction(poor, 'fly-to-moon');
  assert.ok(unknown.error);
  assert.deepEqual(unknown.campaign, poor);

  const capped = { ...poor, credits: 40, members: 5 };
  const noRoom = applyAction(capped, 'recruit');
  assert.ok(noRoom.error);
  assert.deepEqual(noRoom.campaign, capped);
});

test('allows an all-miss campaign to finish all shows and reach an ending', () => {
  let campaign = startCampaign(newCampaign());
  for (let showIndex = 0; showIndex < 3; showIndex += 1) {
    campaign = settleShow(campaign, performance(0, 'C'));
    if (showIndex < 2) campaign = applyAction(campaign, 'rest').campaign;
  }
  assert.equal(campaign.phase, 'ending');
  assert.equal(campaign.showResults.length, 3);
  assert.deepEqual(getEnding(campaign), { score: 3, rank: 'First Stage' });
});

test('maps performance and team growth to all four ending tiers', () => {
  const ending = (ranks, popularity = 0, members = 3) => getEnding({
    ...newCampaign(),
    showResults: ranks.map((rank) => ({ rank })),
    popularity,
    members,
  });
  assert.deepEqual(ending(['S', 'S', 'S']), { score: 12, rank: 'Gold' });
  assert.deepEqual(ending(['A', 'A', 'A']), { score: 9, rank: 'Silver' });
  assert.deepEqual(ending(['B', 'B', 'B']), { score: 6, rank: 'Bronze' });
  assert.deepEqual(ending(['C', 'C', 'C'], 100, 4), { score: 6, rank: 'Bronze' });
  assert.deepEqual(ending(['C', 'C', 'C']), { score: 3, rank: 'First Stage' });
});

test('carries each full-show summary through the ordered season and existing rewards', () => {
  const summaries = [
    { score: 37_280, accuracy: 1, rank: 'S', comboMax: 32 },
    { score: 45_280, accuracy: 1, rank: 'S', comboMax: 32 },
    { score: 53_280, accuracy: 1, rank: 'S', comboMax: 32 },
  ];
  let campaign = startCampaign(newCampaign());

  for (const [index, summary] of summaries.entries()) {
    assert.equal(campaign.showIndex, index);
    campaign = settleShow(campaign, summary);
    assert.deepEqual(
      Object.fromEntries(Object.keys(summary).map((key) => [key, campaign.showResults[index][key]])),
      summary,
    );
    assert.equal(campaign.showResults[index].credits, 50);
    if (index < summaries.length - 1) campaign = applyAction(campaign, 'rest').campaign;
  }

  assert.equal(campaign.phase, 'ending');
  assert.equal(campaign.showResults.length, 3);
  assert.equal(campaign.credits, 150);
});
