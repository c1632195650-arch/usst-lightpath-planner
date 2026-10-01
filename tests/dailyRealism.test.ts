/**
 * 排程生活合理性测试（2026-09-28，RAY 拍板）
 * ============================================================
 * 守的规则：
 *   1. 图书馆类自习 ≥ 60 分钟（要搬书过去，学太短不划算）；其余自习 ≥ 30 分钟
 *   2. 同地点相邻自习块必须合并（含 ≤5 分钟软缓冲的缝）
 *   3. 三餐块后面紧跟「饭后消食·散步」（放得下就必须有）
 *   4. 运动起点距最近一餐结束 ≥ 120 分钟
 *   5. 运动结束后 40 分钟是恢复带：引擎自排的软块不进（课程/用户块不受限）
 *   6. 注水法（weighted max-min fairness）：小需求先满足、盈余按权重分
 *   7. 多目标公平分配：同权重同需求 → 分到一样多（替换旧的"先到先得"）
 *
 * 注释里不含「星号+斜杠」，避免提前闭合块注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construct } from '@/lib/planner/construct.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { DEFAULT_TEMPLATES } from '@/lib/planner/templates';
import { waterFillAlloc, goalTasksOf, decomposeGoal } from '@/features/activity/goalDecompose';
import type { Goal } from '@/features/activity/goalStore';
import { DEFAULT_GOAL_PREFS, type GoalPrefs } from '@/features/activity/goalPrefs';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const DAY_END_MIN = 23 * 60; // 默认 dayEnd
const DIGEST_TITLE = '饭后消食';

const SPORT_TITLES = new Set(
  DEFAULT_TEMPLATES.filter((t) => t.category === 'sport').map((t) => t.name),
);

const isLibrary = (place: string | undefined) => !!place && place.includes('图书馆');

/** 跑全部 golden 语料，收集计划（construct 直呼，不走旧引擎） */
function plansOfAllInputs() {
  return GOLDEN_INPUTS.map((g) => {
    const { plan } = construct(toPlanRequest(buildGoldenInput(g)));
    return { name: g.name, plan };
  });
}

/* ============================================================
 * 一、自习块：地点分级下限 + 同点合并
 * ========================================================== */

test('图书馆类自习块 ≥ 60 分钟，任何自习块 ≥ 30 分钟', () => {
  for (const { name, plan } of plansOfAllInputs()) {
    for (const b of plan.blocks) {
      if (b.kind !== 'study') continue;
      const dur = b.endMin - b.startMin;
      if (isLibrary(b.place)) {
        assert.ok(dur >= 60, `${name} ${b.dayOfWeek}日 图书馆自习只有 ${dur} 分钟`);
      } else {
        assert.ok(dur >= 30, `${name} ${b.dayOfWeek}日 自习块只有 ${dur} 分钟`);
      }
    }
  }
});

test('同地点相邻自习块已合并（不留 ≤5 分钟的缝）', () => {
  for (const { name, plan } of plansOfAllInputs()) {
    const study = plan.blocks
      .filter((b) => b.kind === 'study')
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin);
    for (let i = 1; i < study.length; i++) {
      const prev = study[i - 1];
      const cur = study[i];
      if (prev.dayOfWeek !== cur.dayOfWeek || prev.place !== cur.place) continue;
      const gap = cur.startMin - prev.endMin;
      assert.ok(gap > 5, `${name} ${cur.dayOfWeek}日 同在「${cur.place}」的两块自习只隔 ${gap} 分钟 —— 应合并`);
    }
  }
});

/* ============================================================
 * 二、三餐拆两块 + 饭后运动冷却
 * ========================================================== */

test('放得下的三餐后面必须紧跟饭后消食块', () => {
  const overlaps = (
    a: { startMin: number; endMin: number },
    b: { startMin: number; endMin: number },
  ) => a.startMin < b.endMin && b.startMin < a.endMin;
  for (const { name, plan } of plansOfAllInputs()) {
    const meals = plan.blocks.filter((b) => b.kind === 'meal');
    assert.ok(meals.length > 0, `${name} 应该有三餐块（语料本身的问题）`);
    for (const meal of meals) {
      const span = { startMin: meal.endMin, endMin: meal.endMin + 25 };
      const digest = plan.blocks.find(
        (b) => b.title === DIGEST_TITLE && b.dayOfWeek === meal.dayOfWeek && b.startMin === meal.endMin,
      );
      if (digest) continue;
      // 缺消食块只在两种情况下合法：超出当天边界，或紧贴着下一件既有的事
      const blocked = plan.blocks.some(
        (b) => b.dayOfWeek === meal.dayOfWeek && b !== meal && overlaps(b, span),
      );
      const pastDayEnd = meal.endMin + 25 > DAY_END_MIN;
      assert.ok(
        blocked || pastDayEnd,
        `${name} ${meal.dayOfWeek}日 ${meal.title}（结束 ${meal.endMin}）后面有空位却没有消食块`,
      );
    }
  }
});

test('运动起点距最近一餐结束 ≥ 120 分钟', () => {
  let sportSeen = 0;
  for (const { name, plan } of plansOfAllInputs()) {
    const meals = plan.blocks.filter((b) => b.kind === 'meal');
    const sports = plan.blocks.filter((b) => SPORT_TITLES.has(b.title));
    sportSeen += sports.length;
    for (const sport of sports) {
      for (const meal of meals) {
        if (meal.dayOfWeek !== sport.dayOfWeek || meal.endMin > sport.startMin) continue;
        const gap = sport.startMin - meal.endMin;
        assert.ok(
          gap >= 120,
          `${name} ${sport.dayOfWeek}日「${sport.title}」距${meal.title}结束只有 ${gap} 分钟`,
        );
      }
    }
  }
  assert.ok(sportSeen > 0, 'golden 语料里应该至少排出一个运动块（否则本测试形同虚设）');
});

/* ============================================================
 * 三、运动后恢复带
 * ========================================================== */

test('运动结束后 40 分钟内没有引擎自排的软块（恢复带）', () => {
  for (const { name, plan } of plansOfAllInputs()) {
    const sports = plan.blocks.filter((b) => SPORT_TITLES.has(b.title));
    for (const sport of sports) {
      for (const b of plan.blocks) {
        if (b === sport || b.dayOfWeek !== sport.dayOfWeek) continue;
        if (b.kind !== 'study' && b.kind !== 'activity') continue;
        if (b.startMin <= sport.endMin) continue; // 运动之前的块不归恢复带管
        assert.ok(
          b.startMin >= sport.endMin + 40,
          `${name} ${sport.dayOfWeek}日「${b.title}」在运动结束后 ${b.startMin - sport.endMin} 分钟就开始了`,
        );
      }
    }
  }
});

/* ============================================================
 * 四、注水法（weighted max-min fairness）
 * ========================================================== */

test('注水法：容量够 → 各目标拿满需求', () => {
  assert.deepEqual(waterFillAlloc([100, 200], [1, 1], 600), [100, 200]);
});

test('注水法：容量不够且权重相同 → 等分', () => {
  assert.deepEqual(waterFillAlloc([400, 400], [1, 1], 600), [300, 300]);
});

test('注水法：小需求先满足，盈余给大需求（不是按比例砍）', () => {
  assert.deepEqual(waterFillAlloc([100, 500], [1, 1], 600), [100, 500]);
});

test('注水法：权重决定盈余分配', () => {
  assert.deepEqual(waterFillAlloc([500, 500], [1, 3], 600), [150, 450]);
});

test('注水法：零需求不占容量', () => {
  assert.deepEqual(waterFillAlloc([0, 400], [1, 1], 300), [0, 300]);
});

/* ============================================================
 * 五、goalTasksOf 公平分配
 * ========================================================== */

const TERM = '2026-09-07';
const W3 = 3;

function goal(over: Partial<Goal> & Pick<Goal, 'id' | 'title' | 'totalHours' | 'dueAt'>): Goal {
  return { emoji: '🎯', kind: 'contest', pace: 'steady', source: 'manual', ...over };
}

function prefs(over: Partial<GoalPrefs> = {}): GoalPrefs {
  return { ...DEFAULT_GOAL_PREFS, freeDays: [1, 2, 3, 4, 5], ...over };
}

const keptOf = (out: { tasks: { id: string; durationMin?: number }[] }, id: string) =>
  out.tasks.filter((t) => t.id.startsWith(`goal-${id}`)).reduce((n, t) => n + (t.durationMin ?? 0), 0);

test('公平分配：两个同权重同需求的目标分到一样多（旧版是先到先得）', () => {
  const ga = goal({ id: 'fa', title: 'A', totalHours: 90, dueAt: '2026-11-30' });
  const gb = goal({ id: 'fb', title: 'B', totalHours: 90, dueAt: '2026-11-30' });
  const out = goalTasksOf([ga, gb], W3, TERM, prefs());
  const a = keptOf(out, 'fa');
  const b = keptOf(out, 'fb');
  assert.ok(a > 0 && b > 0, `两个目标都应该有产出（A=${a}, B=${b}）`);
  assert.ok(Math.abs(a - b) <= 10, `同权重同需求应等分：A=${a}, B=${b}`);
  assert.ok(out.warnings.some((w) => w.goalId === 'fb'), '被分配不足的目标必须有预警');
});

test('公平分配：高优先级目标分得比低优先级多', () => {
  const gp = goal({ id: 'fp', title: '高优', totalHours: 90, dueAt: '2026-11-30', priority: 5 });
  const gq = goal({ id: 'fq', title: '低优', totalHours: 90, dueAt: '2026-11-30', priority: 1 });
  const out = goalTasksOf([gp, gq], W3, TERM, prefs());
  const p = keptOf(out, 'fp');
  const q = keptOf(out, 'fq');
  assert.ok(p > q, `高优先级应分得更多：priority5=${p}, priority1=${q}`);
});

test('公平分配：单目标容量够时与 decomposeGoal 输出一致（不回归）', () => {
  const g = goal({ id: 'fs', title: '单目标', totalHours: 30, dueAt: '2026-11-30' });
  const direct = decomposeGoal(g, W3, TERM, prefs());
  const viaTasks = goalTasksOf([g], W3, TERM, prefs());
  const directTotal = direct.tasks.reduce((n, t) => n + (t.durationMin ?? 0), 0);
  const viaTotal = viaTasks.tasks.reduce((n, t) => n + (t.durationMin ?? 0), 0);
  assert.equal(viaTotal, directTotal, '单目标走注水（容量不紧）应与直接分解一致');
});
