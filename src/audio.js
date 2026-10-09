const COUNT_IN_MS = 3000;
const LOOKAHEAD_SECONDS = 0.12;
const FEEDBACK_FREQUENCIES = { perfect: 880, good: 587, miss: 220 };
const MELODY = [261.63, 293.66, 349.23, 392, 440, 523.25, 587.33, 659.25];

export function createAudioEngine({
  contextFactory = () => new AudioContext(),
  onBeat = () => {},
  clock = () => performance.now(),
} = {}) {
  let context = null;
  let outputGain = null;
  let available = false;
  let muted = false;
  let volume = 1;
  let running = false;
  let paused = false;
  let pausedElapsed = 0;
  let audioOrigin = 0;
  let clockOrigin = 0;
  let beatsMs = [];
  let firedBeats = [];
  let firedCursor = 0;
  let scheduledBeats = new Set();
  let sources = [];

  function applyVolume() {
    if (!outputGain || !context) return;
    if (typeof outputGain.gain.setTargetAtTime === 'function') {
      outputGain.gain.setTargetAtTime(volume, context.currentTime, 0.015);
    } else {
      outputGain.gain.value = volume;
    }
  }

  function elapsedSeconds() {
    if (!running) return 0;
    if (paused) return pausedElapsed;
    if (available && context) return context.currentTime - audioOrigin;
    return (clock() - clockOrigin) / 1000;
  }

  function stopSources() {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // A source may already have ended before pause or teardown.
      }
    }
    sources = [];
  }

  function switchToClockFallback() {
    if (!available) return;
    const elapsed = elapsedSeconds();
    available = false;
    clockOrigin = clock() - elapsed * 1000;
  }

  function playTone(frequency, atTime, duration = 0.08, volume = 0.08, type = 'sine') {
    if (!available || muted || !context || context.state !== 'running') return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, atTime);
      gain.gain.setValueAtTime(0.0001, atTime);
      gain.gain.exponentialRampToValueAtTime(volume, atTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, atTime + duration);
      oscillator.connect(gain);
      gain.connect(outputGain ?? context.destination);
      oscillator.onended = () => {
        const at = sources.indexOf(oscillator);
        if (at >= 0) sources.splice(at, 1);
        try { gain.disconnect(); } catch { /* Already torn down. */ }
      };
      oscillator.start(atTime);
      oscillator.stop(atTime + duration + 0.01);
      sources.push(oscillator);
    } catch {
      switchToClockFallback();
    }
  }

  function getPlayhead() {
    return elapsedSeconds() * 1000 - COUNT_IN_MS;
  }

  function getCountdown() {
    return Math.max(0, Math.ceil(COUNT_IN_MS / 1000 - elapsedSeconds()));
  }

  function scheduleCountIn() {
    if (!available || !context) return;
    const startAt = context.currentTime + 0.02;
    for (let beat = 0; beat < 3; beat += 1) {
      playTone(beat === 2 ? 880 : 660, startAt + beat, 0.12, 0.09, 'triangle');
    }
  }

  function update() {
    if (!running || paused) return;
    const playhead = getPlayhead();

    while (firedCursor < beatsMs.length && firedBeats[firedCursor]) firedCursor += 1;
    for (let index = firedCursor; index < beatsMs.length; index += 1) {
      const beatMs = beatsMs[index];
      if (!firedBeats[index] && playhead >= beatMs) {
        firedBeats[index] = true;
        onBeat({ index, beatMs });
      }

      const timeUntilBeat = (beatMs - playhead) / 1000;
      if (
        available
        && !muted
        && !firedBeats[index]
        && !scheduledBeats.has(index)
        && timeUntilBeat > 0
        && timeUntilBeat <= LOOKAHEAD_SECONDS
      ) {
        const when = audioOrigin + COUNT_IN_MS / 1000 + beatMs / 1000;
        const beatTone = index % 4 === 0 ? MELODY[(index / 4) % MELODY.length] : 82.41;
        playTone(beatTone, Math.max(context.currentTime + 0.005, when), 0.11, 0.075, index % 4 === 0 ? 'triangle' : 'sine');
        if (index % 2 === 1) playTone(880, Math.max(context.currentTime + 0.005, when), 0.025, 0.025, 'square');
        scheduledBeats.add(index);
      }
    }
  }

  async function start(chartBeatsMs) {
    if (context) {
      try {
        await context.close();
      } catch {
        // A previous run may already have released its context.
      }
      context = null;
      outputGain = null;
    }
    stopSources();
    beatsMs = [...chartBeatsMs];
    firedBeats = beatsMs.map(() => false);
    firedCursor = 0;
    scheduledBeats = new Set();
    running = true;
    paused = false;
    pausedElapsed = 0;
    clockOrigin = clock();

    try {
      context = contextFactory();
      await context.resume();
      available = context.state === 'running';
      if (available) {
        outputGain = context.createGain();
        outputGain.gain.setValueAtTime(volume, context.currentTime);
        outputGain.connect(context.destination);
        audioOrigin = context.currentTime;
        scheduleCountIn();
      }
    } catch {
      available = false;
      context = null;
    }
  }

  async function pause() {
    if (!running || paused) return;
    pausedElapsed = elapsedSeconds();
    paused = true;
    stopSources();
    scheduledBeats = new Set();
    if (available && context) {
      try {
        await context.suspend();
      } catch {
        switchToClockFallback();
      }
    }
  }

  async function resume() {
    if (!running || !paused) return;
    if (available && context) {
      try {
        await context.resume();
        audioOrigin = context.currentTime - pausedElapsed;
      } catch {
        available = false;
        clockOrigin = clock() - pausedElapsed * 1000;
      }
    } else {
      clockOrigin = clock() - pausedElapsed * 1000;
    }
    for (const index of [...scheduledBeats]) {
      if (!firedBeats[index]) scheduledBeats.delete(index);
    }
    paused = false;
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted) {
      stopSources();
      scheduledBeats = new Set();
    } else {
      for (const index of [...scheduledBeats]) {
        if (!firedBeats[index]) scheduledBeats.delete(index);
      }
    }
  }

  function setVolume(value) {
    const numeric = Number(value);
    volume = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 1;
    applyVolume();
  }

  function feedback(judgement) {
    const frequency = FEEDBACK_FREQUENCIES[judgement];
    if (!frequency || !available || muted || !context || context.state !== 'running') return;
    playTone(frequency, context.currentTime + 0.005, 0.13, 0.07, 'triangle');
  }

  async function destroy() {
    stopSources();
    running = false;
    paused = false;
    if (context) {
      try {
        await context.close();
      } catch {
        available = false;
      }
    }
    context = null;
    outputGain = null;
    available = false;
  }

  return {
    start,
    pause,
    resume,
    setMuted,
    setVolume,
    feedback,
    update,
    getPlayhead,
    getCountdown,
    isAvailable: () => available,
    destroy,
  };
}
