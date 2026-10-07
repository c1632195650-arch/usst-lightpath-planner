/**
 * 最小重启（长计划增强计划书-2026-10-07 §2.1，RAY 拍板「最小重启」）
 * ============================================================
 * 解决什么：这周没做完的目标投入（如 3 次跑步只跑了 1 次），下周怎么办？
 * 三个立场（缺一不可）：
 *   1. **顺延一个最小可行单元**（25 分钟补课块）—— 让目标"还活着"；
 *   2. **欠账明说**（计数进 warning，不静默）—— 用户知道自己欠了多少；
 *   3. **绝不补整周** —— 全量顺延 = 雪崩弃坑（外部调研与 RAY 拍板的一致结论）；
 *      连续两周同类欠账 → **降档建议**（调低档，而不是加压补课）。
 *
 * 数据源：`behaviorLog` 的 skipped 记录（没标记 ≠ 没做，不进欠账 —— 诚实口径）。
 * ⚠️ 域对纪律（R5）：本模块**不 import features/behavior** —— 欠账表由调用方
 * （useWeekPlan，week 域，本来就消费 behaviorLog）用 `goalDebtByGoal` 算好注入。
 * 纯函数：不读时钟、不碰 localStorage；周上下文全部由参数注入。
 */
import type { UserTask } from '@/lib/planner/templates';
import { KIND_TO_BLOCK } from './goalDecompose';
import type { Goal } from './goalStore';

/** 补课块时长 = 最小可行单元（与 goalDecompose 的 MIN_BLOCK 同值口径） */
export const RESTART_BLOCK_MIN = 25;

export interface RestartOutput {
  tasks: UserTask[];
  warnings: Array<{ goalId: string; title: string; message: string }>;
}

export function restartTasks(
  /** 上周目标块欠账（goalId → skipped 次数）；调用方用 `goalDebtByGoal(records, prevWeekNo)` 算 */
  debt: ReadonlyMap<string, number>,
  /** 上上周欠账（判断「连续两周」，只影响文案） */
  debtPrev: ReadonlyMap<string, number>,
  goals: readonly Goal[],
  weekNo: number,
): RestartOutput {
  const tasks: UserTask[] = [];
  const warnings: RestartOutput['warnings'] = [];

  for (const goal of goals) {
    const skipped = debt.get(goal.id) ?? 0;
    if (skipped <= 0) continue;

    tasks.push({
      id: `goal-${goal.id}-restart-w${weekNo}`,
      title: `${goal.title} · 补上周`,
      emoji: goal.emoji,
      kind: KIND_TO_BLOCK[goal.kind],
      category: 'custom',
      weeks: [weekNo],
      durationMin: RESTART_BLOCK_MIN,
      priority: 60,
      note: `最小重启 · 上周欠账 ${skipped} 次（本次只补一个最小步子，其余计入欠账）`,
    });

    const streak = (debtPrev.get(goal.id) ?? 0) > 0;    warnings.push({
      goalId: goal.id,
      title: goal.title,
      message: streak
        ? `「${goal.title}」连续两周欠账：已排最小补课块。建议把目标调低一档（延后截止 / 减少总时长），比硬补更可能走完`
        : `「${goal.title}」上周欠账 ${skipped} 次：已排一个 25 分钟补课块，其余计入欠账（不会整周补课）`,
    });
  }
  return { tasks, warnings };
}
