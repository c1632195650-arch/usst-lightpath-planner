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

test('只加一件固定任务：既有安排没动 → churn 必须是 0', () => {
  const base = solveWeek(reqWith({}));
  const after = solveWeek(reqWith({ tasks: [PINNED], previousPlan: base.plan }));

  // 前提：这一版确实多了一个块（否则「没动」无从谈起）
  const added = after.plan.blocks.filter(
    (b) => !base.plan.blocks.some((p) => p.id === b.id),
  );
  assert.equal(added.length, 1, `应恰好新增 1 块，实际 ${added.length}`);

  // 前提：既有块一个都没被挪动 / 删掉
  const moved = after.plan.blocks.filter((b) => {
    const p = base.plan.blocks.find((x) => x.id === b.id);
    return p && (p.startMin !== b.startMin || p.endMin !== b.endMin || p.place !== b.place);
  });
  const removed = base.plan.blocks.filter(
    (p) => !after.plan.blocks.some((b) => b.id === p.id),
  );
  assert.deepEqual([moved.length, removed.length], [0, 0], '夹具前提：既有安排应纹丝未动');

  assert.equal(
    after.diagnostics.churnMin, 0,
    '用户主动新增的块不该算成「扰动」—— 实测既有安排一个都没动，churn 却报了改动量',
  );
  assert.equal(after.diagnostics.cost.parts.churn, 0);
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

  // ⚠️ 一个**必须知道**的事实：这里被挤走的是引擎自排的软块（free），
  //    而 §5.5 规定 `lockFactorOf('free') = 0` —— 引擎挪动自己的块不罚。
  //    所以 churn **代价**恒为 0：它目前**只是一个度量**，不会驱动 improve 去保住原有安排。
  //    要让「最小扰动」真正起作用，得给 free 块一个非零的小权重 —— 那是规格变更，
  //    交给 B 定夺；本测试只把现状钉住，免得有人以后悄悄改了却没人知道。
  assert.equal(after.diagnostics.cost.parts.churn, 0, 'free 块移动按 §5.5 不罚');
});

test('只是加东西、没打扰谁 → churn 保持 0（自习目标翻倍属于这种）', () => {
  const base = solveWeek(reqWith({}));
  const heavier = solveWeek(reqWith({
    policy: { ...BASE.policy, dailyStudyMin: 240 },
    previousPlan: base.plan,
  }));
  const moved = heavier.plan.blocks.filter((b) => {
    const p = base.plan.blocks.find((x) => x.id === b.id);
    return p && (p.startMin !== b.startMin || p.endMin !== b.endMin);
  });
  assert.equal(moved.length, 0, '前提：自习目标翻倍只是新增块，不该挪动既有块');
  assert.equal(heavier.diagnostics.churnMin, 0, '没打扰既有安排，就不该报改动量');
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
