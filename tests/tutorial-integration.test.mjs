import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, startCampaign, settleShow } from '../src/progression.js';
import { saveCampaign } from '../src/storage.js';

class Element {
  listeners = new Map();
  classList = { toggle() {}, add() {}, remove() {} };
  style = {};
  dataset = {};
  textContent = '';
  hidden = false;
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? new Set();
    callbacks.add(callback); this.listeners.set(type, callbacks);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, event = {}) {
    event.preventDefault ??= () => {};
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
  setAttribute() {}
  focus() {}
}

class Root extends Element {
  elements = new Map();
  set innerHTML(html) {
    this.html = html; this.elements.clear();
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
      if (id !== 'stage-art') this.elements.set(`#${id}`, new Element());
    }
  }
  get innerHTML() { return this.html; }
  querySelector(selector) { return this.elements.get(selector) ?? null; }
  querySelectorAll() { return []; }
  click(selector) { assert.ok(this.querySelector(selector), selector); this.querySelector(selector).dispatch('click'); }
}

const flush = () => new Promise(resolve => setImmediate(resolve));

async function boot(t, hash = '#home') {
  const original = Object.fromEntries(['window', 'document', 'history', 'localStorage', 'performance']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => { for (const [name, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  } });
  const data = new Map();
  const writes = [];
  const storage = { getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); writes.push(key); }, removeItem: key => data.delete(key) };
  const campaign = settleShow(startCampaign(newCampaign()), { accuracy: 0.8, score: 12345, comboMax: 4, rank: 'B' });
  saveCampaign(campaign, storage);
  const app = new Root();
  const nav = new Root();
  const brand = new Element();
  const win = new Element();
  const doc = new Element();
  const frames = new Map();
  let frameId = 0;
  let clockMs = 0;
  const clock = { now: () => clockMs };
  win.location = { hash };
  win.scrollTo = () => {};
  win.performance = clock;
  win.matchMedia = () => ({ matches: false });
  win.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  doc.body = new Element(); doc.documentElement = new Element();
  doc.querySelector = selector => ({ '#app': app, '#app-nav': nav, '.brand': brand })[selector] ?? null;
  const pushes = [];
  const history = { pushState: (_, __, value) => { pushes.push(value); win.location.hash = value; } };
  for (const [name, value] of Object.entries({ window: win, document: doc, history, localStorage: storage, performance: clock })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  await import(`../src/main.js?integration=${hash}-${Date.now()}-${Math.random()}`);
  await flush();
  const before = JSON.stringify([...data]);
  const writesBefore = writes.length;
  return { app, win, pushes, data, writes, before, writesBefore,
    runAt(ms) { clockMs = ms; const [id, fn] = frames.entries().next().value ?? [];
      assert.ok(fn, 'a live performance frame exists'); frames.delete(id); fn(); } };
}

test('real app completes and replays rehearsal without changing the saved campaign or archive', async t => {
  const h = await boot(t);
  h.app.click('#open-tutorial'); await flush();
  assert.match(h.app.innerHTML, /开始练习/);
  h.app.click('#start-performance'); await flush();
  h.runAt(33001); await flush();
  assert.match(h.app.innerHTML, /练习完成/);
  assert.match(h.app.innerHTML, /再练一次/);
  assert.equal(JSON.stringify([...h.data]), h.before);
  assert.equal(h.writes.length, h.writesBefore);
  h.app.click('#retry-tutorial'); await flush();
  assert.match(h.app.innerHTML, /开始练习/);
  h.app.click('#exit-tutorial'); await flush();
  assert.match(h.app.innerHTML, /12345|当前赛季/);
  assert.equal(JSON.stringify([...h.data]), h.before);
  assert.equal(h.win.listeners.get('keydown')?.size ?? 0, 0);
});

test('browser history restoration of rehearsal does not push a new history entry', async t => {
  const h = await boot(t);
  h.win.location.hash = '#tutorial';
  h.win.dispatch('popstate'); await flush();
  assert.match(h.app.innerHTML, /开始练习/);
  assert.deepEqual(h.pushes, []);
  h.app.click('#exit-tutorial'); await flush();
});
