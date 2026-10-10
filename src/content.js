import { LANE_KEYS } from './lane-input.js';

function makeShow(id, title, bpm, variant) {
  const beatDuration = 60_000 / bpm;
  const ms = beat => Math.round(beat * beatDuration);
  const sections = [
    { id: 'intro', name: '前奏', startMs: 0 },
    { id: 'verse', name: '主段', startMs: ms(8) },
    { id: 'chorus', name: '合奏', startMs: ms(32) },
    { id: 'outro', name: '收尾', startMs: ms(56) },
  ];
  const scale = [60, 62, 64, 67, 69, 72, 74, 76];
  const motif = [0, 2, 3, 2, 1, 3, 4, 2];
  const chart = [];
  const music = [];
  const tone = (voice, beat, duration, midi, volume, type = 'triangle') => music.push({
    voice, atMs: ms(beat), durationMs: ms(duration),
    frequency: 440 * 2 ** ((midi - 69) / 12), volume, type,
  });
  // Twelve playable bars: spacious phrases first, then a denser chorus.
  for (let bar = 2; bar < 14; bar += 1) {
    const offsets = bar < 6 ? [0, 2] : [0, 1, 2.5];
    for (const [position, offset] of offsets.entries()) {
      const index = chart.length;
      const pitchIndex = (motif[index % 8] + variant * 2 + Math.floor(index / 8)) % 8;
      const lane = Math.floor(pitchIndex / 2);
      const hold = position === offsets.length - 1 && bar % 2 === 1;
      const duration = hold ? (offset === 2 ? 1.5 : 0.75) : 0.35;
      const note = { id: `${id}-note-${String(index + 1).padStart(2, '0')}`,
        type: hold ? 'hold' : 'tap', hitMs: ms(bar * 4 + offset), x: (lane + 0.5) / LANE_KEYS.length };
      if (hold) note.durationMs = ms(duration);
      chart.push(note);
      tone('melody', bar * 4 + offset, duration, scale[pitchIndex], 0.055);
    }
  }
  const roots = [48, 45, 53, 55];
  for (let bar = 0; bar < 16; bar += 1) {
    const root = bar === 15 ? 48 : bar === 14 ? 55 : roots[(bar + variant) % roots.length];
    const outro = bar >= 14;
    tone('bass', bar * 4, 1.7, root - 12, 0.055, 'sine');
    if (!outro) tone('bass', bar * 4 + 2, 1.4, root - 12, 0.04, 'sine');
    for (const interval of [0, root === 45 ? 3 : 4, 7]) tone('harmony', bar * 4, 3.7, root + interval, 0.012, 'sine');
    if (bar < 2 || outro) tone('melody', bar * 4, outro ? 3 : 1, root + 24, 0.045);
    for (let beat = 0; beat < (outro ? 2 : 4); beat += 1) {
      tone(beat % 2 === 0 ? 'kick' : 'snare', bar * 4 + beat,
        beat % 2 === 0 ? 0.16 : 0.07, beat % 2 === 0 ? 30 : 74,
        beat % 2 === 0 ? 0.065 : 0.018, beat % 2 === 0 ? 'sine' : 'square');
      if (bar >= 2 && !outro) {
        for (const half of [0, 0.5]) tone('hat', bar * 4 + beat + half, 0.025, 100, 0.008, 'square');
      }
    }
  }
  music.sort((a, b) => a.atMs - b.atMs);
  return { id, title, bpm, beatsMs: chart.map(note => note.hitMs), chart,
    music, sections, durationMs: ms(64) };
}

export const SHOWS = [
  makeShow('recruitment', '招新试听', 100, 0),
  makeShow('club-night', '社团之夜', 110, 1),
  makeShow('welcome-stage', '迎新舞台', 120, 2),
];

// A separate rehearsal: never append this chart to the three-show season.
export const TUTORIAL_DIFFICULTY = {
  id: 'tutorial', name: '新手练习', speedMultiplier: 0.65,
  goodWindowMs: 320, perfectWindowMs: 180, scoreMultiplier: 1, rewardMultiplier: 0,
};

function makeTutorialShow() {
  const lanes = [0, 0, 0, 0, 1, 2, 3, 0, 1, 2, 3];
  const times = [4000, 6000, 8000, 12000, 14000, 16000, 18000, 22000, 24000, 26000, 28000];
  const chart = lanes.map((lane, i) => ({
    id: `tutorial-${i + 1}`, type: i < 7 ? 'tap' : 'hold',
    hitMs: times[i], x: (lane + 0.5) / LANE_KEYS.length,
    ...(i < 7 ? {} : { durationMs: 1000 }),
  }));
  const music = chart.map((note, i) => ({
    voice: 'melody', atMs: note.hitMs, durationMs: note.durationMs ?? 300,
    frequency: [261.63, 329.63, 392, 523.25][lanes[i]], volume: 0.055, type: 'triangle',
  }));
  for (let beat = 0; beat < 30; beat += 1) {
    music.push({ voice: 'kick', atMs: beat * 1000, durationMs: 120,
      frequency: 55, volume: 0.035, type: 'sine' });
  }
  return {
    id: 'tutorial', title: '新手练习', bpm: 60, durationMs: 30000,
    chart, beatsMs: times, music: music.sort((a, b) => a.atMs - b.atMs),
    sections: [
      { id: 'tap', name: '单键点击', startMs: 0, instruction: '① 先练 D 键：音符到白线时按一下，触屏点最左边按键。' },
      { id: 'switch', name: '四键切换', startMs: 10000, instruction: '② 练习四键切换：从左到右对应 D F J K，看准音符所在轨道。' },
      { id: 'hold', name: '长按练习', startMs: 20000, instruction: '③ 长音符到白线时按住，等尾部到白线再松开。' },
    ],
  };
}

export const TUTORIAL_SHOW = makeTutorialShow();

export const DIFFICULTIES = [
  {
    id: 'easy',
    name: '轻松',
    description: '判定更宽 · 得分与经费 ×0.9',
    speedMultiplier: 0.85,
    goodWindowMs: 230,
    perfectWindowMs: 130,
    scoreMultiplier: 0.9,
    rewardMultiplier: 0.9,
  },
  {
    id: 'standard',
    name: '标准',
    description: '经典判定 · 原始得分与经费',
    speedMultiplier: 1,
    goodWindowMs: 170,
    perfectWindowMs: 90,
    scoreMultiplier: 1,
    rewardMultiplier: 1,
  },
  {
    id: 'spotlight',
    name: '聚光灯',
    description: '判定更严 · 得分与经费 ×1.25',
    speedMultiplier: 1.2,
    goodWindowMs: 130,
    perfectWindowMs: 70,
    scoreMultiplier: 1.25,
    rewardMultiplier: 1.25,
  },
];

export function getDifficulty(id) {
  return DIFFICULTIES.find((difficulty) => difficulty.id === id)
    ?? DIFFICULTIES.find((difficulty) => difficulty.id === 'standard');
}

export const TRAINING_BONUS = 45;

export const ACTIONS = [
  { id: 'train', name: '加练合奏', description: '花费 30，下场固定额外获得 45 经费，净赚 15。', cost: 30 },
  { id: 'promote', name: '校园宣传', description: '乐队热度增加 20。', cost: 20 },
  { id: 'recruit', name: '招募新成员', description: '乐队人数增加 1，最多 5 人。', cost: 40 },
  { id: 'rest', name: '整理器材', description: '不消耗经费，直接准备下一场。', cost: 0 },
];
