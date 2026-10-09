export const LANE_KEYS = Object.freeze(['a', 's', 'd', 'f', 'h', 'j', 'k', 'l']);

export function laneForKey(key) {
  return LANE_KEYS.indexOf(String(key ?? '').toLowerCase());
}
