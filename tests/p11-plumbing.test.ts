/**
 * P1-1 接线测试（白天批 2026-10-02，任务书 §三 P1-1）
 * ============================================================
 * 覆盖两项「UI 传了引擎没读」的断链修复：
 *   ① actualLoadByDow：req 一路传到 construct 的 ctx（跨周自适应开始看实际执行）
 *   ② commits / previousCommits：增量脏区域按提交项差异收敛（大改后没被点名的天不动）
 *
 * 反向验证纪律：① 删掉 solver 的 effectiveCtx 映射 → 降档用例红；
 * ② 删掉 WeekPlanView 的双传（本文件锁 toPlanRequest 映射）→ commits 恒 [] → 冻结用例红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { solveWeek } from '../src/lib/planner/solver.ts';
import { toPlanRequest } from '../src/lib/planner/schedule.ts';
import { buildPhasesFromCalendar, phaseOfWeek } from '../src/lib/planner/buildPhases.ts';
import { TERM_CALENDAR } from '../src/constants/term.ts';
import type { Schedule } from '../src/types.ts';
import type { Commit } from '../src/lib/planner/model.ts';

const SCHEDULE: Schedule = {
  semesterName: 's', semesterType: 'autumn', termStart: '2026-09-07',
  totalWeeks: 20, source: 'demo', courses: [],
};
const policy = phaseOfWeek(buildPhasesFromCalendar(SCHEDULE, null, TERM_CALENDAR['2026-2027-1']).plan, 3)!.policy;

test('P1-1① actualLoadByDow 经 solveWeek 进 construct：高负荷日产能降档', () => {
  // 夹具要点：让 usable（而非空档空间/dailyStudyMin）成为自习预算的结合约束，
  // 否则 0.9 的 capacityFactor 缩的是“根本用不满”的池子，观测不到差异。
  // （实测：默认 blankRatio 下周一自习恒 ≈ 空档上限 460；blank 0.4 → usable 456<460 咬合）
  const tightPolicy = { ...policy, dailyStudyMin: 600, blankRatio: 0.4 };
  const baseReq = toPlanRequest({
    schedule: SCHEDULE, weekNo: 3, policy: tightPolicy,
    // 计划负荷：4 天有值（过 MIN_HISTORY_DAYS=3 的均值门槛），周一中等
    rolling: { loadByDow: [0, 300, 300, 300, 300, 0, 0] } as never,
  });
  const base = solveWeek(baseReq);
  const studyMinOn = (plan: typeof base.plan, day: number) =>
    plan.blocks.filter((b) => b.dayOfWeek === day && b.kind === 'study')
      .reduce((n, b) => n + (b.endMin - b.startMin), 0);

  // 实际负荷：周一爆表（≥ mean*1.15 且 ≥ mean+30）→ 该天 capacityFactor=0.9
  const loaded = solveWeek({
    ...baseReq,
    actualLoadByDow: [720, 300, 300, 300, 0, 0, 0],
  });
  const baseMon = studyMinOn(base.plan, 1);
  const loadedMon = studyMinOn(loaded.plan, 1);
  assert.ok(
    loadedMon < baseMon,
    `实际负荷爆表的周一应降档（基线 ${baseMon} → 实载 ${loadedMon}）——若两者相等，说明 req.actualLoadByDow 没进 ctx（反向验证点）`,
  );
  // 未爆表的天不受影响（至少不升得离谱）——只断言周三基本持平，避免过度约束
  assert.equal(studyMinOn(loaded.plan, 3), studyMinOn(base.plan, 3), '未命中降档的天产能不变');
});

test('P1-1② commits/previousCommits 进增量：改周一交期，周六块 id 冻结', () => {
  const c1Mon: Commit = { id: 'c1', title: '复习A', kind: 'study', effortMin: 60, dueAt: { weekNo: 3, dayOfWeek: 1, min: 18 * 60 } };
  const c2Thu: Commit = { id: 'c2', title: '复习B', kind: 'study', effortMin: 60, dueAt: { weekNo: 3, dayOfWeek: 4, min: 18 * 60 } };
  const first = solveWeek(toPlanRequest({
    schedule: SCHEDULE, weekNo: 3, policy, commits: [c1Mon, c2Thu],
  }));

  // 第二轮：c1 交期 周一 → 周三（脏天 = {1,3}±1 = 1..4）；周六在脏区外
  const c1Wed: Commit = { ...c1Mon, dueAt: { weekNo: 3, dayOfWeek: 3, min: 18 * 60 } };
  const second = solveWeek(toPlanRequest({
    schedule: SCHEDULE, weekNo: 3, policy,
    commits: [c1Wed, c2Thu],
    previousPlan: first.plan,
    previousCommits: [c1Mon, c2Thu],
  }));

  const idsOn = (plan: typeof first.plan, day: number) =>
    plan.blocks.filter((b) => b.dayOfWeek === day).map((b) => b.id).sort();
  const firstSat = idsOn(first.plan, 6);
  const secondSat = idsOn(second.plan, 6);
  assert.ok(firstSat.length > 0, '夹具应让周六有块（否则冻结断言空转）');
  assert.deepEqual(secondSat, firstSat, '脏区外（周六）的块 id 应冻结 —— 若不一致，commits/previousCommits 没生效或增量未收敛');
  // 正向：脏天内的交期块真的挪了（增量不是恒冻结的假绿）
  const wedHas = second.plan.blocks.some((b) => b.dayOfWeek === 3 && b.title === '复习A');
  assert.ok(wedHas, '改期后 c1 应出现在周三（脏天内确实重排了）');
});
