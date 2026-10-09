export function getInitialView(phase, hash) {
  const pageByHash = {
    '#home': 'home',
    '#schedule': 'schedule',
    '#schedule-title': 'schedule',
    '#team': 'team',
    '#team-title': 'team',
    '#settings': 'settings',
  };
  if (pageByHash[hash]) return pageByHash[hash];
  if (phase === 'home') return 'home';
  return 'campaign';
}

export function getNavigationItems(phase) {
  const items = [
    { id: 'home', label: '首页', target: 'home' },
    { id: 'schedule', label: '演出日程', target: 'schedule' },
    { id: 'team', label: '团队阵容', target: 'team' },
  ];

  const current = phase === 'show'
    ? { id: 'campaign', label: '继续演出', target: 'campaign' }
    : phase === 'management'
      ? { id: 'campaign', label: '继续经营', target: 'campaign' }
      : phase === 'ending'
        ? { id: 'campaign', label: '赛季结果', target: 'campaign' }
        : null;

  if (current) items.push(current);
  items.push({ id: 'settings', label: '设置', target: 'settings' });
  return items;
}
