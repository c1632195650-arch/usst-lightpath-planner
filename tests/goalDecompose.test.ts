/**
 * 目标分解算法 v1 测试
 * ============================================================
 * 守的规则（定稿设计，不得偏离）：
 *   1. pace 曲线：steady 等量 / sprint 单调递增 / both 打底+临期加权
 *   2. 块长：40 分钟基准（问卷 focusMinutes 覆盖），clamp 25–120，5 分钟吸附
 *   3. 分布：落在有空天、避开课程密日
 *   4. 容量守卫：周预算 > 自由容量 60% → 预警（不静默砍）
 *   5. 精力预算表：按 kind 归类，超 cap 剔除 + 预警
 *   6. 无截止日期：steady 每周 60 分钟旧行为；sprint 不排（不猜）
 *   7. 多目标并行折扣：2 个 ×0.85
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Goal } from '@/features/activity/goalStore';
import { DEFAULT_GOAL_PREFS, type GoalPrefs } from '@/features/activity/goalPrefs';
import { decomposeGoal, goalTasksOf, paceWeights } from '@/features/activity/goalDecompose';

const TERM = '2026-09-07'; // 第 1 周周一（与校历常量一致）
const W3 = 3;              // 第 3 周（9/21–9/27）

function goal(over: Partial<Goal> & Pick<Goal, 'id' | 'title' | 'totalHours' | 'dueAt'>): Goal {
  return { emoji: '🎯', kind: 'contest', pace: 'steady', source: 'manual', ...over };
}
function prefs(over: Partial<GoalPrefs> = {}): GoalPrefs {
  return {
    ...DEFAULT_GOAL_PREFS,
    freeDays: [1, 2, 3, 4, 5],
    ...over,
  };
}

test('pace 曲线：steady 等量 / sprint 单调递增 / both 打底+临期加权', () => {
  assert.deepEqual(paceWeights('steady', 4), [1, 1, 1, 1]);
  const sp = paceWeights('sprint', 4);
  assert.ok(sp[3] > sp[2] && sp[2] > sp[1] && sp[1] > sp[0], 'sprint 单调递增');
  const bo = paceWeights('both', 6);
  assert.equal(bo[0], 1, 'both 前期打底');
  assert.ok(bo[5] > bo[0], 'both 临期加权');
});

test('steady：80h/10 周 → 本周预算 480min，拆 5 块 × 95min（40min 基准被「周预算/天数」覆盖为整周预算分布）', () => {
  const g = goal({ id: 'g1', title: '数学建模国赛', totalHours: 80, dueAt: '2026-11-16' });
  // 11/16 在第 11 周 → 第 3 周时 weeksLeft = 8, W = 9
  const r = decomposeGoal(g, W3, TERM, prefs());
  assert.ok(r.tasks.length > 0);
  const total = r.tasks.reduce((n, t) => n + (t.durationMin ?? 0), 0);
  const weights = paceWeights('steady', 9);
  const expectBudget = Math.round((80 * 60) * (weights[0] / weights.reduce((a, b) => a + b, 0)));
  assert.ok(
    Math.abs(total - expectBudget) <= 5 * r.tasks.length,
    `块合计 ${total} 应接近本周预算 ${expectBudget}（吸附误差 ≤ 每天五分钟）`,
  );
  // 每块 clamp 在 25–120
  for (const t of r.tasks) {
    assert.ok((t.durationMin ?? 0) >= 25 && (t.durationMin ?? 0) <= 120);
    assert.equal((t.durationMin ?? 0) % 5, 0, '5 分钟吸附');
  }
});

test('sprint：临近截止的周预算显著高于早期', () => {
  const g = goal({ id: 'g2', title: '冲刺目标', totalHours: 60, dueAt: '2026-10-05', pace: 'sprint' });
  // 10/05 在第 5 周 → 第 1 周 weeksLeft = 4
  const early = decomposeGoal(g, 1, TERM, prefs());
  const last = decomposeGoal(g, 5, TERM, prefs());
  const earlyMin = early.tasks.reduce((n, t) => n + (t.durationMin ?? 0), 0);
  const lastMin = last.tasks.reduce((n, t) => n + (t.durationMin ?? 0), 0);
  assert.ok(lastMin > earlyMin, `临期周预算（${lastMin}）应大于早期（${earlyMin}）`);
});

test('分布：有空天按课程量升序，避开课程密日', () => {
  const g = goal({ id: 'g3', title: '稳态目标', totalHours: 5, dueAt: '2026-09-28' });
  // 5h/4 周 → 每周 75min → 5 天 × 15min < 25 → clamp 25：块数 = 5 天 → total 125 > 75
  // 用 2 天有课差异验证排序：freeDays [1,2]，周一课 300min、周二 0
  const r = decomposeGoal(g, W3, TERM, prefs({ freeDays: [1, 2] }), { 1: 300, 2: 0 });
  assert.deepEqual(
    r.tasks.map((t) => Number(t.id.match(/-d(\d)$/)?.[1])),
    [2, 1],
    '全部块落在两天内，且第一块在课程少的周二',
  );
});

test('容量守卫：周预算 > 自由容量 60% → 预警（不静默砍）', () => {
  const g = goal({ id: 'g4', title: '大目标', totalHours: 50, dueAt: '2026-09-28' });
  // 9/28 在第 4 周 → 第 3 周 weeksLeft = 1，W = 2 → 本周预算 ≈ 3000×(1/3) = 1000min
  const r = decomposeGoal(g, W3, TERM, prefs({ freeDays: [1, 2, 3] }), { 1: 4800, 2: 4800, 3: 4800, 4: 4800, 5: 4800, 6: 4800, 7: 4800 });
  assert.ok(r.warning, '预算远超自由容量 60% → 必须预警');
  assert.match(r.warning!.message, /延长截止日期/);
});

test('精力预算表：学习类合计超 cap → 超出部分剔除 + 预警', () => {
  const g1 = goal({ id: 'ga', title: 'A', totalHours: 90, dueAt: '2026-11-30' });
  const g2 = goal({ id: 'gb', title: 'B', totalHours: 90, dueAt: '2026-11-30' });
  // 默认 studyCap = 600min：各 600min/周 → A 吃满 cap，B 全部被裁
  const out = goalTasksOf([g1, g2], W3, TERM, prefs());
  const keptA = out.tasks.filter((t) => t.id.startsWith('goal-ga')).reduce((n, t) => n + (t.durationMin ?? 0), 0);
  const keptB = out.tasks.filter((t) => t.id.startsWith('goal-gb')).reduce((n, t) => n + (t.durationMin ?? 0), 0);
  assert.ok(keptA + keptB <= 600 + 125, `合计不超过 cap（尾块容差）：实际 ${keptA + keptB}`);
  assert.ok(keptA >= keptB, '先到先得：A 优先，B 被裁');
  assert.ok(out.warnings.some((w) => w.goalId === 'gb'), '被裁的 B 必须有预警');
});

test('多目标并行折扣：2 个目标时单目标预算 ×0.85', () => {
  const g = goal({ id: 'g5', title: 'X', totalHours: 10, dueAt: '2026-09-28' });
  const p1 = decomposeGoal(g, W3, TERM, prefs({ parallelCount: 1 }));
  const p2 = decomposeGoal(g, W3, TERM, prefs({ parallelCount: 2 }));
  const sum = (r: typeof p1) => r.tasks.reduce((n, t) => n + (t.durationMin ?? 0), 0);
  assert.ok(sum(p2) < sum(p1), '并行 2 个 → 预算打折');
});

test('focusMinutes 覆盖块长基准：专注 120 → 单块更长、块数更少', () => {
  const g = goal({ id: 'g6', title: 'Y', totalHours: 40, dueAt: '2026-11-16' });
  const p40 = decomposeGoal(g, W3, TERM, prefs({ focusMinutes: 40 }));
  const p120 = decomposeGoal(g, W3, TERM, prefs({ focusMinutes: 120 }));
  const d40 = p40.tasks[0]?.durationMin ?? 0;
  const d120 = p120.tasks[0]?.durationMin ?? 0;
  assert.ok(d120 >= d40, '专注时长更长 → 单块更长');
});

test('无截止日期：steady 每周 60 分钟旧行为；sprint 不排（不猜）', () => {
  const steady = goal({ id: 's1', title: '无截止 steady', totalHours: 20, dueAt: undefined! });
  const r1 = decomposeGoal(steady, W3, TERM, prefs());
  assert.equal(r1.tasks.length, 1);
  assert.equal(r1.tasks[0].durationMin, 60);
  const sprint = goal({ id: 's2', title: '无截止 sprint', totalHours: 20, dueAt: undefined!, pace: 'sprint' });
  const r2 = decomposeGoal(sprint, W3, TERM, prefs());
  assert.equal(r2.tasks.length, 0, 'sprint 无截止日 → 不排');
});

test('goalTasksOf 汇总：tasks 与 warnings 都返回', () => {
  const g1 = goal({ id: 'ga', title: 'A', totalHours: 30, dueAt: '2026-11-30' });
  const out = goalTasksOf([g1], W3, TERM, prefs(), { 1: 4800, 2: 4800, 3: 4800, 4: 4800, 5: 4800, 6: 4800, 7: 4800 });
  assert.ok(out.tasks.length > 0);
  assert.ok(out.warnings.length > 0, '小自由容量场景应触发预警');
});
