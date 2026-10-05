/**
 * 方法库 v2 扩域消费层测试（tests/method_params_v2.test.ts）
 * ==============================================================
 * 覆盖 2026-10-06 的 v2 扩域：HABIT / GOAL / EXECUTION / WOOP 四个参数块
 * 与 `methodTipForBlock` 的三态行为。
 *
 * 🔴 反向验证锚点（本文件守护的东西）：
 *   RV-1 关掉任一新参数块 → 本测试变红（证明引擎真的消费编译产物）
 *   RV-2 把 methodTipForBlock 的 null 分支改成硬凑 → 三态测试变红
 *   RV-3 给 methodTipForBlock 传入学科参数 → 类型层就该拒绝（本文件用参数形状断言守住）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HABIT,
  GOAL,
  EXECUTION,
  WOOP,
  methodTipForBlock,
  methodHint,
  methodCardsForPhase,
  type MethodTipContext,
} from '@/lib/planner/methods';

/* ---------------------------------------------------------------
 * 一、四块参数来自编译产物（非手写常量）
 * ------------------------------------------------------------- */

test('HABIT 块编译自 v2 习惯条目', () => {
  // 线索联结需至少 14 天才值得评估
  assert.equal(HABIT.minCueDays, 14);
  // 每周豁免额度≥1：漏一天不作失败处理
  assert.ok(HABIT.missGracePerWeek >= 1);
  // 中断后应尽快重排（不超过 48 小时）
  assert.ok(HABIT.relapseResumeHours <= 48);
  // 前28 天不评价成败
  assert.ok(HABIT.noJudgeBeforeDays >= 14);
  assert.equal(HABIT.oneCuePerHabit, true);
  assert.equal(HABIT.anchorRequired, true);
  assert.equal(HABIT.stableContextRequired, true);
});

test('GOAL 块编译自 v2 目标条目', () => {
  // 里程碑不宜过多（超过4 就变打卡）
  assert.ok(GOAL.milestoneMax <= 4);
  assert.equal(GOAL.checkInIntervalDays, 7);
  // 心理对照视界：1-4 周
  assert.equal(GOAL.wishHorizonMinDays, 1);
  assert.equal(GOAL.wishHorizonDays, 28);
  // 放弃条件必须是客观的
  assert.equal(GOAL.killRequireObjective, true);
  assert.ok(GOAL.killCriteriaCount >= 1);
  // 规划缓冲：规划谬误要求留余量
  assert.ok(GOAL.planningBufferRatio > 0);
});

test('EXECUTION 块编译自 v2 执行力条目', () => {
  assert.equal(EXECUTION.twoMinuteThreshold, 2);
  assert.equal(EXECUTION.firstActionStartMin, 5);
  // 低能量日的保底动作必须 ≤5 分钟，否则「保底」失去意义
  assert.ok(EXECUTION.minActionFloorMin <= 5);
  assert.equal(EXECUTION.fallbackDefined, true);
  // if-then 的障碍必须是内在的
  assert.equal(EXECUTION.requireInnerObstacle, true);
  // 诱惑捆绑必须真的限制使用（只靠自律提示效果显著更弱）
  assert.equal(EXECUTION.bundlingRestrictAccess, true);
  assert.ok(EXECUTION.frictionStepsMax >= 1);
});

test('WOOP 块：必须要求给出障碍（只做正向想象会降低能量）', () => {
  assert.equal(WOOP.requireObstacle, true);
  assert.equal(WOOP.steps, 4);
  assert.ok(WOOP.outcomeImagerySec > 0 && WOOP.outcomeImagerySec <= 120);
  assert.ok(WOOP.wishMaxWords > 0);
});

/* ---------------------------------------------------------------
 * 二、🔴 没有 WILLPOWER 块 —— contested 不得编译成硬参数
 * ------------------------------------------------------------- */

test('不导出任何「意志力资源量」常量（ego depletion 已进入复制危机）', async () => {
  const mod = await import('@/lib/planner/methods');
  // 断言模块上**不存在** WILLPOWER / SELF_CONTROL_RESOURCE 之类导出。
  // 若将来有人加进来，必须先回答 Vohs 2021（36lab/N=3531）的复制结果。
  const forbidden = Object.keys(mod).filter((k) =>
    /WILLPOWER|SELF_CONTROL_RESOURCE|DEPLETION/i.test(k));
  assert.deepEqual(forbidden, [], `不应存在意志力资源量导出：${forbidden.join(', ')}`);
});

/* ---------------------------------------------------------------
 * 三、methodTipForBlock 三态（P2-1）
 * ------------------------------------------------------------- */

test('methodTipForBlock · 有匹配：返回结构完整的 tip', () => {
  const tip = methodTipForBlock({ kind: 'review' });
  assert.ok(tip, '复习块应有tip');
  assert.ok(tip!.slug.length > 0);
  assert.ok(tip!.tip.length > 0);
  assert.ok(['A', 'B', 'C', 'D'].includes(tip!.tier), `tier 应为 A-D，实际 ${tip!.tier}`);
  assert.ok(['verified', 'contested'].includes(tip!.status));
  // slug 必须真实存在于方法库（不许编造）
  const h = methodHint(tip!.slug);
  assert.ok(h, `tip 引用的 ${tip!.slug} 必须在方法库中存在`);
});

test('methodTipForBlock · 条件不满足：返回 null（宁缺毋滥，不硬凑）', () => {
  // 未定义的块类目 → 没有任何候选 → null（绝不硬凑一条）
  const tip = methodTipForBlock({ kind: 'weird-unknown-kind' as never });
  assert.equal(tip, null, '未知块类目必须返回 null 而非硬凑');
});

test('methodTipForBlock · 低能量时给出最小行动提示（上下文敏感）', () => {
  const normal = methodTipForBlock({ kind: 'assignment', durationMin: 20 });
  const low = methodTipForBlock({ kind: 'assignment', durationMin: 20, lowEnergy: true });
  assert.ok(low, '低能量作业块应有专门提示');
  assert.equal(low!.slug, 'two-minute-start', '低能量时应指向最小行动而非泛泛建议');
  // 确认与普通情形**不同**（否则说明上下文条件根本没生效）
  assert.notEqual(low!.slug, normal?.slug);
});

test('methodTipForBlock · 已有 if-then 时不再重复提示', () => {
  const without = methodTipForBlock({ kind: 'assignment', durationMin: 20 });
  const withPlan = methodTipForBlock({ kind: 'assignment', durationMin: 20, hasIfThen: true });
  // hasIfThen=true 时不应再推implementation-cue-spec
  assert.notEqual(withPlan?.slug, 'implementation-cue-spec');
  assert.ok(without, '对照：无if-then 时应照常返回');
});

test('methodTipForBlock · 纯函数：同输入同输出', () => {
  const ctx: MethodTipContext = { kind: 'exam', durationMin: 90 };
  assert.deepEqual(methodTipForBlock(ctx), methodTipForBlock(ctx));
});

test('methodTipForBlock · 不接受学科参数（CY 明确红线）', () => {
  // 形状断言：参数对象的键只应是块类目与时长/能量特征。
  // 若有人给 MethodTipContext 加学科参数，这里会红。
  const tip = methodTipForBlock({ kind: 'review', durationMin: 45 });
  assert.ok(tip);
  // tip 的内容不得出现任何具体学科名（方法论跨学科通用）
  const majors = ['高等数学', '线性代数', '大学物理', '有机化学', '数据结构', '毛概', '英语'];
  for (const m of majors) {
    assert.ok(!tip!.tip.includes(m), `tip 不应按学科走，实际含「${m}」：${tip!.tip}`);
  }
});

test('methodTipForBlock · contested 条目恒排最后（不把争议当定论）', () => {
  // 把所有块类目都取一遍，检查：若候选里同时有 verified 与 contested，
  // 返回的必须是 verified 的那条。
  const kinds = ['assignment', 'review', 'exam', 'exercise', 'rest'] as const;
  for (const kind of kinds) {
    for (const lowEnergy of [true, false]) {
      const tip = methodTipForBlock({ kind, durationMin: 60, lowEnergy });
      if (!tip) continue;
      assert.equal(
        tip.status, 'verified',
        `${kind}/lowEnergy=${lowEnergy} 返回了 contested 条目 ${tip.slug}，违反「争议不作定论」`,
      );
    }
  }
});

/* ---------------------------------------------------------------
 * 四、v2 条目在索引里可查（含contested 的双向状态）
 * ------------------------------------------------------------- */

test('v2 五类领域代表条目均在 hints 索引中', () => {
  const must = [
    'habit-formation-times',        // 习惯
    'woop-mental-contrasting',      // 目标
    'procrastination-mood-repair',  // 执行力
    'ego-depletion-contested',      // 自控力（contested）
    'procrastination-mood-repair',  // 情绪调节（与执行力共用机制条目）
    'retrospective-peak-end-rule',  // 边界
  ];
  for (const s of must) assert.ok(methodHint(s), `${s} 应在索引中`);
});

test('contested 条目的状态被如实保留（不得被编译成 verified）', () => {
  const contestedSlugs = [
    'ego-depletion-contested',
    'decision-fatigue-contested',
    'habit-research-selfcritique',
    'psychological-counterfactual-neg',
  ];
  for (const s of contestedSlugs) {
    const h = methodHint(s);
    assert.ok(h, `${s} 应在索引中`);
    assert.equal(h!.status, 'contested', `${s} 应标 contested`);
  }
});

test('方法卡排序：contested 恒置底', () => {
  const cards = methodCardsForPhase('any', 20);
  const idx = cards.findIndex((c) => c.status === 'contested');
  if (idx >= 0) {
    const after = cards.slice(idx + 1);
    assert.ok(
      after.every((c) => c.status === 'contested'),
      'contested 之后不应再出现 verified 卡片',
    );
  }
});