/**
 * 光溯移动端 · 执行力评估 · 完成单元构建（维度 1/3 的原料）
 * ============================================================
 * 纯函数：把「周计划 × 覆盖层 × 行为日志」折算成逐日的 CompletionUnit。
 * 口径申报（v1 取舍，任务书未细化处）：
 *   · 只统计**当周**的日子 —— 跨周的日子需要异步重算上一周计划，v1 不做
 *     （冷启动 7 天窗在前几天本来就显示「累积中」，影响有限）；
 *   · 块的「最终完成状态」以行为日志最后一次事件为准（先勾后取消 = 未完成）；
 *   · 没有任何事件的日子也生成单元（scheduled 但没勾 = 未完成），这样完成率
 *     的分母才是真实的「排了多少」，而不是「勾了多少」。
 */
import type { WeekPlan } from '@/types';
import type { UserPlanLayer } from '@/features/week/userPlanStore';
import { applyLayerToBlocks, parseDate, weekNoFromTermStart } from '../lib/sync.ts';
import type { CompletionUnit } from './model.ts';

export function completionUnits(args: {
  plan: WeekPlan;
  layer: UserPlanLayer;
  termStart: string;
  /** 待统计的本地日历日（含今天；其余日子忽略） */
  days: readonly string[];
  /** finalDoneKeys(behaviorEvents) —— 最终处于已勾选状态的 (dayKey#blockId) 集合 */
  doneKeys: ReadonlySet<string>;
}): CompletionUnit[] {
  const units: CompletionUnit[] = [];
  for (const dayKey of args.days) {
    const t = parseDate(dayKey);
    if (t === null) continue;
    const d = new Date(t);
    const wn = weekNoFromTermStart(args.termStart, d);
    if (wn === null) continue;
    const dow = ((d.getUTCDay() + 6) % 7) + 1;
    const { blocks } = applyLayerToBlocks(args.plan, args.layer, wn, dow);
    for (const b of blocks) {
      units.push({ dayKey, blockId: b.id, done: args.doneKeys.has(`${dayKey}#${b.id}`) });
    }
  }
  return units;
}
