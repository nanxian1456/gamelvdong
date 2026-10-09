const PREFERENCES_KEY = 'rhythm-campus-band-preferences';
const PREFERENCES_VERSION = 1;

const DEFAULT_PREFERENCES = Object.freeze({
  muted: false,
  volume: 100,
  reduceMotion: false,
  offsetMs: 0,
});

function resolveStorage(storage) {
  return storage ?? globalThis.localStorage;
}

function normalizePreferences(value) {
  const volume = Number(value?.volume);
  const normalized = {
    muted: value?.muted === true,
    volume: Number.isFinite(volume) ? Math.round(Math.max(0, Math.min(100, volume))) : 100,
    reduceMotion: value?.reduceMotion === true,
  };
  if (value != null && Object.prototype.hasOwnProperty.call(value, 'offsetMs')) {
    const offset = Number(value.offsetMs);
    normalized.offsetMs = Number.isFinite(offset) ? Math.round(Math.max(-150, Math.min(150, offset))) : 0;
  }
  return normalized;
}

export function loadPreferences(storage) {
  try {
    const target = resolveStorage(storage);
    const raw = target?.getItem(PREFERENCES_KEY);
    if (raw === null || raw === undefined) return { ...DEFAULT_PREFERENCES };
    const record = JSON.parse(raw);
    if (record?.version !== PREFERENCES_VERSION || !record.preferences || typeof record.preferences !== 'object') {
      return { ...DEFAULT_PREFERENCES };
    }
    return normalizePreferences(record.preferences);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences, storage) {
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    target.setItem(PREFERENCES_KEY, JSON.stringify({
      version: PREFERENCES_VERSION,
      preferences: normalizePreferences(preferences),
    }));
    return true;
  } catch {
    return false;
  }
}
