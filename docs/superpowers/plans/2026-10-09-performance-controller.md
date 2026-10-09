# 演出控制模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把演出 runtime、音频、输入、Canvas、HUD 和动画循环从 `src/main.js` 收拢到可独立验证的 `src/performance-controller.js`，保持玩家行为和存档兼容。

**Architecture:** 创建单例演出控制器作为 `main.js` 与演出内部实现之间的唯一接缝。控制器拥有可保留的会话状态，`leave()` 只暂停和解绑页面，`dispose()` 才销毁资源；`main.js` 仅传入当前赛季数据并处理完成结算与设置持久化。

**Tech Stack:** 浏览器原生 ES modules、Canvas 2D、Web Audio 现有适配器、Node.js `node:test`，无新增依赖或构建步骤。

**Spec:** `docs/superpowers/specs/2026-10-09-performance-controller-design.md`

## Global Constraints

- 不修改谱面、判定窗口、计分、经营规则、页面结构、CSS 或本地存档格式。
- 不引入框架、构建工具或第三方依赖；继续使用浏览器原生 ES modules。
- `src/performance-controller.js` 的公开接口只能是 `enter`、`leave`、`setPreferences`、`dispose`。
- 所有公开生命周期方法必须幂等；每场最多调用一次 `onComplete`，每个活动页面最多一个帧循环和一组输入/resize 监听器。
- `leave()` 保留 rhythm runtime；`dispose()` 清空并销毁当前会话，但同一控制器实例可用于下一场或下一赛季。
- 继续使用 `audio.js` 的单调时钟回退；音频不可用不能阻断演出。
- 遵守项目指令：禁止批量或递归删除；本计划不需要删除文件。
- 当前目录不是 Git 仓库。每个任务以聚焦测试通过作为检查点，不执行 Git 提交；若执行前已初始化 Git，则每个任务通过后各提交一次。

## Review Focus

- 快速双击开始或并发两次 `enter({ autoStart: true })`：只能创建/启动一个引擎；Task 1 的并发进入测试固定该行为。
- `engine.start()` 尚未完成时离开页面：启动完成后必须保持暂停且不能遗留帧循环；Task 2 的延迟启动测试固定该行为。
- 在会话创建前或销毁后修改偏好：新引擎仍应收到最新 muted/volume；Task 1 与 Task 2 的偏好测试固定该行为。
- `onComplete` 抛错：资源仍须释放且结算回调不得重入；Task 3 的异常完成测试固定该行为。
- 页面隐藏、重复 `leave()`/`dispose()` 或无会话时调用生命周期方法：不得报错、重复暂停、重复销毁或残留监听器；Task 2 的幂等测试固定该行为。

---

### Task 1: 建立控制器接缝与会话启动

**Files:**
- Create: `src/performance-controller.js`
- Create: `tests/performance-controller.test.mjs`

**Interfaces:**
- Consumes: `renderPerformanceView(...)`、`createRhythmRuntime(chart, showIndex)`、`bindRhythmControls({ surface, windowTarget, onEvent })`、`resizeStageCanvas(root)`、`drawStage(...)`。
- Produces: `createPerformanceController({ root, windowTarget, documentTarget, createEngine, onComplete, onPreferenceChange })`，返回 `{ enter, leave, setPreferences, dispose }`。
- `enter({ campaign, show, difficulty, preferences, saveUnavailable = false, restoredActiveShow = false, autoStart = false }): Promise<void>`；`difficulty` 是 `getDifficulty(...)` 返回值，控制器在内部叠加 `preferences.offsetMs`。传入 `preferences` 时替换最新偏好，省略时沿用 `setPreferences()` 或上次 `enter()` 保存的值。
- `setPreferences(preferences): void`；保存完整偏好快照，活动引擎立即调用 `setMuted(preferences.muted)` 与 `setVolume(preferences.volume / 100)`。

- [ ] **Step 1: 写最小 DOM、事件目标、帧调度器和伪音频引擎适配器**

  在 `tests/performance-controller.test.mjs` 中提供 `createHarness()`。它返回可统计监听器数量的 `root/windowTarget/documentTarget`、可手动执行单帧的 `frames`、可控制 `start()` Promise 的 `engine`，以及调用计数。最小元素映射必须覆盖演出模板查询的所有 ID、`[role="progressbar"]` 和 `#stage-art` 的 2D context。

- [ ] **Step 2: 写失败的启动与公开接口测试**

```js
test('exposes only the four lifecycle methods and waits for manual start', async () => {
  assert.deepEqual(Object.keys(controller).sort(), ['dispose', 'enter', 'leave', 'setPreferences']);
  await controller.enter({ ...options, autoStart: false });
  assert.equal(createEngineCalls, 0);
  root.click('#start-performance');
  await flushAsync();
  assert.equal(createEngineCalls, 1);
  assert.equal(engine.startCalls, 1);
});

test('coalesces concurrent automatic entry into one session', async () => {
  await Promise.all([
    controller.enter({ ...options, autoStart: true }),
    controller.enter({ ...options, autoStart: true }),
  ]);
  assert.equal(createEngineCalls, 1);
  assert.equal(engine.startCalls, 1);
  assert.equal(frames.pendingCount, 1);
  assert.equal(windowTarget.listenerCount('keydown'), 1);
});

test('stores preferences before a session and syncs an active engine', async () => {
  controller.setPreferences({ muted: true, volume: 35, reduceMotion: true, offsetMs: 20 });
  await controller.enter({ ...options, preferences: undefined, autoStart: true });
  assert.deepEqual(engine.mutedValues, [true]);
  assert.deepEqual(engine.volumeValues, [0.35]);
  controller.setPreferences({ muted: false, volume: 60, reduceMotion: false, offsetMs: -10 });
  assert.equal(engine.mutedValues.at(-1), false);
  assert.equal(engine.volumeValues.at(-1), 0.6);
});

test('routes the performance mute control through the preference callback', async () => {
  await controller.enter({ ...options, autoStart: false });
  root.click('#mute-toggle');
  assert.deepEqual(preferenceChanges, [{ muted: true }]);
});
```

- [ ] **Step 3: 运行聚焦测试并确认因模块不存在而失败**

  Run: `node --test tests/performance-controller.test.mjs`

  Expected: FAIL，错误指向无法导入 `src/performance-controller.js`。

- [ ] **Step 4: 实现控制器工厂、页面渲染和单次启动**

  在 `src/performance-controller.js` 中导出唯一工厂函数。控制器内部保存 `session`、最新 `entry`、最新偏好、控件绑定和帧 ID；`enter()` 先渲染/绑定当前页面，再按 `autoStart` 调用内部 `startSession()`。用同一个 pending Promise 合并并发启动，创建 runtime 和 engine 后应用偏好并调用 `engine.start(show.beatsMs)`。

- [ ] **Step 5: 运行聚焦测试并建立检查点**

  Run: `node --test tests/performance-controller.test.mjs`

  Expected: 本任务四个测试全部 PASS，活动页面恰有一组输入监听器和一个待执行帧。

### Task 2: 实现暂停、离场、恢复和销毁

**Files:**
- Modify: `src/performance-controller.js`
- Modify: `tests/performance-controller.test.mjs`

**Interfaces:**
- Consumes: Task 1 的单例 `session` 与 pending start Promise。
- Produces: `leave(): Promise<void>` 和 `dispose(): Promise<void>`；`leave()` 保留 session，`dispose()` 清空 session 且控制器可复用。
- 页面控件继续是控制器私有实现：`#pause-toggle` 调用内部 `pauseSession()`，`#resume-performance` 调用内部 `resumeSession()`，`visibilitychange` 只暂停活动且未暂停的会话。

- [ ] **Step 1: 写失败的生命周期测试**

```js
test('leave pauses, resets input, cancels frames, and enter resumes the same session', async () => {
  await controller.enter({ ...options, autoStart: true });
  engine.playhead = 250;
  frames.runNext();
  const progressBeforeLeave = root.text('#progress-value');
  await controller.leave();
  assert.equal(engine.pauseCalls, 1);
  assert.equal(controls.resetCalls, 1);
  assert.equal(controls.disposeCalls, 1);
  assert.equal(frames.pendingCount, 0);
  await controller.enter({ ...options, autoStart: false });
  assert.equal(createEngineCalls, 1);
  assert.equal(engine.resumeCalls, 1);
  assert.equal(frames.pendingCount, 1);
  assert.equal(root.text('#progress-value'), progressBeforeLeave);
});

test('leaving during a pending start cannot revive a detached page', async () => {
  const entering = controller.enter({ ...options, autoStart: true });
  const leaving = controller.leave();
  startGate.resolve();
  await Promise.all([entering, leaving]);
  assert.equal(engine.pauseCalls, 1);
  assert.equal(frames.pendingCount, 0);
});

test('hidden-page pause and repeated cleanup are idempotent', async () => {
  await controller.enter({ ...options, autoStart: true });
  documentTarget.hidden = true;
  documentTarget.dispatch('visibilitychange');
  await flushAsync();
  await controller.leave();
  await controller.leave();
  await controller.dispose();
  await controller.dispose();
  assert.equal(engine.destroyCalls, 1);
  assert.equal(documentTarget.listenerCount('visibilitychange'), 0);
  assert.equal(windowTarget.listenerCount('resize'), 0);
});

test('a disposed controller applies the latest preferences to its next session', async () => {
  await controller.enter({ ...options, autoStart: true });
  await controller.dispose();
  controller.setPreferences({ muted: true, volume: 20, reduceMotion: false, offsetMs: 0 });
  await controller.enter({ ...nextOptions, preferences: undefined, autoStart: true });
  assert.equal(createEngineCalls, 2);
  assert.equal(engines[1].volumeValues.at(-1), 0.2);
});
```

- [ ] **Step 2: 运行聚焦测试并确认生命周期断言失败**

  Run: `node --test tests/performance-controller.test.mjs`

  Expected: 新增测试 FAIL，已完成的 Task 1 测试保持 PASS。

- [ ] **Step 3: 实现页面级绑定和会话级清理**

  `leave()` 依次标记页面已离开、重置并 dispose 输入、取消帧、移除页面按钮与 resize/visibility 监听器，再等待 pending start 并暂停引擎。`enter()` 对保留且暂停的 session 重新渲染/绑定，调用 `engine.resume()` 并只创建一个帧。`dispose()` 先 `leave()`，再以单个 pending dispose Promise 合并重复调用，调用 `engine.destroy()` 并清空 runtime、HUD、Canvas 和涟漪。

- [ ] **Step 4: 固定 resize 与恢复行为**

  每次页面处于 entered 状态时至多绑定一个 150ms debounce resize handler；handler 只操作当前已渲染的演出 DOM。`leave()` 清除 pending timeout，`dispose()` 确保监听器移除；下一次 `enter()` 重新绑定。

- [ ] **Step 5: 运行聚焦测试并建立检查点**

  Run: `node --test tests/performance-controller.test.mjs`

  Expected: Task 1–2 全部 PASS；测试结束时所有伪事件目标监听器数量为 0。

### Task 3: 迁移输入判定、帧循环、Canvas、HUD 与完成回调

**Files:**
- Modify: `src/performance-controller.js`
- Modify: `tests/performance-controller.test.mjs`

**Interfaces:**
- Consumes: `advanceRhythmRuntime`、`processRhythmInput`、`getRhythmSummary`、`getShowBeatCue`、`drawStage`、`resizeStageCanvas` 与 Task 2 生命周期。
- Produces: `onComplete(summary): void | Promise<void>` 每场至多调用一次；控制器在调用前已停止帧、重置输入并销毁引擎。
- `difficultyWithOffset()` 返回 `{ ...entry.difficulty, offsetMs: preferences.offsetMs ?? 0 }`；所有判定、HUD cue 与总结使用同一份当前难度数据。

- [ ] **Step 1: 写失败的输入、帧与完成测试**

```js
test('advances and draws from the engine playhead while freezing a paused session', async () => {
  await controller.enter({ ...options, autoStart: true });
  engine.playhead = 250;
  frames.runNext();
  assert.equal(root.text('#progress-value'), '01 / 32');
  root.click('#pause-toggle');
  await flushAsync();
  const updateCalls = engine.updateCalls;
  frames.runAll();
  assert.equal(engine.updateCalls, updateCalls);
});

test('resets held rhythm input before the paused guard', async () => {
  await controller.enter({ ...options, autoStart: true });
  await controller.leave();
  assert.deepEqual(processedEvents.at(-1), { type: 'reset' });
});

test('completes once and disposes resources before notifying main', async () => {
  await controller.enter({ ...shortShowOptions, autoStart: true });
  engine.playhead = 10_000;
  frames.runNext();
  await flushAsync();
  assert.equal(engine.destroyCalls, 1);
  assert.equal(completeSummaries.length, 1);
  assert.equal(frames.pendingCount, 0);
  assert.equal(resourceSnapshotAtComplete.destroyed, true);
});

test('cleans up once even when onComplete throws', async () => {
  onComplete = () => { throw new Error('settlement failed'); };
  await controller.enter({ ...shortShowOptions, autoStart: true });
  engine.playhead = 10_000;
  frames.runNext();
  await flushAsync();
  assert.match(reportedErrors[0].message, /settlement failed/);
  assert.equal(engine.destroyCalls, 1);
  assert.equal(onCompleteCalls, 1);
});

test('finishes through the unavailable-audio fallback clock', async () => {
  engine.available = false;
  await controller.enter({ ...shortShowOptions, autoStart: true });
  fallbackClock.advance(10_000);
  frames.runNext();
  await flushAsync();
  assert.equal(completeSummaries.length, 1);
  assert.match(root.text('#audio-note'), /视觉节拍/);
});
```

- [ ] **Step 2: 运行聚焦测试并确认帧/HUD测试失败**

  Run: `node --test tests/performance-controller.test.mjs`

  Expected: 新增测试 FAIL，Task 1–2 测试保持 PASS。

- [ ] **Step 3: 迁移演出内部实现**

  从 `main.js` 当前实现逐项迁移 `judgementText`、舞台尺寸刷新、判定反馈、输入处理、HUD 更新和 `updatePerformance`。控制器内部使用 `windowTarget.requestAnimationFrame/cancelAnimationFrame`、`windowTarget.performance.now()` 与 `windowTarget.setTimeout/clearTimeout`，测试适配器无需修改浏览器全局对象。

- [ ] **Step 4: 实现一次性完成顺序与错误传播**

  内部 `finishSession()` 先原子设置 `finishing`，取得 `getRhythmSummary(runtime.rhythm, difficultyWithOffset())`，停止帧和输入并销毁 engine，再清空 session，最后 `await onComplete(summary)`。将完成 Promise 保存到内部，供帧回调只观察一次；回调异常通过 `windowTarget.reportError?.(error)` 报告，同时保证不会再次进入完成流程。

- [ ] **Step 5: 运行聚焦测试并建立检查点**

  Run: `node --test tests/performance-controller.test.mjs`

  Expected: 控制器全部测试 PASS，包含真实 rhythm runtime 驱动下的 HUD、暂停和完成路径。

### Task 4: 将主程序改接控制器并移除跨模块源码断言

**Files:**
- Modify: `src/main.js:1-597`
- Modify: `tests/presentation.test.mjs:103-174`
- Test: `tests/performance-controller.test.mjs`

**Interfaces:**
- Consumes: Task 3 的 `createPerformanceController(...)` 和四个公开方法。
- Produces: `main.js` 中唯一的控制器实例；完成回调负责 `settleShow`、保存 campaign 并重绘页面，偏好回调负责既有 `updatePreferences(changes)`。

- [ ] **Step 1: 先把依赖源码位置的展示测试改为接口/边界测试**

  删除 `tests/presentation.test.mjs` 中读取 `main.js` 函数体的 6 个测试：音频 playhead 接线、一次结算、暂停清理、暂停冻结、binder dispose、reset 顺序。相同行为必须已由 `tests/performance-controller.test.mjs` 的 Task 1–3 测试覆盖；保留纯 HTML/CSS 展示测试，并新增边界断言：

```js
test('main delegates performance internals to the controller boundary', async () => {
  const source = await readFile(new URL('src/main.js', projectUrl), 'utf8');
  assert.match(source, /createPerformanceController\(/);
  assert.match(source, /performanceController\.enter\(/);
  assert.match(source, /performanceController\.leave\(/);
  assert.match(source, /performanceController\.setPreferences\(/);
  assert.doesNotMatch(source, /createAudioEngine\s*\(\s*\)|createRhythmRuntime|requestAnimationFrame|bindRhythmControls|drawStage/);
});
```

- [ ] **Step 2: 运行展示与控制器测试并确认边界断言失败**

  Run: `node --test tests/performance-controller.test.mjs tests/presentation.test.mjs`

  Expected: 控制器测试 PASS，新边界测试 FAIL，因为 `main.js` 仍直接拥有演出内部实现。

- [ ] **Step 3: 在 `main.js` 创建并接线单例控制器**

  导入 `createPerformanceController` 与 `createAudioEngine`，创建控制器时传入 `app/window/document/createAudioEngine`。`onComplete(summary)` 执行 `campaign = settleShow(campaign, summary)`、清除 `restoredActiveShow`、`persistCampaign()` 和 `render()`；`onPreferenceChange(changes)` 调用现有 `updatePreferences(changes)`。

  将主渲染函数签名改为 `render({ autoStartPerformance = false } = {})`，演出分支调用 `renderShow({ autoStart: autoStartPerformance })`；新赛季和经营行动进入下一场时调用 `render({ autoStartPerformance: true })`，其他渲染使用默认值。`renderShow({ autoStart = false })` 只校验 show 并调用：

```js
performanceController.enter({
  campaign,
  show,
  difficulty: getDifficulty(campaign.difficulty),
  preferences,
  saveUnavailable,
  restoredActiveShow,
  autoStart,
});
```

  刷新恢复和尚未开始便离开再返回时使用 `autoStart: false`。仅当 `currentView === 'campaign' && campaign.phase === 'show'` 时，导航离开演出页前 `await performanceController.leave()`；返回 campaign 后用默认 `render()` 触发再次 `enter()`。设置更新后调用 `performanceController.setPreferences(preferences)`。

- [ ] **Step 4: 删除 `main.js` 已迁移的演出状态与函数**

  删除 `runtime/frameId/unbindRhythmControls/hud/ripples/stageSize/stageGeom/stageCtx/resizeTimer`，以及 `refreshStageSize`、`judgementText`、`beginPerformance`、`activeDifficulty`、`pulseStat`、`showJudgement`、`handleRhythmInput`、`updatePerformance`、`updateHud`、`finishPerformance`、`pausePerformance`、`resumePerformance` 和全局 resize/visibility handler。同步移除不再需要的 rhythm/controls/stage imports；`main.js` 不读取控制器内部状态。

- [ ] **Step 5: 运行聚焦测试并建立检查点**

  Run: `node --test tests/performance-controller.test.mjs tests/presentation.test.mjs tests/views.test.mjs tests/progression.test.mjs`

  Expected: 全部 PASS；`main.js` 只通过四方法接口管理演出。

### Task 5: 更新维护文档并执行完整验证

**Files:**
- Modify: `docs/开发维护指南.md`
- Modify: `docs/superpowers/specs/2026-10-09-performance-controller-design.md`
- Modify: `docs/superpowers/plans/2026-10-09-performance-controller.md`

**Interfaces:**
- Consumes: Task 4 的最终模块边界。
- Produces: 与现行代码一致的维护说明、完成状态和验证记录。

- [ ] **Step 1: 更新代码结构与维护约定**

  将 `src/main.js` 描述改为“路由、赛季状态、存档、经营与结算编排”；增加 `src/performance-controller.js` 行，说明其拥有演出 runtime、音频、输入、Canvas、HUD 与生命周期。注明修改暂停/恢复/演出页绑定时先运行 `tests/performance-controller.test.mjs`。

- [ ] **Step 2: 运行完整自动化测试**

  Run: `node --test`

  Expected: 0 failures；既有 106 个测试加新增控制器测试全部通过。

- [ ] **Step 3: 运行覆盖率与语法检查**

  Run: `node --test --experimental-test-coverage`

  Expected: 0 failures，`src/performance-controller.js` 的行覆盖率不低于 85%，项目总行覆盖率不低于当前基线 90%。

  Run: `Get-ChildItem src -Filter *.js | ForEach-Object { node --check $_.FullName }`

  Expected: 每个源文件退出码均为 0，无语法错误。

- [ ] **Step 4: 用本地 HTTP 服务执行浏览器验收**

  Run: `python -m http.server 50967 --bind 127.0.0.1`

  在桌面和手机 viewport 依次验证：新赛季自动进入三秒倒数；ASDFHJKL 与八轨触控输入；静音与音量同步；暂停画面冻结并恢复原进度；导航离开再返回恢复同一场；刷新后显示“本场演出待继续”；完成仅结算一次并进入经营/结局；控制台无 error。

- [ ] **Step 5: 写回完成状态与验证结果**

  将规格状态改为“已实施”，在本计划末尾追加实际测试数量、覆盖率、语法检查和浏览器 viewport/控制台结果。若任一步未通过，保持规格为“已批准”，记录失败命令与现象，不声明完成。

## 执行记录

- 实施日期：2026-10-09。
- `src/main.js` 从 597 行缩减到 288 行，演出内部状态迁移到 `src/performance-controller.js`。
- `node --test`：117/117 通过，0 failures。
- `node --test --experimental-test-coverage`：总行覆盖率 92.14%，`src/performance-controller.js` 行覆盖率 96.07%。
- `node --check`：`src/` 下 14 个 JavaScript 文件全部通过。
- 浏览器桌面验收：自动开始、暂停冻结、恢复、离开/返回保留进度、刷新恢复入口和一次性结算均通过。
- 浏览器手机验收：390×844 viewport 下显示 8 个轨道按钮，舞台宽 362px，无页面横向溢出。
- 浏览器控制台：桌面与手机验收均无 warning/error。
- 浏览器验收发现并以 RED→GREEN 测试修复“返回进行中的演出时倒数标签残留 3”的问题。
