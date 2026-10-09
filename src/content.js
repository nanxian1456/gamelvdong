function makeShow(id, title, bpm, accents) {
  const beatDuration = 60_000 / bpm;
  const beatsMs = Array.from({ length: 32 }, (_, index) => {
    const position = index + 1 + accents[index % accents.length];
    return Math.round(position * beatDuration);
  });
  const pattern = ['tap', 'tap', 'tap', 'hold', 'tap', 'hold', 'tap', 'tap'];
  const seed = ['recruitment', 'club-night', 'welcome-stage'].indexOf(id);
  const chart = beatsMs.map((hitMs, index) => {
    const type = pattern[index % pattern.length];
    const x = ((index * 7 + seed * 3) % 19 + 1) / 20;
    const note = {
      id: `${id}-note-${String(index + 1).padStart(2, '0')}`,
      type,
      hitMs,
      x,
    };

    if (type === 'hold') note.durationMs = 220;

    return note;
  });

  return { id, title, bpm, beatsMs, chart };
}

export const SHOWS = [
  makeShow('recruitment', '招新试听', 100, [0, 0, 0.15, 0, 0, 0.25, 0, 0]),
  makeShow('club-night', '社团之夜', 110, [0, 0.2, 0, 0, 0.3, 0, 0.15, 0]),
  makeShow('welcome-stage', '迎新舞台', 120, [0, 0.25, 0, 0.15, 0, 0.3, 0, 0.2]),
];

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

export const ACTIONS = [
  { id: 'train', name: '加练合奏', description: '下一场演出额外获得 15 经费。', cost: 30 },
  { id: 'promote', name: '校园宣传', description: '乐队热度增加 20。', cost: 20 },
  { id: 'recruit', name: '招募新成员', description: '乐队人数增加 1，最多 5 人。', cost: 40 },
  { id: 'rest', name: '整理器材', description: '不消耗经费，直接准备下一场。', cost: 0 },
];
