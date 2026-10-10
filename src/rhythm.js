import { SHOWS } from './content.js';
import { LANE_KEYS, laneForKey } from './lane-input.js';

const GOOD_WINDOW_MS = 170;
const PERFECT_WINDOW_MS = 90;
const CUE_LEAD_MS = 800;
const HOLD_RELEASE_GRACE_MS = 80;
const BASE_POINTS = { perfect: 1000, good: 650, miss: 0 };
const STAGE_MULTIPLIERS = [1, 1.25, 1.5];

function makeRuntimeState(chart, stageIndex) {
  return {
    chart,
    stageIndex,
    laneOf: chart.map((note) => laneForRatio(note?.x)),
    noteStates: chart.map(() => ({ status: 'pending', judgement: null })),
    results: [],
    score: 0,
    combo: 0,
    comboMax: 0,
    accuracyPoints: 0,
    activeInputs: new Map(),
    finished: chart.length === 0,
    heldKeys: new Set(),
  };
}

export function createRhythmRuntime(chart, stageIndex = 0) {
  const notes = Array.isArray(chart) ? chart : chart?.chart ?? [];
  return makeRuntimeState(notes, stageIndex);
}

function laneForRatio(normalizedX) {
  const x = Math.max(0, Math.min(1, Number.isFinite(normalizedX) ? normalizedX : 0));
  return Math.min(LANE_KEYS.length - 1, Math.floor(x * LANE_KEYS.length));
}

function noteLane(note, width, laneOf, index) {
  if (Array.isArray(laneOf) && Number.isInteger(laneOf[index])) return laneOf[index];
  if (note && Number.isInteger(note.lane)) return note.lane;
  return laneForRatio(note?.x);
}

function runtimeLane(runtime, index) {
  return noteLane(runtime.chart[index], 0, runtime.laneOf, index);
}

function inputLane(input, width) {
  if (Number.isInteger(input?.lane) && input.lane >= 0 && input.lane < LANE_KEYS.length) return input.lane;
  if (!Number.isFinite(input?.x)) return -1;
  return laneForRatio(input.x);
}

function inputSource(input) {
  if (input.type.startsWith('pointer-')) return `pointer:${input.pointerId ?? 'primary'}`;
  return `key:${input.key}`;
}

function hasActiveInputForNote(runtime, noteIndex) {
  for (const input of runtime.activeInputs.values()) {
    if (input.noteIndex === noteIndex) return true;
  }
  return false;
}

function heldNoteSet(runtime) {
  const held = new Set();
  for (const input of runtime.activeInputs.values()) {
    if (input.noteIndex != null) held.add(input.noteIndex);
  }
  return held;
}

function effectivePlayhead(playheadMs, difficulty) {
  return playheadMs - (Number.isFinite(difficulty?.offsetMs) ? difficulty.offsetMs : 0);
}

function recordResult(runtime, index, judgement, difficulty = {}, deltaMs = null) {
  const state = runtime.noteStates[index];
  if (!state || state.status === 'resolved') return;
  state.status = 'resolved';
  state.judgement = judgement;
  const base = BASE_POINTS[judgement];
  runtime.combo = judgement === 'miss' ? 0 : runtime.combo + 1;
  runtime.comboMax = Math.max(runtime.comboMax, runtime.combo);
  runtime.accuracyPoints += base;
  runtime.score += Math.round(base * (STAGE_MULTIPLIERS[runtime.stageIndex] ?? 1)
    * (difficulty.scoreMultiplier ?? 1)) + (judgement === 'miss' ? 0 : runtime.combo * 10);
  runtime.results.push({ noteIndex: index, judgement, deltaMs,
    timing: deltaMs == null ? null : (deltaMs < -8 ? 'early' : deltaMs > 8 ? 'late' : 'on') });
  runtime.finished = runtime.results.length === runtime.chart.length;
}

export function timingLabel(timing) {
  return timing === 'early' ? '偏快' : timing === 'late' ? '偏慢' : '';
}

function judgeHead(runtime, index, lane, source, playheadMs, difficulty, width) {
  const note = runtime.chart[index];
  if (!note || runtime.noteStates[index].status !== 'pending'
    || runtimeLane(runtime, index) !== lane) return false;
  const adjusted = effectivePlayhead(playheadMs, difficulty);
  const signed = adjusted - note.hitMs;
  const goodWindow = difficulty.goodWindowMs ?? GOOD_WINDOW_MS;
  if (Math.abs(signed) > goodWindow) return false;
  const judgement = Math.abs(signed) <= (difficulty.perfectWindowMs ?? PERFECT_WINDOW_MS) ? 'perfect' : 'good';
  if (note.type === 'hold') {
    runtime.noteStates[index].status = 'sustaining';
    runtime.noteStates[index].judgement = judgement;
    runtime.noteStates[index].releasedAt = null;
    runtime.activeInputs.set(source, { lane, noteIndex: index });
  } else {
    recordResult(runtime, index, judgement, difficulty, signed);
  }
  return true;
}

function pressLane(runtime, lane, source, playheadMs, difficulty, width) {
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANE_KEYS.length || runtime.activeInputs.has(source)) return;
  const adjusted = effectivePlayhead(playheadMs, difficulty);
  for (let index = 0; index < runtime.chart.length; index += 1) {
    if (runtime.noteStates[index].status === 'sustaining' && runtimeLane(runtime, index) === lane) {
      runtime.activeInputs.set(source, { lane, noteIndex: index });
      return;
    }
  }

  runtime.activeInputs.set(source, { lane, noteIndex: null });
  const goodWindow = difficulty.goodWindowMs ?? GOOD_WINDOW_MS;
  let best = -1;
  let bestDelta = Infinity;
  for (let index = 0; index < runtime.chart.length; index += 1) {
    if (runtime.noteStates[index].status !== 'pending') continue;
    if (runtimeLane(runtime, index) !== lane) continue;
    const delta = Math.abs(adjusted - runtime.chart[index].hitMs);
    if (delta <= goodWindow && delta < bestDelta) { bestDelta = delta; best = index; }
  }
  if (best >= 0) judgeHead(runtime, best, lane, source, playheadMs, difficulty, width);
}

function releaseInput(runtime, source, playheadMs, difficulty, width, height) {
  const activeInput = runtime.activeInputs.get(source);
  if (!activeInput) return;
  const adjusted = effectivePlayhead(playheadMs, difficulty);
  advanceRhythmRuntime(runtime, playheadMs, 0, difficulty, width, height);
  runtime.activeInputs.delete(source);
  const { noteIndex } = activeInput;
  const state = noteIndex != null ? runtime.noteStates[noteIndex] : null;
  if (state && state.status === 'sustaining' && !hasActiveInputForNote(runtime, noteIndex)) {
    state.releasedAt = adjusted;
  }
}

function movePointer(runtime, source, lane, playheadMs, difficulty, width) {
  const active = runtime.activeInputs.get(source);
  if (!active) return;
  if (Number.isInteger(lane) && lane >= 0 && lane < LANE_KEYS.length) active.lane = lane;
  if (active.noteIndex == null && Number.isInteger(active.lane)) {
    const adjusted = effectivePlayhead(playheadMs, difficulty);
    const goodWindow = difficulty.goodWindowMs ?? GOOD_WINDOW_MS;
    let best = -1;
    let bestDelta = Infinity;
    for (let index = 0; index < runtime.chart.length; index += 1) {
      if (runtime.noteStates[index].status !== 'pending') continue;
      if (runtimeLane(runtime, index) !== active.lane) continue;
      const delta = Math.abs(adjusted - runtime.chart[index].hitMs);
      if (delta <= goodWindow && delta < bestDelta) { bestDelta = delta; best = index; }
    }
    if (best >= 0) judgeHead(runtime, best, active.lane, source, playheadMs, difficulty, width);
  }
}

export function processRhythmInput(runtime, input, playheadMs, difficulty = {}, fieldWidthCssPx = 400, fieldHeightCssPx = 400) {
  if (input?.type === 'reset') {
    runtime.heldKeys.clear();
    runtime.activeInputs.clear();
    return runtime;
  }
  if (input?.type === 'key-down' || input?.type === 'key-up') {
    const down = input.type === 'key-down';
    const lane = laneForKey(input.key);
    if (lane < 0) return runtime;
    const source = inputSource(input);
    if (down) {
      runtime.heldKeys.add(input.key);
      pressLane(runtime, lane, source, playheadMs, difficulty, fieldWidthCssPx);
    } else {
      runtime.heldKeys.delete(input.key);
      releaseInput(runtime, source, playheadMs, difficulty, fieldWidthCssPx, fieldHeightCssPx);
    }
    return runtime;
  }

  if (input?.type === 'pointer-down') {
    const lane = inputLane(input, fieldWidthCssPx);
    pressLane(runtime, lane, inputSource(input), playheadMs, difficulty, fieldWidthCssPx);
  } else if (input?.type === 'pointer-move') {
    const lane = Number.isInteger(input.lane) ? input.lane : inputLane(input, fieldWidthCssPx);
    movePointer(runtime, inputSource(input), lane, playheadMs, difficulty, fieldWidthCssPx);
  } else if (input?.type === 'pointer-up') {
    releaseInput(runtime, inputSource(input), playheadMs, difficulty, fieldWidthCssPx, fieldHeightCssPx);
  }
  return runtime;
}

export function advanceRhythmRuntime(runtime, playheadMs, deltaMs, difficulty = {}, fieldWidthCssPx = 400, fieldHeightCssPx = fieldWidthCssPx) {
  const adjusted = effectivePlayhead(playheadMs, difficulty);
  const held = heldNoteSet(runtime);
  for (let index = 0; index < runtime.chart.length; index += 1) {
    const note = runtime.chart[index];
    const state = runtime.noteStates[index];
    if (state.status === 'pending') {
      if (adjusted > note.hitMs + (difficulty.goodWindowMs ?? GOOD_WINDOW_MS)) {
        recordResult(runtime, index, 'miss', difficulty, adjusted - note.hitMs);
      }
      continue;
    }
    if (state.status !== 'sustaining') continue;
    const endMs = note.hitMs + (note.durationMs ?? 0);
    if (held.has(index)) {
      state.releasedAt = null;
    } else if (state.releasedAt == null) {
      state.releasedAt = adjusted;
    } else if (adjusted - state.releasedAt > HOLD_RELEASE_GRACE_MS && adjusted < endMs - HOLD_RELEASE_GRACE_MS) {
      recordResult(runtime, index, 'miss', difficulty, 0);
      continue;
    }
    if (adjusted >= endMs) {
      const heldToEnd = state.releasedAt == null || (endMs - state.releasedAt) <= HOLD_RELEASE_GRACE_MS;
      recordResult(runtime, index, heldToEnd ? state.judgement : 'miss', difficulty, 0);
    }
  }
  runtime.finished = runtime.results.length === runtime.chart.length;
  return runtime;
}

export function getRhythmSummary(runtime, difficulty = {}) {
  const total = runtime.chart.length;
  const accuracy = total === 0 ? 0 : runtime.accuracyPoints / (total * 1000);
  const rank = accuracy >= 0.95 ? 'S'
    : accuracy >= 0.82 ? 'A'
      : accuracy >= 0.65 ? 'B' : 'C';
  return { score: runtime.score, accuracy, rank, comboMax: runtime.comboMax };
}

export function getNextBeatCue(beatsMs, judged, playheadMs, goodWindowMs = GOOD_WINDOW_MS) {
  for (let index = 0; index < beatsMs.length; index += 1) {
    if (judged[index]) continue;
    const remainingMs = beatsMs[index] - playheadMs;
    if (remainingMs > CUE_LEAD_MS) return null;
    if (remainingMs < -goodWindowMs) continue;
    const clampedRemaining = Math.max(0, remainingMs);
    return {
      index,
      beatMs: beatsMs[index],
      remainingMs: clampedRemaining,
      progress: 1 - clampedRemaining / CUE_LEAD_MS,
    };
  }
  return null;
}

export function getShowBeatCue(showIndex, judged, playheadMs, difficulty = {}) {
  const show = SHOWS[showIndex];
  return show
    ? getNextBeatCue(show.beatsMs, judged, playheadMs, difficulty.goodWindowMs ?? GOOD_WINDOW_MS)
    : null;
}

export function judgeInput(beatsMs, judged, inputMs, difficulty = {}) {
  const goodWindowMs = difficulty.goodWindowMs ?? GOOD_WINDOW_MS;
  const perfectWindowMs = difficulty.perfectWindowMs ?? PERFECT_WINDOW_MS;
  let closest = null;

  for (let index = 0; index < beatsMs.length; index += 1) {
    if (judged[index]) continue;
    const deltaMs = inputMs - beatsMs[index];
    const distance = Math.abs(deltaMs);

    if (distance <= goodWindowMs && (!closest || distance < closest.distance)) {
      closest = { index, deltaMs, distance };
    }
  }

  if (!closest) return null;
  return {
    index: closest.index,
    deltaMs: closest.deltaMs,
    judgement: closest.distance <= perfectWindowMs ? 'perfect' : 'good',
  };
}

export function expireMisses(beatsMs, judged, playheadMs, difficulty = {}) {
  const goodWindowMs = difficulty.goodWindowMs ?? GOOD_WINDOW_MS;
  return beatsMs.flatMap((beatMs, index) => (
    !judged[index] && playheadMs > beatMs + goodWindowMs ? [index] : []
  ));
}

export function getDisplayedScore(rawScore, difficulty = {}) {
  return Math.round(rawScore * (difficulty.scoreMultiplier ?? 1));
}

export function summarizePerformance(results, difficulty = {}) {
  let score = 0;
  let rawScore = 0;
  let combo = 0;
  let comboMax = 0;

  for (const { judgement } of results) {
    if (judgement === 'perfect') rawScore += 1000;
    if (judgement === 'good') rawScore += 650;
    combo = judgement === 'miss' ? 0 : combo + 1;
    comboMax = Math.max(comboMax, combo);
  }

  const accuracy = results.length === 0 ? 0 : rawScore / (results.length * 1000);
  score = getDisplayedScore(rawScore, difficulty);
  const rank = accuracy >= 0.95 ? 'S'
    : accuracy >= 0.82 ? 'A'
      : accuracy >= 0.65 ? 'B' : 'C';

  return { score, accuracy, rank, comboMax };
}
