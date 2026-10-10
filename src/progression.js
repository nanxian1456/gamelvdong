import { ACTIONS, DIFFICULTIES, SHOWS, TRAINING_BONUS, getDifficulty } from './content.js';

export function createSeasonId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function newCampaign(difficulty = 'standard') {
  return {
    showIndex: 0,
    phase: 'home',
    credits: 0,
    popularity: 0,
    members: 3,
    nextShowCreditBonus: 0,
    showResults: [],
    actionHistory: [],
    difficulty: getDifficulty(difficulty).id,
  };
}

export function startCampaign(campaign) {
  return campaign.phase === 'home'
    ? { ...campaign, phase: 'show', seasonId: campaign.seasonId ?? createSeasonId() }
    : campaign;
}

export function setCampaignDifficulty(campaign, difficultyId) {
  if (campaign.phase !== 'home' || !DIFFICULTIES.some(({ id }) => id === difficultyId)) return campaign;
  return { ...campaign, difficulty: difficultyId };
}

export function settleShow(campaign, performance) {
  if (campaign.phase !== 'show' || !SHOWS[campaign.showIndex]) return campaign;

  const accuracy = Math.min(1, Math.max(0, Number(performance.accuracy) || 0));
  const difficulty = getDifficulty(campaign.difficulty);
  const credits = Math.floor((20 + Math.floor(accuracy * 30)) * difficulty.rewardMultiplier)
    + Math.floor(campaign.nextShowCreditBonus);
  const popularity = 5 + Math.floor(accuracy * 25);
  const result = { ...performance, accuracy, credits, popularity };

  return {
    ...campaign,
    phase: campaign.showIndex === SHOWS.length - 1 ? 'ending' : 'management',
    credits: campaign.credits + credits,
    popularity: campaign.popularity + popularity,
    nextShowCreditBonus: 0,
    showResults: [...campaign.showResults, result],
  };
}

export function retryLastShow(campaign) {
  if (!['management', 'ending'].includes(campaign.phase)) return campaign;
  const result = campaign.showResults.at(-1);
  if (!result || campaign.showResults.length !== campaign.showIndex + 1) return campaign;
  const difficulty = getDifficulty(campaign.difficulty);
  const baseCredits = Math.floor((20 + Math.floor(result.accuracy * 30)) * difficulty.rewardMultiplier);
  // Recover the actually awarded bonus, including legacy difficulty-scaled saves.
  return {
    ...campaign, phase: 'show',
    credits: Math.max(0, campaign.credits - result.credits),
    popularity: Math.max(0, campaign.popularity - result.popularity),
    nextShowCreditBonus: Math.max(0, result.credits - baseCredits),
    showResults: campaign.showResults.slice(0, -1),
  };
}

export function applyAction(campaign, actionId) {
  if (campaign.phase !== 'management') return { campaign, error: '当前阶段不能经营团队。' };

  const action = ACTIONS.find(({ id }) => id === actionId);
  if (!action) return { campaign, error: '未找到这项经营行动。' };
  if (campaign.credits < action.cost) return { campaign, error: '经费不足，选择其他行动或整理器材。' };
  if (action.id === 'recruit' && campaign.members >= 5) {
    return { campaign, error: '乐队已满员，最多 5 人。' };
  }

  const next = {
    ...campaign,
    phase: 'show',
    showIndex: campaign.showIndex + 1,
    credits: campaign.credits - action.cost,
    actionHistory: [...campaign.actionHistory, actionId],
  };
  if (action.id === 'train') next.nextShowCreditBonus = TRAINING_BONUS;
  if (action.id === 'promote') next.popularity += 20;
  if (action.id === 'recruit') next.members += 1;

  return { campaign: next, error: null };
}

export function getEnding(campaign) {
  const rankPoints = { S: 4, A: 3, B: 2, C: 1 };
  const performancePoints = campaign.showResults.reduce(
    (total, result) => total + (rankPoints[result.rank] ?? 0),
    0,
  );
  const popularityPoints = Math.min(2, Math.floor(campaign.popularity / 50));
  const teamPoints = Math.max(0, campaign.members - 3);
  const score = performancePoints + popularityPoints + teamPoints;
  const rank = score >= 12 ? 'Gold'
    : score >= 9 ? 'Silver'
      : score >= 6 ? 'Bronze' : 'First Stage';

  return { score, rank };
}
