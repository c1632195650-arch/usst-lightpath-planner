/**
 * WP12 —— H7 导入恒开 / H8 日程变动 ring buffer + 注入
 * ============================================================
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §WP12）：
 *   RV1 ← updateLayer 摘掉 pushPlanEvents(diffPlanEvents(…)) → 源码断言红
 *   RV2 ← diffPlanEvents 删掉 excluded 分支 → 事件断言红
 *   （add_pending_fact 直落 applied 的反向在 scripts/test_plan_events.py --reverse）
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diffPlanEvents, emptyUserPlan, getRecentPlanEvents, pushPlanEvents } from '@/features/week/userPlanStore';
import type { UserPlanLayer } from '@/features/week/userPlanStore';

const layer = (over: Partial<UserPlanLayer> = {}): UserPlanLayer => ({
  ...emptyUserPlan(),
  ...over,
});

beforeEach(() => {
  // ring 是模块级单例 —— 每条用例前清空（通过读不到的私数组做不到，用 25 条空转挤不掉；
  // 改为：直接断言相对变化，或用 clear。这里给 clear 提供：push 足量旧事件顶掉）
  // 简化：每条用例自证长度，不依赖跨用例状态 —— pushPlanEvents 全部走本用例计数。
});

test('WP12·H8: diffPlanEvents 识别任务增删 / 排除恢复 / 挪动', () => {
  // 反向：删掉 excluded 分支 → 本用例红
  const prev = layer({
    tasks: [{ id: 't1', title: '旧任务' } as UserPlanLayer['tasks'][number]],
    excluded: ['b1'],
    moves: [],
  });
  const next = layer({
    tasks: [{ id: 't2', title: '新任务' } as UserPlanLayer['tasks'][number]],
    excluded: ['b2'],
    moves: [{ weekNo: 5, blockId: 'x', dayOfWeek: 3, startMin: 600, endMin: 660, source: 'drag' } as never],
  });
  const events = diffPlanEvents(prev, next);
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ['blocks_excluded', 'blocks_restored', 'move_added', 'task_added', 'task_removed']);
  assert.ok(events.find((e) => e.type === 'task_added' && e.title === '新任务'));
});

test('WP12·H8: 无变化 → 零事件', () => {
  const l = layer();
  assert.deepEqual(diffPlanEvents(l, layer()), []);
});

test('WP12·H8: ring buffer 上限 20（旧事件被丢）', () => {
  // 反向：pushPlanEvents 去掉 slice(-20) → 本用例红
  for (let i = 0; i < 25; i++) pushPlanEvents([{ type: 'task_added', title: `事件${i}` }]);
  const recent = getRecentPlanEvents();
  assert.equal(recent.length, 20);
  assert.equal(recent[0].title, '事件5', '最旧的 5 条被挤掉');
  assert.equal(recent[19].title, '事件24');
});

/* ---------------- 源码接线断言 ---------------- */

const SRC = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('WP12·H7 源码: SHOW_IMPORT 恒 true（正式构建可见导入入口）', () => {
  const src = SRC('/src/App.tsx');
  assert.match(src, /const SHOW_IMPORT = true;/);
  assert.doesNotMatch(src, /SHOW_IMPORT = import\.meta\.env\.DEV/);
});

test('WP12·H8 源码: updateLayer 落层时发事件；LbaoChat 注入 getRecentPlanEvents', () => {
  // 反向：摘掉 updateLayerStore 里的 pushPlanEvents(diffPlanEvents(…)) → 本用例红
  // ⚠️ 2026-10-08 改锚（Ray 周页批次接入）：updateLayer 收拢进 useWeekPlanStore（模块级 store）。
  const store = SRC('/src/features/week/useWeekPlanStore.ts');
  assert.match(store, /pushPlanEvents\(diffPlanEvents\(layerSnap\.layer, next\)\)/);
  const chat = SRC('/src/features/libao/LbaoChat.tsx');
  assert.match(chat, /lbaoChat\(q, identity, profileCtx, getRecentPlanEvents\(\)\)/);
});

test('WP12·H7 源码: 课表回写不含坐标（api.ts 摘要只统计课程/节次/占比）', () => {
  // 数据红线：对外/落盘无 lat/lon —— 回写摘要必须是纯文本统计
  const api = SRC('/src/lib/api.ts');
  assert.match(api, /addTimetableFacts/);
  assert.doesNotMatch(api.split('addTimetableFacts')[1]?.split('}')[0] ?? '', /lat|lon|经纬|坐标/i);
});
