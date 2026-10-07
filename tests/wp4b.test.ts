/**
 * WP4b —— B2（撤销栈重复）/ B3（融合天集丢调课天）/ B5（跨列甩放影子与落点不一致）
 * ============================================================
 * B3/B5 修法把逻辑抽成了纯函数（localizedReplan.ts / dragPreview.ts），
 * 这里直接测行为；B2 的修复点在 React 组件内（setState updater 外压栈），
 * 用**源码模式断言**钉住（本项目有此先例：libaoIntent.test.ts 对拍源码正则）。
 *
 * ⚠️ 反向验证（记录见 docs/wp-ledger-v2.md §WP4b）：
 *   RV-B2 ← 还原 updateLayer（快照挪回 updater 内）→ WP4B-B2 源码断言红
 *   RV-B3 ← localizedDaysFor 去掉 overrideDays 合并 → B3 两条用例红
 *   RV-B5 ← onDrop 还原旧口径（忽略 preview）→ B5 源码断言红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  localizedDaysFor,
  localizedPlan,
  overrideAffectedDays,
} from '@/lib/planner/localizedReplan';
import { dropTargetMin } from '@/features/week/dragPreview';
import type { Schedule, TimeBlock, WeekPlan } from '@/types';

/* ---------------- B3：融合天集 ∪ 调课天 ---------------- */

const LAYER = {
  slots: [] as Array<{ days: number[] }>,
  moves: [] as Array<{ weekNo: number | null; dayOfWeek: number }>,
  tasks: [] as Array<{ dayOfWeek: number | null }>,
};

test('B3: localizedDaysFor 把调课影响天并进融合天集', () => {
  // 反向：还原成 void overrideDays 的旧实现 → 本用例红
  const days = localizedDaysFor(LAYER, [2], 5);
  assert.deepEqual(days, [2], '本周只调了周二 → 只重排周二');
  const mixed = localizedDaysFor({ ...LAYER, tasks: [{ dayOfWeek: 4 }] }, [2], 5);
  assert.deepEqual(mixed, [2, 4], '调课天 ∪ 用户改动天');
});

test('B3: 本周没有调课时行为与修复前一致', () => {
  assert.deepEqual(localizedDaysFor({ ...LAYER, tasks: [{ dayOfWeek: 4 }] }, [], 5), [4]);
  // 空规则 → []：调用方按 days.length===0 走「整周接受」，与修复前口径一致
  assert.deepEqual(localizedDaysFor(LAYER, [], 5), []);
});

const slot = (id: string, day: number, weeks?: number[]) => ({
  id, name: `课${id}`, slots: [{ dayOfWeek: day, startPeriod: 1, endPeriod: 2, ...(weeks ? { weeks } : {}) }],
});

test('B3: overrideAffectedDays 算出调课/停课真正影响的天', () => {
  const base = { courses: [slot('c1', 3), slot('c2', 5)] } as unknown as Schedule;
  // 调课：周三的课挪到周五（本周一次性）
  const moved = { courses: [slot('c1', 5), slot('c2', 5)] } as unknown as Schedule;
  assert.deepEqual(overrideAffectedDays(base, moved, 3), [3, 5]);
  // 停课：周三的课整节从本周排除
  const cancelled = { courses: [{ id: 'c1', name: '课c1', slots: [] }, slot('c2', 5)] } as unknown as Schedule;
  assert.deepEqual(overrideAffectedDays(base, cancelled, 3), [3]);
  // 无覆盖 → 派生=原课表 → 零天
  assert.deepEqual(overrideAffectedDays(base, base, 3), []);
});

test('B3 端到端：apply 后切周再切回，覆写必须已在排程里（不必等切周）', () => {
  // 场景：prev 是「调课应用前」的本周计划；用户应用调课（周三的课挪到周五）+ 加了周四的事；
  // 引擎重排出 next（含新调课）。修复前 days=[4]（丢调课天）→ 周三保留 prev（旧课位）→ 覆写不可见。
  const block = (id: string, day: number, start: number, title: string): TimeBlock =>
    ({ id, kind: 'course', dayOfWeek: day, startMin: start, endMin: start + 90, title });
  const prevPlan: WeekPlan = {
    weekNo: 5,
    blocks: [block('old-wed', 3, 480, '旧课位·周三'), block('thu', 4, 600, '周四自習')],
    stats: { courseMin: 180, studyMin: 90, blankMin: 0, blockCount: 2 },
  };
  const nextPlan: WeekPlan = {
    weekNo: 5,
    blocks: [block('new-fri', 5, 480, '新课位·周五'), block('thu', 4, 600, '周四自習')],
    stats: { courseMin: 180, studyMin: 90, blankMin: 0, blockCount: 2 },
  };

  // 修复后：days = 调课天 {3,5} ∪ 改动天 {4} → 周三用新版（旧课位消失）
  const fixed = localizedPlan(prevPlan, nextPlan, localizedDaysFor({ ...LAYER, tasks: [{ dayOfWeek: 4 }] }, [3, 5], 5)).plan;
  assert.ok(!fixed.blocks.some((b) => b.id === 'old-wed'), '旧课位必须被新版覆盖');
  assert.ok(fixed.blocks.some((b) => b.id === 'new-fri'), '新课位（调课结果）必须出现');

  // 反向（还原旧实现 days=[4]）：周三保留 prev → 覆写不可见 → 断言红
  const broken = localizedPlan(prevPlan, nextPlan, [4]).plan;
  assert.ok(broken.blocks.some((b) => b.id === 'old-wed'), '旧实现里周三保留旧版（此断言证明差异真实存在）');
});

/* ---------------- B5：影子落点一致性 ---------------- */

const BLOCKS = [{ endMin: 600 }, { endMin: 780 }];

test('B5: dropTargetMin 有本列预览用预览值，否则退回列末尾+10', () => {
  assert.equal(dropTargetMin(null, 2, BLOCKS), 790, '无预览 → 列末尾 780 + 10');
  assert.equal(dropTargetMin(null, 2, []), 490, '空列 → 早八 480 + 10');
  assert.equal(dropTargetMin({ day: 2, atMin: 750 }, 2, BLOCKS), 750);
  assert.equal(dropTargetMin({ day: 3, atMin: 750 }, 2, BLOCKS), 790, '别列的预览不串');
});

test('B5 不变量: 预览位 = 最终位（悬停兜底与松手落点同一个函数）', () => {
  const shown = dropTargetMin(null, 2, BLOCKS); // 列级 onDragOver 画的影子
  const dropped = dropTargetMin({ day: 2, atMin: shown }, 2, BLOCKS); // onDrop 取的落点
  assert.equal(dropped, shown, '所见即所得');
});

test('B5 源码接线: 列级 onDragOver 已接 updatePreview 兜底（防止纯函数测试名存实亡）', () => {
  // 反向：删掉列级 dragover 的 updatePreview / onDrop 的同落点换算 → 本用例红
  // ⚠️ 2026-10-08 改锚（Ray 周页批次接入）：泳道事件在 WeekDayColumn.tsx。
  const src = readFileSync(
    fileURLToPath(new URL('../src/features/week/WeekDayColumn.tsx', import.meta.url)),
    'utf8',
  );
  assert.match(src, /onDragOver=\{\(e\) => \{[\s\S]*?if \(draggingId\) updatePreview\(day, atMinFromEvent\(e\),/, '列级 dragover 必须画影子（updatePreview）');
  assert.match(src, /const atMin = preview && preview\.day === day \? preview\.atMin : atMinFromEvent\(e\);/, 'onDrop 与悬停预览同落点（所见即所得）');
  assert.match(src, /handleDrop\(id, day, atMin\)/, 'onDrop 必须走同一落点口径');
});

/* ---------------- B2：撤销栈快照在 updater 外 ---------------- */

test('B2 源码接线: pushUndoSnapshot 在任何 React updater 之外（StrictMode 不再双压栈）', () => {
  // 反向：把 pushUndoSnapshot 挪进任何 setState updater → 本用例红
  // ⚠️ 2026-10-08 改锚（Ray 周页批次接入）：updateLayer 收拢进 useWeekPlanStore ——
  //    模块级 store 天然无 setState，快照在落库（commitLayer）之前同步压栈。
  const src = readFileSync(
    fileURLToPath(new URL('../src/features/week/useWeekPlanStore.ts', import.meta.url)),
    'utf8',
  );
  const m = /export function updateLayerStore\(([\s\S]*?)\n\}/.exec(src);
  assert.ok(m, 'updateLayerStore 定义必须存在');
  const body = m[1];
  const pushAt = body.indexOf('pushUndoSnapshot');
  const commitAt = body.indexOf('commitLayer(');
  assert.ok(pushAt >= 0 && commitAt >= 0, '快照与落库都要存在');
  assert.ok(pushAt < commitAt, '快照必须在落库之前压栈');
  assert.equal(body.includes('setState'), false, 'store 层不得有 setState（StrictMode 双调用风险）');
});
