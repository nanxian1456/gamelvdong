import test from 'node:test';
import assert from 'node:assert/strict';

test('refreshing a tutorial route keeps rehearsal separate from the saved season phase', () => {
  for (const phase of ['home', 'show', 'management', 'ending']) {
    assert.equal(getInitialView(phase, '#tutorial'), 'tutorial');
  }
});
import { getInitialView, getNavigationItems } from '../src/navigation.js';

test('keeps home sections available and adds the current campaign destination', () => {
  assert.deepEqual(getNavigationItems('show'), [
    { id: 'home', label: '首页', target: 'home' },
    { id: 'schedule', label: '演出日程', target: 'schedule' },
    { id: 'team', label: '团队阵容', target: 'team' },
    { id: 'campaign', label: '继续演出', target: 'campaign' },
    { id: 'settings', label: '设置', target: 'settings' },
  ]);
});

test('uses the active management or season result as the contextual destination', () => {
  assert.equal(getNavigationItems('management').find(({ id }) => id === 'campaign').label, '继续经营');
  assert.equal(getNavigationItems('ending').find(({ id }) => id === 'campaign').label, '赛季结果');
});

test('shows only home destinations before a season starts', () => {
  assert.deepEqual(getNavigationItems('home'), [
    { id: 'home', label: '首页', target: 'home' },
    { id: 'schedule', label: '演出日程', target: 'schedule' },
    { id: 'team', label: '团队阵容', target: 'team' },
    { id: 'settings', label: '设置', target: 'settings' },
  ]);
});

test('restores the selected page from its hash without changing campaign progress', () => {
  assert.equal(getInitialView('show', '#home'), 'home');
  assert.equal(getInitialView('management', '#schedule'), 'schedule');
  assert.equal(getInitialView('management', '#team'), 'team');
  assert.equal(getInitialView('management', '#team-title'), 'team');
  assert.equal(getInitialView('show', '#schedule-title'), 'schedule');
  assert.equal(getInitialView('show', '#settings'), 'settings');
  assert.equal(getInitialView('show', '#campaign'), 'campaign');
  assert.equal(getInitialView('home', ''), 'home');
});
