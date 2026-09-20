/**
 * 成就统计 · **唯一聚合点**（R5.3）
 * ============================================================
 * 「这学期在竞赛上花了多少小时」—— 由 `ActivityEntry` **现算**。
 *
 * ── 为什么不存一个「累计小时数」────────────────────────────────
 * 存了就必然出现**双写**：明细改了而累计没改（或反过来），
 * 这时没人知道该信哪个。类比银行账户：余额是流水算出来的，不是记下来的。
 *
 * ── 为什么它是唯一聚合点 ───────────────────────────────────────
 * 成就面板、周视图、未来的周报都调这里的函数。
 * 各写一份 sum 必然漂移（四舍五入、跨周围界、过滤条件都会不一样）。
 *
 * 纯函数：输入数组 + 周次，输出统计。**不读 localStorage**。
 */
import type { ActivityEntry, ActivityTag } from './activityStore';
import type { Goal, GoalKind } from './goalStore';

export interface TagTotal {
  tag: ActivityTag;
  minutes: number;
}

export interface GoalTotal {
  goalId: string;
  title: string;
  emoji: string;
  kind: GoalKind;
  minutes: number;
  /** 有定额时才算进度；没有定额的目标不代表失败 */
  targetMinutes?: number;
  progress?: number;
}

export interface WeekSummary {
  weekNo: number;
  totalMin: number;
  byTag: TagTotal[];
  count: number;
}

export interface RangeSummary {
  fromWeek: number;
  toWeek: number;
  totalMin: number;
  /** 按目标的累计（含「未挂目标」的归类由调用方处理） */
  byGoal: GoalTotal[];
  byTag: TagTotal[];
  count: number;
}

export const TAGS_ORDER: ActivityTag[] = ['interest', 'goal', 'other'];

function sumMin(list: readonly ActivityEntry[]): number {
  return list.reduce((n, e) => n + e.minutes, 0);
}

/** 一周的汇总 */
export function summarizeWeek(list: readonly ActivityEntry[], weekNo: number): WeekSummary {
  const mine = list.filter((e) => e.weekNo === weekNo);
  const byTag: TagTotal[] = TAGS_ORDER
    .map((tag) => ({ tag, minutes: sumMin(mine.filter((e) => e.tag === tag)) }))
    .filter((t) => t.minutes > 0);
  return { weekNo, totalMin: sumMin(mine), byTag, count: mine.length };
}

/** 一个周次区间内的汇总（含首尾） */
export function summarizeRange(
  list: readonly ActivityEntry[],
  fromWeek: number,
  toWeek: number,
  goals: readonly Goal[] = [],
): RangeSummary {
  const mine = list.filter((e) => e.weekNo >= fromWeek && e.weekNo <= toWeek);
  const byGoal: GoalTotal[] = goals.map((g) => {
    const minutes = sumMin(mine.filter((e) => e.goalId === g.id));
    return {
      goalId: g.id,
      title: g.title,
      emoji: g.emoji,
      kind: g.kind,
      minutes,
      ...(g.targetMinutes ? { targetMinutes: g.targetMinutes } : {}),
      ...(g.targetMinutes ? { progress: Math.min(1, minutes / g.targetMinutes) } : {}),
    };
  });
  return {
    fromWeek,
    toWeek,
    totalMin: sumMin(mine),
    byGoal,
    byTag: TAGS_ORDER
      .map((tag) => ({ tag, minutes: sumMin(mine.filter((e) => e.tag === tag)) }))
      .filter((t) => t.minutes > 0),
    count: mine.length,
  };
}

/** 某个目标的累计（不限周次） */
export function totalForGoal(list: readonly ActivityEntry[], goalId: string): number {
  return sumMin(list.filter((e) => e.goalId === goalId));
}

/** 按天汇总 —— 「哪天投入最多」这类问题的答案 */
export function groupByDate(list: readonly ActivityEntry[]): Array<{ date: string; minutes: number }> {
  const map = new Map<string, number>();
  for (const e of list) map.set(e.date, (map.get(e.date) ?? 0) + e.minutes);
  return [...map.entries()]
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 小时数的人话写法：不足 1 小时给分钟，否则保留一位小数 */
export function humanHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  return `${Math.round((minutes / 60) * 10) / 10} 小时`;
}
