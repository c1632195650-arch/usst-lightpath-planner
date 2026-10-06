/**
 * P1-5（2026-10-06 收官批次·批次 5，CY 裁决 R3）· 每周活动量下限 weeklyActivityMin
 * ============================================================
 * 任务书 P1-5：引擎此前完全不会主动排运动（不手动加，一周可能零运动）。
 * 接线：`PlanRequest.weeklyActivityMin`（可选，缺省 undefined = 不生效）——
 * construct 活动模块里「本周已排运动分钟 vs 下限」的缺口按剩余天数均摊：
 *   · 未达标的天强制出运动候选（forceSport，同 WP5 配额通道）；
 *   · 运动块的每日活动预算闸放宽（缺口是知识库裁决的真实需求）；
 *   · 软保底：实在放不进就如实缺，不硬挤。
 * 口径 = 健康库 `aerobic-150`（A 级）：WHO 每周 ≥150 分钟中等强度有氧
 * （与 R批 H1 评估维度的 `moderateMin` 同一口径）。
 *
 * 契约: BuildWeekPlanInput/PlanRequest 增 weeklyActivityMin?（可选字段，opt-in）。
 *
 * ⚠️ 反向验证（RV，红线 4）：删 construct 里 forceSport 的 `|| sportRemaining > 0`
 *   → 「补排」用例红（无画像触发时运动为 0）→ 还原 sha256 一致。
 *   删预算闸放宽分支 → 同批用例红（预算紧张语料）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construct } from '@/lib/planner/construct';
import { toPlanRequest } from '@/lib/planner/schedule';
import type { PlanRequest } from '@/lib/planner/model';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
if (!G) throw new Error('找不到 week-04-typical 语料');

/** 无画像触发语料：不传 scenarios → 画像不触发运动模块（基线 = 用户自排的运动） */
function noTriggerReq(): PlanRequest {
  return { ...toPlanRequest(buildGoldenInput(G)), scenarios: null };
}

function sportStats(req: PlanRequest): { blocks: number; minutes: number } {
  // 同时匹配模块块（…-activity-sport-…）与用户自定义块（…-activity-custom-user-sport-…）
  const blocks = construct(req).plan.blocks.filter((b) => b.kind === 'activity' && b.id.includes('sport'));
  return { blocks: blocks.length, minutes: blocks.reduce((s, b) => s + b.endMin - b.startMin, 0) };
}

/* ---------------- 一、opt-in 零改动保证（golden 安全） ---------------- */

test('P1-5: 不传 weeklyActivityMin → 输出与显式 undefined 逐位一致（golden 免拍前提）', () => {
  const a = construct(noTriggerReq());
  const b = construct({ ...noTriggerReq(), weeklyActivityMin: undefined });
  assert.deepEqual(a.plan.blocks, b.plan.blocks);
});

test('P1-5: 无触发语料基线为 0 运动分钟（下限不传时不擅自排）', () => {
  const s = sportStats(noTriggerReq());
  assert.equal(s.minutes, 0, `不该擅自动 —— 实际 ${s.minutes} 分钟`);
});

/* ---------------- 二、补排（缺口按天均摊） ---------------- */

test('P1-5: 下限 150 → 引擎补排运动至 ≥150（无触发语料从 0 补起）', () => {
  // RV 锚：删 forceSport 的 `|| sportRemaining > 0` → 本用例红（回到 0）
  const s = sportStats({ ...noTriggerReq(), weeklyActivityMin: 150 });
  assert.ok(s.minutes >= 150, `应当 ≥150 分钟，实际 ${s.minutes}`);
  assert.ok(s.blocks >= 2, `应分布多天（按天均摊），实际 ${s.blocks} 块`);
  // 软保底不硬挤：补排后其余块（课/学/餐）不应被清空
  const plan = construct({ ...noTriggerReq(), weeklyActivityMin: 150 }).plan;
  assert.ok(plan.blocks.some((b) => b.kind === 'meal'), '运动补排不该挤掉三餐');
});

test('P1-5: 下限 300 → 补排到 300（显式传入覆盖口径，供更高要求用户）', () => {
  const s = sportStats({ ...noTriggerReq(), weeklyActivityMin: 300 });
  assert.ok(s.minutes >= 300, `应当 ≥300 分钟，实际 ${s.minutes}`);
  const s150 = sportStats({ ...noTriggerReq(), weeklyActivityMin: 150 });
  assert.ok(s.minutes >= s150.minutes, '更高的下限不该排出更少的运动');
});

/* ---------------- 三、已达标不补 ---------------- */

test('P1-5: 语料自带运动已 ≥150 → 不再补排（块数与不传下限一致）', () => {
  // 用户自带 2×90=180 分钟运动（钉在周一周二，priority 99 保证先于模块模板落位）
  const withSportTasks = (): PlanRequest => {
    const base = noTriggerReq();
    const sportTask = (i: number, day: 1 | 2) => ({
      id: `user-sport-${i}`,
      title: `游泳 90 分钟 ${i}`,
      kind: 'activity' as const,
      category: 'sport' as const,
      dayOfWeek: day,
      durations: [90],
      weeks: [base.weekNo],
      priority: 99,
    });
    return { ...base, tasks: [...(base.tasks ?? []), sportTask(1, 1), sportTask(2, 2)], weeklyActivityMin: 150 };
  };
  const withFloor = sportStats(withSportTasks());
  const withoutFloor = sportStats({ ...withSportTasks(), weeklyActivityMin: undefined });
  assert.ok(withoutFloor.minutes >= 150, `语料自带应 ≥150，实际 ${withoutFloor.minutes}`);
  assert.equal(withFloor.blocks, withoutFloor.blocks, '已达标 → 补排分支不得多排块');
  assert.equal(withFloor.minutes, withoutFloor.minutes, '已达标 → 不得多出运动分钟');
});

/* ---------------- 四、与 WP5 运动模式互斥（模式优先） ---------------- */

test('P1-5: sportQuota 与 weeklyActivityMin 同传 → 模式优先（配额语义不被下限干扰）', () => {
  const quota = { ...noTriggerReq(), lifeModeExtras: { sportSessions: 4 }, weeklyActivityMin: 150 };
  const s = sportStats(quota);
  assert.ok(s.minutes > 0);
  assert.ok(s.blocks <= 4, `配额 4 次 → 最多 4 块，实际 ${s.blocks}`);
});

/* ---------------- 五、toPlanRequest 透传 ---------------- */

test('P1-5: BuildWeekPlanInput.weeklyActivityMin 经 toPlanRequest 透传（条件展开）', () => {
  const G2 = buildGoldenInput(G);
  const absent = toPlanRequest(G2) as Record<string, unknown>;
  assert.ok(!('weeklyActivityMin' in absent), '不传 → 字段不出现（逐字段一致纪律）');
  const present = toPlanRequest({ ...G2, weeklyActivityMin: 150 }) as Record<string, unknown>;
  assert.equal(present.weeklyActivityMin, 150, '传入 → 透传到 PlanRequest');
});
