import test from 'node:test';
import assert from 'node:assert/strict';
import * as storageApi from '../src/storage.js';
import { applyAction, newCampaign, settleShow, startCampaign } from '../src/progression.js';
import {
  clearCampaign,
  loadCampaign,
  loadSeasonArchive,
  recordCompletedSeason,
  restartCompletedSeason,
  saveCampaign,
} from '../src/storage.js';

const KEY = 'rhythm-campus-band-archive';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function completedCampaign() {
  let campaign = startCampaign(newCampaign('spotlight'));
  for (let index = 0; index < 3; index += 1) {
    campaign = settleShow(campaign, { score: 32000, accuracy: 1, rank: 'S', comboMax: 32 });
    if (index < 2) campaign = applyAction(campaign, 'rest').campaign;
  }
  return { ...campaign, phase: 'ending', credits: 73, popularity: 105 };
}

test('records completed seasons locally and avoids duplicate entries for the same season', () => {
  const storage = new MemoryStorage();
  const campaign = completedCampaign();
  const first = recordCompletedSeason(campaign, storage, 1234);
  const second = recordCompletedSeason(campaign, storage, 5678);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.deepEqual(loadSeasonArchive(storage), [{
    id: campaign.seasonId,
    difficulty: 'spotlight',
    rank: 'Gold',
    score: 14,
    popularity: 105,
    credits: 73,
    completedAt: 1234,
  }]);
  assert.equal(storage.values.has(KEY), true);
});

test('recovers from a malformed local season archive without throwing', () => {
  const storage = new MemoryStorage();
  storage.setItem(KEY, '{bad json');
  assert.deepEqual(loadSeasonArchive(storage), []);
});

test('updates a retried finale in place rather than duplicating the season archive', () => {
  const storage = new MemoryStorage();
  const campaign = completedCampaign();
  recordCompletedSeason(campaign, storage, 1234);
  const retried = { ...campaign, credits: 100, popularity: 110 };
  assert.equal(recordCompletedSeason(retried, storage, 5678), true);
  const records = loadSeasonArchive(storage);
  assert.equal(records.length, 1);
  assert.equal(records[0].credits, 100);
  assert.equal(records[0].popularity, 110);
  assert.equal(records[0].completedAt, 1234);
  assert.equal(recordCompletedSeason(retried, storage, 9999), false);
});

test('failed archive update retains the revised finale and prevents a destructive season restart', () => {
  const storage = new MemoryStorage();
  const original = completedCampaign();
  recordCompletedSeason(original, storage, 1234);
  const revised = { ...original, credits: 100, popularity: 110 };
  saveCampaign(revised, storage);
  storage.setItem = () => { throw new Error('quota exhausted'); };
  assert.equal(recordCompletedSeason(revised, storage, 5678), false);
  assert.equal(restartCompletedSeason(revised, storage), false);
  assert.equal(loadCampaign(storage).campaign.credits, 100);
  assert.equal(storageApi.isCompletedSeasonArchived(revised, storage), false);
  assert.equal(storageApi.isCompletedSeasonArchived(original, storage), true);
});

test('keeps only the newest stored record for each season ID', () => {
  const storage = new MemoryStorage();
  storage.setItem(KEY, JSON.stringify({
    version: 1,
    records: [
      { id: 'season-a', difficulty: 'standard', rank: 'Bronze', score: 6, popularity: 50, credits: 20, completedAt: 100 },
      { id: 'season-b', difficulty: 'easy', rank: 'Silver', score: 9, popularity: 75, credits: 40, completedAt: 300 },
      { id: 'season-a', difficulty: 'spotlight', rank: 'Gold', score: 14, popularity: 105, credits: 73, completedAt: 200 },
      { id: 'season-c', difficulty: 'standard', rank: 'First Stage', score: 3, popularity: 15, credits: 25, completedAt: 150 },
    ],
  }));

  assert.deepEqual(loadSeasonArchive(storage), [
    { id: 'season-b', difficulty: 'easy', rank: 'Silver', score: 9, popularity: 75, credits: 40, completedAt: 300 },
    { id: 'season-a', difficulty: 'spotlight', rank: 'Gold', score: 14, popularity: 105, credits: 73, completedAt: 200 },
    { id: 'season-c', difficulty: 'standard', rank: 'First Stage', score: 3, popularity: 15, credits: 25, completedAt: 150 },
  ]);
});

test('defaults legacy campaigns to standard difficulty and assigns an archive identity', () => {
  const campaign = startCampaign(newCampaign());
  const legacy = { ...campaign };
  delete legacy.difficulty;
  delete legacy.seasonId;
  const storage = new MemoryStorage();
  storage.setItem('rhythm-campus-band-save', JSON.stringify({ version: 1, campaign: legacy }));
  const loaded = loadCampaign(storage);
  assert.equal(loaded.campaign.difficulty, 'standard');
  assert.ok(loaded.campaign.seasonId);
  assert.equal(loadCampaign(storage).campaign.seasonId, loaded.campaign.seasonId);
  assert.equal(loaded.recovered, false);
});

test('migrates a completed legacy season once and keeps its archive identity on reload', () => {
  const storage = new MemoryStorage();
  const legacy = { ...completedCampaign() };
  delete legacy.difficulty;
  delete legacy.seasonId;
  storage.setItem('rhythm-campus-band-save', JSON.stringify({ version: 1, campaign: legacy }));

  const first = loadCampaign(storage).campaign;
  assert.equal(first.difficulty, 'standard');
  assert.equal(recordCompletedSeason(first, storage, 1234), true);
  const reloaded = loadCampaign(storage).campaign;
  assert.equal(reloaded.seasonId, first.seasonId);
  assert.equal(recordCompletedSeason(reloaded, storage, 5678), false);
  assert.equal(loadSeasonArchive(storage).length, 1);
});

test('keeps only the ten most recent season records', () => {
  const storage = new MemoryStorage();
  const campaign = completedCampaign();
  for (let index = 0; index < 12; index += 1) {
    recordCompletedSeason({ ...campaign, seasonId: `season-${index}` }, storage, index);
  }
  const archive = loadSeasonArchive(storage);
  assert.equal(archive.length, 10);
  assert.equal(archive[0].id, 'season-11');
  assert.equal(archive.at(-1).id, 'season-2');
});

test('keeps the completed-season archive when clearing the active campaign', () => {
  const storage = new MemoryStorage();
  const campaign = completedCampaign();
  recordCompletedSeason(campaign, storage, 1234);
  saveCampaign(campaign, storage);
  assert.equal(clearCampaign(storage), true);
  assert.equal(storage.getItem('rhythm-campus-band-save'), null);
  assert.equal(loadSeasonArchive(storage).length, 1);
});

test('leaves the completed season playable when archive storage fails', () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error('storage blocked'); };
  assert.equal(recordCompletedSeason(completedCampaign(), storage, 1234), false);
});

test('does not clear a completed season until its archive can be saved', () => {
  const storage = new MemoryStorage();
  const campaign = completedCampaign();
  saveCampaign(campaign, storage);
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === KEY) throw new Error('quota exceeded');
    setItem(key, value);
  };

  assert.equal(restartCompletedSeason(campaign, storage), false);
  assert.equal(loadCampaign(storage).campaign.seasonId, campaign.seasonId);
  assert.deepEqual(loadSeasonArchive(storage), []);

  storage.setItem = setItem;
  assert.equal(restartCompletedSeason(campaign, storage), true);
  assert.equal(loadCampaign(storage).recovered, true);
  assert.equal(loadSeasonArchive(storage).length, 1);
});

test('keeps the restart flow safe when localStorage access itself throws', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage unavailable'); },
  });

  try {
    assert.doesNotThrow(() => assert.equal(restartCompletedSeason(completedCampaign()), false));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
