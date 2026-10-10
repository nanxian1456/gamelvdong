import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, newCampaign, settleShow, startCampaign } from '../src/progression.js';
import { clearCampaign, loadCampaign, saveCampaign } from '../src/storage.js';

const KEY = 'rhythm-campus-band-save';

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test('upgrades the pending bonus of a legacy paid training without charging again', () => {
  const storage = new MemoryStorage();
  let campaign = settleShow(startCampaign(newCampaign()), { score: 0, accuracy: 0, rank: 'C', comboMax: 0 });
  campaign = applyAction({ ...campaign, credits: 100 }, 'train').campaign;
  campaign.nextShowCreditBonus = 15;
  saveCampaign(campaign, storage);
  const loaded = loadCampaign(storage).campaign;
  assert.equal(loaded.credits, 70);
  assert.equal(loaded.nextShowCreditBonus, 45);
  assert.equal(loadCampaign(storage).campaign.nextShowCreditBonus, 45);
});

test('round-trips campaign state through a versioned local record', () => {
  const storage = new MemoryStorage();
  const campaign = settleShow(startCampaign(newCampaign()), {
    score: 25_000,
    accuracy: 0.78125,
    rank: 'B',
    comboMax: 8,
  });
  campaign.credits = 42;
  assert.equal(saveCampaign(campaign, storage), true);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { version: 1, campaign });
  assert.deepEqual(loadCampaign(storage), { campaign, recovered: false });
});

test('round-trips a campaign containing a completed show result', () => {
  const storage = new MemoryStorage();
  const campaign = settleShow(startCampaign(newCampaign()), {
    score: 25_000,
    accuracy: 0.78125,
    rank: 'B',
    comboMax: 8,
  });
  assert.equal(saveCampaign(campaign, storage), true);
  assert.deepEqual(loadCampaign(storage), { campaign, recovered: false });
});

test('loads a legacy version-1 save without newer optional fields and retains version 1', () => {
  const storage = new MemoryStorage();
  const campaign = settleShow(startCampaign(newCampaign()), {
    score: 25_000,
    accuracy: 0.78125,
    rank: 'B',
    comboMax: 8,
  });
  delete campaign.difficulty;
  delete campaign.seasonId;
  storage.setItem(KEY, JSON.stringify({ version: 1, campaign }));

  const loaded = loadCampaign(storage);
  const saved = JSON.parse(storage.getItem(KEY));
  assert.equal(loaded.recovered, false);
  assert.equal(loaded.campaign.difficulty, 'standard');
  assert.equal(typeof loaded.campaign.seasonId, 'string');
  assert.equal(saved.version, 1);
  assert.deepEqual(Object.keys(saved.campaign.showResults[0]).sort(),
    ['accuracy', 'comboMax', 'credits', 'popularity', 'rank', 'score']);
});

test('starts a fresh playable campaign when the save key is missing', () => {
  const loaded = loadCampaign(new MemoryStorage());
  assert.deepEqual(loaded.campaign, newCampaign());
  assert.equal(loaded.recovered, true);
});

test('recovers from malformed JSON and unsupported save versions', () => {
  const storage = new MemoryStorage();
  storage.setItem(KEY, '{broken');
  assert.deepEqual(loadCampaign(storage), { campaign: newCampaign(), recovered: true });

  storage.setItem(KEY, JSON.stringify({ version: 99, campaign: newCampaign() }));
  assert.deepEqual(loadCampaign(storage), { campaign: newCampaign(), recovered: true });
});

test('rejects malformed campaign fields instead of restoring invalid state', () => {
  const storage = new MemoryStorage();
  storage.setItem(KEY, JSON.stringify({
    version: 1,
    campaign: { ...newCampaign(), credits: 'a lot' },
  }));
  assert.deepEqual(loadCampaign(storage), { campaign: newCampaign(), recovered: true });
});

test('recovers when phase, show index, results, and action history cannot occur together', () => {
  const storage = new MemoryStorage();
  storage.setItem(KEY, JSON.stringify({
    version: 1,
    campaign: {
      ...newCampaign(),
      phase: 'management',
      showIndex: 2,
      showResults: [],
    },
  }));
  assert.deepEqual(loadCampaign(storage), { campaign: newCampaign(), recovered: true });
});

test('contains storage read, write, and removal exceptions', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.deepEqual(loadCampaign(broken), { campaign: newCampaign(), recovered: true });
  const campaign = Object.freeze(newCampaign());
  assert.equal(saveCampaign(campaign, broken), false);
  assert.equal(clearCampaign(broken), false);
  assert.deepEqual(campaign, newCampaign());
});

test('clears only this game save and reports success', () => {
  const storage = new MemoryStorage();
  storage.setItem(KEY, 'save');
  storage.setItem('other-app', 'keep');
  assert.equal(clearCampaign(storage), true);
  assert.equal(storage.getItem(KEY), null);
  assert.equal(storage.getItem('other-app'), 'keep');
});
