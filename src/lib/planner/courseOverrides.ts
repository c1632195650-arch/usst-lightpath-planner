/**
 * 调课 / 停课覆盖层（R3）
 * ============================================================
 * 老师临时说「这周停一次」「换到周五 5-6 节」—— 用户要能改，且**原始课表不许被污染**。
 *
 * ── 为什么只做「视图覆盖」──────────────────────────────────
 * 导入的 `Schedule` 是**事实来源**（教务导出还可能重新导入）。
 * 直接在它上面改，一是**没法撤销**（改完就不知道原来是什么），
 * 二是**没法只影响一周**（「这周停课」会被写成「永远停课」）。
 * 所以这里产出的是一份**派生副本**：`applyCourseOverrides(schedule, overrides, weekNo)`
 * 返回一个新的 `Schedule`，原对象一个字符都不动（有单测盯着）。
 *
 * ── 长期 vs 一次性（读法 A）──────────────────────────────────
 * 长期覆盖（`weekNo === null`）**只影响创建之后的周次** ——
 * 判定统一走 `longTermRules.ts`，与 S1 的长期锁、R4 的不可时段同一个出处。
 * 同一课程同一节次有多条长期覆盖时，取 `createdAtWeek` 最大的那条。
 *
 * 纯函数：不读时钟、不随机、不改入参。
 */
import type { Course, CourseTimeSlot, DayOfWeek, Schedule } from '@/types';
import { periodEndMin, periodStartMin } from '@/constants/time';
import { effectiveRuleAt, longRuleApplies } from './longTermRules.ts';

/** 一条覆盖范围之外的最小描述（`userPlanStore.CourseOverride` 的超集） */
export interface OverrideLike {
  id: string;
  courseId: string;
  startPeriod: number;
  /** `number` = 只这一周；`null` = 长期 */
  weekNo: number | null;
  action: 'cancel' | 'move';
  newDay?: number;
  newStartMin?: number;
  newEndMin?: number;
  createdAtWeek?: number;
}

export interface AppliedOverride {
  id: string;
  courseName: string;
  action: 'cancel' | 'move';
  periodLabel: string;
  scope: 'once' | 'long';
}

/** 分钟 → 最接近的节次（调课给的是具体时间，而排程内部按「节」计算时间） */
export function periodOfMin(min: number): number {
  let best = 1;
  let bestDiff = Infinity;
  // 13 节课是本项目已知的节次上限（`constants/time` 的 `MAX_PERIOD`）
  for (let p = 1; p <= 13; p++) {
    const d = Math.abs(periodStartMin(p) - min);
    if (d < bestDiff) { bestDiff = d; best = p; }
  }
  return best;
}

/** 结束分钟 → 最接近的节次（按结束时刻对齐） */
export function endPeriodOfMin(min: number): number {
  let best = 1;
  let bestDiff = Infinity;
  for (let p = 1; p <= 13; p++) {
    const d = Math.abs(periodEndMin(p) - min);
    if (d < bestDiff) { bestDiff = d; best = p; }
  }
  return best;
}

const sameSlot = (slot: CourseTimeSlot, courseId: string, startPeriod: number) =>
  slot.startPeriod === startPeriod;

/**
 * 挑出**这一周生效**的覆盖。
 *
 * 同一个「课程 + 节次」只允许一条生效 —— 多条长期时按 `createdAtWeek` 取最新（读法 A）。
 */
export function activeOverrides(
  overrides: readonly OverrideLike[],
  weekNo: number,
): { list: OverrideLike[]; ignoredCount: number } {
  const once = overrides.filter((o) => o.weekNo === weekNo);
  const long = overrides.filter((o) => o.weekNo === null && longRuleApplies(o, weekNo));

  const picked: OverrideLike[] = [];
  const keys = new Set<string>();
  for (const o of [...once, ...long]) keys.add(`${o.courseId}|${o.startPeriod}`);

  let ignoredCount = 0;
  for (const k of keys) {
    const [courseId, sp] = k.split('|');
    const candidates = [...once, ...long].filter((o) => o.courseId === courseId
      && o.startPeriod === Number(sp));
    // 一次性的当周优先（它是对这一周最明确的表达），否则按读法 A 取最新创建的长期规则
    const onceHit = candidates.find((o) => o.weekNo !== null);
    const best = onceHit ?? effectiveRuleAt(candidates, weekNo);
    if (!best) continue;
    picked.push(best);
    ignoredCount += candidates.length - 1;
  }
  return { list: picked, ignoredCount };
}

/**
 * 把覆盖应用到某周的课表上，产出**派生副本**。
 *
 * @returns `schedule` 的新版本 + 实际应用了什么（给用户看的回执）
 */
export function applyCourseOverrides(
  schedule: Schedule,
  overrides: readonly OverrideLike[],
  weekNo: number,
): { schedule: Schedule; applied: AppliedOverride[] } {
  const { list } = activeOverrides(overrides, weekNo);
  if (list.length === 0) return { schedule, applied: [] };

  const total = schedule.totalWeeks ?? 20;
  /** 「除了这一周以外的全部周次」—— 用于把某个 slot 从本周挪走而不影响其它周 */
  const weeksWithout = (except: number | null): number[] => {
    if (except == null) return [];
    return Array.from({ length: total }, (_, i) => i + 1).filter((w) => w !== except);
  };

  const applied: AppliedOverride[] = [];

  const courses: Course[] = schedule.courses.map((c) => {
    const mine = list.filter((o) => o.courseId === c.id);
    if (mine.length === 0) return c;

    let slots: CourseTimeSlot[] = [...c.slots];
    for (const ov of mine) {
      const target = slots.find((s) => sameSlot(s, c.id, ov.startPeriod));
      if (!target) continue;
      const others = slots.filter((s) => s !== target);

      if (ov.action === 'cancel') {
        // 本周这一节不再出现：长期则整节删掉（派生副本里），一次性则只排除这一周
        slots = ov.weekNo === null
          ? others
          : [...others, { ...target, weeks: weeksWithout(ov.weekNo) }];
        applied.push({
          id: ov.id, courseName: c.name, action: 'cancel',
          periodLabel: labelOf(target), scope: ov.weekNo === null ? 'long' : 'once',
        });
        continue;
      }

      // 调课：从原位挪开（同逻辑），再在原位之外加一条新节次
      const moved: CourseTimeSlot = {
        dayOfWeek: (ov.newDay ?? target.dayOfWeek) as DayOfWeek,
        startPeriod: ov.newStartMin != null ? periodOfMin(ov.newStartMin) : target.startPeriod,
        endPeriod: ov.newEndMin != null ? endPeriodOfMin(ov.newEndMin) : target.endPeriod,
        weeks: ov.weekNo === null
          ? Array.from({ length: total }, (_, i) => i + 1)
          : [ov.weekNo],
      };
      slots = ov.weekNo === null
        ? [...others, moved]
        : [...others, { ...target, weeks: weeksWithout(ov.weekNo) }, moved];
      applied.push({
        id: ov.id, courseName: c.name, action: 'move',
        periodLabel: `${labelOf(target)} → ${periodLabelOf(moved)}`,
        scope: ov.weekNo === null ? 'long' : 'once',
      });
    }
    return { ...c, slots };
  });

  return { schedule: { ...schedule, courses }, applied };
}

function periodLabelOf(s: CourseTimeSlot): string {
  return s.startPeriod === s.endPeriod ? `第${s.startPeriod}节` : `${s.startPeriod}-${s.endPeriod}节`;
}
function labelOf(s: CourseTimeSlot): string {
  return `周${s.dayOfWeek} ${periodLabelOf(s)}`;
}

/**
 * 「长期」判定的预估：给 UI 用 —— 这条覆盖会影响哪些周？
 * 纯展示用途，判断是否生效一律以上面的 `activeOverrides` 为准。
 */
export function overrideScopeText(ov: OverrideLike, totalWeeks: number): string {
  if (ov.weekNo !== null) return `第 ${ov.weekNo} 周`;
  const from = ov.createdAtWeek ?? 1;
  return from <= 1 ? `第 1–${totalWeeks} 周（长期）` : `第 ${from}–${totalWeeks} 周起（长期）`;
}
