import { LANE_KEYS } from './lane-input.js';

export const LANE_COUNT = LANE_KEYS.length;
const JUDGMENT_LINE_Y = 0.84;

export function getStageGeometry(width, height) {
  const lineY = height * JUDGMENT_LINE_Y;
  return {
    width,
    height,
    laneCount: LANE_COUNT,
    laneWidth: width / LANE_COUNT,
    lineY,
    lineStart: { x: 0, y: lineY },
    lineEnd: { x: width, y: lineY },
  };
}

export function laneForX(geometry, normalizedX) {
  const x = Math.max(0, Math.min(1, normalizedX));
  return Math.min(geometry.laneCount - 1, Math.floor(x * geometry.laneCount));
}

export function pointOnLine(geometry, normalizedX) {
  const lane = laneForX(geometry, normalizedX);
  return {
    lane,
    x: (lane + 0.5) * geometry.laneWidth,
    y: geometry.lineY,
  };
}
