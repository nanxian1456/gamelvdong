import { bindRhythmControls } from './controls.js';
import {
  advanceRhythmRuntime,
  createRhythmRuntime,
  getRhythmSummary,
  getNextBeatCue,
  processRhythmInput,
} from './rhythm.js';
import { drawStage, getStageGeometry, resizeStageCanvas } from './stage.js';
import { renderPerformanceView } from './views.js';

const DEFAULT_PREFERENCES = {
  muted: false,
  volume: 100,
  reduceMotion: false,
  offsetMs: 0,
};

export function createPerformanceController({
  root,
  windowTarget,
  documentTarget,
  createEngine,
  onComplete,
  onPreferenceChange,
  onExit,
}) {
  let entry = null;
  let preferences = { ...DEFAULT_PREFERENCES };
  let session = null;
  let startPromise = null;
  let pausePromise = null;
  let disposePromise = null;
  let frameId = 0;
  let resizeTimer = 0;
  let entered = false;
  let controls = null;
  let pageListeners = [];
  let hud = null;
  let ripples = [];
  let stageSize = { width: 400, height: 400 };
  let stageGeometry = null;
  let stageContext = null;
  let finishPromise = null;
  let retryPromise = null;
  let lifecycleVersion = 0;

  const reducedMotionEnabled = () => preferences.reduceMotion
    || windowTarget.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const activeDifficulty = () => ({
    ...(entry?.difficulty ?? {}),
    offsetMs: preferences.offsetMs ?? 0,
  });

  const listen = (target, type, listener) => {
    if (!target) return;
    target.addEventListener(type, listener);
    pageListeners.push(() => target.removeEventListener(type, listener));
  };

  const clearPageBindings = () => {
    controls?.dispose();
    controls = null;
    for (const remove of pageListeners.splice(0)) remove();
    if (resizeTimer) windowTarget.clearTimeout(resizeTimer);
    resizeTimer = 0;
  };

  const cancelFrame = () => {
    if (frameId) windowTarget.cancelAnimationFrame(frameId);
    frameId = 0;
  };

  const refreshStageSize = () => {
    const canvas = root.querySelector('#stage-art');
    const bounds = canvas?.getBoundingClientRect();
    if (!bounds?.width) return;
    stageSize = { width: bounds.width, height: bounds.height || bounds.width };
    stageGeometry = getStageGeometry(root);
    stageContext = canvas.getContext('2d');
  };

  const initializeHud = () => {
    hud = {
      score: root.querySelector('#score-value'),
      combo: root.querySelector('#combo-value'),
      accuracy: root.querySelector('#accuracy-value'),
      progressValue: root.querySelector('#progress-value'),
      progressFill: root.querySelector('#progress-fill'),
      progressbar: root.querySelector('[role="progressbar"]'),
      banner: root.querySelector('#judgement-banner'),
      countdown: root.querySelector('#countdown-label'),
      cueElement: root.querySelector('#next-beat-cue'),
      cueLabel: root.querySelector('#next-beat-label'),
      cueProgress: root.querySelector('#cue-progress'),
      section: root.querySelector('#music-section'),
      lastScore: '',
      lastCombo: '',
      lastAccuracy: '',
      lastProgress: -1,
      lastProgressFill: -1,
      lastCountdown: null,
      lastCueText: '',
      judged: null,
      lastJudgedCount: -1,
    };
  };

  const judgementText = result => {
    if (result.judgement === 'miss') return '错过';
    const base = result.judgement === 'perfect' ? '完美' : '命中';
    const hint = result.timing === 'early' ? ' · 偏快' : result.timing === 'late' ? ' · 偏慢' : '';
    return result.judgement === 'perfect' && !hint ? base : base + hint;
  };

  const pulseStat = element => {
    if (!element || reducedMotionEnabled()) return;
    element.classList.remove('bump');
    void element.offsetWidth;
    element.classList.add('bump');
  };

  const showJudgement = result => {
    const banner = hud?.banner ?? root.querySelector('#judgement-banner');
    if (!banner) return;
    banner.textContent = judgementText(result);
    banner.dataset.grade = result.judgement;
    if (!reducedMotionEnabled()) {
      banner.classList.remove('pop');
      void banner.offsetWidth;
      banner.classList.add('pop');
    }
    const now = windowTarget.performance.now();
    if (result.judgement !== 'miss' && Number.isInteger(result.noteIndex)) {
      ripples.push({ t0: now, noteIndex: result.noteIndex, grade: result.judgement });
      if (ripples.length > 12) ripples.splice(0, ripples.length - 12);
    }
    if (session) {
      if (result.judgement === 'miss') session.lastMissAt = now;
      else session.lastHitAt = now;
    }
  };

  const updateHud = playheadMs => {
    if (!session || !hud) return;
    const rhythm = session.rhythm;
    const completed = rhythm.results.length;
    const total = rhythm.chart.length;
    const scoreText = rhythm.score.toLocaleString();
    const comboText = String(rhythm.combo);
    const accuracyText = `${Math.round((total ? rhythm.accuracyPoints / (total * 1000) : 0) * 100)}%`;
    const progressText = `${String(completed).padStart(2, '0')} / ${total}`;
    if (hud.progressValue && hud.lastProgress !== completed) {
      hud.progressValue.textContent = progressText;
      hud.progressbar?.setAttribute('aria-valuenow', String(completed));
      hud.lastProgress = completed;
    }
    if (hud.progressFill && hud.lastProgressFill !== completed) {
      hud.progressFill.style.transform = `scaleX(${total ? completed / total : 0})`;
      hud.lastProgressFill = completed;
    }
    if (hud.score && hud.lastScore !== scoreText) {
      hud.score.textContent = scoreText;
      hud.lastScore = scoreText;
      pulseStat(hud.score);
    }
    if (hud.combo && hud.lastCombo !== comboText) {
      hud.combo.textContent = comboText;
      hud.lastCombo = comboText;
      if (Number(comboText) >= 10) pulseStat(hud.combo);
    }
    if (hud.accuracy && hud.lastAccuracy !== accuracyText) {
      hud.accuracy.textContent = accuracyText;
      hud.lastAccuracy = accuracyText;
    }
    const playhead = Number.isFinite(playheadMs) ? playheadMs : session.engine.getPlayhead();
    const section = entry.show.sections?.findLast(part => playhead >= part.startMs);
    if (hud.section) hud.section.textContent = playhead < 0 ? '准备' : section?.name ?? '演出中';
    const tutorialHint = root.querySelector('#tutorial-hint');
    if (tutorialHint && section?.instruction) tutorialHint.textContent = section.instruction;
    const countdownText = playhead < 0 ? `倒数 ${session.engine.getCountdown()}` : '';
    if (hud.countdown && hud.lastCountdown !== countdownText) {
      hud.countdown.textContent = countdownText;
      hud.lastCountdown = countdownText;
    }
    if (hud.lastJudgedCount !== completed
      || hud.judged == null
      || hud.judged.length !== rhythm.noteStates.length) {
      hud.judged = rhythm.noteStates.map(state => state.status === 'resolved');
      hud.lastJudgedCount = completed;
    }
    const cue = getNextBeatCue(
      entry.show.beatsMs,
      hud.judged ?? [],
      playhead,
      activeDifficulty().goodWindowMs,
    );
    if (hud.cueElement && hud.cueLabel && hud.cueProgress) {
      hud.cueElement.hidden = !cue;
      if (cue) {
        const cueText = cue.remainingMs === 0
          ? '下一拍 · 现在'
          : `下一拍 · ${(cue.remainingMs / 1000).toFixed(1)} 秒`;
        if (hud.lastCueText !== cueText) {
          hud.cueLabel.textContent = cueText;
          hud.lastCueText = cueText;
        }
        hud.cueProgress.style.transform = `scaleX(${cue.progress})`;
      }
    }
  };

  const handleRhythmInput = event => {
    if (!session) return;
    const difficulty = activeDifficulty();
    if (event?.type === 'reset') {
      processRhythmInput(session.rhythm, event, session.engine.getPlayhead(), difficulty);
      return;
    }
    if (session.paused || session.finishing) return;
    const firstNewResult = session.rhythm.results.length;
    processRhythmInput(
      session.rhythm,
      event,
      session.engine.getPlayhead(),
      difficulty,
      stageSize.width,
      stageSize.height,
    );
    for (const result of session.rhythm.results.slice(firstNewResult)) {
      session.engine.feedback(result.judgement);
      showJudgement(result);
    }
    updateHud(session.engine.getPlayhead());
  };

  const finishSession = async () => {
    if (!session || session.finishing || !session.rhythm.finished) return finishPromise;
    const completedSession = session;
    completedSession.finishing = true;
    controls?.reset();
    cancelFrame();
    const summary = getRhythmSummary(completedSession.rhythm, activeDifficulty());
    finishPromise = (async () => {
      await dispose();
      await onComplete?.(summary);
    })();
    try {
      await finishPromise;
    } finally {
      finishPromise = null;
    }
  };

  const updatePerformance = () => {
    if (!session || session.finishing) return;
    session.engine.update();
    if (session.paused) return;
    const playheadMs = session.engine.getPlayhead();
    const difficulty = activeDifficulty();
    const deltaMs = Math.max(0, playheadMs - session.lastPlayheadMs);
    const firstNewResult = session.rhythm.results.length;
    advanceRhythmRuntime(
      session.rhythm,
      playheadMs,
      deltaMs,
      difficulty,
      stageSize.width,
      stageSize.height,
    );
    session.lastPlayheadMs = playheadMs;
    for (const result of session.rhythm.results.slice(firstNewResult)) {
      session.engine.feedback(result.judgement);
      showJudgement(result);
    }
    updateHud(playheadMs);
    const now = windowTarget.performance.now();
    if (ripples.length) ripples = ripples.filter(ripple => now - ripple.t0 < 700);
    if (playheadMs >= -1600 || hud?.lastCountdown === '') {
      drawStage(root, entry.show, session.rhythm, playheadMs, difficulty, {
        reducedMotion: reducedMotionEnabled(),
        geometry: stageGeometry,
        ctx: stageContext,
        ripples,
        combo: session.rhythm.combo,
        hitFlash: Math.max(0, 1 - (now - session.lastHitAt) / 220),
        missFlash: Math.max(0, 1 - (now - session.lastMissAt) / 320),
      });
    }
    if (session.rhythm.finished && playheadMs >= (entry.show.durationMs ?? 0)) {
      void finishSession().catch(error => windowTarget.reportError?.(error));
      return;
    }
    scheduleFrame();
  };

  const scheduleFrame = () => {
    if (frameId || !session || session.paused || session.finishing) return;
    frameId = windowTarget.requestAnimationFrame(() => {
      frameId = 0;
      updatePerformance();
    });
  };

  const renderPage = () => {
    clearPageBindings();
    root.innerHTML = renderPerformanceView({
      campaign: entry.campaign,
      show: entry.show,
      runtime: session,
      preferences,
      saveUnavailable: entry.saveUnavailable,
      restoredActiveShow: entry.restoredActiveShow,
      tutorial: entry.tutorial,
    });

    const muteButton = root.querySelector('#mute-toggle');
    listen(muteButton, 'click', () => {
      const changes = { muted: !preferences.muted };
      setPreferences({ ...preferences, ...changes });
      muteButton.textContent = preferences.muted ? '声音关闭' : '声音开启';
      muteButton.setAttribute('aria-pressed', String(preferences.muted));
      onPreferenceChange?.(changes);
    });

    const startButton = root.querySelector('#start-performance');
    listen(root.querySelector('#exit-tutorial'), 'click', () => { void onExit?.(); });
    listen(startButton, 'click', () => { void startSession(); });
    listen(root.querySelector('#pause-toggle'), 'click', () => { void pauseSession(); });
    listen(root.querySelector('#resume-performance'), 'click', () => { void resumeSession(); });
    listen(root.querySelector('#retry-performance'), 'click', () => {
      void retrySession().catch(error => windowTarget.reportError?.(error));
    });

    const surface = root.querySelector('#stage-scene');
    if (surface) {
      controls = bindRhythmControls({
        surface,
        windowTarget,
        onEvent: handleRhythmInput,
      });
    }

    resizeStageCanvas(root, windowTarget.devicePixelRatio);
    refreshStageSize();
    initializeHud();
    updateHud(session?.engine.getPlayhead());
    drawStage(
      root,
      entry.show,
      session?.rhythm,
      session?.engine?.getPlayhead(),
      activeDifficulty(),
      {
        reducedMotion: reducedMotionEnabled(),
        geometry: stageGeometry,
        ctx: stageContext,
        combo: session?.rhythm.combo ?? 0,
      },
    );

    listen(windowTarget, 'resize', () => {
      if (resizeTimer) windowTarget.clearTimeout(resizeTimer);
      resizeTimer = windowTarget.setTimeout(() => {
        resizeTimer = 0;
        if (!entered || !entry) return;
        resizeStageCanvas(root, windowTarget.devicePixelRatio);
        refreshStageSize();
        drawStage(
          root,
          entry.show,
          session?.rhythm,
          session?.engine?.getPlayhead(),
          activeDifficulty(),
          {
            reducedMotion: reducedMotionEnabled(),
            geometry: stageGeometry,
            ctx: stageContext,
            combo: session?.rhythm.combo ?? 0,
          },
        );
      }, 150);
    });
    listen(documentTarget, 'visibilitychange', () => {
      if (documentTarget.hidden && session && !session.paused) void pauseSession();
    });
  };

  const startSession = async () => {
    if (startPromise) return startPromise;
    if (session) return;
    startPromise = (async () => {
      const engine = createEngine();
      session = {
        engine,
        rhythm: createRhythmRuntime(entry.show.chart, entry.campaign.showIndex),
        paused: false,
        finishing: false,
        lastPlayheadMs: -3000,
        lastHitAt: 0,
        lastMissAt: 0,
      };
      ripples = [];
      engine.setMuted(preferences.muted);
      engine.setVolume(preferences.volume / 100);
      await engine.start(entry.show.beatsMs, entry.show.music);
      if (!entered || session?.paused) return;
      renderPage();
      root.querySelector('#show-intro')?.setAttribute('hidden', '');
      const audioNote = root.querySelector('#audio-note');
      if (audioNote) {
        audioNote.textContent = engine.isAvailable()
          ? entry.saveUnavailable ? '本地记录不可用' : ''
          : '音频不可用，当前使用视觉节拍。';
      }
      const banner = root.querySelector('#judgement-banner');
      if (banner) banner.textContent = '准备就绪';
      root.querySelector('#stage-scene')?.focus({ preventScroll: true });
      scheduleFrame();
    })();
    try {
      await startPromise;
    } finally {
      startPromise = null;
    }
  };

  const pauseSession = async ({ updatePage = true } = {}) => {
    if (!session || session.paused) return pausePromise;
    const targetSession = session;
    targetSession.paused = true;
    controls?.reset();
    cancelFrame();
    pausePromise = (async () => {
      if (startPromise) await startPromise;
      if (session !== targetSession) return;
      await targetSession.engine.pause();
      if (updatePage && entered) {
        const overlay = root.querySelector('#pause-overlay');
        if (overlay) overlay.hidden = false;
        const pauseButton = root.querySelector('#pause-toggle');
        if (pauseButton) pauseButton.textContent = '已暂停';
      }
    })();
    try {
      await pausePromise;
    } finally {
      if (session === targetSession) pausePromise = null;
    }
  };

  const resumeSession = async () => {
    if (!session || !session.paused) return;
    const targetSession = session;
    if (pausePromise) await pausePromise;
    if (!entered || session !== targetSession) return;
    await targetSession.engine.resume();
    if (!entered || session !== targetSession) return;
    targetSession.paused = false;
    const overlay = root.querySelector('#pause-overlay');
    if (overlay) overlay.hidden = true;
    const pauseButton = root.querySelector('#pause-toggle');
    if (pauseButton) pauseButton.textContent = '暂停';
    scheduleFrame();
  };

  const retrySession = async () => {
    if (retryPromise) return retryPromise;
    if (!entered || !session?.paused || session.finishing) return;
    const options = { ...entry, preferences: { ...preferences }, autoStart: true };
    retryPromise = (async () => {
      const releasing = dispose();
      const version = lifecycleVersion;
      await releasing;
      if (version !== lifecycleVersion) return;
      await enter(options);
    })();
    try { await retryPromise; } finally { retryPromise = null; }
  };

  async function enter(options) {
    const version = ++lifecycleVersion;
    if (disposePromise) await disposePromise;
    if (version !== lifecycleVersion) return;
    entered = true;
    entry = {
      ...options,
      saveUnavailable: options.saveUnavailable ?? false,
      restoredActiveShow: options.restoredActiveShow ?? false,
    };
    if (options.preferences) setPreferences(options.preferences);
    renderPage();
    if (session?.paused) await resumeSession();
    else if (options.autoStart) await startSession();
  }

  async function leave() {
    lifecycleVersion += 1;
    entered = false;
    const pendingPause = session && !session.paused
      ? pauseSession({ updatePage: false })
      : pausePromise;
    clearPageBindings();
    cancelFrame();
    await pendingPause;
  }

  function setPreferences(nextPreferences) {
    preferences = { ...preferences, ...nextPreferences };
    session?.engine.setMuted(preferences.muted);
    session?.engine.setVolume(preferences.volume / 100);
  }

  async function dispose() {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      await leave();
      const targetSession = session;
      if (!targetSession) return;
      session = null;
      startPromise = null;
      pausePromise = null;
      await targetSession.engine.destroy();
      entry = null;
      hud = null;
      ripples = [];
      stageSize = { width: 400, height: 400 };
      stageGeometry = null;
      stageContext = null;
    })();
    try {
      await disposePromise;
    } finally {
      disposePromise = null;
    }
  }

  return { enter, leave, setPreferences, dispose };
}
