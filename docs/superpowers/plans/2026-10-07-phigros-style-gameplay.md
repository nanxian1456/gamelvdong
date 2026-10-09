# 自由判定线节奏玩法实施计划（历史计划）

> 状态：该计划针对的自由判定线、多手势玩法已被当前八轨钢琴块玩法取代。以下复选框和 A/D、空格、Flick、Drag 步骤是历史记录，不是当前待办；请从[README](../../../README.md)进入现行[开发维护指南](../../开发维护指南.md)和[玩家玩法说明](../../玩法说明.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三场单机演出改为带 Tap、Hold、Flick、Drag 的下落音符玩法，同时保留既有经营赛季、音频时钟和本地结算。

**Architecture:** `content.js` 提供每场谱面与难度参数；`rhythm.js` 独立维护音符状态、空间/时间判定和计分；`controls.js` 输出规范化输入事件；`stage.js` 绘制谱面；`main.js` 编排音频时钟、暂停、HUD 和结算。先以第一场完成端到端切片，再验证三场赛季流程。

**Tech Stack:** 原生 JavaScript ES modules、Canvas 2D、浏览器 Pointer/Keyboard Events、Node.js built-in test runner；不新增运行时依赖。

**Spec:** [`../specs/2026-10-07-phigros-style-gameplay-design.md`](../specs/2026-10-07-phigros-style-gameplay-design.md)

## Global Constraints

- 谱面区域使用纯黑背景；固定白色斜判定线、蓝色键盘光标、红色圆形 Flick 音符。
- 键盘只用 A/D 沿判定线移动，空格接触；键盘 Flick 只使用左右方向。
- 每场保留 32 个节拍锚点及既有 BPM，音频播放头是唯一判定时间源。
- 下落速度倍率：轻松 0.85×、标准 1.0×、聚光灯 1.2×；既有判定窗口与难度经济倍率不变。
- 标准难度下落时间为 1500ms；首版移动速度为每秒 1.0 个舞台宽度。
- 位置容差为舞台宽度的 3.5%，限制在 20 至 36 CSS px；Flick 指针手势 160ms 内移动至少舞台宽度的 5%。
- 判定基础分 Perfect 1000、Good 650、Miss 0；阶段倍率为 1.0×、1.25×、1.5×；连击加分为当前连击数 × 10。
- 准确率只按基础判定分归一化；评级阈值沿用 S 95%、A 82%、B 65%。
- 不改变本地存档版本、单机范围、音量设置或经营结算规则；不新增网络服务、音频素材或依赖。
- 项目没有 `.git`；不添加提交步骤，不批量删除任何文件或目录。

## Review Focus

- 静态谱面字段错误或边界值异常；Task 1 的图表契约测试检查有限且递增的 `hitMs`、有效类型、归一化坐标、有效方向、正持续时间，以及位于长音符时长内的有限递增 Drag 路径偏移。
- 相邻长音符要求键盘执行互斥的空格接触；Task 1 测试验证谱面不安排冲突时段。
- 键盘重复事件、丢失 keyup 或指针取消后输入卡住或重复触发 Flick；Task 3 测试验证 repeat 抑制、reset/dispose、pointercancel 与 blur 清理。
- 视口缩放、高 DPR、舞台边缘位置导致光标或判定坐标漂移；Task 4 测试覆盖几何映射、容差边界与 DPR 上限。
- 页面切后台或暂停期间重复判定、播放头继续前进；Task 5 测试验证冻结、恢复、输入重置和幂等结算。

---

### Task 1: 谱面与难度数据

**Files:**
- Modify: `src/content.js`
- Create: `tests/chart.test.mjs`

**Interfaces:**
- Produces: each `SHOWS[i]` retains `beatsMs` and adds `chart: ChartNote[]` with exactly 32 entries.
- `ChartNote = { id: string, type: 'tap'|'hold'|'flick'|'drag', hitMs: number, x: number, durationMs?: number, direction?: 'left'|'right', path?: Array<{ offsetMs: number, x: number }> }`.
- `hitMs` and each Drag `path[].offsetMs` are absolute milliseconds from show start; each Drag path point lies within `[hitMs, hitMs + durationMs]`.
- Produces: each difficulty adds `speedMultiplier` while preserving its existing windows and reward/score multipliers.

- [ ] **Step 1: Write chart contract tests** in `tests/chart.test.mjs`: assert all three charts contain 32 unique IDs; `hitMs` values are finite, strictly increasing, and match corresponding `beatsMs`; all four types appear in every chart; note and Drag path `x` values are finite in `[0,1]`; Hold/Drag have positive durations; Drag offsets are finite, strictly increasing, and within `[hitMs, hitMs + durationMs]`; Flick direction is `left` or `right`; long-note contact intervals do not conflict with another required contact; stage patterns are deterministic and vary positions/types.
- [ ] **Step 2: Run the new test to verify failure**

Run: `node --test tests/chart.test.mjs`  
Expected: FAIL because `SHOWS` has no `chart` field or difficulty speed multipliers.

- [ ] **Step 3: Add `chart` and `speedMultiplier` data** in `src/content.js`: preserve `beatsMs` for audio scheduling; author 32 events per show with `hitMs` aligned to each beat; use normalized target coordinates, left/right Flick directions, and non-overlapping Hold/Drag durations.
- [ ] **Step 4: Run the chart contract tests**

Run: `node --test tests/chart.test.mjs`  
Expected: PASS for all three charts and exact speed multipliers `[0.85, 1, 1.2]`.

### Task 2: 判定状态与计分核心

**Files:**
- Modify: `src/rhythm.js`
- Modify: `tests/rhythm.test.mjs`

**Interfaces:**
- Produces: `createRhythmRuntime(chart, stageIndex)` returns mutable per-show state: `noteStates`, `results`, `score`, `combo`, `comboMax`, `accuracyPoints`, `cursorX`, `axis`, `contact`, and `finished`.
- Produces: `processRhythmInput(runtime, input, playheadMs, difficulty, fieldWidthCssPx)` applies one normalized event to that state.
- Produces: `advanceRhythmRuntime(runtime, playheadMs, deltaMs, difficulty, fieldWidthCssPx)` advances cursor/sustain state and expires misses exactly once.
- Produces: `getRhythmSummary(runtime, difficulty)` returns `{ score, accuracy, rank, comboMax }` using the stage index stored in runtime.
- Input events: `{ type: 'key-down'|'key-up', key: 'a'|'d'|'space' }`, `{ type: 'pointer-down'|'pointer-move'|'pointer-up', x: number, y: number, pointerType: string, timeStamp: number }`, or `{ type: 'reset' }`; pointer coordinates are normalized to the stage rectangle.
- Drag path `offsetMs` values are absolute show-relative times; compare/interpolate them directly against the audio playhead.

- [ ] **Step 1: Add failing domain tests** in `tests/rhythm.test.mjs`: Perfect and Good at each exact inclusive timing boundary and Miss just outside Good for Easy/Standard/Spotlight; target-position tolerance `clamp(width × 0.035, 20, 36)` at minimum, interior, and maximum widths; keydown Flick direction; Hold/Drag completion and early release; Drag deviation beyond 100ms; one-time Miss expiry; all-miss completion; and accuracy independence from multipliers/combo.
- [ ] **Step 2: Verify the new domain tests fail**

Run: `node --test tests/rhythm.test.mjs`  
Expected: FAIL because the note runtime and spatial/gesture APIs are not defined.

- [ ] **Step 3: Implement the runtime and scoring transitions** in `src/rhythm.js`: keep exact difficulty timing windows; create one final result per chart note; use absolute chart-time Drag offsets when tracking path progress; use base points `{ perfect: 1000, good: 650, miss: 0 }`; calculate a hit as `round(base × stageMultiplier × difficulty.scoreMultiplier) + updatedCombo × 10`; reset combo and award zero on Miss; normalize accuracy from base points only; finish after all notes, including sustains, resolve.
- [ ] **Step 4: Run rhythm tests**

Run: `node --test tests/rhythm.test.mjs`  
Expected: PASS, including stage 3 Spotlight Good at combo 3 scoring `1249` and accuracy remaining `0.65` for a Good.

### Task 3: 键盘、鼠标与触屏输入

**Files:**
- Modify: `src/controls.js`
- Modify: `tests/controls.test.mjs`

**Interfaces:**
- Consumes: normalized event contract from Task 2.
- Produces: `bindRhythmControls({ surface, windowTarget, onEvent })` returns `{ reset(), dispose() }`.
- `reset()` emits a `reset` event and clears held keys/pointers; `dispose()` removes every listener and invokes `reset()` once.

- [ ] **Step 1: Add failing controls tests**: A/D keydown/up emits directional state once; repeated keydown does not create another movement edge or Flick; Space down/up tracks contact; pointer coordinates normalize against `surface.getBoundingClientRect()`; pointercancel and window blur reset state; pointerdown/up does not duplicate a synthesized click; events originating from unrelated buttons/inputs are ignored.
- [ ] **Step 2: Verify the controls tests fail**

Run: `node --test tests/controls.test.mjs`  
Expected: FAIL because the binder currently accepts only one pulse button.

- [ ] **Step 3: Implement the event adapter** in `src/controls.js` using scoped keyboard listeners and Pointer Events with pointer capture; suppress native repeat and compatibility click duplication; emit the Task 2 event shapes.
- [ ] **Step 4: Run controls tests**

Run: `node --test tests/controls.test.mjs`  
Expected: PASS, with `reset()` and `dispose()` leaving no active key or pointer state.

### Task 4: 谱面几何与 Canvas 绘制

**Files:**
- Modify: `src/stage.js`
- Modify: `tests/stage.test.mjs`

**Interfaces:**
- Produces: `getStageGeometry(app)` returns CSS-pixel `width`, `height`, and white-line endpoints for the fixed -11-degree line centered at 49% height.
- Replaces: `drawStage(app, runtime, now, options)` with `drawStage(app, show, rhythmRuntime, playheadMs, difficulty, options)`; options retain `reducedMotion`.

- [ ] **Step 1: Add failing canvas tests**: line geometry remains on-screen at wide and narrow aspect ratios; cursor positions at normalized x values 0, 0.5, and 1 project onto the white line; note fall reaches its line target at `hitMs` for all three speed multipliers; rendering uses black background, white line, blue cursor, and red circular Flick; high-DPR sizing remains capped at 2; reduced motion preserves note positions.
- [ ] **Step 2: Verify the stage tests fail**

Run: `node --test tests/stage.test.mjs`  
Expected: FAIL because stage geometry and note rendering are absent.

- [ ] **Step 3: Implement shared geometry and rendering** in `src/stage.js`: use one geometry helper for cursor projection and drawing; derive note vertical position from remaining time, standard 1500ms travel, and difficulty speed; draw note shape/type, direction, hold body, Drag path, and cursor.
- [ ] **Step 4: Run stage tests**

Run: `node --test tests/stage.test.mjs`  
Expected: PASS for geometry, note positions, colors, DPR, and reduced motion.

### Task 5: 演出流程接入与 HUD

**Files:**
- Modify: `src/main.js`
- Modify: `styles.css`
- Modify: `tests/presentation.test.mjs`
- Modify: `tests/rhythm.test.mjs` (only if a lifecycle regression belongs to the rhythm unit)

**Interfaces:**
- Consumes: chart data from Task 1, runtime API from Task 2, controls binder from Task 3, and geometry/draw functions from Task 4.
- Produces: one live performance runtime that retains `engine`, adds `rhythm`, and keeps existing `paused`/`finishing` lifecycle flags.
- `beginPerformance()` still starts audio from `show.beatsMs`; each RAF reads the engine playhead, advances rhythm state, draws, updates HUD, and finalizes exactly once when `rhythm.finished`.

- [ ] **Step 1: Add failing presentation/lifecycle tests**: performance markup exposes accessible A/D + Space instructions, accuracy and chart progress; the pulse target is absent; `finishPerformance` passes the rhythm summary to `settleShow` once; pause/resume freezes the playhead-driven scene; hidden-page pause and save failure keep the existing recovery behavior.
- [ ] **Step 2: Verify those tests fail**

Run: `node --test tests/presentation.test.mjs tests/rhythm.test.mjs`  
Expected: FAIL because the current view renders one pulse target and no note HUD.

- [ ] **Step 3: Integrate the first complete show** in `src/main.js`: initialize rhythm runtime, route controls with the current engine playhead and stage width, advance note/sustain state, update score/combo/accuracy/progress, and settle through existing `settleShow`; reset controls during pause/view teardown and retain visibility auto-pause and audio fallback.
- [ ] **Step 4: Update the performance scene styles** in `styles.css`: black playfield, responsive canvas, visible white line and blue cursor, compact note instructions and HUD; preserve the rest of the app theme and reduced-motion behavior.
- [ ] **Step 5: Run presentation and lifecycle tests**

Run: `node --test tests/presentation.test.mjs tests/rhythm.test.mjs tests/audio.test.mjs`  
Expected: PASS, with the first show completing into the existing management flow and no duplicate settlement.

### Task 6: 全赛季回归与浏览器验收

**Files:**
- Modify: `tests/chart.test.mjs`
- Modify: `tests/progression.test.mjs`
- Modify: `tests/storage.test.mjs` only if a compatibility assertion needs to be added

**Interfaces:**
- Consumes: all three integrated charts and the existing `settleShow`, archive, and storage contracts.
- Produces: regression evidence that each chart can complete and each summary remains compatible with campaign progression and local archives.

- [ ] **Step 1: Add failing season regression tests**: complete three 32-note charts at each difficulty; preserve show ordering and existing rewards; scores rise by stage without a display clamp; old version-1 saves still load; stored results retain only the existing summary fields.
- [ ] **Step 2: Run focused season tests**

Run: `node --test tests/chart.test.mjs tests/progression.test.mjs tests/storage.test.mjs`  
Expected: FAIL only for missing new chart/score assertions; existing progression and storage behavior remains unchanged.

- [ ] **Step 3: Adjust chart content or integration** only where these tests reveal a gap; do not change progression formulas or storage version.
- [ ] **Step 4: Run the complete unit suite**

Run: `node --test`  
Expected: PASS for all existing and added tests, with no new dependencies.

- [ ] **Step 5: Run browser acceptance on desktop and mobile**: serve the project root locally on an available loopback port; play all three shows with keyboard and pointer/touch, try each difficulty, and verify note arrival, position tolerance, all four note types, pause/resume, black/white/red/blue visuals, live accuracy, final rewards, and no viewport overflow at 360×800 and 1440×900.

## Plan Self-Review

- Spec coverage: chart data and difficulty in Task 1; note types, timing, sustain, scoring, accuracy, and misses in Task 2; A/D, Space, pointer, repeat, and cancellation in Task 3; fixed line, colors, falling speed, responsive geometry, and reduced motion in Task 4; audio, pause, visibility, HUD, and settlement in Task 5; all-show completion, rewards, archives, and old saves in Task 6.
- Interfaces are shared from chart data through rhythm runtime, normalized controls events, stage geometry, and main lifecycle without introducing duplicate pointer-coordinate mapping or a new runtime package.
- The project has no `.git`; this plan intentionally contains no commit commands. Create no cleanup or bulk-deletion step.
- Existing baseline: `node --test` passed 68 tests before gameplay implementation; Task 6 reruns the full suite after all changes.
