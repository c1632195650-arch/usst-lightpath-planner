/**
 * 不可时段 → 硬约束（R6.2）
 * ============================================================
 * 用户说「周四下午别排自习」—— 那一时段就**不许**出现任何软事。
 *
 * ── 为什么做成 construct 之后的清理，而不是改 construct ──────────
 * `construct` 里四处候选搜索都靠 `freeGaps(start, end, placed)` 枚举空档，
 * 要让它们都认识「用户声明的禁区」就得给若干函数加一个参数 —— 面太大，
 * 而且每加一个 need 就要再传一次。放在构造之后处理，逻辑集中在一点，
 * 更好测，也更符合「用户约束是**对已排出结果的调整**」这个语义
 * （与 S1 的长期锁同一套路数）。
 *
 * ── 长期 / 一次性 ─────────────────────────────────────────────
 * 判定走 `longTermRules`（读法 A）：长期规则只在创建之后的周次生效。
 *
 * ── 课程怎么办 ───────────────────────────────────────────────
 * **课程不动**。用户说的是「别排自习 / 别排活动」，不是「别上课」。
 * 声明的时段与课程重叠时，那段时间本来就被课占着，无需处理。
 *
 * 纯函数：不读时钟、不随机。
 */
import type { TimeBlock, WeekPlan } from '@/types';
import { DAY_NAME } from './construct.ts';
import { longRuleApplies } from './longTermRules.ts';

/** 一条不可时段的最小形状（与 `userPlanStore.UnavailableSlot` 对齐） */
export interface UnavailableSlotLike {
  id: string;
  days: number[];
  fromMin: number;
  toMin: number;
  /** 空 = 长期；否则只看这些周 */
  weeks: number[];
  scope: 'once' | 'long';
  createdAtWeek?: number;
  title?: string;
}

export interface UnavailableApplyResult {
  blocks: TimeBlock[];
  /** 因避让而被挪走的块 id */
  moved: string[];
  /** 让不开的块 id（这一天塞满才会发生） */
  dropped: string[];
  /** 本周真正生效的声明（给 UI 回执用） */
  applied: UnavailableSlotLike[];
}

/** 这条声明在本周生效吗 */
export function slotActiveThisWeek(s: UnavailableSlotLike, weekNo: number): boolean {
  if (s.weeks.length > 0) return s.weeks.includes(weekNo);
  return longRuleApplies({ weekNo: null, createdAtWeek: s.createdAtWeek }, weekNo);
}

const isCourse = (b: TimeBlock) => b.kind === 'course' || b.source === 'course';
const hit = (b: TimeBlock, from: number, to: number) => b.startMin < to && from < b.endMin;

export function applyUnavailableSlots(
  plan: WeekPlan,
  slots: readonly UnavailableSlotLike[],
  weekNo: number,
  bounds: { dayStartMin: number; dayEndMin: number } = { dayStartMin: 7 * 60, dayEndMin: 23 * 60 },
): UnavailableApplyResult {
  const active = slots.filter((s) => slotActiveThisWeek(s, weekNo));
  if (active.length === 0) {
    return { blocks: plan.blocks, moved: [], dropped: [], applied: [] };
  }

  /** 每天有哪些禁区 */
  const bans = new Map<number, Array<{ from: number; to: number }>>();
  for (const s of active) {
    for (const d of s.days) {
      const list = bans.get(d) ?? [];
      list.push({ from: s.fromMin, to: s.toMin });
      bans.set(d, list);
    }
  }

  let blocks = [...plan.blocks];
  const moved: string[] = [];
  const dropped: string[] = [];

  for (const [day, windows] of bans) {
    const dayBlocks = blocks.filter((b) => b.dayOfWeek === day);
    for (const b of [...dayBlocks].sort((x, y) => x.startMin - y.startMin)) {
      if (isCourse(b)) continue;
      if (!windows.some((w) => hit(b, w.from, w.to))) continue;

      const dur = b.endMin - b.startMin;
      const spot = findSpot(blocks, day, windows, dur, bounds);
      if (spot == null) {
        blocks = blocks.filter((x) => x.id !== b.id);
        dropped.push(b.id);
        plan.issues.push({
          level: 'info',
          code: 'lock-conflict',
          blockId: b.id,
          message: `「${b.title}」要让开你声明的时段，但 ${DAY_NAME[day] ?? `周${day}`}这天挤不下了 —— 它已从本周计划里去掉`,
        });
        continue;
      }
      blocks = blocks.map((x) => (x.id === b.id
        ? { ...x, startMin: spot, endMin: spot + dur } : x));
      moved.push(b.id);
    }
  }

  return { blocks, moved, dropped, applied: active };
}

/**
 * 给一块找一个「不在任何禁区里、也不压到别的块」的位置。
 * 优先**原时间之后**的最早空位，找不到再看之前 ——
 * 用户的直觉是「往后挪」而不是被搬到早上。
 */
function findSpot(
  blocks: readonly TimeBlock[],
  day: number,
  windows: ReadonlyArray<{ from: number; to: number }>,
  dur: number,
  bounds: { dayStartMin: number; dayEndMin: number },
): number | null {
  const occupied = blocks
    .filter((b) => b.dayOfWeek === day)
    .map((b) => ({ startMin: b.startMin, endMin: b.endMin }));
  const busy = [...occupied, ...windows.map((w) => ({ startMin: w.from, endMin: w.to }))]
    .sort((a, b) => a.startMin - b.startMin);

  const candidates: number[] = [];
  let cursor = bounds.dayStartMin;
  for (const o of busy) {
    if (o.endMin <= cursor) continue;
    if (o.startMin - cursor >= dur) candidates.push(cursor);
    cursor = Math.max(cursor, o.endMin);
  }
  if (bounds.dayEndMin - cursor >= dur) candidates.push(cursor);

  return candidates.length ? candidates[0] : null;
}
