/**
 * 定点重排（R6.1）
 * ============================================================
 * 用户说「周四下午别排」→ **只动周四下午**，其余六天原样。
 *
 * ── 为什么要它 ───────────────────────────────────────────────
 * 整周重排会让「我明明只改了周四」变成「全周都抖了一遍」——
 * 用户审稿的成本从「看一天」涨到「看七天」，而且没法判断自己的要求到底生效没有。
 *
 * ── 做法 ─────────────────────────────────────────────────────
 * 引擎照样排一整份（它必须看全局才知道周四是紧还是松），
 * 排完再**融合**：受影响的天用新版，其余天保留上一版的块 —— 就地。
 * 这是一种诚实的折中：不假装能局部求解，但给到用户「只有你要改的那块变了」的体感。
 *
 * 纯函数：不读时钟、不随机。
 */
import type { Course, CourseTimeSlot, Schedule, TimeBlock, WeekPlan } from '@/types';
import { longRuleApplies } from './longTermRules.ts';

export interface WeeklyLike { weeks?: number[]; createdAtWeek?: number; scope?: 'once' | 'long' }

/** 一次「用户要求」会影响哪些天（`null` = 全周，交给调用方判断） */
export function affectedDays(
  rule: { days?: number[]; dayOfWeek?: number } & WeeklyLike,
  weekNo: number,
): number[] | null {
  if (rule.weeks?.length && !rule.weeks.includes(weekNo)) return [];
  if (rule.weeks != null && rule.weeks.length === 0) {
    if (!longRuleApplies({ weekNo: null, createdAtWeek: rule.createdAtWeek }, weekNo)) return [];
  }
  if (rule.days?.length) return rule.days;
  if (rule.dayOfWeek != null) return [rule.dayOfWeek];
  return null; // 没指定天 = 全周
}

/** 汇总多条要求的影响范围；任一要求影响全周则结果为 `null` */
export function unionAffectedDays(
  rules: ReadonlyArray<{ days?: number[]; dayOfWeek?: number } & WeeklyLike>,
  weekNo: number,
): number[] | null {
  const set = new Set<number>();
  for (const r of rules) {
    const days = affectedDays(r, weekNo);
    if (days === null) return null;
    for (const d of days) set.add(d);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 融合天集 = 用户改动天 ∪ 本周已应用的调课/停课天（WP4b-B3，2026-09-27）。
 *
 * 为什么必须有调课天：调课走 `courseOverrides` → 派生课表变化 → 引擎重排。
 * 若融合只看 layer 的 slots/moves/tasks，调课那天的改动会被判成「未受影响」
 * 而保留上一版 —— 用户应用了调课，排程里却看不到，切周再切回才出现。
 * `overrideDays` 为空（本周没有调课）时行为与修复前一致。
 *
 * 入参用结构化最小接口（`UserPlanLayer` 天然满足），避免 lib 反向依赖 feature。
 */
export interface LocalizedRuleSource {
  slots: ReadonlyArray<{ days: number[] }>;
  moves: ReadonlyArray<{ weekNo: number | null; dayOfWeek: number }>;
  tasks: ReadonlyArray<{ dayOfWeek?: number | null }>;
}

export function localizedDaysFor(
  layer: LocalizedRuleSource,
  overrideDays: ReadonlyArray<number>,
  weekNo: number,
): number[] | null {
  const rules: Array<{ days?: number[] }> = [];
  for (const s of layer.slots) rules.push({ days: s.days });
  for (const m of layer.moves) if (m.weekNo === weekNo) rules.push({ days: [m.dayOfWeek] });
  for (const t of layer.tasks) if (t.dayOfWeek != null) rules.push({ days: [t.dayOfWeek] });
  if (overrideDays.length > 0) rules.push({ days: [...overrideDays] });
  return unionAffectedDays(rules, weekNo);
}

/**
 * 本周调课/停课实际影响到的星期：原课表 vs 派生课表逐课比对（WP4b-B3 配套）。
 * 「取消/挪走的节」与「新出现的节」所在的天都要进融合天集。纯函数、不落盘。
 */
export function overrideAffectedDays(base: Schedule, derived: Schedule, weekNo: number): number[] {
  const active = (sch: Schedule): Set<string> => {
    const set = new Set<string>();
    for (const c of sch.courses as Course[]) {
      for (const s of c.slots as CourseTimeSlot[]) {
        if (s.weeks && !s.weeks.includes(weekNo)) continue;
        set.add(`${c.id}|${s.dayOfWeek}|${s.startPeriod}|${s.endPeriod}`);
      }
    }
    return set;
  };
  const before = active(base);
  const after = active(derived);
  const days = new Set<number>();
  for (const k of before) if (!after.has(k)) days.add(Number(k.split('|')[1]));
  for (const k of after) if (!before.has(k)) days.add(Number(k.split('|')[1]));
  return [...days].sort((a, b) => a - b);
}

/**
 * 融合两份计划：`days` 这些天用 `next`，其余天用 `prev`。
 *
 * ⚠️ **`prev` 为 `null`（首次排程）时必须整体用 `next`** ——
 *    没有上一版就谈不上「保留其余天」。
 */
export function localizedPlan(
  prev: WeekPlan | null,
  next: WeekPlan,
  days: number[] | null,
): { plan: WeekPlan; changedDays: number[] } {
  if (!prev || days === null || days.length === 0) return { plan: next, changedDays: days ?? [] };

  const want = new Set(days);
  const keep = prev.blocks.filter((b) => !want.has(b.dayOfWeek));
  const fresh = next.blocks.filter((b) => want.has(b.dayOfWeek));
  const blocks = [...keep, ...fresh].sort(
    (a, b) => (a.dayOfWeek - b.dayOfWeek) || (a.startMin - b.startMin),
  );
  return { plan: { ...next, blocks, stats: statsOf(blocks) }, changedDays: days };
}

/** 哪些天的块集合真的变了 —— 用于「答案 audit」（变了才有资格说只动了这些天） */
export function diffDays(prev: WeekPlan | null, next: WeekPlan): number[] {
  if (!prev) return [];
  const key = (b: TimeBlock) => `${b.id}@${b.dayOfWeek}:${b.startMin}-${b.endMin}`;
  const before = new Set(prev.blocks.map(key));
  const after = new Set(next.blocks.map(key));
  const touched = new Set<number>();
  for (const k of [...before, ...after]) {
    const day = Number(/@(\d)/.exec(k)?.[1] ?? 0);
    if (!before.has(k) || !after.has(k)) touched.add(day);
  }
  return [...touched].sort((a, b) => a - b);
}

function statsOf(blocks: readonly TimeBlock[]): WeekPlan['stats'] {
  let courseMin = 0;
  let studyMin = 0;
  for (const b of blocks) {
    const d = b.endMin - b.startMin;
    if (b.kind === 'course') courseMin += d;
    if (b.kind === 'study') studyMin += d;
  }
  const daySpanMin = 16 * 60; // 与 `construct` 的统计口径一致：07:00–23:00
  const days = new Set(blocks.map((b) => b.dayOfWeek)).size;
  const blankMin = Math.max(0, days * daySpanMin - blocks.reduce((n, b) => n + (b.endMin - b.startMin), 0));
  return { courseMin, studyMin, blankMin, blockCount: blocks.length };
}
