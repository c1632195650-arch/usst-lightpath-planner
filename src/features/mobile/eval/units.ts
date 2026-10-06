/**
 * 光溯移动端 · 执行力评估 · 完成单元构建（维度 1/3 的原料）
 * ============================================================
 * 纯函数：把「周计划 × 覆盖层 × 行为日志」折算成逐日的 CompletionUnit。
 * 口径申报（v1 取舍，任务书未细化处）：
 *   · 只统计**当周**的日子 —— 跨周的日子需要异步重算上一周计划，v1 不做；
 *   · 块的「最终完成状态」以行为日志最后一次事件为准（先勾后取消 = 未完成）；
 *   · 没有任何事件的日子也生成单元（scheduled 但没勾 = 未完成），这样完成率
 *     的分母才是真实的「排了多少」，而不是「勾了多少」——**但只对「App 在用」
 *     的日子成立**：调用方必须先经 `inUseDays` 截断（2026-10-06 验收缺陷①，
 *     铁律 2：装 App 之前的日子没有可信的完成数据，虚构 done=false 会让
 *     冷启动恒得 confident 0%，见 docs/task3-acceptance-report-2026-10-06.md）。
 */
import type { WeekPlan } from '@/types';
import type { UserPlanLayer } from '@/features/week/userPlanStore';
import { applyLayerToBlocks, parseDate, weekNoFromTermStart } from '../lib/sync.ts';
import type { CompletionUnit } from './model.ts';

/** 本地日历日 'YYYY-MM-DD'（补零；补零后字符串比较即时间序） */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 「App 实际在用」的日子 ⊆ days：**从首个行为事件当天起算（含）**。
 * 首个事件前（含无任何事件的冷启动）→ 空数组 → completionRate 走 accumulating
 * 「数据累积中」，绝不显示 0%。补零 ISO 日，字符串比较即时间序；非法日不进统计。
 */
export function inUseDays(days: readonly string[], firstEventDayKey: string | null): string[] {
  if (!firstEventDayKey || !DAY_KEY_RE.test(firstEventDayKey)) return [];
  return days.filter((d) => DAY_KEY_RE.test(d) && d >= firstEventDayKey);
}

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
