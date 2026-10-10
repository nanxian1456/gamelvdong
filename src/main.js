import { SHOWS, TUTORIAL_SHOW, TUTORIAL_DIFFICULTY, getDifficulty } from './content.js';
import { createAudioEngine } from './audio.js';
import { applyAction, getEnding, newCampaign, retryLastShow, setCampaignDifficulty, settleShow, startCampaign } from './progression.js';
import {
  clearCampaign,
  loadCampaign,
  loadSeasonArchive,
  isCompletedSeasonArchived,
  recordCompletedSeason,
  restartCompletedSeason,
  saveCampaign,
} from './storage.js';
import { getInitialView, getNavigationItems } from './navigation.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { createPerformanceController } from './performance-controller.js';
import {
  renderEndingView,
  renderHomeView,
  renderManagementView,
  renderScheduleView,
  renderSettingsView,
  renderTeamView,
  renderTutorialResultView,
} from './views.js';

const app = document.querySelector('#app');
const navigation = document.querySelector('#app-nav');

let { campaign, recovered } = loadCampaign();
let seasonArchive = loadSeasonArchive();
let currentView = getInitialView(campaign.phase, window.location.hash);
let restoredActiveShow = campaign.phase === 'show';
let preferences = loadPreferences();
let preferenceSaveUnavailable = false;
let saveUnavailable = false;
let saveNotice = recovered ? '没有可用的本地记录，已准备新档案。' : '';
let tutorialSummary = null;
let tutorialVersion = 0;

const performanceController = createPerformanceController({
  root: app,
  windowTarget: window,
  documentTarget: document,
  createEngine: createAudioEngine,
  onComplete(summary) {
    campaign = settleShow(campaign, summary);
    restoredActiveShow = false;
    persistCampaign();
    render();
  },
  onPreferenceChange(changes) {
    updatePreferences(changes);
  },
});

// Rehearsal has its own controller and result, never settles or saves a campaign.
const tutorialController = createPerformanceController({
  root: app, windowTarget: window, documentTarget: document,
  createEngine: createAudioEngine,
  onComplete(summary) {
    if (currentView !== 'tutorial') return;
    tutorialSummary = summary;
    render();
  },
  onPreferenceChange: updatePreferences,
  onExit: () => navigateTo('home'),
});

async function startTutorial(pushHistory = true) {
  const version = ++tutorialVersion;
  const previousView = currentView;
  currentView = 'tutorial';
  tutorialSummary = null;
  if (previousView === 'campaign' && campaign.phase === 'show') await performanceController.leave();
  await tutorialController.dispose();
  if (version !== tutorialVersion || currentView !== 'tutorial') return;
  if (pushHistory && previousView !== 'tutorial') history.pushState(null, '', '#tutorial');
  render();
  window.scrollTo(0, 0);
}

function renderTutorial() {
  if (tutorialSummary) {
    app.innerHTML = renderTutorialResultView(tutorialSummary);
    app.querySelector('#retry-tutorial').addEventListener('click', () => void startTutorial());
    app.querySelector('#exit-tutorial').addEventListener('click', () => void navigateTo('home'));
    return;
  }
  void tutorialController.enter({
    campaign: { showIndex: 0 }, show: TUTORIAL_SHOW, difficulty: TUTORIAL_DIFFICULTY,
    preferences, tutorial: true, autoStart: false,
  });
}

function persistCampaign() {
  if (!saveCampaign(campaign)) {
    saveUnavailable = true;
    saveNotice = '浏览器无法保存进度；关闭页面后，本次记录可能无法恢复。';
  }
}

function persistPreferences() {
  preferenceSaveUnavailable = !savePreferences(preferences);
}

function applyMotionPreference() {
  document.documentElement.classList.toggle('reduce-motion', preferences.reduceMotion);
}

function updatePreferences(changes) {
  preferences = { ...preferences, ...changes };
  persistPreferences();
  performanceController.setPreferences(preferences);
  tutorialController.setPreferences(preferences);
  applyMotionPreference();

  const notice = app.querySelector('#settings-save-note');
  if (notice) {
    notice.hidden = !preferenceSaveUnavailable;
    notice.textContent = preferenceSaveUnavailable
      ? '设置暂时无法保存；本次会话仍然有效。'
      : '';
  }
}

applyMotionPreference();

function renderNavigation() {
  navigation.innerHTML = getNavigationItems(campaign.phase)
    .map((item) => {
      const active = item.target === currentView;
      return `<a href="#${item.target}" data-nav-target="${item.target}"${active ? ' aria-current="page"' : ''}>${item.label}</a>`;
    })
    .join('');
}

async function navigateTo(target, pushHistory = true) {
  if (target === 'tutorial') {
    if (currentView !== 'tutorial') await startTutorial(pushHistory);
    return;
  }
  if (!['home', 'schedule', 'team', 'settings', 'campaign'].includes(target)) return;
  if (currentView === 'tutorial') {
    tutorialVersion += 1;
    currentView = target;
    tutorialSummary = null;
    await tutorialController.dispose();
    if (currentView !== target) return;
    render();
    if (pushHistory) history.pushState(null, '', `#${target}`);
    window.scrollTo(0, 0);
    return;
  }
  if (['home', 'schedule', 'team', 'settings'].includes(target)) {
    if (currentView === target) return;
    if (currentView === 'campaign' && campaign.phase === 'show') {
      await performanceController.leave();
    }
    currentView = target;
    render();
    if (pushHistory) history.pushState(null, '', `#${target}`);
    window.scrollTo(0, 0);
    return;
  }

  if (target !== 'campaign' || currentView === 'campaign') return;
  currentView = 'campaign';
  render();
  if (pushHistory) history.pushState(null, '', '#campaign');
  window.scrollTo(0, 0);
}

navigation.addEventListener('click', (event) => {
  const link = event.target.closest('[data-nav-target]');
  if (!link) return;
  event.preventDefault();
  void navigateTo(link.dataset.navTarget);
});

window.addEventListener('popstate', () => {
  const target = getInitialView(campaign.phase, window.location.hash);
  if (target !== currentView) void navigateTo(target, false);
});

document.querySelector('.brand').addEventListener('click', (event) => {
  event.preventDefault();
  void navigateTo('home');
});

function bindCampaignAction() {
  app.querySelector('[data-campaign-action]')?.addEventListener('click', () => {
    if (campaign.phase === 'home') {
      clearCampaign();
      campaign = startCampaign(newCampaign(campaign.difficulty));
      currentView = 'campaign';
      saveNotice = '';
      persistCampaign();
      render();
      return;
    }
    void navigateTo('campaign');
  });
}

function renderHome() {
  app.innerHTML = renderHomeView({ campaign, seasonArchive, shows: SHOWS, saveNotice });

  bindCampaignAction();
  app.querySelector('#open-tutorial').addEventListener('click', () => void startTutorial());
  app.querySelectorAll('input[name="season-difficulty"]').forEach((input) => {
    input.addEventListener('change', () => {
      campaign = setCampaignDifficulty(campaign, input.value);
      persistCampaign();
      app.querySelectorAll('.difficulty-option').forEach((option) => {
        option.classList.toggle('is-selected', option.querySelector('input').checked);
      });
    });
  });
  app.querySelector('#open-team-page').addEventListener('click', () => void navigateTo('team'));
}

function renderSchedule() {
  app.innerHTML = renderScheduleView({ campaign, shows: SHOWS });
  bindCampaignAction();
}

function renderTeam() {
  app.innerHTML = renderTeamView({ campaign });
  bindCampaignAction();
}

function renderSettings() {
  app.innerHTML = renderSettingsView({ campaign, preferences, preferenceSaveUnavailable });

  app.querySelector('#setting-sound-enabled').addEventListener('change', (event) => {
    updatePreferences({ muted: !event.currentTarget.checked });
  });
  app.querySelector('#setting-volume').addEventListener('input', (event) => {
    const volume = Number(event.currentTarget.value);
    updatePreferences({ volume });
    app.querySelector('#setting-volume-value').value = `${preferences.volume}%`;
  });
  app.querySelector('#setting-reduced-motion').addEventListener('change', (event) => {
    updatePreferences({ reduceMotion: event.currentTarget.checked });
  });
  app.querySelector('#setting-offset').addEventListener('input', (event) => {
    const offsetMs = Number(event.currentTarget.value);
    updatePreferences({ offsetMs });
    app.querySelector('#setting-offset-value').value = `${preferences.offsetMs} 毫秒`;
  });
}

function renderShow({ autoStart = false } = {}) {
  const show = SHOWS[campaign.showIndex];
  if (!show) {
    campaign = { ...campaign, phase: 'ending' };
    render();
    return;
  }

  void performanceController.enter({
    campaign,
    show,
    difficulty: getDifficulty(campaign.difficulty),
    preferences,
    saveUnavailable,
    restoredActiveShow,
    autoStart,
  });
}

function renderManagement() {
  app.innerHTML = renderManagementView({ campaign, saveNotice });
  bindShowRetry();

  app.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const outcome = applyAction(campaign, button.dataset.action);
      if (outcome.error) {
        saveNotice = outcome.error;
        app.querySelector('#action-notice').textContent = outcome.error;
        return;
      }
      campaign = outcome.campaign;
      currentView = 'campaign';
      saveNotice = '';
      persistCampaign();
      render();
    });
  });
}

function renderEnding() {
  recordCompletedSeason(campaign);
  seasonArchive = loadSeasonArchive();
  if (!isCompletedSeasonArchived(campaign)) {
    saveNotice = '赛季已完成，但本地赛季档案暂时未能保存。';
  } else if (saveNotice === '赛季已完成，但本地赛季档案暂时未能保存。') {
    saveNotice = '';
  }
  const ending = getEnding(campaign);
  app.innerHTML = renderEndingView({ campaign, ending, saveNotice });
  bindShowRetry();
  app.querySelector('#restart-season').addEventListener('click', () => {
    if (!window.confirm('重新开启会覆盖当前赛季进度，历史赛季档案会保留。要继续吗？')) return;
    if (!restartCompletedSeason(campaign)) {
      saveNotice = '未能安全开启新赛季，当前进度已保留。请稍后重试。';
      const notice = app.querySelector('#ending-save-notice');
      notice.hidden = false;
      notice.textContent = saveNotice;
      return;
    }
    campaign = newCampaign();
    currentView = 'home';
    saveNotice = '';
    persistCampaign();
    render();
  });
}

function bindShowRetry() {
  app.querySelector('#retry-show')?.addEventListener('click', () => {
    if (!window.confirm('本场成绩和奖励将撤回，按重试成绩重新结算。之前的演出和经营选择会保留。要重试吗？')) return;
    const retried = retryLastShow(campaign);
    if (retried === campaign) return;
    campaign = retried;
    currentView = 'campaign';
    restoredActiveShow = false;
    saveNotice = '';
    persistCampaign();
    render();
  });
}

function syncBackdropVideo() {
  const performing = currentView === 'tutorial' || (currentView === 'campaign' && campaign.phase === 'show');
  document.body.classList.toggle('performing', performing);
  const video = document.querySelector('.page-background video');
  if (!video) return;
  if (performing) {
    video.pause();
  } else if (video.paused) {
    try {
      const played = video.play();
      played?.catch?.(() => {});
    } catch {
      // Autoplay may be blocked outside a user gesture; the poster stays.
    }
  }
}

function render({ autoStartPerformance = false } = {}) {
  renderNavigation();
  if (currentView === 'home') renderHome();
  else if (currentView === 'tutorial') renderTutorial();
  else if (currentView === 'schedule') renderSchedule();
  else if (currentView === 'team') renderTeam();
  else if (currentView === 'settings') renderSettings();
  else if (campaign.phase === 'show') renderShow({ autoStart: autoStartPerformance });
  else if (campaign.phase === 'management') renderManagement();
  else if (campaign.phase === 'ending') renderEnding();
  else renderHome();
  syncBackdropVideo();
}

render();
