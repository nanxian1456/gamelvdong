import { ACTIONS, DIFFICULTIES, SHOWS, getDifficulty } from './content.js';
import { LANE_KEYS } from './lane-input.js';

const MEMBER_ROLES = ['主唱', '键盘', '鼓手', '贝斯', '采样'];
const RANK_NAMES = { S: '完美共振', A: '全场合拍', B: '稳定发挥', C: '初次登台' };
const SEASON_RANK_NAMES = { Gold: '金奖', Silver: '银奖', Bronze: '铜奖', 'First Stage': '初登舞台' };
const showRankName = rank => RANK_NAMES[rank] ?? '初次登台';
const seasonRankName = rank => SEASON_RANK_NAMES[rank] ?? '初登舞台';

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

function resourceItemMarkup(kind, symbol, label, value) {
  return `<div class="resource-item">
    <span class="resource-symbol ${kind}" aria-hidden="true">${symbol}</span>
    <span class="resource-label">${label}<strong>${value}</strong></span>
  </div>`;
}

export function renderResources(campaign) {
  return `<div class="resource-strip" aria-label="乐队资源">
    ${resourceItemMarkup('credit', '￥', '经费', campaign.credits)}
    ${resourceItemMarkup('popularity', '★', '乐队热度', campaign.popularity)}
  </div>`;
}

function statCardMarkup(label, value) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function memberRowMarkup(role, index) {
  const memberNumber = String(index + 1).padStart(2, '0');
  return `<div class="member-row">
    <span class="member-token">${memberNumber}</span>
    <span class="member-name">乐队成员 ${memberNumber}</span>
    <span class="member-role">${role}</span>
  </div>`;
}

export function renderMemberRows(memberCount) {
  return MEMBER_ROLES.slice(0, memberCount).map(memberRowMarkup).join('');
}

export function renderHeaderSection(campaign) {
  const stateLabel =
    campaign.phase === 'home'
      ? '新生乐队档案'
      : campaign.phase === 'management'
        ? '演出间歇 / 团队经营'
        : '迎新演出季';
  return `<div class="eyebrow">${stateLabel}</div>`;
}

function campaignActionMarkup(campaign) {
  if (campaign.phase === 'home') {
    return '<button class="primary-button" type="button" data-campaign-action="start">开启演出季</button>';
  }
  const label =
    campaign.phase === 'show'
      ? '继续演出'
      : campaign.phase === 'management'
        ? '继续经营'
        : '查看赛季结果';
  return `<button class="primary-button" type="button" data-campaign-action="continue">${label}</button>`;
}

function difficultySelectionMarkup(campaign) {
  return `<fieldset class="difficulty-select" aria-label="赛季难度">
    <legend>赛季难度</legend>
    <div class="difficulty-options">
      ${DIFFICULTIES.map((difficulty) => `<label class="difficulty-option ${campaign.difficulty === difficulty.id ? 'is-selected' : ''}">
        <input type="radio" name="season-difficulty" value="${difficulty.id}" ${campaign.difficulty === difficulty.id ? 'checked' : ''}>
        <span class="difficulty-name">${difficulty.name}</span>
        <small>${difficulty.description}</small>
      </label>`).join('')}
    </div>
  </fieldset>`;
}

function renderSeasonArchive(seasonArchive) {
  const best = [...seasonArchive].sort((first, second) => (
    second.score - first.score || second.completedAt - first.completedAt
  ))[0];
  const recent = seasonArchive.slice(0, 3);
  return `<section class="season-archive" aria-labelledby="season-archive-title">
    <div class="section-topline">
      <div>
        <h2 class="section-heading" id="season-archive-title">赛季档案</h2>
      </div>
      ${best ? `<span class="archive-best-rank">${seasonRankName(best.rank)}</span>` : ''}
    </div>
    ${best ? `<p class="archive-best-line">最佳 <strong>${best.score}</strong> · ${seasonRankName(best.rank)} · ${getDifficulty(best.difficulty).name}难度</p>` : '<p class="archive-empty">暂无赛季记录</p>'}
    ${recent.length ? `<div class="archive-recent" aria-label="最近赛季">
      ${recent.map((record) => `<div class="archive-record">
        <span>${seasonRankName(record.rank)}</span>
        <strong>${getDifficulty(record.difficulty).name}</strong>
        <b>${record.score}</b>
        <time>${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(record.completedAt))}</time>
      </div>`).join('')}
    </div>` : ''}
  </section>`;
}

function showCard(show, index, campaign) {
  const complete = index < campaign.showResults.length;
  const current = index === campaign.showIndex && !complete;
  const locked = !complete && !current;
  const state = complete ? '已完成' : current ? '待演出' : '未解锁';
  const classes = ['show-card', complete ? 'is-done' : '', current ? 'is-current' : '', locked ? 'is-locked' : '']
    .filter(Boolean)
    .join(' ');
  const result = campaign.showResults[index];
  const stateIcon = complete ? '✓ ' : locked ? '◆ ' : '';
  return `<article class="${classes}">
    <span class="show-number">0${index + 1}</span>
    <div><h3>${escapeHtml(show.title)}</h3><p>每分钟 ${show.bpm} 拍 · ${result ? `${result.score.toLocaleString()} 分 · ${showRankName(result.rank)}` : '校园现场'}</p></div>
    <span class="show-state">${stateIcon}${state}</span>
  </article>`;
}

export function renderHomeView({ campaign, seasonArchive, shows, saveNotice }) {
  const currentShow = shows[campaign.showIndex] ?? shows.at(-1);
  const teamSummary = campaign.actionHistory.length
    ? `已完成 ${campaign.actionHistory.length} 次团队行动，成员分工与舞台经验正在积累。`
    : '从演出中获得资源，在间歇阶段为团队安排下一步。';
  const phaseText =
    campaign.phase === 'home'
      ? '等待开场'
      : campaign.phase === 'show'
        ? '演出进行中'
        : campaign.phase === 'management'
          ? '团队经营中'
          : '演出季已完成';
  return `<section class="home-page" aria-labelledby="page-title">
    ${renderHeaderSection(campaign)}
    <h1 class="page-heading" id="page-title">校园声场</h1>
    <p class="subheading">迎新舞台即将亮起。声浪社正从第一场演出出发，向校园的聚光灯走去。</p>
    <div class="home-action-row hero-action-row hero-action-top">${campaignActionMarkup(campaign)}
      <button id="open-tutorial" class="secondary-button" type="button">新手练习</button>
    </div>
    <section class="campaign-banner" aria-label="当前演出季">
      <div>
        <h2>新生乐队成长计划</h2>
        <p>从招新试听，到迎新舞台。每一次合拍，都让团队更近一步。</p>
      </div>
    </section>
    <div class="home-grid">
      <section class="home-overview" aria-labelledby="overview-title">
        <div class="section-topline">
          <div>
            <h2 class="section-heading" id="overview-title">当前赛季</h2>
          </div>
          <span class="section-kicker">${phaseText}</span>
        </div>
        <div class="home-stats">
          ${statCardMarkup('已完成演出', `${campaign.showResults.length} / 3`)}
          ${statCardMarkup('团队人数', `${campaign.members} 人`)}
        </div>
        <div class="current-show-summary">
          <span class="section-kicker">${campaign.phase === 'ending' ? '最后一场' : '接下来'}</span>
          <strong>${escapeHtml(currentShow.title)}</strong>
          <span>每分钟 ${currentShow.bpm} 拍 · ${campaign.phase === 'ending' ? '演出完成' : '校园现场'}</span>
        </div>
        ${campaign.phase === 'home'
          ? difficultySelectionMarkup(campaign)
          : `<p class="current-difficulty">本季难度 · ${getDifficulty(campaign.difficulty).name}</p>`}
        ${renderResources(campaign)}
        ${saveNotice ? `<p class="save-notice" role="status">${escapeHtml(saveNotice)}</p>` : ''}
      </section>
      <aside class="team-panel home-team-summary" aria-labelledby="home-team-title">
        <h2 class="section-heading" id="home-team-title">乐队成员</h2>
        <div class="team-count">
          <strong>${campaign.members}<span style="font-size:13px;font-weight:600"> / 5</span></strong>
          <span>当前阵容</span>
        </div>
        <p class="summary-copy">${teamSummary}</p>
        <button class="secondary-button" id="open-team-page" type="button">查看团队阵容</button>
        ${renderSeasonArchive(seasonArchive)}
      </aside>
    </div>
  </section>`;
}

export function renderScheduleView({ campaign, shows }) {
  return `<section class="section-page schedule-page" aria-labelledby="schedule-page-title">
    <header class="section-page-header">
      <div>
        ${renderHeaderSection(campaign)}
        <h1 class="page-heading" id="schedule-page-title">演出日程</h1>
        <p class="subheading">三场校园现场，记录声浪社从初次合拍到迎新舞台的成长。</p>
      </div>
      ${renderResources(campaign)}
    </header>
    <div class="schedule-page-layout">
      <section class="section-panel" aria-labelledby="schedule-title">
        <div class="section-topline">
          <div>
            <h2 class="section-heading" id="schedule-title">校园现场</h2>
          </div>
          <span class="section-kicker">${campaign.showResults.length} / 3 完成</span>
        </div>
        <div class="schedule-list">${shows.map((show, index) => showCard(show, index, campaign)).join('')}</div>
      </section>
      <aside class="section-panel schedule-summary">
        <h2 class="section-heading">
          ${
            campaign.phase === 'home'
              ? '演出季尚未开始'
              : campaign.phase === 'ending'
                ? '演出季已完成'
                : `第 ${Math.min(campaign.showIndex + 1, shows.length)} 场 / 共 3 场`
          }
        </h2>
        <p>
          ${
            campaign.phase === 'home'
              ? '准备好后，从第一场演出开启旅程。'
              : `当前进度：${campaign.showResults.length} 场已完成。`
          }
        </p>
        <div class="home-action-row">${campaignActionMarkup(campaign)}</div>
      </aside>
    </div>
  </section>`;
}

export function renderTeamView({ campaign }) {
  return `<section class="section-page team-page" aria-labelledby="team-page-title">
    <header class="section-page-header">
      <div>
        ${renderHeaderSection(campaign)}
        <h1 class="page-heading" id="team-page-title">团队阵容</h1>
        <p class="subheading">认识声浪社的成员，查看团队成长与演出资源。</p>
      </div>
      ${renderResources(campaign)}
    </header>
    <div class="team-page-layout">
      <section class="section-panel" aria-labelledby="team-title">
        <h2 class="section-heading" id="team-title">乐队成员 · ${campaign.members} / 5</h2>
        <div class="member-roster">
          ${renderMemberRows(campaign.members)}
        </div>
      </section>
      <aside class="section-panel team-summary-panel">
        <h2 class="section-heading">成长记录</h2>
        <div class="team-summary-stats">
          ${statCardMarkup('演出完成', `${campaign.showResults.length} / 3`)}
          ${statCardMarkup('团队行动', `${campaign.actionHistory.length} 次`)}
          ${statCardMarkup('当前热度', campaign.popularity)}
        </div>
        <p>
          ${
            campaign.phase === 'management'
              ? '当前处于演出间歇，可以继续安排团队行动。'
              : '团队行动会在每场演出之间开放。'
          }
        </p>
        <div class="home-action-row">${campaignActionMarkup(campaign)}</div>
      </aside>
    </div>
  </section>`;
}

export function renderSettingsView({ campaign, preferences, preferenceSaveUnavailable }) {
  return `<section class="section-page settings-page" aria-labelledby="settings-page-title">
    <header class="section-page-header">
      <div>
        ${renderHeaderSection(campaign)}
        <h1 class="page-heading" id="settings-page-title">设置</h1>
        <p class="subheading">声音与舞台画面偏好</p>
      </div>
    </header>
    <section class="section-panel settings-panel" aria-label="游戏设置">
      <div class="setting-row">
        <div class="setting-copy">
          <label class="setting-title" for="setting-offset">延迟校准</label>
          <p>蓝牙耳机可适当调大（早击调大，晚击调小）</p>
        </div>
        <div class="volume-control">
          <input id="setting-offset" type="range" min="-150" max="150" step="5" value="${preferences.offsetMs ?? 0}" aria-describedby="setting-offset-value">
          <output id="setting-offset-value" for="setting-offset">${preferences.offsetMs ?? 0} 毫秒</output>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <label class="setting-title" for="setting-sound-enabled">演出声音</label>
          <p>节拍伴奏与命中提示</p>
        </div>
        <input class="setting-switch" id="setting-sound-enabled" type="checkbox" role="switch" ${preferences.muted ? '' : 'checked'}>
      </div>
      <div class="setting-row volume-setting">
        <div class="setting-copy">
          <label class="setting-title" for="setting-volume">音量</label>
          <p>演出声音输出</p>
        </div>
        <div class="volume-control">
          <input id="setting-volume" type="range" min="0" max="100" step="1" value="${preferences.volume}" aria-describedby="setting-volume-value">
          <output id="setting-volume-value" for="setting-volume">${preferences.volume}%</output>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <label class="setting-title" for="setting-reduced-motion">降低动态效果</label>
          <p>保持舞台波形与转场静止</p>
        </div>
        <input class="setting-switch" id="setting-reduced-motion" type="checkbox" role="switch" ${preferences.reduceMotion ? 'checked' : ''}>
      </div>
      <p class="settings-save-note" id="settings-save-note" role="status" ${preferenceSaveUnavailable ? '' : 'hidden'}>设置暂时无法保存；本次会话仍然有效。</p>
    </section>
  </section>`;
}

function showProgressMarkup(runtime, total) {
  const done = runtime?.rhythm.results.length ?? 0;
  return `<span id="beat-progress-label">${String(done).padStart(2, '0')} / ${total}</span>`;
}

export function renderPerformanceView({
  campaign,
  show,
  runtime,
  preferences,
  saveUnavailable,
  restoredActiveShow,
  tutorial = false,
}) {
  const hasRuntime = Boolean(runtime);
  const isRecovery = !hasRuntime && restoredActiveShow;
  return `<section class="performance-page" aria-labelledby="performance-title">
    <div class="performance-shell">
      <div class="performance-topbar">
        <div class="show-title-wrap">
          <span class="stage-index">${tutorial ? '练' : '0' + (campaign.showIndex + 1)}</span>
          <div class="performance-title">
            <h1 id="performance-title">${escapeHtml(show.title)}</h1>
          </div>
        </div>
        <div class="performance-controls">
          ${tutorial ? '<button id="exit-tutorial" class="quiet-button" type="button">返回首页</button>' : ''}
          <button id="mute-toggle" class="quiet-button" type="button" aria-pressed="${preferences.muted}">
            ${preferences.muted ? '声音关闭' : '声音开启'}
          </button>
          ${
            hasRuntime
              ? `<button id="pause-toggle" class="quiet-button" type="button">
                ${runtime.paused ? '已暂停' : '暂停'}
              </button>`
              : ''
          }
        </div>
      </div>
      <div class="performance-stats">
        <div class="stat-block"><span>本场得分</span><strong id="score-value">${runtime?.rhythm.score.toLocaleString() ?? '0'}</strong></div>
        <div class="combo-block"><strong id="combo-value">${runtime?.rhythm.combo ?? 0}</strong><span>连击</span></div>
        <div class="stat-block"><span>准确率</span><strong id="accuracy-value">${runtime ? `${Math.round(runtime.rhythm.accuracyPoints / (runtime.rhythm.chart.length * 10))}%` : '0%'}</strong></div>
        <div class="stat-block"><span>节拍进度</span><strong id="progress-value">${showProgressMarkup(runtime, show.chart.length)}</strong></div>
      </div>
      <div
        class="progress-track"
        role="progressbar"
        aria-label="演出进度"
        aria-valuemin="0"
        aria-valuemax="${show.chart.length}"
        aria-valuenow="${runtime?.rhythm.results.length ?? 0}"
      >
        <div class="progress-fill" id="progress-fill" style="transform:scaleX(${((runtime?.rhythm.results.length ?? 0) / show.chart.length)})"></div>
      </div>
      <div class="stage-scene" id="stage-scene" role="group" tabindex="0" aria-describedby="performance-instructions" aria-label="四轨音符区，键盘按 DFJK 对应轨道，触屏按对应轨道">
        <canvas id="stage-art" aria-hidden="true"></canvas>
        <span class="scene-caption">声浪社 · 校园露天舞台</span>
        <span class="scene-bpm">每分钟 ${show.bpm} 拍</span>
        <div class="lane-keypad" role="group" aria-label="四轨触控键盘">
          ${LANE_KEYS.map((key, lane) => `<button class="lane-key" type="button" data-lane-key="${lane}" aria-label="第${lane + 1}轨，${key.toUpperCase()}键"><kbd>${key.toUpperCase()}</kbd></button>`).join('')}
        </div>
        <div id="next-beat-cue" class="next-beat-cue" hidden aria-live="off">
          <span id="next-beat-label">下一拍</span>
          <span class="cue-track" aria-hidden="true">
            <span id="cue-progress"></span>
          </span>
        </div>
        <div id="show-intro" class="show-intro" ${hasRuntime ? 'hidden' : ''}>
          <p class="eyebrow">${tutorial ? '独立练习 · 不影响赛季' : isRecovery ? '演出恢复' : '第 ' + (campaign.showIndex + 1) + ' 场'}</p>
          <h2>${isRecovery ? '本场演出待继续' : escapeHtml(show.title)}</h2>
          <p>${isRecovery ? '本场将从节拍倒数重新开始，已完成演出会保留。' : '灯光即将亮起。节拍会从倒数结束后开始。'}</p>
          ${campaign.showIndex === 0 ? `<div id="first-play-guide" class="first-play-guide">
            <p>① 从左到右：<kbd>D F J K</kbd>，触屏点下方对应按键。</p>
            <p>② 短音符到白线时按一下；长音符按住，直到尾部到白线再松开。</p>
            <p>③ 倒数后先听前奏，再跟音符合奏。没跟上可以暂停后重试。</p>
          </div>` : ''}
          <button id="start-performance" class="primary-button" type="button">${tutorial ? '开始练习' : isRecovery ? '从本场开始' : '开始演出'}</button>
        </div>
        <div id="pause-overlay" class="pause-overlay" ${runtime?.paused ? '' : 'hidden'}>
          <p class="eyebrow">演出暂停</p>
          <h2>演出暂停</h2>
          <p>节拍停在当前时刻。</p>
          <button id="resume-performance" class="primary-button" type="button">继续演出</button>
          <button id="retry-performance" class="quiet-button" type="button">本场重试</button>
          <p>${tutorial ? '仅重新开始练习，不影响正式赛季。' : '仅清空本场分数，之前的演出和经营选择保留。'}</p>
        </div>
      </div>
      <div class="judgement-banner" id="judgement-banner" aria-live="polite">${hasRuntime ? '准备就绪' : ''}</div>
      <p class="performance-help" id="countdown-label" aria-live="polite">${hasRuntime ? '3' : ''}</p>
      <p class="performance-instructions" id="performance-instructions">D F J K 对应左到右四轨 · 短音符按一下 · 长音符按住至尾部到白线</p>
      ${tutorial ? `<p id="tutorial-hint" class="tutorial-hint" role="status">${escapeHtml(show.sections[0].instruction)}</p>` : ''}
      <p class="performance-help">当前乐段：<span id="music-section">准备</span> · 本场 ${Math.round((show.durationMs ?? 0) / 1000)} 秒</p>
      <p class="visual-audio-note" id="audio-note">${saveUnavailable ? '本地记录不可用' : ''}</p>
    </div>
  </section>`;
}

export function renderTutorialResultView(summary) {
  const accuracy = Math.round(summary.accuracy * 100);
  return `<section class="section-page tutorial-result" aria-labelledby="page-title">
    <h1 class="page-heading" id="page-title">练习完成</h1>
    <p class="subheading">${accuracy >= 65 ? '已经找到节奏了！准备好后可以尝试正式演出。' : '先熟悉按键，再找节奏。没跟上也没关系，可以再练一次。'}</p>
    <div class="section-panel">
      <div class="home-stats">
        ${statCardMarkup('练习得分', summary.score.toLocaleString())}
        ${statCardMarkup('准确率', `${accuracy}%`)}
        ${statCardMarkup('最高连击', summary.comboMax)}
      </div>
      <p>本次练习不影响经费、乐队热度和正式赛季成绩，也不会写入赛季档案。</p>
      <div class="home-action-row">
        <button id="retry-tutorial" class="primary-button" type="button">再练一次</button>
        <button id="exit-tutorial" class="secondary-button" type="button">返回首页</button>
      </div>
    </div>
  </section>`;
}

export function renderManagementView({ campaign, saveNotice }) {
  const result = campaign.showResults.at(-1);
  return `<section class="management-page" aria-labelledby="page-title">
    <div class="management-heading">
      <div>
        ${renderHeaderSection(campaign)}
        <h1 class="page-heading" id="page-title">演出间歇</h1>
        <p class="subheading">灯光熄下，下一场还在等。把演出的回响变成团队向前的力量。</p>
      </div>
      ${renderResources(campaign)}
    </div>
    <div class="management-layout">
      <section aria-labelledby="actions-title">
        <div class="result-band">
          <div>
            <h2>
              ${escapeHtml(SHOWS[campaign.showResults.length - 1]?.title ?? '校园演出')}
              · ${RANK_NAMES[result?.rank] ?? '演出完成'}
            </h2>
            <p>
              本场 ${result?.score.toLocaleString() ?? 0} 分，最高连击 ${result?.comboMax ?? 0}
            </p>
          </div>
          <span class="result-rank">${showRankName(result?.rank)}</span>
        </div>
        <div class="reward-row">
          <span class="reward-chip credit">经费 +${result?.credits ?? 0}</span>
          <span class="reward-chip">热度 +${result?.popularity ?? 0}</span>
        </div>
        <button id="retry-show" class="quiet-button" type="button">本场重试</button>
        <p class="notice-text">重试会撤回本场奖励，按新成绩重新结算；此前经营选择保留。</p>
        <h2 class="actions-title" id="actions-title">团队行动</h2>
        <div class="action-list">${ACTIONS.map((action, index) => {
          const disabled =
            campaign.credits < action.cost || (action.id === 'recruit' && campaign.members >= 5);
          const costLabel = action.cost === 0 ? '免费' : `${action.cost} 经费`;
          return `<button class="action-button" type="button" data-action="${action.id}" ${disabled ? 'disabled' : ''}>
            <span class="action-index">0${index + 1}</span>
            <span class="action-copy">
              <strong>${escapeHtml(action.name)}</strong>
              <small>${escapeHtml(action.description)}</small>
            </span>
            <span class="action-cost ${action.cost === 0 ? 'free' : ''}">${costLabel}</span>
          </button>`;
        }).join('')}</div>
        <p class="notice-text" id="action-notice" role="status">${escapeHtml(saveNotice)}</p>
      </section>
      <aside class="management-side" aria-labelledby="roster-title">
        <h2 class="section-heading" id="roster-title">团队阵容</h2>
        <div class="member-roster">
          ${renderMemberRows(campaign.members)}
        </div>
        <div class="management-resources">${renderResources(campaign)}</div>
      </aside>
    </div>
  </section>`;
}

export function renderEndingView({ campaign, ending, saveNotice }) {
  const endingTitle =
    {
      Gold: '整座校园都在合拍。',
      Silver: '声浪，已经传过了操场。',
      Bronze: '舞台记住了你们的节拍。',
    }[ending.rank] ?? '第一束灯光，已经亮起。';
  return `<section class="ending-page" aria-labelledby="ending-title">
    <div class="eyebrow">演出季落幕</div>
    <div class="ending-hero">
      <span class="ending-stamp rank-${ending.rank.toLowerCase().replaceAll(' ', '-')}">${seasonRankName(ending.rank)}</span>
      <p class="ending-rank-name">${seasonRankName(ending.rank)} · 团队总评 ${ending.score}</p>
      <div>
        <h1 id="ending-title">${endingTitle}</h1>
        <p>三场演出落幕，声浪社的新生演出季完成。</p>
      </div>
    </div>
    <div class="ending-grid">
      <section aria-labelledby="results-title">
        <h2 class="section-heading" id="results-title">演出记录</h2>
        <div class="ending-results">
          ${SHOWS.map((show, index) => {
            const result = campaign.showResults[index];
            return `<div class="ending-result-row">
            <span class="show-number">0${index + 1}</span>
            <strong>${escapeHtml(show.title)}</strong>
            <span>${result?.score.toLocaleString() ?? 0} 分</span>
            <b>${showRankName(result?.rank)}</b>
          </div>`;
          }).join('')}
        </div>
      </section>
      <aside>
        <h2 class="section-heading">团队总评 · ${ending.score}</h2>
        <div class="ending-stat">
          <div class="ending-stat-row">
            <span>最终热度</span>
            <strong>${campaign.popularity}</strong>
          </div>
          <div class="ending-stat-row">
            <span>剩余经费</span>
            <strong>${campaign.credits}</strong>
          </div>
          <div class="ending-stat-row">
            <span>赛季难度</span>
            <strong>${getDifficulty(campaign.difficulty).name}</strong>
          </div>
          <div class="ending-stat-row">
            <span>乐队成员</span>
            <strong>${campaign.members} 人</strong>
          </div>
          <div class="ending-stat-row">
            <span>团队行动</span>
            <strong>${campaign.actionHistory.length} 次</strong>
          </div>
        </div>
        <div class="ending-actions">
          <button class="quiet-button" id="retry-show" type="button">重试最后一场</button>
          <button class="primary-button" id="restart-season" type="button">再演一季</button>
        </div>
        <p class="notice-text">重试会撤回最后一场奖励，再次完成后更新本季档案。</p>
      </aside>
    </div>
    <p class="save-notice" id="ending-save-notice" role="status" ${saveNotice ? '' : 'hidden'}>${escapeHtml(saveNotice)}</p>
  </section>`;
}
