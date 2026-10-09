import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioEngine } from '../src/audio.js';

class FakeAudioContext {
  currentTime = 0;
  state = 'suspended';
  destination = {};
  oscillatorStarts = [];
  gainNodes = [];
  failOscillator = false;

  async resume() {
    this.state = 'running';
  }

  async suspend() {
    this.state = 'suspended';
  }

  async close() {
    this.state = 'closed';
  }

  createOscillator() {
    const context = this;
    if (context.failOscillator) throw new Error('audio node unavailable');
    return {
      frequency: { setValueAtTime() {} },
      connect() {},
      start(time) { context.oscillatorStarts.push(time); },
      stop() {},
    };
  }

  createGain() {
    const node = {
      connection: null,
      gain: {
        value: 1,
        setValueAtTime(value) { this.value = value; },
        setTargetAtTime(value) { this.value = value; },
        exponentialRampToValueAtTime() {},
      },
      connect(target) { this.connection = target; },
    };
    this.gainNodes.push(node);
    return node;
  }
}

test('starts beat time after the three-second count-in and schedules in order', async () => {
  const context = new FakeAudioContext();
  const events = [];
  const engine = createAudioEngine({ contextFactory: () => context, onBeat: (event) => events.push(event) });
  await engine.start([0, 500]);
  assert.equal(engine.getCountdown(), 3);
  assert.equal(engine.getPlayhead(), -3000);

  context.currentTime = 3.39;
  engine.update();
  assert.deepEqual(events, [{ index: 0, beatMs: 0 }]);
  assert.deepEqual(context.oscillatorStarts, [0.02, 1.02, 2.02, 3.5, 3.5]);
});

test('freezes playhead while paused and resumes from that same point', async () => {
  const context = new FakeAudioContext();
  const engine = createAudioEngine({ contextFactory: () => context });
  await engine.start([0, 500]);
  context.currentTime = 3.2;
  engine.update();
  const frozen = engine.getPlayhead();
  assert.equal(frozen, 200);
  await engine.pause();
  context.currentTime = 8;
  assert.equal(engine.getPlayhead(), frozen);
  await engine.resume();
  assert.equal(engine.getPlayhead(), frozen);
});

test('does not replay visual beat callbacks after pause and resume', async () => {
  const context = new FakeAudioContext();
  const events = [];
  const engine = createAudioEngine({ contextFactory: () => context, onBeat: (event) => events.push(event) });
  await engine.start([0, 500]);
  context.currentTime = 3;
  engine.update();
  await engine.pause();
  context.currentTime = 10;
  await engine.resume();
  engine.update();
  assert.deepEqual(events, [{ index: 0, beatMs: 0 }]);
  context.currentTime += 0.5;
  engine.update();
  assert.deepEqual(events, [{ index: 0, beatMs: 0 }, { index: 1, beatMs: 500 }]);
});

test('mute silences generated cues but keeps visual beat callbacks active', async () => {
  const context = new FakeAudioContext();
  const events = [];
  const engine = createAudioEngine({ contextFactory: () => context, onBeat: (event) => events.push(event) });
  await engine.start([0, 500]);
  engine.setMuted(true);
  engine.feedback('perfect');
  context.currentTime = 3;
  engine.update();
  assert.deepEqual(events, [{ index: 0, beatMs: 0 }]);
  assert.equal(context.oscillatorStarts.length, 3);
});

test('routes cues through a master gain that can change before and during playback', async () => {
  const context = new FakeAudioContext();
  const engine = createAudioEngine({ contextFactory: () => context });
  assert.equal(typeof engine.setVolume, 'function');

  engine.setVolume(0.35);
  await engine.start([0]);
  const masterGain = context.gainNodes[0];
  assert.equal(masterGain.gain.value, 0.35);
  assert.equal(masterGain.connection, context.destination);
  assert.ok(context.gainNodes.slice(1).every((node) => node.connection === masterGain));

  engine.setVolume(0.6);
  assert.equal(masterGain.gain.value, 0.6);
  engine.setVolume(2);
  assert.equal(masterGain.gain.value, 1);
});

test('falls back to an injected monotonic clock when audio creation fails', async () => {
  let now = 1000;
  const events = [];
  const engine = createAudioEngine({
    contextFactory: () => { throw new Error('audio blocked'); },
    onBeat: (event) => events.push(event),
    clock: () => now,
  });
  await engine.start([0]);
  assert.equal(engine.isAvailable(), false);
  assert.equal(engine.getCountdown(), 3);
  now += 3000;
  engine.update();
  assert.equal(engine.getPlayhead(), 0);
  assert.deepEqual(events, [{ index: 0, beatMs: 0 }]);
});

test('rebases the fallback clock after audio fails following a long pause', async () => {
  let now = 1000;
  const context = new FakeAudioContext();
  const engine = createAudioEngine({ contextFactory: () => context, clock: () => now });
  await engine.start([0, 500, 1000]);
  context.currentTime = 3.2;
  await engine.pause();

  now += 10_000;
  context.currentTime = 8;
  await engine.resume();
  assert.equal(engine.getPlayhead(), 200);

  context.failOscillator = true;
  engine.feedback('perfect');
  assert.equal(engine.getPlayhead(), 200);
  now += 250;
  assert.equal(engine.getPlayhead(), 450);
});

test('resume re-schedules beats silenced by pause instead of dropping them', async () => {
  const context = new FakeAudioContext();
  const engine = createAudioEngine({ contextFactory: () => context });
  await engine.start([0, 500]);
  context.currentTime = 3.45;
  engine.update();
  const scheduledBeforePause = context.oscillatorStarts.length;
  assert.ok(scheduledBeforePause > 3);

  await engine.pause();
  await engine.resume();
  engine.update();
  assert.ok(context.oscillatorStarts.length > scheduledBeforePause);
});

test('starting twice releases the previous audio context', async () => {
  const contexts = [];
  const engine = createAudioEngine({ contextFactory: () => {
    const context = new FakeAudioContext();
    contexts.push(context);
    return context;
  } });
  await engine.start([0]);
  await engine.start([0]);
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].state, 'closed');
  assert.equal(engine.isAvailable(), true);
  assert.equal(engine.getPlayhead(), -3000);
});
