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

const SRC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/WeekPlanView.tsx', import.meta.url)), 'utf8');

test('WP7·E5 源码: 开关按钮带 aria-pressed + data-testid，浏览态提示在位', () => {
  const src = SRC();
  assert.match(src, /data-testid="edit-mode-toggle"/);
  assert.match(src, /aria-pressed=\{editMode\}/);
  assert.match(src, /浏览模式 · 点「编辑」才能拖拽与改排/);
});

test('WP7·E5 源码: 网格类名绑定 editMode（浏览 7 列一行 / 编辑四档自适应）', () => {
  // 反向：把网格类名写死回旧版 → 本用例红
  const src = SRC();
  assert.match(src, /editMode\s*\?\s*'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'\s*:\s*'overflow-x-auto'/);
  // 2026-10-02 白天批申报（P1-3·4B）：内层网格新增日视图档位分支 ——
  // dayFocus 时单列铺满，周视图类名原样保留。锁意图「浏览 7 列 / 编辑四档」不变，
  // 只是把三档（编辑/日/周）的类名绑定一起锁住。
  assert.match(src, /editMode\s*\?\s*'contents'\s*:\s*dayFocus\s*\?\s*'grid grid-cols-1 gap-3'\s*:\s*'grid grid-cols-7 min-w-\[1120px\] gap-3'/);
});

test('WP7·E5 源码: 面板区被 editMode 包裹（浏览态零渲染）', () => {
  // 反向：删掉面板区的 editMode 包裹 → 本用例红
  const src = SRC();
  const addAt = src.indexOf('<AddTaskPanel');
  const learnedAt = src.indexOf('<LearnedPreferencesPanel');
  const openGate = src.lastIndexOf('{editMode && (', addAt);
  assert.ok(openGate >= 0 && openGate < addAt, 'AddTaskPanel 之前必须有 editMode 门');
  const closeGate = src.indexOf(')}', learnedAt);
  assert.ok(closeGate > learnedAt, 'LearnedPreferencesPanel 之后必须闭合门控');
});

test('WP7·E5 源码: BlockCard 拖拽与 hover 工具挂 editable 门；调用点传 editMode', () => {
  // 反向：draggable 的 editable 门删掉 → 本用例红
  const src = SRC();
  assert.match(src, /draggable=\{editable && block\.kind !== 'course'/);
  assert.match(src, /editable=\{editMode\}/);
  assert.match(src, /\{editable && \(\n\s*<div className="group /);
});
