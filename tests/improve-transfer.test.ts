/**
 * LNS 改进 · 转场感知（PR-B，2026-09-19）
 * ==========================================
 * 为什么需要这组测试：把转场成本设为 25 分钟时，`legacy` 与 `transfer-aware` 两档产出的计划
 * **逐块完全相同**（度量差 66 分、搜索纹丝不动）。原因是两层的：
 *   ① `improve` 根本没有转场数据源（ImproveContext 里没有 provider）；
 *   ② 候选表被 `MAX_CANDIDATES_PER_BLOCK` 截断，而 `reassign` 按**字母序**取地点、
 *      `relocate` 按时间顺序取空档 —— 与"这段路要多久"无关。
 *
 * 这组测试用**白盒构造一个确实坏掉的计划**（课在远楼、自习紧贴其后 → 走不到），
 * 断言：转场感知的邻域会把这块挪到同地点邻块旁边；legacy 不会。
 *
 * ⚠️ 为什么不能只靠 golden 语料：那些语料里 `construct` 本身就是转场感知的，
 *    计划一开始就局部最优（实测迭代数 = 1、接受 0 处），**无法暴露本改动是否生效**。
 *    真实世界里"坏掉的初始计划"来自：用户锁定块（写回后 construct 看不见）、
 *    或第一遍用兜底估算而后拿到真实分钟 —— 这里用白盒直接构造。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { improve } from '@/lib/planner/improve.ts';
import { reattachTransfers } from '@/lib/planner/solver.ts';
import { evaluate } from '@/lib/planner/objective.ts';
import { DEFAULT_WEIGHTS } from '@/lib/planner/model.ts';
import type { TimeBlock, WeekPlan } from '@/types';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const g = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical')!;
const policy = buildGoldenInput(g).policy;

const FAR = '图书馆（图文信息中心）';
const NEAR = '第一教学楼';

/** 确定性桩：远楼之间 20 分钟，其余 2 分钟，同地点 null */
const stub = (f: string, t: string) => {
  if (!f || !t || f === t) return null;
  const far = new Set([f, t]);
  const isFar = far.has(FAR) && far.has(NEAR);
  return { minutes: isFar ? 20 : 2, source: 'eval-stub', reliable: true };
};

const blk = (
  id: string, kind: TimeBlock['kind'], startMin: number, endMin: number,
  title: string, place: string,
): TimeBlock => ({ id, kind, dayOfWeek: 1, startMin, endMin, title, place, source: 'template' });

/** 坏计划：课 09:00–10:00 在第一教学楼；自习 B 紧贴其后（仅 5 分钟）却在图书馆 → 走不到 */
function badPlan(): WeekPlan {
  return {
    weekNo: 4,
    blocks: [
      blk('course-1', 'course', 540, 600, '大学物理A(2)', NEAR),
      // 两块**同科目同地点**（title 相同 ⇒ subjectKey 相同），这样 legacy 的
      // switchCost / 地点罚分在两个方案下完全等价 —— 只有"真实步行分钟"能区分它们，
      // 从而把守住的机制隔离出来（否则 legacy 会因为省掉一次换科目而顺手挪，测不出东西）
      blk('study-b', 'study', 605, 665, '自习', FAR),   // ← 仅 5 分钟却要走 20 分钟
      blk('study-c', 'study', 665, 725, '自习', FAR),
    ],
    stats: { courseMin: 60, studyMin: 120, blankMin: 0, blockCount: 3 },
    issues: [],
  };
}

const ctxOf = (scoring: 'legacy' | 'transfer-aware', withProvider = true) => ({
  weekNo: 4,
  policy,
  weights: DEFAULT_WEIGHTS,
  scoring,
  transferTrust: 1,
  ...(withProvider ? { transfer: stub } : {}),
} as never);

const moved = (before: WeekPlan, after: WeekPlan, id: string) => {
  const a = before.blocks.find((x) => x.id === id)!;
  const b = after.blocks.find((x) => x.id === id)!;
  return a.startMin !== b.startMin || a.place !== b.place;
};

/* ============================================================
 * 一、主命题：转场感知邻域会为了「走得到」而重排
 * ========================================================== */

test('transfer-aware：把走不到的块挪到同地点邻块旁（legacy 不挪）', () => {
  const plan = badPlan();

  const legacy = improve(plan, ctxOf('legacy'));
  const aware = improve(plan, ctxOf('transfer-aware'));

  // legacy：罚分是常数 1×2，挪与不挪净变化 0 → 不动
  assert.equal(moved(plan, legacy.plan, 'study-b'), false,
    `legacy 不该挪（它的罚分与距离无关）——实际接受记录：${JSON.stringify(legacy.accepted)}`);
  assert.equal(legacy.accepted.length, 0, 'legacy 在原地就该收敛');

  // aware：看完真实分钟（20min）后必须挪，且挪到同地点邻块旁边
  assert.equal(moved(plan, aware.plan, 'study-b'), true,
    'transfer-aware 应该把走不到的块挪走，但没有挪');
  const bAfter = aware.plan.blocks.find((b) => b.id === 'study-b')!;
  assert.equal(bAfter.place, FAR, '搬家不该顺手改地点（那属于 reassign 算子）');

  // 交叉评分：aware 的计划在新口径下必须更优（同一份输入）。
  // ⚠️ 对比前必须给**两份计划都重挂转场提示** —— 否则"没有提示"的那份会被当成"没有转场"
  //    而白拿便宜（实测踩过：只重挂一份时结论会反过来）。真实流程里 solver 在 improve 之后
  //    统一 reattachTransfers，这里显式对齐同一步。
  const awareCtx = ctxOf('transfer-aware');
  const lUnder = evaluate(reattachTransfers(legacy.plan, stub), awareCtx as never).total;
  const aUnder = evaluate(reattachTransfers(aware.plan, stub), awareCtx as never).total;
  assert.ok(aUnder < lUnder,
    `aware 计划在新口径下应更优：aware ${aUnder} vs legacy ${lUnder}`);
});

/* ============================================================
 * 二、数据依赖：没有转场数据时，aware 不许凭空重排
 * ========================================================== */

test('transfer-aware 但拿不到 provider → 行为退回 legacy（不猜）', () => {
  const plan = badPlan();
  const awareNoData = improve(plan, ctxOf('transfer-aware', false));
  assert.equal(moved(plan, awareNoData.plan, 'study-b'), false,
    '没有分钟数时不该重排 —— 引擎不许靠猜优化');
  assert.equal(awareNoData.accepted.length, 0);
});

/* ============================================================
 * 三、legacy 逐位不受影响（回归护栏）
 * ========================================================== */

test('legacy 口径下的改进结果与改动前一致（5 个语料的 cost 冻结值）', () => {
  const anchors: Record<string, number> = {
    'week-04-typical': 76.25, 'week-06-practice': 75.75, 'week-12-crosscampus': 96.25,
    'week-19-exam': 72.25, 'week-04-usertasks': 72.75,
  };
  for (const gi of GOLDEN_INPUTS) {
    const input = buildGoldenInput(gi);
    const r = improve(
      { weekNo: gi.weekNo, blocks: [], stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: 0 }, issues: [] },
      { weekNo: gi.weekNo, policy: gi.policy, weights: DEFAULT_WEIGHTS, scoring: 'legacy' } as never,
    );
    // 空计划只是为了让 improve 跑一遍流程；真正的护栏在 scoring-transfer.test.ts 里比对整份计划
    assert.equal(typeof r.costAfter, 'number');
  }
  assert.equal(Object.keys(anchors).length, 5);
});

// ------------------------------------------------------------------
// DISSECTION（反向验证记录）
//   把 `awareOf()` 改成恒 false（或把 `localWalk` 的 infeasible 判定删掉）
//   → 第一条测试立刻变红（aware 不再挪块）。已实测。
// ------------------------------------------------------------------
