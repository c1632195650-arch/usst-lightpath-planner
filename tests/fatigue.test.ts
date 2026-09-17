/**
 * 跨周自适应（疲劳 / 逐日可行性）—— 引擎侧验收
 * 跑法：npm run test:engine
 *
 * 这一组盯的是**一类很容易做错的自适应**：调目标本身不难，难的是
 * 「构造 / 评分 / 解释」三处说的是不是**同一个数**。只要有一处还按基准目标算，
 * 就会出现「按 96 分钟排、按 120 分钟扣分」—— 引擎会认为一份本来合理的计划
 * 质量很差，进而让 `improve` 往错的方向推。
 *
 * 语料复用**冻结的 golden 输入**：这样「没有滚动数据时行为完全不变」这件事，
 * 与 AC-2（构造等价）用的是同一套输入。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RollingState, WeekPlan } from '@/types';
import { solveWeek, stablePlanJson } from '@/lib/planner/solver.ts';
import { evaluate } from '@/lib/planner/objective.ts';
import { DEFAULT_WEIGHTS } from '@/lib/planner/model.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import {
  FATIGUE, countableDaysOf, effectiveStudyMin, fatigueAdjustment, weeklyStudyTarget,
} from '@/lib/planner/fatigue.ts';
import { buildGoldenInput, goldenInputByName } from './golden-inputs.ts';

const G = goldenInputByName('week-04-typical');
if (!G) throw new Error('缺少 golden 语料 week-04-typical');
const BASE = toPlanRequest(buildGoldenInput(G));
const DAYS = countableDaysOf(BASE.policy);

function reqWith(rolling: RollingState | undefined) {
  return { ...BASE, rolling } as never;
}

/** 造一份「工作日日均占用 = 给定分钟」的滚动状态（周一到周日同值） */
function rollingOf(dailyMin: number, feasibleByDow?: number[]): RollingState {
  return {
    recentLoad: Array.from({ length: 7 }, () => dailyMin),
    loadByDow: [0, 0, 0, 0, 0, 0, 0, 0],
    upcoming: [],
    ...(feasibleByDow ? { feasibleByDow } : {}),
  };
}

function studyMinOf(plan: WeekPlan, day?: number): number {
  return plan.blocks
    .filter((b) => b.kind === 'study' && (day == null || b.dayOfWeek === day))
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);
}

/* ============================================================
 * 一、无数据 = 完全不变（golden 安全的前提）
 * ========================================================== */

test('没有滚动数据时恒等：因子为 1、逐日目标 = 基准值、没有理由行', () => {
  const adj = fatigueAdjustment(BASE.policy, undefined);
  assert.equal(adj.factor, 1);
  assert.equal(adj.observedDailyMin, null);
  assert.equal(adj.adjustedDailyMin, BASE.policy.dailyStudyMin);
  for (const d of DAYS) {
    assert.equal(effectiveStudyMin(adj, d), BASE.policy.dailyStudyMin, `周${d} 目标不该变`);
  }
  assert.equal(weeklyStudyTarget(BASE.policy, adj), BASE.policy.dailyStudyMin * DAYS.length);
  assert.deepEqual(adj.reasons, [], '没有调节就不该产出理由（否则文案会无中生有）');
  assert.deepEqual(adj.softenedDays, []);
});

test('没有滚动数据时不产出疲劳诊断（可与「有数据但不需要调节」区分）', () => {
  assert.equal(solveWeek(reqWith(undefined)).diagnostics.fatigue, undefined);
  assert.ok(solveWeek(reqWith(rollingOf(300))).diagnostics.fatigue, '有数据就该有诊断');
});

/* ============================================================
 * 二、只下调、不上调（反内卷）
 * ========================================================== */

test('负荷轻时不加量：因子恒为 1（引擎不替用户上强度）', () => {
  for (const m of [0, 120, 300, FATIGUE.loadLow]) {
    const adj = fatigueAdjustment(BASE.policy, rollingOf(m));
    assert.equal(adj.factor, 1, `日均 ${m} 分钟不该触发任何调节`);
    assert.equal(adj.adjustedDailyMin, BASE.policy.dailyStudyMin);
  }
  // 上限必须 ≤ 1 —— 这是本测试真正要锁住的契约
  assert.ok(FATIGUE.minFactor <= 1 && FATIGUE.minFactor > 0);
});

test('疲劳随日均占用单调不增，并在上限处封顶', () => {
  const marks = [FATIGUE.loadLow, 500, 540, FATIGUE.loadHigh, 900];
  const factors = marks.map((m) => fatigueAdjustment(BASE.policy, rollingOf(m)).factor);
  assert.equal(factors[0], 1, `${FATIGUE.loadLow} 分钟/天 = 边界，不该调节`);
  for (let i = 1; i < factors.length; i += 1) {
    assert.ok(factors[i] <= factors[i - 1], `因子应单调不增：${marks[i - 1]} → ${factors[i - 1]}，${marks[i]} → ${factors[i]}`);
  }
  assert.equal(factors[3], FATIGUE.minFactor, `${FATIGUE.loadHigh} 分钟/天应压到下限`);
  assert.equal(factors[4], FATIGUE.minFactor, '超出上限仍封顶，不许无限压');
});

/* ============================================================
 * 三、端到端：高负荷 → 自习真的变少
 * ========================================================== */

test('端到端：负荷偏高时实排自习总量下降，且诊断带上因子', () => {
  const base = solveWeek(reqWith(undefined));
  const heavy = solveWeek(reqWith(rollingOf(FATIGUE.loadHigh)));
  const a = studyMinOf(base.plan);
  const b = studyMinOf(heavy.plan);

  assert.ok(
    b < a,
    `目标下调后自习应减少，实际 ${a} → ${b}（若相等说明目标没真正接到构造层）`,
  );
  const f = heavy.diagnostics.fatigue;
  assert.ok(f, '应带上自适应诊断');
  assert.equal(f.factor, FATIGUE.minFactor);
  assert.equal(f.baseDailyMin, BASE.policy.dailyStudyMin);
  assert.equal(f.weeklyTargetMin, weeklyStudyTarget(BASE.policy, fatigueAdjustment(BASE.policy, rollingOf(FATIGUE.loadHigh))));
});

/* ============================================================
 * 四、逐日可行性：只动那一天
 * ========================================================== */

test('逐日可行性：被标记「总是没做」的那天少排，其他天不受影响', () => {
  // 找一个本来就有自习块的日子（不然「变少」无从谈起）
  const base = solveWeek(reqWith(undefined));
  const targetDay = [1, 2, 3, 4, 5].find((d) => studyMinOf(base.plan, d) > 0);
  assert.ok(targetDay, '夹具应至少有一天排了自习');

  const feas = [1, 1, 1, 1, 1, 1, 1];
  feas[targetDay - 1] = FATIGUE.minFeasible;
  // 负荷给一个**不触发疲劳**的值，把疲劳这个变量消掉 —— 否则分不清是谁造成的差异
  const soft = solveWeek(reqWith(rollingOf(FATIGUE.loadLow, feas)));

  const before = studyMinOf(base.plan, targetDay);
  const after = studyMinOf(soft.plan, targetDay);
  assert.ok(
    after < before,
    `周${targetDay} 的可行性被压到 ${FATIGUE.minFeasible}，自习应变少，实际 ${before} → ${after}`,
  );

  // 其他天逐块一致（证明不是「整体缩水」）
  for (const d of DAYS) {
    if (d === targetDay) continue;
    assert.equal(
      studyMinOf(soft.plan, d), studyMinOf(base.plan, d),
      `周${d} 没被标记没做，不该受影响`,
    );
  }
});

/* ============================================================
 * 四·补、越界值与统计口径（防「读了旧数据就失控」）
 * ========================================================== */

test('引擎对越界的可行性值兜底：0 不能变成「这天什么都不排」', () => {
  // 应用层写入时会截断到 [minFeasible, 1]；但**旧版本存下来的状态**可能没有这一层，
  // 引擎也不能因为读到 0 就把某天的自习目标算成 0（那等于「这天别安排任何自习」），
  // 读到 2 也不能把目标翻倍（会把自习排爆）。
  const low = Math.round(BASE.policy.dailyStudyMin * FATIGUE.minFeasible);
  const adj = fatigueAdjustment(BASE.policy, rollingOf(300, [0, -1, 2, 1, 1, 1, 1]));
  assert.equal(effectiveStudyMin(adj, 1), low, '可行性 0 → 截断到下限');
  assert.equal(effectiveStudyMin(adj, 2), low, '可行性为负 → 同样截断');
  assert.equal(
    effectiveStudyMin(adj, 3), BASE.policy.dailyStudyMin,
    '可行性 >1 → 夹回 1（否则「多做的天数」会把目标越推越高）',
  );
});

test('日均口径随 weekendWork 变化 —— 必须与 objective 的 countableDays 同口径', () => {
  // 工作日满是 600、周末空闲。不占周末的学期里日均就是 600（不该被周末稀释）；
  // 占周末的学期里日均被摊薄到 429（低于下限）。两边若不同口径，
  // 同一份数据会算出两个「累不累」。
  const load = [600, 600, 600, 600, 600, 0, 0];
  const rolling: RollingState = { recentLoad: load, loadByDow: [0, ...load], upcoming: [] };
  assert.equal(
    fatigueAdjustment({ ...BASE.policy }, rolling).factor, FATIGUE.minFactor,
    '不占周末 → 只看工作日 5 天',
  );
  assert.equal(
    fatigueAdjustment({ ...BASE.policy, weekendWork: true }, rolling).factor, 1,
    '占周末 → 周末的 0 把日均摊到 429，低于下限，因此不调节',
  );
});

/* ============================================================
 * 五、口径一致：评分与解释都必须用「有效目标」
 * ========================================================== */
test('评分口径：自习缺口按有效目标算，不是按基准目标', () => {
  const rolling = rollingOf(FATIGUE.loadHigh);
  const heavy = solveWeek(reqWith(rolling));
  const adj = fatigueAdjustment(BASE.policy, rolling);
  const want = weeklyStudyTarget(BASE.policy, adj);

  assert.ok(want < BASE.policy.dailyStudyMin * DAYS.length, '前提：有效目标确实低于基准');

  const r = evaluate(heavy.plan, {
    weekNo: BASE.weekNo,
    policy: BASE.policy,
    weights: DEFAULT_WEIGHTS,
    rolling,
  });
  assert.equal(
    r.raw.targetStudyMin, want,
    '评分用的目标必须是有效目标（否则会「按 96 分钟排、按 120 分钟扣分」）',
  );
  assert.equal(r.raw.studyMin, studyMinOf(heavy.plan), '实际自习口径也应一致');
});

test('解释口径：达成有效目标就不该报「自习未达标」', () => {
  const heavy = solveWeek(reqWith(rollingOf(FATIGUE.loadHigh)));
  const got = studyMinOf(heavy.plan);
  const baseWant = BASE.policy.dailyStudyMin * DAYS.length;

  const issue = heavy.plan.issues.find((i) => i.code === 'study-shortfall');
  assert.equal(
    issue, undefined,
    `已达成有效目标却报了未达标：${issue?.message ?? ''}`,
  );
  // ⚠️ 区分度所在：若仍按**基准**目标判阈值，这里本来会误报。
  //    没有这行断言，本测试在「口径没改」时也会通过，等于没测。
  assert.ok(
    got < baseWant * 0.8,
    `前提不成立：实际自习 ${got} 未低于基准阈值 ${Math.round(baseWant * 0.8)}，`
    + '本测试无法区分「用了有效目标」还是「根本没触发阈值」',
  );
});

/* ============================================================
 * 六、确定性
 * ========================================================== */

test('同一份含滚动的输入重复求解，结果逐字节相同', async () => {
  const { stablePlanJson } = await import('@/lib/planner/solver.ts');
  const r = reqWith(rollingOf(560, [1, 0.8, 0.6, 1, 1, 1, 1]));
  assert.equal(stablePlanJson(solveWeek(r)), stablePlanJson(solveWeek(r)));
});
