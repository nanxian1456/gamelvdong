export const LANE_KEYS = Object.freeze(['d', 'f', 'j', 'k']);

export function laneForKey(key) {
  return LANE_KEYS.indexOf(String(key ?? '').toLowerCase());
}
