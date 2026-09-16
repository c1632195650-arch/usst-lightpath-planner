/**
 * 排程引擎 v2 · 构造阶段（Construct，T1.1）
 * ============================================================
 * 依据：`排程引擎-v2-技术规格书.md` §5.1 步骤 2–3、§9-T1.1、§6.4（语义键 id）、§7.2。
 *
 * 职责：**把「这一周」排成一条可行的初始时间轴**（`initialPlan`，必然可行）。
 *
 * 与旧引擎的关系（这是 AC-2 的立身之本）：
 *   本文件 = `schedule.ts::buildWeekPlan`（旧 7 步）的**原样搬迁**。
 *   · 块**内容**（时间 / 类型 / 标题 / 地点）与旧引擎**逐块一致** → AC-2；
 *   · 只有 **id 规则**升级为语义键（§6.4），id 不参与 AC-2 比对；
 *   · 理由 / 说明 / 问题一律走 `explain.ts`（T1.5），此处不再内联文案。
 *
 * ⚠️ 为什么 id 必须去时间：`churn` 与 `lockLevels` 都靠 id 匹配「同一个块」。
 *    若 id 含 `startMin`，块平移后 id 就变 → 被算成「删一个 + 新增一个」，
 *    churn 虚高、**三级锁彻底失效**（见 §6.4）。
 *
 * 设计纪律：纯函数 —— 不读时钟、不 fetch、不用随机；转场时间由调用方注入。
 */
import type {
  DayOfWeek, PhasePolicy, PlanIssue, Schedule, ScenarioFields, TimeBlock, WeekPlan,
} from '@/types';
import { periodEndMin, periodStartMin, toMinutes } from '../../constants/time.ts';
import {
  DEFAULT_TEMPLATES, MEAL_SLOTS, customTemplate, openAt,
  type ActivityCategory, type ActivityTemplate, type UserTask,
} from './templates.ts';
import { campusOfPlace, resolvePlace } from './places.ts';
import { campusFallbackTransfer, campusOfName, type TransferProvider } from './campusLookup.ts';
import { blockId, type Commit, type PlanRequest } from './model.ts';
import { effectiveEffortMin, sortCommits } from './objective.ts';
import {
  buildWeekNotes, issueCourseConflict, issueCourseNoPlace, issueMealSkipped,
  issueTransferLate, issueTransferMissingPlace, issueTransferTight,
  reasonForCommit, reasonForCommitDeps, reasonForCommitPart, reasonForMeal,
  reasonForStudy, reasonForTemplate, reasonForUserTask, summaryStudyIssue,
} from './explain.ts';

/* ============================================================
 * 一、常量（与旧引擎逐字一致）
 * ========================================================== */

const DAY_ORDER: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];
const DAY_NAME: Record<number, string> = {
  1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日',
};

/** 小于这个长度的空档不再往里塞东西（走路/收尾都不够） */
const MIN_GAP = 15;
/** 学习块最短时长 */
const MIN_CHUNK = 20;
/** 转场余量低于这个值算「偏紧」 */
const TIGHT_SLACK = 5;
/** 晚间起点（policy.eveningAllowed = false 时不再从此后开始新块） */
const EVENING_FROM = toMinutes('18:00');
/** 一天里活动模块的总时长上限（别把一天切成一堆碎片） */
const ACTIVITY_CAP_MIN = 120;
/** 走到食堂后排队/洗手的缓冲 —— 否则每顿饭后紧跟的转场都是「0 余量偏紧」 */
const MEAL_BUFFER_MIN = 5;
/** 引擎自己排的软块，从上个块走过来之后再多留 5 分钟 —— 不把自己逼到「0 余量」 */
const SOFT_BUFFER_MIN = 5;
/** 每类活动模块每天最多几个（运动 1 个、生活类 1 个…） */
const CATEGORY_PER_DAY: Record<string, number> = {
  sport: 1, rest: 1, life: 1, custom: 3, meal: 0, study: 0,
};

const COURSE_EMOJI: Record<string, string> = {
  专业核心: '📕', 专业选修: '📗', 公共基础: '📘', 通识选修: '📙', 实践环节: '🔬', 其他: '📄',
};

/** 引擎自己排的块（软块）—— 晚一点无所谓，不因此报警 */
const SOFT_KINDS = new Set(['study', 'activity', 'blank']);

/* ============================================================
 * 二、有效课程（周次过滤，第一公民）
 * ========================================================== */

export interface EffectiveSlot {
  course: import('@/types').Course;
  slot: import('@/types').CourseTimeSlot;
  dayOfWeek: DayOfWeek;
  startMin: number;
  endMin: number;
  /** 「3-5 节」这样的表述，与教务课表一致 */
  periodLabel: string;
}

/** 某节次在给定周次是否开课（空数组 = 全学期，与 types.ts 约定一致） */
export function activeInWeek(slot: import('@/types').CourseTimeSlot, weekNo: number): boolean {
  return slot.weeks.length === 0 || slot.weeks.includes(weekNo);
}

/**
 * 某一周真正要上的课。
 * 这是整个排程的第一公民 —— 课表里 3-18 周、7-15 周、10-18 周混在一起，
 * 每周的有效课表都不一样（第 9 周时党史已结束、模电实验还没开始）。
 */
export function effectiveCourses(schedule: Schedule, weekNo: number): import('@/types').Course[] {
  return schedule.courses.filter((c) => c.slots.some((s) => activeInWeek(s, weekNo)));
}

/** 某一周的有效节次（展开到天） */
export function effectiveSlots(schedule: Schedule, weekNo: number): EffectiveSlot[] {
  const out: EffectiveSlot[] = [];
  for (const course of schedule.courses) {
    for (const slot of course.slots) {
      if (!activeInWeek(slot, weekNo)) continue;
      out.push({
        course,
        slot,
        dayOfWeek: slot.dayOfWeek,
        startMin: periodStartMin(slot.startPeriod),
        endMin: periodEndMin(slot.endPeriod),
        periodLabel: slot.startPeriod === slot.endPeriod
          ? `第${slot.startPeriod}节`
          : `${slot.startPeriod}-${slot.endPeriod}节`,
      });
    }
  }
  return out;
}

/** 某天的有效节次，按开始时间升序 */
export function slotsOn(schedule: Schedule, weekNo: number, dayOfWeek: DayOfWeek): EffectiveSlot[] {
  return effectiveSlots(schedule, weekNo)
    .filter((s) => s.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startMin - b.startMin);
}

/* ============================================================
 * 三、时间轴工具
 * ========================================================== */

interface Span { startMin: number; endMin: number }

function overlaps(a: Span, b: Span): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** 在 [from, to] 内，挖掉 occupied 之后剩下的空档 */
function freeGaps(from: number, to: number, occupied: Span[]): Span[] {
  const sorted = [...occupied].sort((a, b) => a.startMin - b.startMin);
  const gaps: Span[] = [];
  let cursor = from;
  for (const o of sorted) {
    if (o.endMin <= from) continue;
    if (o.startMin >= to) break;
    if (o.startMin > cursor) gaps.push({ startMin: cursor, endMin: Math.min(o.startMin, to) });
    cursor = Math.max(cursor, o.endMin);
  }
  if (cursor < to) gaps.push({ startMin: cursor, endMin: to });
  return gaps.filter((g) => g.endMin - g.startMin >= MIN_GAP);
}

/** 从时长档位里挑「不超过可用长度」的最大一档 —— 这就是「填充式」 */
function pickDuration(durations: number[], availableMin: number): number | null {
  const usable = [...durations].sort((a, b) => a - b).filter((d) => d <= availableMin);
  return usable.length ? usable[usable.length - 1] : null;
}

/**
 * 把数组从 offset 处轮转（确定性：同一 offset 必得同一顺序，**不引入随机数**）。
 *
 * 用途：自习点轮换。不轮转时「喜欢图书馆」会被理解成「每次都去同一个图书馆」，
 * 引擎按固定顺序取候选 → 整周每个自习块都落在同一个点。真实的人不会这样。
 */
function rotateFrom<T>(arr: T[], offset: number): T[] {
  if (arr.length <= 1) return arr;
  const k = ((offset % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

function sortBlocks(blocks: TimeBlock[]): TimeBlock[] {
  return [...blocks].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin);
}

/** 在 t 之前（结束时间 ≤ t）的最后一个块 */
function lastBlockBefore(blocks: TimeBlock[], t: number): TimeBlock | undefined {
  return [...blocks].filter((b) => b.endMin <= t).sort((a, b) => b.endMin - a.endMin)[0];
}

/** 在 t 之前（结束时间 ≤ t）的最后一个非用餐块 —— 「我从哪儿来」 */
function lastNonMealBefore(blocks: TimeBlock[], t: number): TimeBlock | undefined {
  return [...blocks]
    .filter((b) => b.endMin <= t && b.kind !== 'meal')
    .sort((a, b) => b.endMin - a.endMin)[0];
}

/** 在 t 之后（开始时间 ≥ t）的最近一个块 —— 「接下来要去哪儿」 */
function nextBlockOnOrAfter(blocks: TimeBlock[], t: number): TimeBlock | undefined {
  return [...blocks].filter((b) => b.startMin >= t).sort((a, b) => a.startMin - b.startMin)[0];
}

/**
 * 从 from 走到 to 要几分钟；不知道就是 0（不猜）。
 * ⚠️ 向上取整：实测值常是 4.6 这种小数，用它当偏移会排出 07:34.5999 这种鬼时间。
 *    宁可多留 1 分钟，也不要出现「走了 4.6 分钟」的排程。
 */
function travelNeed(transfer: TransferProvider, from?: string, to?: string): number {
  if (!from || !to || from === to) return 0;
  const info = transfer(from, to);
  return info ? Math.ceil(Math.max(0, info.minutes)) : 0;
}

/** 当天课程主要发生在哪个校区 → 决定去哪边的食堂 */
function dominantCampus(slots: EffectiveSlot[]): string {
  const tally = new Map<string, number>();
  for (const s of slots) {
    const c = s.course.campus ?? 'JG516';
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  let best = 'JG516';
  let bestN = 0;
  for (const [c, n] of tally) if (n > bestN) { best = c; bestN = n; }
  return best;
}

function campusLabel(id: string | null): string {
  if (id === 'JG334') return '南校';
  if (id === 'JG1100') return '1100';
  if (id === 'FUXING') return '复兴路';
  if (id === 'YINGKOU') return '营口路';
  if (id === 'JG516') return '北校';
  return 'unknown'; // 校区未知（不再默认「北校」）
}

/* ============================================================
 * 四、构造入口
 * ========================================================== */

/** 构造阶段的注入项（引擎内部管道；对外只走 `PlanRequest`） */
export interface ConstructCtx {
  /** 活动模块库；缺省 `DEFAULT_TEMPLATES` */
  templates?: ActivityTemplate[];
  /** 旧版用户自定义模块；缺省 = `req.tasks` */
  tasks?: UserTask[];
}

export interface ConstructResult {
  plan: WeekPlan;
  notes: string[];
}

/**
 * 构造一份初始周计划（**必然可行**：不重叠、不迟到）。
 *
 * @param req `PlanRequest`（weekNo / policy / schedule / commits / transfer …）
 * @param ctx 引擎内部注入项（模块库、旧版 tasks）
 */
export function construct(req: PlanRequest, ctx: ConstructCtx = {}): ConstructResult {
  const { schedule, weekNo, policy } = req;
  const templates = ctx.templates ?? DEFAULT_TEMPLATES;
  const tasks = ctx.tasks ?? req.tasks ?? [];
  const scenarios: ScenarioFields | null = req.scenarios ?? null;
  const transfer: TransferProvider = req.transfer ?? campusFallbackTransfer;
  const dayStartMin = toMinutes(req.dayStart ?? '07:00');
  const dayEndMin = toMinutes(req.dayEnd ?? '23:00');
  const withMeals = req.withMeals !== false;
  const commits = req.commits ?? [];

  /** 语义键 id 生成器（规格书 §6.4） */
  const mkId = (day: number, kind: string, key: string): string =>
    blockId(weekNo, day as DayOfWeek, kind, key);

  const notes: string[] = [];
  const issues: PlanIssue[] = [];
  const allBlocks: TimeBlock[] = [];

  const effCourses = effectiveCourses(schedule, weekNo);

  // 用户自定义模块：指定了「星期 + 开始时间」的属固定块，其余交给引擎找空档
  const fixedTasks = tasks.filter((t) => t.dayOfWeek != null && t.startMin != null);
  const floatingTasks = tasks.filter((t) => !(t.dayOfWeek != null && t.startMin != null));
  const taskActive = (t: UserTask) => !t.weeks?.length || t.weeks.includes(weekNo);

  // 提交项（规格书 §5.1 步骤 3 / §9-T0.2）：固定落点的当硬块，其余走 EDF × urgency 择序
  const commitActive = (c: Commit) => !c.weeks?.length || c.weeks.includes(weekNo);
  const activeCommits = commits.filter(commitActive);
  const fixedCommits = activeCommits.filter((c) => c.pinned);
  const floatingCommits = activeCommits.filter((c) => !c.pinned);

  let totalFree = 0;
  let studyMin = 0;
  let courseMin = 0;
  let blankMin = 0;
  /** 排到了「数据未核实」的食堂几次（南校食堂营业时段为推算值）→ 汇总成一条 note */
  let unverifiedMeals = 0;
  /** 提交项的落点（id → 结束时间），用于 `deps` 的先后约束（AC-9） */
  const commitEnd = new Map<string, number>();
  let commitMin = 0;

  for (const day of DAY_ORDER) {
    const dayName = DAY_NAME[day];
    const daySlots = slotsOn(schedule, weekNo, day);
    const dayCampus = dominantCampus(daySlots);

    /* --- 6.1 课程块 --- */
    const courseBlocks: TimeBlock[] = daySlots.map((s) => {
      courseMin += s.endMin - s.startMin;
      return {
        // §6.4 语义键：{courseId}p{startPeriod}（同一门课的同一节次恒等）
        id: mkId(day, 'course', `${s.course.id}p${s.slot.startPeriod}`),
        kind: 'course' as const,
        dayOfWeek: day,
        startMin: s.startMin,
        endMin: s.endMin,
        title: s.course.name,
        courseId: s.course.id,
        place: s.course.building,
        room: s.course.room,
        teacher: s.course.teacher,
        emoji: COURSE_EMOJI[s.course.category] ?? '📄',
        source: 'course' as const,
      };
    });

    for (let i = 0; i < courseBlocks.length; i++) {
      for (let j = i + 1; j < courseBlocks.length; j++) {
        if (overlaps(courseBlocks[i], courseBlocks[j])) {
          issues.push(issueCourseConflict(dayName, courseBlocks[i], courseBlocks[j]));
        }
      }
    }
    for (const s of daySlots.filter((x) => !x.course.building)) {
      issues.push(issueCourseNoPlace(dayName, s.course.name));
    }

    /* --- 6.2 用户固定块 --- */
    const userBlocks: TimeBlock[] = fixedTasks
      .filter((t) => t.dayOfWeek === day && taskActive(t))
      .map((t) => ({
        id: mkId(day, 'user', t.id),
        kind: t.kind ?? 'activity',
        dayOfWeek: day,
        startMin: t.startMin as number,
        endMin: (t.startMin as number) + (t.durationMin ?? 60),
        title: t.title,
        place: t.place,
        emoji: t.emoji ?? '📌',
        reason: reasonForUserTask(),
        locked: true,
        source: 'user' as const,
      }));

    /* --- 6.2b 提交项（用户钉死的落点）--- */
    const commitFixedBlocks: TimeBlock[] = fixedCommits
      .filter((c) => c.pinned?.dayOfWeek === day)
      .map((c) => {
        const start = c.pinned?.startMin as number;
        const dur = Math.max(MIN_CHUNK, c.effortMin);
        commitEnd.set(c.id, start + dur);
        commitMin += dur;
        return {
          id: mkId(day, c.kind ?? 'activity', c.id),
          kind: c.kind ?? 'activity',
          dayOfWeek: day,
          startMin: start,
          endMin: start + dur,
          title: c.title,
          place: commitPlaceName(c),
          emoji: c.emoji ?? '📌',
          reason: reasonForUserTask(),
          locked: true,
          source: 'user' as const,
        } satisfies TimeBlock;
      });

    // 逐块累积：引擎每放一个块，都要考虑「从上个块走过来要多久」
    let placed: TimeBlock[] = [...courseBlocks, ...userBlocks, ...commitFixedBlocks];

    /* --- 6.3 三餐（按地点就近 + 营业时段 + 走路时间） --- */
    if (withMeals) {
      const firstStart = daySlots.length ? daySlots[0].startMin : null;
      for (const meal of MEAL_SLOTS) {
        // 早餐只在上午有早课的日子排（没早课就不必硬叫早）
        if (meal.id === 'breakfast' && !(firstStart != null && firstStart <= toMinutes('10:00'))) continue;
        const res = placeMeal({
          day, meal, placed, dayStartMin, dayEndMin, templates, scenarios, transfer, dayCampus, mkId,
        });
        if (res.block) {
          placed = [...placed, res.block];
          if (res.unverified) unverifiedMeals++;
        } else if (res.skippedReason) {
          issues.push(issueMealSkipped(dayName, res.skippedReason));
        }
      }
    }

    /* --- 6.4 空档与预算 --- */
    const freeTotal = freeGaps(dayStartMin, dayEndMin, placed)
      .reduce((n, g) => n + (g.endMin - g.startMin), 0);
    totalFree += freeTotal;
    // 留白是「下限」：至少留下 blankRatio 的空档不被占用
    const usable = Math.max(0, freeTotal - Math.round(freeTotal * policy.blankRatio));
    // 事件准备块（有截止日期）是硬需求：单独留出预算，不与日常活动抢额度。
    // 「光电杯明天截止」比「今天少自习一小时」严重得多 —— 少了这一项，
    // 日程一满，备考/交材料的块会被日常活动预算静默挤掉，用户完全看不出来。
    const essentialMin = floatingTasks
      .filter((t) => t.essential && taskActive(t) && (t.dayOfWeek == null || t.dayOfWeek === day))
      .reduce((n, t) => n + (t.durationMin ?? 60), 0);
    const activityBudget = Math.min(ACTIVITY_CAP_MIN, Math.round(usable * 0.4)) + essentialMin;

    /* --- 6.4b 提交项填充（EDF × urgency 择序，贪心填空档）--- */
    const commitBlocks = placeCommits({
      day, dayName, commits: floatingCommits, placed, policy, transfer,
      dayStartMin, dayEndMin, mkId, commitEnd,
    });
    if (commitBlocks.length) {
      placed = [...placed, ...commitBlocks];
      for (const b of commitBlocks) commitMin += b.endMin - b.startMin;
    }

    /* --- 6.5 活动模块（运动/午休/取快递/夜宵/自定义…） --- */
    const candidates = buildCandidates(templates, scenarios, floatingTasks, taskActive, day);
    const perCat: Record<string, number> = {};
    let activityMin = 0;
    for (const tpl of candidates) {
      const cat = tpl.category as ActivityCategory;
      const cap = CATEGORY_PER_DAY[cat] ?? 1;
      if ((perCat[cat] ?? 0) >= cap) continue;
      if (activityMin + Math.min(...tpl.durations) > activityBudget) continue;
      const block = placeTemplate({
        tpl, day, placed, dayCampus, mkId, policy, transfer, dayStartMin, dayEndMin,
      });
      if (block) {
        placed = [...placed, block];
        perCat[cat] = (perCat[cat] ?? 0) + 1;
        activityMin += block.endMin - block.startMin;
      }
    }

    /* --- 6.6 学习块（按阶段策略填充） --- */
    const studyBudget = Math.min(policy.dailyStudyMin, Math.max(0, usable - activityMin));
    const studyBlocks = fillStudy({
      day, placed, budget: studyBudget, policy, templates, dayCampus, mkId, transfer,
      dayStartMin, dayEndMin,
    });
    placed = [...placed, ...studyBlocks];
    for (const b of studyBlocks) studyMin += b.endMin - b.startMin;

    /* --- 6.7 转场 + 组装 --- */
    const dayBlocks = sortBlocks(placed);
    attachTransfers(dayBlocks, transfer, dayName, issues);

    // ⚠️ 提交项也算「已占用」——否则留白会被高估（只有带 commits 时才有区别）
    const filled = activityMin
      + studyBlocks.reduce((n, b) => n + (b.endMin - b.startMin), 0)
      + commitBlocks.reduce((n, b) => n + (b.endMin - b.startMin), 0);
    blankMin += Math.max(0, freeTotal - filled);
    allBlocks.push(...dayBlocks);
  }

  /* --- 6.8 汇总 --- */
  const shortfall = summaryStudyIssue(studyMin, policy, weekNo);
  if (shortfall) issues.push(shortfall);

  notes.push(...buildWeekNotes({
    weekNo,
    policy,
    effectiveCourseCount: effCourses.length,
    scenarios,
    unverifiedMeals,
  }));

  return {
    plan: {
      weekNo,
      blocks: sortBlocks(allBlocks),
      stats: {
        courseMin,
        studyMin,
        // 说明：stats 里不含 commitMin 字段（那要改契约层 types.ts 的 WeekPlan.stats）
        //       → 提交项时长并入 blankMin 的扣减已在上面处理，这里只回填既有四个字段
        blankMin,
        blockCount: allBlocks.length,
      },
      issues,
    },
    notes,
  };
}

/** 提交项的地点名（`placeId` 是 `Place.id`，但 `TimeBlock.place` 要 POI 名） */
function commitPlaceName(c: Commit): string | undefined {
  if (!c.placeId) return undefined;
  return resolvePlace(c.placeId)?.name ?? c.placeId;
}

/* ============================================================
 * 五、三餐
 * ========================================================== */

interface MealPick {
  block: TimeBlock | null;
  skippedReason?: string;
  /** 选中的食堂数据是否**未核实**（如南校食堂营业时段是推算值）→ 供 notes 如实标注 */
  unverified?: boolean;
}

/**
 * 排一顿饭。顺序有讲究：
 *   ① 先找「上一个非用餐块」——它决定你从哪儿来、要走多久；
 *   ② 用它挑食堂（同校区 + 此刻在营业 + 走最近 or 按口味）；
 *   ③ 落点必须 ≥ 上一块结束 + 走过去的时间 —— 否则就是假排程。
 */
function placeMeal(args: {
  day: DayOfWeek;
  meal: (typeof MEAL_SLOTS)[number];
  placed: TimeBlock[];
  dayCampus: string;
  dayStartMin: number;
  dayEndMin: number;
  templates: ActivityTemplate[];
  scenarios: ScenarioFields | null;
  transfer: TransferProvider;
  mkId: (day: number, kind: string, key: string) => string;
}): MealPick {
  const { day, meal, placed, dayCampus, dayStartMin, dayEndMin, templates, scenarios, transfer, mkId } = args;
  const nominal = toMinutes(meal.nominal);
  const dur = meal.durationMin;
  const label = campusLabel(dayCampus);

  const primary = meal.id === 'breakfast' ? -1 : 1; // 早餐推迟无意义（要赶课），午晚优先往后
  const offsets = [0];
  for (let d = 5; d <= 120; d += 5) offsets.push(primary * d);
  for (let d = 5; d <= 120; d += 5) offsets.push(-primary * d);

  const freeAt = (s: number, limit: number) =>
    s >= dayStartMin && s + dur <= Math.min(dayEndMin, limit)
    && !placed.some((b) => overlaps(b, { startMin: s, endMin: s + dur }));
  const search = (earliest: number, limit: number = dayEndMin): number | null => {
    for (const off of offsets) {
      const s = nominal + off;
      if (s < earliest) continue;
      if (freeAt(s, limit)) return s;
    }
    return null;
  };

  // ① 粗定位：先不管走路时间，只为知道「大概几点吃」
  const t0 = search(dayStartMin);
  if (t0 == null) {
    return { block: null, skippedReason: `课排得太满，${meal.label}没找到合适的时间段，记得自己补一顿` };
  }

  // ② 从哪儿来：真正紧邻这一餐、且在它之前结束的块（课程/用户块）
  const anchor = lastNonMealBefore(placed, t0);
  // 接下来要去哪儿：如果**紧接着**要去另一个校区（比如晚课在南校卓越楼），
  // 那就该在那边的食堂吃 —— 否则饭后还要跨区折返，纯属白走。
  // ⚠️ 只看 3 小时以内的下一件事：中午不该因为「晚上 18:00 要去南校」就跑去南校吃午饭。
  const next = nextBlockOnOrAfter(placed, t0);
  const nearNext = next && next.startMin - t0 <= 180;
  const nextCampus = nearNext && next?.place ? campusLabel(campusOfName(next.place)) : null;
  const eatOnNextCampus = !!nextCampus && nextCampus !== label;

  // ③ 选食堂：同校区 + 那一刻真的在营业（openAt 直接看营业时段，不做餐次标签硬匹配）
  const pool = templates
    .filter((t) => t.category === 'meal' && t.place)
    .filter((t) => !t.trigger || !scenarios || t.trigger.in.includes(String(scenarios[t.trigger.field])))
    .filter((t) => openAt(t, t0, t0 + dur))
    .sort((a, b) => b.priority - a.priority);
  const sameCampus = pool.filter((t) => t.campus === label || t.campus === 'any');
  const onNextCampus = eatOnNextCampus ? pool.filter((t) => t.campus === nextCampus) : [];
  const chosenPool = onNextCampus.length ? onNextCampus
    : (sameCampus.length ? sameCampus : pool);
  if (chosenPool.length === 0) return { block: null, skippedReason: `${meal.label}时段附近的食堂都没开` };

  let chosen = chosenPool[0];
  let why = eatOnNextCampus && onNextCampus.length
    ? `接下来要去${nextCampus}的${next?.title ?? '下一件事'}，所以把${meal.label}排在那边的${chosen.name}，省一次跨校区折返`
    : '按常去的食堂排的';
  if (scenarios?.meal_radius === 'near' && anchor?.place) {
    // 就近：按转场时间挑最近的（画像在这里真的改变结果）
    let bestMin = Number.POSITIVE_INFINITY;
    for (const t of chosenPool.slice(0, 4)) {
      const info = transfer(anchor.place, t.place as string);
      if (info && info.minutes < bestMin) { bestMin = info.minutes; chosen = t; }
    }
    if (Number.isFinite(bestMin)) {
      why = `你选的是「就近快吃」，所以按从${anchor.place}走过去的时间挑了最近的`;
    }
  } else if (scenarios?.meal_radius === 'far') {
    why = '你愿意为想吃的走远一点，所以按口味优先（不是最近的）';
  }

  // ④ 精定位：落点不得早于「上一块结束 + 走过去 + 排队缓冲」，
  //    也不得晚到「吃完来不及走到下一件事」—— 两头都要留出走路时间
  const need = travelNeed(transfer, anchor?.place, chosen.place);
  const earliest = anchor ? anchor.endMin + need + MEAL_BUFFER_MIN : dayStartMin;
  const tail = travelNeed(transfer, chosen.place, next?.place);
  const limit = next ? next.startMin - tail - MEAL_BUFFER_MIN : dayEndMin;
  const start = search(earliest, limit) ?? search(earliest) ?? t0;

  return {
    block: {
      // §6.4 语义键：{mealId}（breakfast / lunch / dinner）
      id: mkId(day, 'meal', meal.id),
      kind: 'meal',
      dayOfWeek: day,
      startMin: start,
      endMin: start + dur,
      title: `${meal.label} · ${chosen.name}`,
      place: chosen.place,
      emoji: chosen.emoji,
      reason: reasonForMeal({
        why, note: chosen.note, need, anchorPlace: anchor?.place, tail, nextPlace: next?.place,
      }),
      source: 'template',
    },
    unverified: chosen.verified === false,
  };
}

/* ============================================================
 * 六、活动模块
 * ========================================================== */

function buildCandidates(
  templates: ActivityTemplate[],
  scenarios: ScenarioFields | null,
  floatingTasks: UserTask[],
  taskActive: (t: UserTask) => boolean,
  day: DayOfWeek,
): ActivityTemplate[] {
  const tpls = templates.filter((t) => {
    // 食堂由 placeMeal 专门处理（要按校区与营业时段选），自习由 fillStudy 处理（要按策略分块），
    // 这里只处理运动/午休/取快递/夜宵这类「塞一个进去就完事」的模块
    if (t.category === 'meal' || t.category === 'study') return false;
    if (t.autoPlace === false) return false; // 只进模块库，等用户自己挑（取快递/洗澡等）
    if (t.trigger) {
      if (!scenarios) return false; // 没有画像就不擅自替用户安排（运动等）
      if (!t.trigger.in.includes(String(scenarios[t.trigger.field]))) return false;
    }
    return true;
  });
  // 浮动任务里「指定了星期几」的，只在那一星期几参与。
  // 这是事件准备块能精确落到日期的关键 —— 否则「截止前每天一块」会变成一周里天天出现。
  // （P1 合并时补回：属 PR #3 的能力，抽取 `construct` 时漏了）
  const custom = floatingTasks
    .filter(taskActive)
    .filter((t) => t.dayOfWeek == null || t.dayOfWeek === day)
    .map(customTemplate);
  return [...custom, ...tpls].sort((a, b) => b.priority - a.priority);
}

/**
 * 把模块塞进空档。关键点：**先算走路时间再定起点**。
 * 第一版直接放 gap 起点，结果排出一串首尾相接的块，
 * 转场检查立刻报「0 分钟余量、会迟到 10 分钟」——假排程。
 */
function placeTemplate(args: {
  tpl: ActivityTemplate;
  day: DayOfWeek;
  placed: TimeBlock[];
  dayCampus: string;
  mkId: (day: number, kind: string, key: string) => string;
  policy: PhasePolicy;
  transfer: TransferProvider;
  dayStartMin: number;
  dayEndMin: number;
}): TimeBlock | null {
  const { tpl, day, placed, dayCampus, mkId, policy, transfer, dayStartMin, dayEndMin } = args;

  // 校区不匹配的模块不进这一天的候选（不去南校操场跑完再回北校上课）
  const label = tpl.campus ?? 'any';
  const campusOk = label === 'any' || label === campusLabel(dayCampus) || tpl.category === 'custom';
  if (!campusOk) return null;

  const gaps = [...freeGaps(dayStartMin, dayEndMin, placed)]
    .sort((a, b) => (b.endMin - b.startMin) - (a.endMin - a.startMin));
  for (const gap of gaps) {
    const zones: Span[] = tpl.windows.length
      ? tpl.windows.map((w) => ({ startMin: w.startMin, endMin: w.endMin }))
      : [gap];
    for (const z of zones) {
      // ⚠️ 第三项是 P1 合并时补回的：`notBeforeMin`（见 templates.ts）。
      //    没有它，引擎按「最大空档优先」选位，没课的清晨会成为首选 ——
      //    于是「四六级真题」被排到 07:00（还没起床）。（PR #3 的能力，P1 抽取时漏了）
      const floor = Math.max(gap.startMin, z.startMin, tpl.notBeforeMin ?? 0);
      const ceiling = Math.min(gap.endMin, z.endMin);
      // 两头都要留走路时间：从上个块走过来 + 待会儿还要走到下一个块
      const prev = lastBlockBefore(placed, floor);
      const need = travelNeed(transfer, prev?.place, tpl.place);
      const s = prev ? Math.max(floor, prev.endMin + need + SOFT_BUFFER_MIN) : floor;
      if (!policy.eveningAllowed && s >= EVENING_FROM) continue;
      const tail = travelNeed(transfer, tpl.place, nextBlockOnOrAfter(placed, ceiling)?.place);
      const dur = pickDuration(tpl.durations, ceiling - s - tail - (tail ? SOFT_BUFFER_MIN : 0));
      if (dur == null) continue;
      return {
        // §6.4 语义键：{templateId}
        id: mkId(day, tpl.kind, tpl.id),
        kind: tpl.kind,
        dayOfWeek: day,
        startMin: s,
        endMin: s + dur,
        title: tpl.name,
        place: tpl.place,
        emoji: tpl.emoji,
        reason: reasonForTemplate(tpl),
        // 用户自定义的模块要能一眼分辨出来（后续「确认 → 行为记录」靠这个）
        source: tpl.category === 'custom' ? 'user' : 'template',
        // P1 合并时补回：把溯源字段带到块上。
        // 不带它时 UI 认不出「这块来自校历事件」——`WeekPlanView` 靠 `block.fromEventId`
        // 加紫色徽标，`scripts/scheduler.test.ts` 也靠它断言事件块确实排了出来。
        // （标题里的「光电杯报名材料」是给人看的，不该当数据用）
        fromEventId: tpl.fromEventId,
      };
    }
  }
  return null;
}

/* ============================================================
 * 七、自习块填充
 * ========================================================== */

function studyCandidates(
  policy: PhasePolicy,
  dayCampus: string,
  templates: ActivityTemplate[],
): { preferred: ActivityTemplate[]; fallback: ActivityTemplate[] } {
  const wanted = policy.studyPlaces.map((p, i) => {
    const hit = templates.find((t) => t.place === p && t.category === 'study');
    if (hit) return hit;
    // 策略里的自习点不在模块库 → 现场造一个。
    // 校区走**显式地点表**；查不到就按「不限」处理（不再默认北校，规格书 §9-T0.1）
    const place = campusOfPlace(p);
    return {
      id: `study-policy-${i}`,
      name: `自习 · ${p}`,
      emoji: '📚',
      category: 'study' as const,
      kind: 'study' as const,
      durations: [45, 60, 90],
      place: p,
      campus: (place ? campusLabel(place) : 'any') as ActivityTemplate['campus'],
      windows: [],
      priority: 60,
      verified: true,
    };
  });
  // 补充候选：同校区的其它自习点。**只作兜底，不参与轮换** ——
  // 见 fillStudy 的 rotated()：轮换只在画像给的偏好池内做。
  // 校区来自**显式地点表**（旧实现靠 campusOfName 关键字猜 + 默认北校）——行为等价但不再猜
  const fallback = templates.filter(
    (t) => t.category === 'study'
      && campusOfPlace(t.place ?? '') === dayCampus
      && !wanted.some((w) => w.place === t.place),
  );
  return { preferred: wanted, fallback };
}

function fillStudy(args: {
  day: DayOfWeek;
  placed: TimeBlock[];
  /** 今天可用于自习的总分钟数（已扣掉留白与活动） */
  budget: number;
  policy: PhasePolicy;
  templates: ActivityTemplate[];
  dayCampus: string;
  mkId: (day: number, kind: string, key: string) => string;
  transfer: TransferProvider;
  dayStartMin: number;
  dayEndMin: number;
}): TimeBlock[] {
  const { day, placed: placedIn, budget, policy, templates, dayCampus, mkId, transfer, dayStartMin, dayEndMin } = args;
  let placed = placedIn;

  const isWeekend = day === 6 || day === 7;
  if (isWeekend && !policy.weekendWork) return []; // 这个阶段不占周末
  if (budget < MIN_CHUNK) return [];

  const { preferred, fallback } = studyCandidates(policy, dayCampus, templates);
  const blocks: TimeBlock[] = [];
  let remaining = budget;

  /**
   * 轮换**只在画像偏好池内**做 —— 兜底点（同校区其它自习点）接在**队尾**，
   * 不参与轮换，所以「说喜欢图书馆」的人不会因为轮换被轮到宿舍去。
   *
   * 偏移随「星期几 + 今天第几块」平移，是确定性的（不用随机数，测试可复现）。
   * 不轮换时 `studyPlaces` 的顺序固定 → 整周每个自习块都落在池首那一个点。
   */
  const rotated = () => [...rotateFrom(preferred, day + blocks.length), ...fallback];

  // 每次都重新算空档：放完一块后布局变了，下一块的走路时间也要跟着重算
  while (remaining >= MIN_CHUNK) {
    const gaps = [...freeGaps(dayStartMin, dayEndMin, placed)]
      .sort((a, b) => (b.endMin - b.startMin) - (a.endMin - a.startMin));
    let best: { start: number; dur: number; tpl: ActivityTemplate } | null = null;
    const cands = rotated();

    for (const gap of gaps) {
      const prev = lastBlockBefore(placed, gap.startMin);
      // 优先挑「此刻开着门」的自习点（图书馆 8:00-23:00，老馆 6:00-23:00…）
      const tpl = cands.find((t) => openAt(t, gap.startMin, gap.startMin + MIN_CHUNK))
        ?? cands.find((t) => openAt(t, gap.endMin - MIN_CHUNK, gap.endMin))
        ?? cands[0];
      if (!tpl) continue;
      const need = travelNeed(transfer, prev?.place, tpl.place);
      const s = prev ? Math.max(gap.startMin, prev.endMin + need + SOFT_BUFFER_MIN) : gap.startMin;
      if (!policy.eveningAllowed && s >= EVENING_FROM) continue;
      // 空档末尾还要留出「走到下一件事」的时间 + 一点缓冲，
      // 否则会吃掉下一块（尤其下一顿）的走路时间，排出「余 2 分·紧」这种没必要的紧张
      const nextAfter = nextBlockOnOrAfter(placed, gap.endMin);
      const tail = nextAfter
        ? travelNeed(transfer, tpl.place, nextAfter.place) + SOFT_BUFFER_MIN
        : 0;
      const room = Math.min(policy.maxBlockMin, gap.endMin - tail - s, remaining);
      const dur = Math.floor(room / 5) * 5;
      if (dur < MIN_CHUNK) continue;
      best = { start: s, dur, tpl };
      break;
    }
    if (!best) break;

    blocks.push({
      // §6.4 语义键：{templateId}-{第几块}
      id: mkId(day, 'study', `${best.tpl.id}-${blocks.length + 1}`),
      kind: 'study',
      dayOfWeek: day,
      startMin: best.start,
      endMin: best.start + best.dur,
      title: best.tpl.name,
      place: best.tpl.place,
      emoji: best.tpl.emoji,
      reason: reasonForStudy(policy, best.dur),
      source: 'template',
    });
    placed = [...placed, blocks[blocks.length - 1]];
    remaining -= best.dur;
  }
  return blocks;
}

/* ============================================================
 * 八、提交项填充（AC-4 交期 / AC-9 依赖）
 * ========================================================== */

/**
 * 把「浮动提交项」按 **EDF × urgency**（§5.2 `sortCommits`）择序，贪心填空档。
 *
 * 落点规则（都可解释、可复现）：
 *   · 尊重 `window`（如「只在晚上」）；
 *   · 尊重 `deps`：起点不得早于前驱结束（AC-9 前驱结束 ≤ 后驱开始）；
 *   · 两头留走路时间（和自习块同一套口径）；
 *   · `splittable` 的可以拆到多个空档；否则找第一个装得下的空档。
 */
function placeCommits(args: {
  day: DayOfWeek;
  dayName: string;
  commits: Commit[];
  placed: TimeBlock[];
  policy: PhasePolicy;
  transfer: TransferProvider;
  dayStartMin: number;
  dayEndMin: number;
  mkId: (day: number, kind: string, key: string) => string;
  commitEnd: Map<string, number>;
}): TimeBlock[] {
  const {
    day, dayName, commits, placed: placedIn, policy, transfer,
    dayStartMin, dayEndMin, mkId, commitEnd,
  } = args;
  if (commits.length === 0) return [];

  let placed = placedIn;
  const out: TimeBlock[] = [];
  // EDF × urgency 降序（`capacityRemain` 用今天的剩余空档当粗略产能）
  const remain = dayEndMin - dayStartMin;
  const ordered = sortCommits(commits.filter((c) => c.pinned?.dayOfWeek == null || c.pinned.dayOfWeek === day), 0, remain);

  for (const c of ordered) {
    // 依赖：前驱可能排在**别的天**（那天的结束时间更早，天然满足）；同天则要卡住起点
    const depEnd = (c.deps ?? []).reduce((m, id) => Math.max(m, commitEnd.get(id) ?? -1), -1);
    const afterDeps = depEnd >= 0 && depEnd > 0 ? depEnd : null;
    const depNames = (c.deps ?? []).filter((id) => commitEnd.has(id));

    const windowFrom = c.window?.fromMin ?? dayStartMin;
    const windowTo = c.window?.toMin ?? dayEndMin;
    const eff = Math.max(MIN_CHUNK, c.effortMin);
    const minAcc = Math.max(MIN_CHUNK, Math.min(eff, effectiveEffortMin(c)));
    const kind = c.kind ?? 'activity';
    const wantSplit = !!c.splittable;

    let remaining = eff;
    let part = 0;
    while (remaining >= MIN_CHUNK) {
      const gaps = [...freeGaps(dayStartMin, dayEndMin, placed)]
        .sort((a, b) => a.startMin - b.startMin); // 提交项要**尽早**落，故按时间顺序找
      let done = false;
      for (const gap of gaps) {
        const prev = lastBlockBefore(placed, gap.startMin);
        const need = travelNeed(transfer, prev?.place, commitPlaceName(c));
        let s = prev ? Math.max(gap.startMin, prev.endMin + need + SOFT_BUFFER_MIN) : gap.startMin;
        s = Math.max(s, windowFrom);
        if (afterDeps != null) s = Math.max(s, afterDeps);
        if (!policy.eveningAllowed && s >= EVENING_FROM) continue;
        const nextAfter = nextBlockOnOrAfter(placed, gap.endMin);
        const tail = nextAfter
          ? travelNeed(transfer, commitPlaceName(c), nextAfter.place) + SOFT_BUFFER_MIN
          : 0;
        const hardCeil = Math.min(gap.endMin, windowTo);
        const room = Math.min(hardCeil - tail - s, remaining);
        const dur = Math.floor(room / 5) * 5;
        if (dur < MIN_CHUNK) continue;
        // 不可拆的：要么一次装下（≥ 最小可接受），要么继续找
        if (!wantSplit && dur < minAcc && remaining >= minAcc) continue;

        part += 1;
        const block: TimeBlock = {
          // §6.4 语义键：{commitId}（拆分的续块加 -{n}）
          id: mkId(day, kind, part === 1 ? c.id : `${c.id}-${part}`),
          kind,
          dayOfWeek: day,
          startMin: s,
          endMin: s + dur,
          title: c.title,
          place: commitPlaceName(c),
          emoji: c.emoji ?? '📌',
          reason: part === 1
            ? (depNames.length ? reasonForCommitDeps(c.title, depNames) : reasonForCommit(c.title, c.dueAt?.weekNo ?? null, 0))
            : reasonForCommitPart(c.title),
          source: 'template',
        };
        placed = [...placed, block];
        out.push(block);
        commitEnd.set(c.id, s + dur); // 供后驱约束
        remaining -= dur;
        done = true;
        if (!wantSplit) break;
        if (dur < MIN_CHUNK) break;
      }
      if (!done) break; // 没空档了，剩下的量放弃（不硬塞）
      if (!wantSplit) break;
    }
    void dayName;
  }
  return out;
}

/* ============================================================
 * 九、转场标注
 * ========================================================== */

/**
 * 给相邻的两个块标注转场时间与余量。
 * 这是本项目最独特的一环 —— 通用日程 App 不知道「三教走到国合楼要几分钟」。
 *
 * ⚠️ 只对**硬约束**报警：课程 / 用餐 / 用户锁定的块迟到了才是真问题；
 * 自习与活动块（引擎自己排的软块）晚几分钟无所谓，刷一屏警告只会让人无视警告。
 */
function attachTransfers(
  dayBlocks: TimeBlock[],
  transfer: TransferProvider,
  dayName: string,
  issues: PlanIssue[],
): void {
  const missing: TimeBlock[] = []; // 缺地点、算不出转场的相邻对
  for (let i = 0; i < dayBlocks.length - 1; i++) {
    const prev = dayBlocks[i];
    const next = dayBlocks[i + 1];
    if (prev.place && next.place && prev.place === next.place) continue; // 同一栋楼，不用赶
    if (!prev.place || !next.place) {
      // 缺地点 → **不按 0 分钟糊过去**，否则会排出「刚好来得及」的假排程
      // （旧问题 #17 / 规格书 §8.2）。如实收集，循环后汇总一条 info。
      missing.push(prev.place ? next : prev);
      continue;
    }

    const info = transfer(prev.place, next.place);
    if (!info) continue;

    const gap = next.startMin - prev.endMin;
    const slackMin = Math.round(gap - info.minutes);
    next.transfer = {
      fromPlace: prev.place,
      toPlace: next.place,
      minutes: Math.round(info.minutes * 10) / 10,
      slackMin,
      tight: slackMin < TIGHT_SLACK,
      note: info.reliable === false ? '估算值（跨校区），精确时间可让梨宝算一下' : undefined,
    };

    if (SOFT_KINDS.has(next.kind) && !next.locked) continue; // 软块不报警

    if (slackMin < 0) {
      issues.push(issueTransferLate(dayName, prev, next, info.minutes, gap, slackMin));
    } else if (slackMin < TIGHT_SLACK) {
      issues.push(issueTransferTight(dayName, prev, next, info.minutes, slackMin));
    }
  }

  // 缺地点导致的转场盲区：汇总成一条，提醒用户「这段别按刚好来得及算」
  if (missing.length) {
    issues.push(issueTransferMissingPlace(dayName, [...new Set(missing.map((b) => b.title))]));
  }
}
