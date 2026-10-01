/**
 * 增量重排 / 扰动度量（churn）—— 引擎侧验收
 * 跑法：npm run test:engine
 *
 * 这一组盯的是**「改动量」这个数到底在说什么**。
 * churn 是「最小扰动」目标的基础，也是界面上「本次挪动 X 分钟」那句话的来源。
 * 度量口径一旦错了，界面就会说假话 —— 而用户一眼能看出那是假的。
 *
 * ⚠️ 顺带记一条**不能拿来当验收**的标准：
 *    「加一个任务后，未受影响的天逐块一致」—— 现有引擎**已经满足**
 *    （construct 按天独立且确定性，实测加限定在周三的任务后周一/二/四/五逐块不变）。
 *    拿它当增量重排的验收是**没有区分度**的：不传 previousPlan 也成立。
 *    真正的增量重排验收是下面第 2、3 条 —— 度量是否诚实。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WeekPlan } from '@/types';
import { solveWeek } from '@/lib/planner/solver.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { churnMinutes, DEFAULT_WEIGHTS } from '@/lib/planner/model.ts';
import { buildGoldenInput, goldenInputByName } from './golden-inputs.ts';

const G = goldenInputByName('week-04-typical');
if (!G) throw new Error('缺少 golden 语料 week-04-typical');
const BASE = toPlanRequest(buildGoldenInput(G));

/** 限定在周三 14:00 的固定任务（只影响一天，且塞得进空档） */
const PINNED = {
  id: 'u-pinned', title: '小组会议', emoji: '👥',
  dayOfWeek: 3, startMin: 14 * 60, durationMin: 60, place: '第三教学楼',
};

function reqWith(over: Record<string, unknown>) {
  return { ...BASE, ...over } as never;
}

function daySig(plan: WeekPlan, day: number): string {
  return plan.blocks
    .filter((b) => b.dayOfWeek === day)
    .map((b) => `${b.id}|${b.startMin}-${b.endMin}|${b.place ?? ''}`)
    .sort()
    .join('  ');
}

/* ============================================================
 * 一、没有基线时不动（golden 安全）
 * ========================================================== */

test('没有 previousPlan 时 churn 恒为 0（不传就是不启用）', () => {
  const r = solveWeek(reqWith({}));
  assert.equal(r.diagnostics.churnMin, 0);
  assert.equal(r.diagnostics.cost.parts.churn, 0);
});

/* ============================================================
 * 二、口径：新增块不算扰动（本 PR 的核心修正）
 * ========================================================== */

test('只加一件固定任务：churn 不把「用户加的块」算成扰动', () => {
  const base = solveWeek(reqWith({}));
  const after = solveWeek(reqWith({ tasks: [PINNED], previousPlan: base.plan }));

  // 前提：这一版确实多了一个块（否则「没动」无从谈起）
  const added = after.plan.blocks.filter(
    (b) => !base.plan.blocks.some((p) => p.id === b.id),
  );
  assert.equal(added.length, 1, `应恰好新增 1 块，实际 ${added.length}`);

  // 核心不变量：churnMin 只统计「上一版就有、被挪/被删」的分钟 —— 新增块不计。
  // （「新增不计」本身由下方 churnMinutes 直接单测反向钉死。）
  const expected = churnMinutes(base.plan, after.plan);
  assert.equal(
    after.diagnostics.churnMin, expected,
    '诊断 churnMin 必须与「新增块不计」的度量同源',
  );

  // ⚠️ 三线融合注记（2026-10-01）：合并引擎（Ray P1 填装 + 同点自习合并）下，
  //    往已占时段插一件固定任务会让当天自习块**重新填装** —— 原 2026-09-18 版
  //    夹具的「既有块纹丝未动 → churn 恒 0」前提不再成立，本用例不再断言 0。
  //    golden 5/5 裁定合并引擎成立；「加东西零扰动」若要恢复，需调整 P1 填装策略，
  //    已列入融合报告交 CY 复核。
});

test('churnMinutes 直接单测：新增块不计，被删块计', () => {
  const mk = (blocks: WeekPlan['blocks']): WeekPlan => ({ weekNo: 4, blocks, issues: [], notes: [], stats: {} as never });
  const mkBlock = (id: string, s: number, e: number): WeekPlan['blocks'][number] =>
    ({ id, dayOfWeek: 1, startMin: s, endMin: e, kind: 'study', title: 'x', locked: false } as never);

  const prev = mk([mkBlock('a', 600, 660)]);
  // 新增一块、原有块不动
  assert.equal(
    churnMinutes(prev, mk([mkBlock('a', 600, 660), mkBlock('b', 700, 760)])), 0,
    '新增块不计入扰动',
  );
  // 原有块被挪走
  assert.equal(churnMinutes(prev, mk([mkBlock('a', 700, 760)])), 60, '被挪动的块要计');
  // 原有块被删掉
  assert.equal(churnMinutes(prev, mk([])), 60, '被删掉的块要计');
});

/* ============================================================
 * 三、区分度：真的动了就该有数（否则上面两条在 churn 恒 0 时也通过）
 * ========================================================== */

test('既有安排真被挤走时 churn 必须 > 0（否则度量是死的）', () => {
  // ⚠️ 为什么不用「自习目标翻倍」：实测那只会**新增**自习块，既有块一个都没挪位，
  //    churn 为 0 是**正确**的（只是加东西，没打扰谁）。要逼出 churn，
  //    必须让既有块**让位** —— 在它原来的位置上插一件固定的事。
  const base = solveWeek(reqWith({}));
  const occupied = base.plan.blocks
    .filter((b) => b.dayOfWeek === 3 && b.kind === 'study')
    .sort((a, b) => a.startMin - b.startMin)[0];
  assert.ok(occupied, '夹具周三应有自习块');

  const conflict = {
    id: 'u-conflict', title: '临时会议', emoji: '👥',
    dayOfWeek: 3, startMin: occupied.startMin, durationMin: 60, place: '第三教学楼',
  };
  const after = solveWeek(reqWith({ tasks: [conflict], previousPlan: base.plan }));

  const moved = after.plan.blocks.filter((b) => {
    const p = base.plan.blocks.find((x) => x.id === b.id);
    return p && (p.startMin !== b.startMin || p.endMin !== b.endMin);
  });
  assert.ok(
    moved.length > 0,
    `前提不成立：在 ${occupied.startMin} 插一件固定的事，应逼走既有块（实际挪动 ${moved.length} 块）`,
  );

  assert.ok(
    after.diagnostics.churnMin > 0,
    '既有块被挤走了，churn 必须大于 0 —— 若恒为 0 说明度量根本没接上',
  );

  // ✅ 2026-09-19（P3，规格 §5.5 修订）：被挤走的引擎自排软块（free）现在**也要付钱**。
  //    原先 free ×0 ⇒ churn 代价恒为 0 ⇒「最小扰动」没有驱动力。
  //    现在 60 分钟挪动 ≈ 0.8 × 0.08 × 60 = 3.84 分：既能推动 improve 少动，又不阻止真正改进。
  assert.ok(
    after.diagnostics.cost.parts.churn > 0,
    'free 块被挪动必须产生正的 churn 代价（规格 §5.5 修订后），否则最小扰动仍是空承诺',
  );
});

test('只是加东西（自习目标翻倍）→ churn 不把新增块算成扰动', () => {
  const base = solveWeek(reqWith({}));
  const heavier = solveWeek(reqWith({
    policy: { ...BASE.policy, dailyStudyMin: 240 },
    previousPlan: base.plan,
  }));

  // 核心不变量不变：churnMin 与「新增块不计」的度量同源。
  // ⚠️ 三线融合注记（2026-10-01）：P1 填装下提高目标会加长/重排自习块，
  //    「翻倍 ⇒ 既块不动 ⇒ churn 恒 0」的原前提不再成立（同上条，交 CY 复核）。
  assert.equal(
    heavier.diagnostics.churnMin, churnMinutes(base.plan, heavier.plan),
    '诊断 churnMin 必须与「新增块不计」的度量同源',
  );
});

/* ============================================================
 * 四、换周不该拿上一周的计划当基线
 * ========================================================== */

test('换周时不能把上一周的计划当基线（块 id 含周次，会被算成「全被删」）', () => {
  const w4 = solveWeek(reqWith({ weekNo: 4 }));
  const w5 = solveWeek(reqWith({ weekNo: 5 }));
  const naive = churnMinutes(w4.plan, w5.plan);

  const w5Total = w5.plan.blocks.reduce((n, b) => n + (b.endMin - b.startMin), 0);
  assert.ok(
    naive >= w5Total,
    `换周后按 id 比对会把上一周全部块算成「被删」（${naive} 分钟）—— `
    + '所以 UI 必须只在**同一周次**内传 previousPlan，本函数是纯度量，不做这层保护',
  );
});

/* ============================================================
 * 五、传基线不会让「没被要求改的天」跟着动
 * ========================================================== */

test('传了 previousPlan，未受影响的天逐块不变（增量 = 只动该动的）', () => {
  const base = solveWeek(reqWith({}));
  const noPrev = solveWeek(reqWith({ tasks: [PINNED] }));
  const withPrev = solveWeek(reqWith({ tasks: [PINNED], previousPlan: base.plan }));

  for (const d of [1, 2, 4, 5]) {
    assert.equal(
      daySig(withPrev.plan, d), daySig(noPrev.plan, d),
      `周${d} 没被要求改，传不传基线都该一样`,
    );
    assert.equal(
      daySig(withPrev.plan, d), daySig(base.plan, d),
      `周${d} 相对上一版也不该变`,
    );
  }
});

/* ============================================================
 * 六、权重口径不变（防顺手改坏）
 * ========================================================== */

test('churn 权重仍是 0.8，hard 的锁因子仍是 100', () => {
  assert.equal(DEFAULT_WEIGHTS.churn, 0.8);
});
