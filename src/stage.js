import {
  LANE_COUNT,
  getStageGeometry as calculateStageGeometry,
  pointOnLine,
} from './stage-geometry.js';

export function resizeStageCanvas(app, devicePixelRatio = globalThis.devicePixelRatio || 1) {
  const canvas = app.querySelector('#stage-art');
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const nextWidth = Math.max(1, Math.round(bounds.width * ratio));
  const nextHeight = Math.max(1, Math.round(bounds.height * ratio));
  if (canvas.width === nextWidth && canvas.height === nextHeight) return;
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
  cachedLayer.canvas = null;
}

const NOTE_TRAVEL_MS = 1500;
// 霓虹夜场主题：深紫底 + 金色点音符 + 青色长音 + 薄荷判定光
const COLORS = {
  background: '#0b0714',
  line: '#f5f3ff',
  lineGlow: '#43d8bc',
  lineHot: '#f2c64f',
  lineMiss: '#f36e62',
  cursor: '#43d8bc',
  lane: 'rgba(178,132,255,0.14)',
  tap: '#f2c64f',
  tapHalo: 'rgba(242,198,79,0.28)',
  hold: '#22d8ee',
  holdHalo: 'rgba(34,216,238,0.25)',
};

export function getStageGeometry(app) {
  const canvas = app.querySelector('#stage-art');
  if (!canvas) return null;
  const bounds = canvas.getBoundingClientRect();
  return calculateStageGeometry(bounds.width, bounds.height);
}

function noteY(targetY, eventMs, playheadMs, speedMultiplier, spawnY) {
  const travelMs = NOTE_TRAVEL_MS / speedMultiplier;
  return spawnY + (targetY - spawnY) * (1 - (eventMs - playheadMs) / travelMs);
}

const cachedLayer = { canvas: null, width: 0, height: 0, key: '' };

function renderStaticLayer(width, height, geometry) {
  if (typeof document === 'undefined') return null;
  const key = `${width}x${height}`;
  if (cachedLayer.canvas && cachedLayer.key === key) return cachedLayer.canvas;
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(width));
  layer.height = Math.max(1, Math.round(height));
  const context = layer.getContext('2d');
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = COLORS.lane;
  context.lineWidth = 1;
  for (let lane = 1; lane < LANE_COUNT; lane += 1) {
    const laneX = lane * geometry.laneWidth;
    context.beginPath();
    context.moveTo(laneX, 0);
    context.lineTo(laneX, height);
    context.stroke();
  }
  context.strokeStyle = COLORS.line;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(geometry.lineStart.x, geometry.lineStart.y);
  context.lineTo(geometry.lineEnd.x, geometry.lineEnd.y);
  context.stroke();
  cachedLayer.canvas = layer;
  cachedLayer.width = width;
  cachedLayer.height = height;
  cachedLayer.key = key;
  return layer;
}

function drawNote(context, geometry, note, state, playheadMs, speedMultiplier, viewHeight) {
  if (state?.status === 'resolved') return;
  const target = pointOnLine(geometry, note.x);
  const spawnY = 9;
  const y = noteY(target.y, note.hitMs, playheadMs, speedMultiplier, spawnY);
  const durationMs = Math.max(0, note.durationMs ?? 0);

  if (note.type === 'hold') {
    const endY = noteY(target.y, note.hitMs + durationMs, playheadMs, speedMultiplier, spawnY);
    const bodyStartY = state?.status === 'sustaining' ? target.y : y;
    const bodyEndY = state?.status === 'sustaining' ? Math.min(target.y, endY) : endY;
    const top = Math.min(bodyStartY, bodyEndY);
    const bottom = Math.max(bodyStartY, bodyEndY);
    if (bottom < -40 || top > viewHeight + 40) return;
    const blockWidth = geometry.laneWidth * 0.68;
    context.fillStyle = COLORS.holdHalo;
    context.fillRect(target.x - blockWidth / 2 - 3, top - 3, blockWidth + 6, Math.max(8, bottom - top + 6));
    context.fillStyle = COLORS.hold;
    context.fillRect(target.x - blockWidth / 2, top, blockWidth, Math.max(4, bottom - top));
  } else {
    if (y < -40 || y > viewHeight + 40) return;
    const blockWidth = geometry.laneWidth * 0.68;
    context.fillStyle = COLORS.tapHalo;
    context.fillRect(target.x - blockWidth / 2 - 3, y - 10, blockWidth + 6, 20);
    context.fillStyle = COLORS.tap;
    context.fillRect(target.x - blockWidth / 2, y - 7, blockWidth, 14);
  }
}

export function drawStage(app, show, rhythmRuntime, playheadMs, difficulty, { reducedMotion = false, geometry = null, ctx = null, ripples = [], combo = 0, hitFlash = 0, missFlash = 0 } = {}) {
  const canvas = app.querySelector('#stage-art');
  const context = ctx ?? canvas?.getContext('2d');
  const resolvedGeometry = geometry ?? getStageGeometry(app);
  if (!context || !resolvedGeometry) return;
  const { width, height } = resolvedGeometry;
  const currentPlayheadMs = Number.isFinite(playheadMs) ? playheadMs : -NOTE_TRAVEL_MS;
  const speedMultiplier = Number.isFinite(difficulty?.speedMultiplier) && difficulty.speedMultiplier > 0
    ? difficulty.speedMultiplier
    : 1;

  context.clearRect(0, 0, width, height);
  const staticLayer = renderStaticLayer(width, height, resolvedGeometry);
  if (staticLayer) {
    context.drawImage(staticLayer, 0, 0, width, height);
  } else {
    context.fillStyle = COLORS.background;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = COLORS.lane;
    context.lineWidth = 1;
    for (let lane = 1; lane < LANE_COUNT; lane += 1) {
      const laneX = lane * resolvedGeometry.laneWidth;
      context.beginPath();
      context.moveTo(laneX, 0);
      context.lineTo(laneX, height);
      context.stroke();
    }
    context.strokeStyle = COLORS.line;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(resolvedGeometry.lineStart.x, resolvedGeometry.lineStart.y);
    context.lineTo(resolvedGeometry.lineEnd.x, resolvedGeometry.lineEnd.y);
    context.stroke();
  }

  const notes = show?.chart ?? show?.notes ?? [];
  for (let index = 0; index < notes.length; index += 1) {
    drawNote(context, resolvedGeometry, notes[index], rhythmRuntime?.noteStates?.[index], currentPlayheadMs, speedMultiplier, height);
  }

  if (reducedMotion) return;
  context.fillStyle = COLORS.cursor;
  const seen = new Set();
  const activeInputs = rhythmRuntime?.activeInputs;
  if (activeInputs) {
    for (const { lane } of activeInputs.values()) {
      if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_COUNT || seen.has(lane)) continue;
      seen.add(lane);
      context.fillRect(lane * resolvedGeometry.laneWidth, resolvedGeometry.lineY - 4, resolvedGeometry.laneWidth, 8);
    }
  }

  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  const chart = show?.chart ?? show?.notes ?? [];
  for (const ripple of ripples) {
    const age = now - ripple.t0;
    if (age < 0 || age > 650) continue;
    const note = chart[ripple.noteIndex];
    if (!note) continue;
    const progress = age / 650;
    const target = pointOnLine(resolvedGeometry, note.x);
    context.beginPath();
    context.arc(target.x, resolvedGeometry.lineY, 8 + progress * 64, 0, Math.PI * 2);
    context.strokeStyle = ripple.grade === 'perfect' ? COLORS.tap : COLORS.hold;
    context.globalAlpha = (1 - progress) * 0.85;
    context.lineWidth = 3 - progress * 2;
    context.stroke();
    context.globalAlpha = 1;
  }

  if (!reducedMotion) {
    const tier = combo >= 50 ? COLORS.lineHot : combo >= 20 ? COLORS.lineGlow : COLORS.line;
    const glow = Math.max(0, Math.min(1, hitFlash));
    context.beginPath();
    context.moveTo(resolvedGeometry.lineStart.x, resolvedGeometry.lineStart.y);
    context.lineTo(resolvedGeometry.lineEnd.x, resolvedGeometry.lineEnd.y);
    context.strokeStyle = tier;
    context.globalAlpha = 0.35 + glow * 0.65;
    context.lineWidth = 2 + glow * 4;
    context.stroke();
    context.globalAlpha = 1;
    const miss = Math.max(0, Math.min(1, missFlash));
    if (miss > 0) {
      context.beginPath();
      context.moveTo(resolvedGeometry.lineStart.x, resolvedGeometry.lineStart.y);
      context.lineTo(resolvedGeometry.lineEnd.x, resolvedGeometry.lineEnd.y);
      context.strokeStyle = COLORS.lineMiss;
      context.globalAlpha = miss * 0.9;
      context.lineWidth = 2 + miss * 5;
      context.stroke();
      context.globalAlpha = 1;
    }
  }
}
