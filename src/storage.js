import { createSeasonId, getEnding, newCampaign } from './progression.js';
import { DIFFICULTIES, getDifficulty } from './content.js';

const SAVE_KEY = 'rhythm-campus-band-save';
const SAVE_VERSION = 1;
const ARCHIVE_KEY = 'rhythm-campus-band-archive';
const ARCHIVE_VERSION = 1;
const ARCHIVE_LIMIT = 10;
const PHASES = new Set(['home', 'show', 'management', 'ending']);
const RANKS = new Set(['S', 'A', 'B', 'C']);

function resolveStorage(storage) {
  return storage ?? globalThis.localStorage;
}

function isCampaign(value) {
  const fieldsAreValid = Boolean(
    value
    && typeof value === 'object'
    && Number.isInteger(value.showIndex)
    && value.showIndex >= 0
    && value.showIndex < 3
    && PHASES.has(value.phase)
    && (value.difficulty === undefined || DIFFICULTIES.some(({ id }) => id === value.difficulty))
    && (value.seasonId === undefined || (typeof value.seasonId === 'string' && value.seasonId.length > 0))
    && Number.isFinite(value.credits)
    && value.credits >= 0
    && Number.isFinite(value.popularity)
    && value.popularity >= 0
    && Number.isInteger(value.members)
    && value.members >= 3
    && value.members <= 5
    && Number.isFinite(value.nextShowCreditBonus)
    && value.nextShowCreditBonus >= 0
    && Array.isArray(value.showResults)
    && value.showResults.length <= 3
    && value.showResults.every((result) => (
      result
      && RANKS.has(result.rank)
      && Number.isFinite(result.score)
      && Number.isFinite(result.accuracy)
      && result.accuracy >= 0
      && result.accuracy <= 1
      && Number.isInteger(result.comboMax)
      && Number.isFinite(result.credits)
      && Number.isFinite(result.popularity)
    ))
    && Array.isArray(value.actionHistory)
    && value.actionHistory.every((action) => ['train', 'promote', 'recruit', 'rest'].includes(action))
  );
  if (!fieldsAreValid) return false;

  const resultCount = value.showResults.length;
  const actionCount = value.actionHistory.length;
  if (value.phase === 'home') {
    return value.showIndex === 0 && resultCount === 0 && actionCount === 0;
  }
  if (value.phase === 'show') {
    return value.showIndex === resultCount && actionCount === value.showIndex;
  }
  if (value.phase === 'management') {
    return resultCount >= 1 && resultCount <= 2
      && value.showIndex === resultCount - 1
      && actionCount === resultCount - 1;
  }
  return value.showIndex === 2 && resultCount === 3 && actionCount === 2;
}

export function saveCampaign(campaign, storage) {
  try {
    const target = resolveStorage(storage);
    if (!target || !isCampaign(campaign)) return false;
    target.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, campaign }));
    return true;
  } catch {
    return false;
  }
}

export function loadCampaign(storage) {
  try {
    const target = resolveStorage(storage);
    if (!target) return { campaign: newCampaign(), recovered: true };
    const raw = target.getItem(SAVE_KEY);
    if (raw === null) return { campaign: newCampaign(), recovered: true };

    const record = JSON.parse(raw);
    if (record?.version === SAVE_VERSION && isCampaign(record.campaign)) {
      const campaign = {
        ...record.campaign,
        difficulty: record.campaign.difficulty ?? 'standard',
      };
      if (campaign.phase !== 'home' && !campaign.seasonId) campaign.seasonId = createSeasonId();
      const needsMigration = record.campaign.difficulty === undefined
        || (campaign.phase !== 'home' && record.campaign.seasonId === undefined);
      if (needsMigration) {
        try {
          target.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, campaign }));
        } catch {
          // Keep the usable in-memory campaign if migration cannot be persisted.
        }
      }
      return { campaign, recovered: false };
    }
  } catch {
    return { campaign: newCampaign(), recovered: true };
  }

  return { campaign: newCampaign(), recovered: true };
}

function isArchiveRecord(value) {
  return Boolean(
    value
    && typeof value.id === 'string'
    && DIFFICULTIES.some(({ id }) => id === value.difficulty)
    && ['Gold', 'Silver', 'Bronze', 'First Stage'].includes(value.rank)
    && Number.isFinite(value.score)
    && Number.isFinite(value.popularity)
    && Number.isFinite(value.credits)
    && value.credits >= 0
    && Number.isFinite(value.completedAt)
    && Math.abs(value.completedAt) <= 8.64e15,
  );
}

export function loadSeasonArchive(storage) {
  try {
    const target = resolveStorage(storage);
    const raw = target?.getItem(ARCHIVE_KEY);
    if (raw === null || raw === undefined) return [];
    const record = JSON.parse(raw);
    if (record?.version !== ARCHIVE_VERSION || !Array.isArray(record.records)) return [];
    const newestById = new Map();
    for (const archiveRecord of record.records) {
      if (!isArchiveRecord(archiveRecord)) continue;
      const previous = newestById.get(archiveRecord.id);
      if (!previous || archiveRecord.completedAt > previous.completedAt) {
        newestById.set(archiveRecord.id, archiveRecord);
      }
    }
    return [...newestById.values()]
      .sort((first, second) => second.completedAt - first.completedAt)
      .slice(0, ARCHIVE_LIMIT);
  } catch {
    return [];
  }
}

export function recordCompletedSeason(campaign, storage, completedAt = Date.now()) {
  try {
    const target = resolveStorage(storage);
    if (
      !target
      || campaign?.phase !== 'ending'
      || typeof campaign.seasonId !== 'string'
      || campaign.showResults?.length !== 3
    ) return false;
    const records = loadSeasonArchive(target);
    if (records.some(({ id }) => id === campaign.seasonId)) return false;
    const ending = getEnding(campaign);
    const next = [
      {
        id: campaign.seasonId,
        difficulty: getDifficulty(campaign.difficulty).id,
        rank: ending.rank,
        score: ending.score,
        popularity: campaign.popularity,
        credits: campaign.credits,
        completedAt,
      },
      ...records,
    ].slice(0, ARCHIVE_LIMIT);
    target.setItem(ARCHIVE_KEY, JSON.stringify({ version: ARCHIVE_VERSION, records: next }));
    return true;
  } catch {
    return false;
  }
}

export function clearCampaign(storage) {
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    target.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function restartCompletedSeason(campaign, storage) {
  try {
    const target = resolveStorage(storage);
    if (
      !target
      || campaign?.phase !== 'ending'
      || typeof campaign.seasonId !== 'string'
      || campaign.showResults?.length !== 3
    ) return false;

    const isArchived = () => loadSeasonArchive(target).some(({ id }) => id === campaign.seasonId);
    if (!isArchived()) recordCompletedSeason(campaign, target);
    if (!isArchived()) return false;
    return clearCampaign(target);
  } catch {
    return false;
  }
}
