/**
 * WP7 —— E5 编辑模式开关 + E6 七天一行 / 满溢度条
 * ============================================================
 * daySaturation 纯函数单测 + WeekPlanView 源码接线断言
 * （组件无法在 node --test 渲染，接线用源码模式钉住 —— 项目既有手法）。
 *
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §WP7）：
 *   RV1 ← 面板区 editMode 包裹删掉 → 源码断言红
 *   RV2 ← daySaturation 阈值位移（0.5→0.6 等）→ 档位用例红
 *   RV3 ← draggable 的 editable 门删掉 → 源码断言红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { daySaturation } from '@/features/week/saturation';
import type { TimeBlock } from '@/types';

const block = (id: string, start: number, end: number, kind: TimeBlock['kind'] = 'study'): TimeBlock =>
  ({ id, kind, dayOfWeek: 1, startMin: start, endMin: end, title: id } as TimeBlock);

/* ---------------- E6：daySaturation 口径 ---------------- */

test('WP7·E6: occupied 只算非课程非 blank 块，capacity 扣课程分钟', () => {
  const blocks = [
    block('c1', 480, 600, 'course'),   // 课程 120 分钟 → 占 capacity，不占 occupied
    block('s1', 600, 720, 'study'),    // 自习 60 → occupied
    block('blank', 720, 780, 'blank'), // blank 60 → 不占 occupied
    block('a1', 780, 810, 'activity'), // 活动 30 → occupied
  ];
  const sat = daySaturation(blocks, 7 * 60, 23 * 60); // 窗口 960
  assert.equal(sat.occupiedMin, 150, 'blank 与课程都不计 occupied（自习 120 + 活动 30）');
  assert.equal(sat.capacityMin, 840, '960 − 课程 120');
  assert.equal(sat.ratio, 150 / 840);
});

test('WP7·E6: 四档阈值（<50 绿 / 50-70 黄 / 70-85 橙 / ≥85 红）', () => {
  // 反向：daySaturation 阈值位移（如 0.5→0.6）→ 本用例红
  const mk = (occupied: number) => daySaturation([block('s', 480, 480 + occupied, 'study')], 7 * 60, 23 * 60);
  assert.equal(mk(Math.floor(960 * 0.49)).level, 'ok');
  assert.equal(mk(Math.floor(960 * 0.5)).level, 'warm', '恰好 50% 进黄档');
  assert.equal(mk(Math.floor(960 * 0.69)).level, 'warm');
  assert.equal(mk(Math.floor(960 * 0.7)).level, 'full', '70% 进橙档');
  assert.equal(mk(Math.floor(960 * 0.84)).level, 'full');
  assert.equal(mk(Math.floor(960 * 0.85)).level, 'over', '85% 进红档');
});

test('WP7·E6: capacity=0 → ratio 0（不制造假满）；确定性', () => {
  const blocks = [block('c', 420, 1420, 'course')]; // 1000 分钟课程 > 窗口 960
  const sat = daySaturation(blocks, 7 * 60, 23 * 60);
  assert.equal(sat.capacityMin, 0);
  assert.equal(sat.ratio, 0);
  const s1 = daySaturation([block('s', 480, 600, 'study')], 7 * 60, 23 * 60);
  assert.deepEqual(s1, daySaturation([block('s', 480, 600, 'study')], 7 * 60, 23 * 60));
});

/* ---------------- E5：源码接线断言 ---------------- */

/**
 * ⚠️ 2026-10-08 改锚（Ray 周页批次接入）：七列时间轴替换了「浏览 7 列一行 /
 * 编辑四档自适应」两套网格 —— 编辑模式不再重排网格，而是**开关一切编辑入口**
 * （拖拽/右键菜单/空档加事/调整抽屉）。ED5 的四条断言全部改锚到新落点，
 * 断言的契约意图（浏览态不可误改、编辑态全开）原样保留：
 *   ① 开关按钮（testid/aria-pressed/浏览提示）→ WeekToolsPanel 操作条；
 *   ② 「编辑开关真的控制编辑能力」→ allowEdit 从 WeekPlanView 一路透传到 BlockCard；
 *   ③ 低频面板入口（原面板区）→ 调整抽屉按钮在浏览态禁用（等价于旧「浏览态零渲染」）；
 *   ④ BlockCard 的 editable 门 → 由 allowEdit 参与计算（拖拽/菜单/编辑面板三合一）。
 */
const SRC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekPlanView.tsx', import.meta.url)), 'utf8');
const PANEL = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekToolsPanel.tsx', import.meta.url)), 'utf8');
const GRID = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekTimelineGrid.tsx', import.meta.url)), 'utf8');
const COL = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekDayColumn.tsx', import.meta.url)), 'utf8');
const CARD = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/BlockCard.tsx', import.meta.url)), 'utf8');

test('WP7·E5 源码（2026-10-08 改锚）: 编辑模式下线 —— 回到 Ray 的「始终可编辑」', () => {
  // CY 截图裁决：周页操作条按 Ray 设计收敛，编辑模式开关 / 浏览态门 / 相关提示整体下线。
  // 本用例把 E5 契约改锚为下线后的形态：防回流（开关不得复活）+ 防残留门控（视图不再传门）。
  const panel = PANEL();
  assert.equal(panel.includes('edit-mode-toggle'), false, '操作条不再有编辑开关（Ray 设计：始终可编辑）');
  assert.equal(SRC().includes('allowEdit={editMode}'), false, '视图不再把编辑门传给网格');
  // BlockCard 的 allowEdit 注入口保留（默认恒真）——将来要做「只读分享」等场景可直接复用
  assert.match(CARD(), /const editable = allowEdit !== false && block\.kind !== 'course' && block\.source !== 'course';/);
  assert.match(CARD(), /draggable=\{editable\}/);
});
