import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOWS } from '../src/content.js';
import {
  renderEndingView,
  renderHomeView,
  renderManagementView,
  renderPerformanceView,
  renderScheduleView,
  renderSettingsView,
  renderTeamView,
} from '../src/views.js';

const shows = [
  { title: '<招新试听>', bpm: 100 },
  { title: '社团之夜', bpm: 110 },
  { title: '迎新舞台', bpm: 120 },
];

test('first performance offers concise teaching and persistent lane instructions', () => {
  const html = renderPerformanceView({ campaign: campaign({ phase: 'show' }), show: SHOWS[0],
    preferences: { muted: false }, runtime: null });
  assert.match(html, /id="first-play-guide"/);
  assert.match(html, /aria-describedby="performance-instructions"/);
  assert.match(html, /id="performance-instructions"/);
  assert.match(html, /D F J K/);
  assert.match(html, /按住/);
  assert.match(html, /id="retry-performance"/);
});

test('both settlement pages offer a retry of the current show', () => {
  const base = campaign({ phase: 'management', showResults: [{ score: 0, rank: 'C', credits: 20, popularity: 5 }] });
  assert.match(renderManagementView({ campaign: base, saveNotice: '' }), /id="retry-show"/);
  assert.match(renderEndingView({ campaign: { ...base, phase: 'ending' }, ending: { rank: 'Bronze', score: 6 }, saveNotice: '' }), /id="retry-show"/);
});

function campaign(overrides = {}) {
  return {
    phase: 'home',
    showIndex: 0,
    showResults: [],
    actionHistory: [],
    credits: 100,
    popularity: 0,
    members: 3,
    difficulty: 'standard',
    ...overrides,
  };
}

test('home view escapes dynamic copy and presents the active campaign action', () => {
  const html = renderHomeView({
    campaign: campaign({ phase: 'management', showIndex: 0, actionHistory: ['promote'] }),
    seasonArchive: [],
    shows,
    saveNotice: '<存档不可用>',
  });

  assert.match(html, /<h1[^>]*>校园声场<\/h1>/);
  assert.match(html, /data-campaign-action="continue">继续经营<\/button>/);
  assert.match(html, /&lt;招新试听&gt;/);
  assert.match(html, /&lt;存档不可用&gt;/);
  assert.doesNotMatch(html, /<存档不可用>/);
});

test('home keeps one resource group inside the current-season panel without duplicate heat', () => {
  const html = renderHomeView({ campaign: campaign({ credits: 73, popularity: 29 }), seasonArchive: [], shows, saveNotice: '' });
  const overview = html.match(/<section class="home-overview"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.equal((html.match(/aria-label="乐队资源"/g) ?? []).length, 1);
  assert.match(overview, /aria-label="乐队资源"[\s\S]*经费<strong>73<\/strong>[\s\S]*乐队热度<strong>29<\/strong>/);
  assert.doesNotMatch(overview, /当前热度/);
});

test('archive uses the same Chinese season ratings as the finale', () => {
  for (const [rank, label] of [['Gold', '金奖'], ['Silver', '银奖'], ['Bronze', '铜奖'], ['First Stage', '初登舞台']]) {
    const html = renderHomeView({ campaign: campaign(), seasonArchive: [{ rank, score: 12, difficulty: 'standard', completedAt: 1000 }], shows, saveNotice: '' });
    assert.ok(html.includes(` · ${label} · 标准难度`));
    assert.ok(!html.includes(`${label}级`));
  }
});

test('all views display Chinese copy while retaining the four physical key labels', () => {
  const base = campaign({ showResults: [{ score: 12345, rank: 'S', credits: 44, popularity: 25, comboMax: 18 }] });
  const pages = [
    renderHomeView({ campaign: base, seasonArchive: [{ rank: 'Gold', score: 12, difficulty: 'standard', completedAt: 1000 }], shows: SHOWS, saveNotice: '' }),
    renderScheduleView({ campaign: base, shows: SHOWS }),
    renderTeamView({ campaign: base }),
    renderSettingsView({ campaign: base, preferences: { volume: 50, offsetMs: -25 }, preferenceSaveUnavailable: false }),
    renderPerformanceView({ campaign: base, show: SHOWS[0], preferences: { muted: false }, runtime: null }),
    renderManagementView({ campaign: base, saveNotice: '' }),
    ...['Gold', 'Silver', 'Bronze', 'First Stage'].map(rank => renderEndingView({ campaign: base, ending: { rank, score: 12 }, saveNotice: '' })),
  ];
  for (const html of pages) {
    const visibleText = html.replace(/<[^>]*>/g, ' ').replace(/\b[DFJK]\b/g, '');
    assert.doesNotMatch(visibleText, /[a-z]/i);
  }
  assert.match(pages[4], /<kbd>D<\/kbd>[\s\S]*<kbd>F<\/kbd>[\s\S]*<kbd>J<\/kbd>[\s\S]*<kbd>K<\/kbd>/);
  assert.match(pages[3], /-25 毫秒/);
  assert.match(pages[5], /完美共振/);
});

test('schedule view derives completed, current, and locked show states', () => {
  const html = renderScheduleView({
    campaign: campaign({
      phase: 'show',
      showIndex: 1,
      showResults: [{ score: 12345, rank: 'A' }],
      actionHistory: ['rest'],
    }),
    shows,
  });

  assert.match(html, /12,345 分 · 全场合拍/);
  assert.match(html, /✓ 已完成/);
  assert.match(html, /class="show-card is-current"[\s\S]*待演出/);
  assert.match(html, /class="show-card is-locked"[\s\S]*◆ 未解锁/);
  assert.match(html, /第 2 场 \/ 共 3 场/);
});

test('team view renders only recruited members and the management destination', () => {
  const html = renderTeamView({
    campaign: campaign({
      phase: 'management',
      members: 4,
      showResults: [{ score: 0, rank: 'C' }],
      actionHistory: [],
      popularity: 5,
    }),
  });

  assert.match(html, /乐队成员 · 4 \/ 5/);
  assert.match(html, /贝斯/);
  assert.doesNotMatch(html, /采样/);
  assert.match(html, /data-campaign-action="continue">继续经营<\/button>/);
});

test('settings view reflects preferences and exposes a save failure', () => {
  const html = renderSettingsView({
    campaign: campaign({ phase: 'show' }),
    preferences: { muted: true, volume: 35, reduceMotion: true, offsetMs: -25 },
    preferenceSaveUnavailable: true,
  });

  assert.match(html, /id="setting-offset"[^>]*value="-25"/);
  assert.match(html, /id="setting-volume"[^>]*value="35"/);
  assert.match(html, /id="setting-reduced-motion"[^>]*checked/);
  assert.doesNotMatch(html, /id="setting-sound-enabled"[^>]*checked/);
  assert.match(html, /id="settings-save-note" role="status"\s*>设置暂时无法保存/);
});

test('performance view restores an interrupted show without inventing runtime progress', () => {
  const html = renderPerformanceView({
    campaign: campaign({ phase: 'show', showIndex: 0 }),
    show: { title: '<招新试听>', bpm: 100, chart: Array.from({ length: 32 }) },
    runtime: null,
    preferences: { muted: false },
    saveUnavailable: true,
    restoredActiveShow: true,
  });

  assert.match(html, /&lt;招新试听&gt;/);
  assert.match(html, /演出恢复/);
  assert.match(html, /id="start-performance"[^>]*>从本场开始<\/button>/);
  assert.doesNotMatch(html, /id="pause-toggle"/);
  assert.equal((html.match(/class="lane-key"/g) ?? []).length, 4);
  assert.match(html, /id="audio-note">本地记录不可用/);
});

test('management view disables actions the current band cannot take', () => {
  const html = renderManagementView({
    campaign: campaign({
      phase: 'management',
      credits: 20,
      popularity: 5,
      members: 5,
      showResults: [{ score: 12345, rank: 'A', comboMax: 18, credits: 20, popularity: 5 }],
    }),
    saveNotice: '<行动失败>',
  });

  assert.match(html, /12,345 分，最高连击 18/);
  assert.match(html, /data-action="train" disabled/);
  assert.match(html, /data-action="promote"\s*>/);
  assert.match(html, /data-action="recruit" disabled/);
  assert.match(html, /data-action="rest"\s*>/);
  assert.match(html, /&lt;行动失败&gt;/);
});

test('ending view presents the final rank, every show result, and save status', () => {
  const html = renderEndingView({
    campaign: campaign({
      phase: 'ending',
      credits: 75,
      popularity: 80,
      members: 4,
      difficulty: 'spotlight',
      actionHistory: ['promote', 'recruit'],
      showResults: [
        { score: 1000, rank: 'B' },
        { score: 2000, rank: 'A' },
        { score: 3000, rank: 'S' },
      ],
    }),
    ending: { rank: 'Gold', score: 6789 },
    saveNotice: '<档案未保存>',
  });

  assert.match(html, /整座校园都在合拍。/);
  assert.match(html, /金奖 · 团队总评 6789/);
  assert.match(html, /1,000 分[\s\S]*2,000 分[\s\S]*3,000 分/);
  assert.match(html, /剩余经费[\s\S]*75/);
  assert.match(html, /赛季难度[\s\S]*聚光灯/);
  assert.match(html, /&lt;档案未保存&gt;/);
});
