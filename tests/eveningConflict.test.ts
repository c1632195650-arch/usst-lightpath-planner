/**
 * 晚课冲突回归（2026-10-08，RAY 报告）
 * ============================================================
 * 症状：「晚上玩两小时游戏」被压在 18:00 晚课正上方，同一时刻两块日程。
 * 根因（复现脚本 _repro-evening.mjs，双引擎同病）：
 *   ① 固定任务（星期+开始时间）原样落位、零碰撞校验 —— 直接叠在课程上；
 *   ② 没说星期、只给单次时长的浮动任务天天都是候选 —— 一句话铺满一周 7 块。
 * 修复：① 与当天硬块相撞时顺延到其后（课程永不挪）；
 *       ② 一次性任务（无星期 + durationMin）一周恰好一块。
 * ⚠️ 双引擎（lib/planner 与 lib/planner-cy）都必须满足，这里两边都断言。
 * 注意：本文件顶部注释不得出现连续两个星号+斜杠的序列。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Course } from '@/types';
import type { UserTask } from '@/lib/planner/templates.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { solveWeek as solveLocal } from '@/lib/planner/solver.ts';
import { solveWeek as solveCy } from '@/lib/planner-cy/solver.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical') ?? GOLDEN_INPUTS[0];
if (!G) throw new Error('没有可用的 golden 语料');

/** 周二/周四各加一门 18:00-19:25 的晚课（11-12 节） */
function withEveningClass(base: ReturnType<typeof buildGoldenInput>) {
  const weeks = Array.from({ length: 20 }, (_, i) => i + 1);
  const evening: Course = {
    id: 'c-evening',
    name: '晚课（测试）',
    credit: 2,
    category: '公共基础',
    campus: 'JG516',
    building: '第一教学楼',
    slots: [
      { dayOfWeek: 2, startPeriod: 11, endPeriod: 12, weeks },
      { dayOfWeek: 4, startPeriod: 11, endPeriod: 12, weeks },
    ],
  };
  return { ...base, schedule: { ...base.schedule, courses: [...base.schedule.courses, evening] } };
}

/** 找指定标题的块并断言不与任何课程块重叠 */
function assertNoCourseClash(plan: { blocks: Array<{ title: string; kind: string; dayOfWeek: number; startMin: number; endMin: number }> }, title: string, ctx: string) {
  const courses = plan.blocks.filter((b) => b.kind === 'course');
  const hits = plan.blocks.filter((b) => b.title === title);
  assert.ok(hits.length > 0, `${ctx}：任务「${title}」没被排进日程`);
  for (const g of hits) {
    const clash = courses.some(
      (c) => c.dayOfWeek === g.dayOfWeek && g.startMin < c.endMin && c.startMin < g.endMin,
    );
    assert.equal(clash, false,
      `${ctx}：「${title}」在周${g.dayOfWeek} ${g.startMin}-${g.endMin} 与课程重叠（修复失效）`);
  }
  return hits;
}

test('固定任务钉在晚课时间上 → 顺延到课程之后（本地引擎）', () => {
  const base = withEveningClass(buildGoldenInput(G));
  const task = { id: 'game-fix', title: '玩游戏', durationMin: 120, dayOfWeek: 2, startMin: 18 * 60, category: 'custom', priority: 80 } as UserTask;
  const res = solveLocal(toPlanRequest({ ...base, tasks: [task] }));
  const hits = assertNoCourseClash(res.plan, '玩游戏', '本地引擎');
  const blk = hits[0];
  // 晚课 18:00-19:25（11-12 节），顺延后起点 = 课程结束 = 19:25
  assert.ok(blk.startMin >= 19 * 60 + 25, `本地引擎：顺延后应不早于 19:25，实际 ${blk.startMin}`);
});

test('固定任务钉在晚课时间上 → 顺延到课程之后（CY引擎）', () => {
  const base = withEveningClass(buildGoldenInput(G));
  const task = { id: 'game-fix', title: '玩游戏', durationMin: 120, dayOfWeek: 2, startMin: 18 * 60, category: 'custom', priority: 80 } as unknown as CyUserTask;
  const res = solveCy(toPlanRequest({ ...base, tasks: [task] }));
  const hits = assertNoCourseClash(res.plan, '玩游戏', 'CY引擎');
  assert.ok(hits[0].startMin >= 19 * 60 + 25, `CY引擎：顺延后应不早于 19:25，实际 ${hits[0].startMin}`);
});

test('无星期的单次任务一周恰好一块（本地引擎）', () => {
  const base = withEveningClass(buildGoldenInput(G));
  const task = { id: 'game-float', title: '玩游戏', durationMin: 120, category: 'custom', priority: 80 } as UserTask;
  const res = solveLocal(toPlanRequest({ ...base, tasks: [task] }));
  const n = res.plan.blocks.filter((b) => b.title === '玩游戏').length;
  assert.equal(n, 1, `本地引擎：一次性任务应只排 1 块，实际 ${n} 块（铺满一周的旧病复发）`);
  assertNoCourseClash(res.plan, '玩游戏', '本地引擎');
});

test('无星期的单次任务一周恰好一块（CY引擎）', () => {
  const base = withEveningClass(buildGoldenInput(G));
  const task = { id: 'game-float', title: '玩游戏', durationMin: 120, category: 'custom', priority: 80 } as unknown as CyUserTask;
  const res = solveCy(toPlanRequest({ ...base, tasks: [task] }));
  const n = res.plan.blocks.filter((b) => b.title === '玩游戏').length;
  assert.equal(n, 1, `CY引擎：一次性任务应只排 1 块，实际 ${n} 块（铺满一周的旧病复发）`);
  assertNoCourseClash(res.plan, '玩游戏', 'CY引擎');
});

test('多档位 durations 的填空档用法不受「一周一块」影响（本地引擎）', () => {
  const base = buildGoldenInput(G);
  const task = { id: 'listen', title: '练英语听力', durations: [30, 45], category: 'custom', priority: 80 } as unknown as UserTask;
  const res = solveLocal(toPlanRequest({ ...base, tasks: [task] }));
  const n = res.plan.blocks.filter((b) => b.title === '练英语听力').length;
  assert.ok(n >= 1, '填空档语义的浮动任务至少排 1 块');
});
