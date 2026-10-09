import test from 'node:test';
import assert from 'node:assert/strict';

const preferences = await import('../src/preferences.js').catch(() => null);

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test('persists settings separately and clamps the volume to its supported range', () => {
  assert.equal(typeof preferences?.loadPreferences, 'function');
  assert.equal(typeof preferences?.savePreferences, 'function');
  const storage = memoryStorage();

  assert.deepEqual(preferences.loadPreferences(storage), {
    muted: false,
    volume: 100,
    reduceMotion: false,
    offsetMs: 0,
  });
  assert.equal(preferences.savePreferences({ muted: true, volume: 135, reduceMotion: true, offsetMs: 0 }, storage), true);

  assert.deepEqual(preferences.loadPreferences(storage), {
    muted: true,
    volume: 100,
    reduceMotion: true,
    offsetMs: 0,
  });
  assert.deepEqual([...storage.values.keys()], ['rhythm-campus-band-preferences']);
});

test('recovers malformed or unavailable preferences with safe defaults', () => {
  assert.equal(typeof preferences?.loadPreferences, 'function');
  const storage = memoryStorage();
  storage.values.set('rhythm-campus-band-preferences', '{broken json');
  assert.deepEqual(preferences.loadPreferences(storage), {
    muted: false,
    volume: 100,
    reduceMotion: false,
    offsetMs: 0,
  });

  const unavailable = { getItem() { throw new Error('storage unavailable'); } };
  assert.deepEqual(preferences.loadPreferences(unavailable), {
    muted: false,
    volume: 100,
    reduceMotion: false,
    offsetMs: 0,
  });
});

test('reports preference save failures without throwing', () => {
  assert.equal(typeof preferences?.savePreferences, 'function');
  const unavailable = { setItem() { throw new Error('storage unavailable'); } };

  assert.equal(preferences.savePreferences({ muted: false, volume: 50, reduceMotion: false }, unavailable), false);
});
