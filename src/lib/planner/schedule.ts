/**
 * 周调度器（A1 规则引擎）
 * ============================================================
 * 职责：**把「这一周」排成一条时间轴**。
 *
 *   输入：课表（按周次过滤后的有效课程） + 阶段策略 PhasePolicy + 活动模块库 + 转场时间
 *   输出：WeekPlan（TimeBlock[] + stats + issues）
 *
 * 为什么是规则引擎而不是让 LLM 直接吐时间表：
 *   1. 「15:50 下课 → 走到国合楼 15 分钟 → 16:05 才能开始」这类推理是**算术**，
 *      LLM 高频出错；而算术恰恰是本项目最扎实的部分（真实路网 146 POI，可达率 100%）。
 *   2. 规则可测试。这个项目的标准是测试全绿，LLM 的输出天生做不到。
 *   3. 「决策层不替用户拍板」：规则的每一步都能说出理由（block.reason），
 *      LLM 排出来的时间表用户无从质疑。
 *   LLM 的位置在**意图层**（把「下周三交实验报告」解析成任务），不在这里。
 *
 * 三条关键设计（都是踩过坑总结的）：
 *   · **周次过滤是第一公民**：课从 3-18 周、7-15 周、10-18 周混在一起，
 *     每周的有效课表都不同。排程单位是「第 N 周」，不是「整学期课表」。
 *   · **任何由引擎自己放上去的块，都要给上一块留出走路时间**。
 *     否则会出现「0 分钟余量，你去不了」的假排程（第一版就踩了这个坑）。
 *   · **只对「硬约束」的迟到报警**：课程 / 用餐 / 用户指定的块迟到了才是问题；
 *     自习块晚 5 分钟无所谓，不该刷一屏警告。
 *
 * 设计约束（与 buildPhases / today 一致）：
 *   · 纯函数：不读时钟、不 fetch。转场时间由调用方**注入**（transfer 参数），
 *     应用层注入的是调后端 route() 的实现，测试注入的是桩函数。
 *   · 确定性：同输入必得同输出（块 id 也是确定的），便于 diff 与「确认后锁定」。
 */

import type {
  Course, CourseTimeSlot, DayOfWeek, PhasePolicy, PlanIssue, Schedule,
  ScenarioFields, TimeBlock, TransferHint, WeekPlan,
} from '@/types';
import { CAMPUS_TRANSFER_MIN } from '../../types.ts';
import {
  humanizeMinutes, periodEndMin, periodStartMin, toHHmm, toMinutes,
} from '../../constants/time.ts';
import {
  DEFAULT_TEMPLATES, MEAL_SLOTS, customTemplate, openAt,
  type ActivityCategory, type ActivityTemplate, type UserTask,
} from './templates.ts';

/* ============================================================
 * 一、注入式依赖
 * ========================================================== */

export interface TransferInfo {
  /** 实测/估算步行分钟 */
  minutes: number;
  /** 数据来源，如 'osm' / 'campus-estimate' / 'manual' */
  source?: string;
  /** 是否可信（false 表示估算值，UI 应标注） */
  reliable?: boolean;
}

/** 转场时间提供者。应用层注入「调后端 route()」，测试注入桩函数 */
export type TransferProvider = (from: string, to: string) => TransferInfo | null;

/** POI 名 → 校区（粗粒度，仅用于跨校区兜底估算；精确值走后端 route()） */
const CAMPUS_KEYWORDS: Array<{ kw: string; campus: keyof typeof CAMPUS_TRANSFER_MIN }> = [
  { kw: '1100', campus: 'JG1100' },
  { kw: '申', campus: 'JG1100' },
  { kw: '复兴', campus: 'FUXING' },
  { kw: '营口', campus: 'YINGKOU' },
  { kw: '580', campus: 'JG516' }, // 580 号与本部同属军工路一带，按北校处理
  { kw: '南校区', campus: 'JG334' },
  { kw: '卓越楼', campus: 'JG334' },
  { kw: '国合楼', campus: 'JG334' },
  { kw: '第四教学楼', campus: 'JG334' },
  { kw: '思餐厅', campus: 'JG334' },
  { kw: '第六食堂', campus: 'JG334' },
  { kw: '清真', campus: 'JG334' },
];

/** 按关键字判断一个地点名大概在哪个校区 */
export function campusOfName(name: string): keyof typeof CAMPUS_TRANSFER_MIN {
  for (const { kw, campus } of CAMPUS_KEYWORDS) {
    if (name.includes(kw)) return campus;
  }
  return 'JG516'; // 默认北校（本部主校区）
}

/**
 * 兜底转场：只处理**跨校区**，且明确标 reliable:false。
 * 同校区返回 null —— 「同校区多远」这件事只有真实路网能答，不猜。
 */
export const campusFallbackTransfer: TransferProvider = (from, to) => {
  const a = campusOfName(from);
  const b = campusOfName(to);
  if (a === b) return null;
  const minutes = CAMPUS_TRANSFER_MIN[a]?.[b];
  if (!minutes) return null;
  return { minutes, source: 'campus-estimate', reliable: false };
};

/* ============================================================
 * 二、输入 / 输出
 * ========================================================== */

export interface BuildWeekPlanInput {
  schedule: Schedule;
  /** 目标周次（1-based） */
  weekNo: number;
  /** 该周所属阶段策略 */
  policy: PhasePolicy;
  /** 画像场景字段 —— 决定运动 / 夜宵等模块是否参与 */
  scenarios?: ScenarioFields | null;
  /** 用户自定义模块 */
  tasks?: UserTask[];
  /** 模块库，默认 DEFAULT_TEMPLATES */
  templates?: ActivityTemplate[];
  /** 转场时间来源，默认 campusFallbackTransfer */
  transfer?: TransferProvider;
  /** 一天的可排程区间，默认 07:00–23:00 */
  dayStart?: string;
  dayEnd?: string;
  /** 是否排三餐（默认 true） */
  withMeals?: boolean;
}

export interface BuildWeekPlanResult {
  plan: WeekPlan;
  /** 生成过程说明（面向用户） */
  notes: string[];
}

/* ============================================================
 * 三、常量
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
 * 四、有效课程（周次过滤）
 * ========================================================== */

export interface EffectiveSlot {
  course: Course;
  slot: CourseTimeSlot;
  dayOfWeek: DayOfWeek;
  startMin: number;
  endMin: number;
  /** 「3-5 节」这样的表述，与教务课表一致 */
  periodLabel: string;
}

/** 某节次在给定周次是否开课（空数组 = 全学期，与 types.ts 约定一致） */
export function activeInWeek(slot: CourseTimeSlot, weekNo: number): boolean {
  return slot.weeks.length === 0 || slot.weeks.includes(weekNo);
}

/**
 * 某一周真正要上的课。
 * 这是整个排程的第一公民 —— 课表里 3-18 周、7-15 周、10-18 周混在一起，
 * 每周的有效课表都不一样（第 9 周时党史已结束、模电实验还没开始）。
 */
export function effectiveCourses(schedule: Schedule, weekNo: number): Course[] {
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
 * 五、时间轴工具
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

/* ============================================================
 * 六、主入口
 * ========================================================== */

export function buildWeekPlan(input: BuildWeekPlanInput): BuildWeekPlanResult {
  const {
    schedule, weekNo, policy,
    scenarios = null,
    tasks = [],
    templates = DEFAULT_TEMPLATES,
    transfer = campusFallbackTransfer,
    dayStart = '07:00',
    dayEnd = '23:00',
    withMeals = true,
  } = input;

  const dayStartMin = toMinutes(dayStart);
  const dayEndMin = toMinutes(dayEnd);

  const notes: string[] = [];
  const issues: PlanIssue[] = [];
  const allBlocks: TimeBlock[] = [];

  const effCourses = effectiveCourses(schedule, weekNo);
  if (effCourses.length === 0) {
    notes.push(`第 ${weekNo} 周没有课（已结课或处在考试周），整天都可以自己安排`);
  } else {
    notes.push(`第 ${weekNo} 周有 ${effCourses.length} 门课（已按周次过滤，不是照搬整学期课表）`);
  }

  // 用户自定义模块：指定了「星期 + 开始时间」的属固定块，其余交给引擎找空档
  const fixedTasks = tasks.filter((t) => t.dayOfWeek != null && t.startMin != null);
  const floatingTasks = tasks.filter((t) => !(t.dayOfWeek != null && t.startMin != null));
  const taskActive = (t: UserTask) => !t.weeks?.length || t.weeks.includes(weekNo);

  let totalFree = 0;
  let studyMin = 0;
  let courseMin = 0;
  let blankMin = 0;
  let seq = 0;
  const newId = (day: number, kind: string, startMin: number) => `${day}-${kind}-${startMin}-${++seq}`;

  for (const day of DAY_ORDER) {
    const dayName = DAY_NAME[day];
    const daySlots = slotsOn(schedule, weekNo, day);
    const dayCampus = dominantCampus(daySlots);

    /* --- 6.1 课程块 --- */
    const courseBlocks: TimeBlock[] = daySlots.map((s) => {
      courseMin += s.endMin - s.startMin;
      return {
        id: newId(day, 'course', s.startMin),
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
          issues.push({
            level: 'error',
            blockId: courseBlocks[j].id,
            message: `${dayName}「${courseBlocks[i].title}」与「${courseBlocks[j].title}」时间冲突`,
          });
        }
      }
    }
    for (const s of daySlots.filter((x) => !x.course.building)) {
      issues.push({
        level: 'info',
        message: `「${s.course.name}」还没有上课地点，${dayName}的转场时间无法计算（记得补上）`,
      });
    }

    /* --- 6.2 用户固定块 --- */
    const userBlocks: TimeBlock[] = fixedTasks
      .filter((t) => t.dayOfWeek === day && taskActive(t))
      .map((t) => ({
        id: newId(day, 'user', t.startMin as number),
        kind: t.kind ?? 'activity',
        dayOfWeek: day,
        startMin: t.startMin as number,
        endMin: (t.startMin as number) + (t.durationMin ?? 60),
        title: t.title,
        place: t.place,
        emoji: t.emoji ?? '📌',
        reason: '你自己指定的时间，重排时会锁定不动',
        locked: true,
        source: 'user' as const,
      }));

    // 逐块累积：引擎每放一个块，都要考虑「从上个块走过来要多久」
    let placed: TimeBlock[] = [...courseBlocks, ...userBlocks];

    /* --- 6.3 三餐（按地点就近 + 营业时段 + 走路时间） --- */
    if (withMeals) {
      const firstStart = daySlots.length ? daySlots[0].startMin : null;
      for (const meal of MEAL_SLOTS) {
        // 早餐只在上午有早课的日子排（没早课就不必硬叫早）
        if (meal.id === 'breakfast' && !(firstStart != null && firstStart <= toMinutes('10:00'))) continue;
        const res = placeMeal({ day, meal, placed, dayStartMin, dayEndMin, templates, scenarios, transfer, dayCampus });
        if (res.block) placed = [...placed, res.block];
        else if (res.skippedReason) issues.push({ level: 'info', message: `${dayName}：${res.skippedReason}` });
      }
    }

    /* --- 6.4 空档与预算 --- */
    const freeTotal = freeGaps(dayStartMin, dayEndMin, placed)
      .reduce((n, g) => n + (g.endMin - g.startMin), 0);
    totalFree += freeTotal;
    // 留白是「下限」：至少留下 blankRatio 的空档不被占用
    const usable = Math.max(0, freeTotal - Math.round(freeTotal * policy.blankRatio));
    const activityBudget = Math.min(ACTIVITY_CAP_MIN, Math.round(usable * 0.4));

    /* --- 6.5 活动模块（运动/午休/取快递/夜宵/自定义…） --- */
    const candidates = buildCandidates(templates, scenarios, floatingTasks, taskActive);
    const perCat: Record<string, number> = {};
    let activityMin = 0;
    for (const tpl of candidates) {
      const cat = tpl.category as ActivityCategory;
      const cap = CATEGORY_PER_DAY[cat] ?? 1;
      if ((perCat[cat] ?? 0) >= cap) continue;
      if (activityMin + Math.min(...tpl.durations) > activityBudget) continue;
      const block = placeTemplate({
        tpl, day, placed, dayCampus, newId, policy, transfer, dayStartMin, dayEndMin,
      });
      if (block) {
        placed = [...placed, block];
        perCat[cat] = (perCat[cat] ?? 0) + 1;
        activityMin += block.endMin - block.startMin;
      }
    }

    // 「有人约才去运动」——不主动排，但留一句话
    if (scenarios?.exercise_trigger === 'with_others' && day === 1) {
      notes.push('你运动是「有人约才去」，所以没主动给你排运动块 —— 有人约时现成用空档就行');
    }

    /* --- 6.6 学习块（按阶段策略填充） --- */
    const studyBudget = Math.min(policy.dailyStudyMin, Math.max(0, usable - activityMin));
    const studyBlocks = fillStudy({
      day, placed, budget: studyBudget, policy, templates, dayCampus, newId, transfer,
      dayStartMin, dayEndMin,
    });
    placed = [...placed, ...studyBlocks];
    for (const b of studyBlocks) studyMin += b.endMin - b.startMin;

    /* --- 6.7 转场 + 组装 --- */
    const dayBlocks = sortBlocks(placed);
    attachTransfers(dayBlocks, transfer, dayName, issues);

    const filled = activityMin + studyBlocks.reduce((n, b) => n + (b.endMin - b.startMin), 0);
    blankMin += Math.max(0, freeTotal - filled);
    allBlocks.push(...dayBlocks);
  }

  /* --- 6.8 汇总 --- */
  const studyDays = policy.weekendWork ? 7 : 5;
  const wantMin = policy.dailyStudyMin * studyDays;
  if (studyMin < wantMin * 0.8) {
    issues.push({
      level: 'info',
      message: `本周自习 ${humanizeMinutes(studyMin)}，低于目标 ${humanizeMinutes(wantMin)}`
        + '（课太满或留白比例偏高，可以把「留白」调低一点）',
    });
  }
  notes.push(
    `每天自习目标 ${policy.dailyStudyMin} 分钟｜单块上限 ${policy.maxBlockMin} 分钟`
    + `｜刻意留白 ${Math.round(policy.blankRatio * 100)}%`,
  );
  if (!policy.eveningAllowed) notes.push('这个阶段不占用晚间（18:00 之后），晚上留给你自己');
  if (!policy.weekendWork) notes.push('这个阶段不占周末');

  return {
    plan: {
      weekNo,
      blocks: sortBlocks(allBlocks),
      stats: { courseMin, studyMin, blankMin, blockCount: allBlocks.length },
      issues,
    },
    notes,
  };
}

/* ============================================================
 * 七、内部：三餐
 * ========================================================== */

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

function campusLabel(id: string): string {
  if (id === 'JG334') return '南校';
  if (id === 'JG1100') return '1100';
  if (id === 'FUXING') return '复兴路';
  if (id === 'YINGKOU') return '营口路';
  if (id === 'JG516') return '北校';
  return 'any';
}

interface MealPick { block: TimeBlock | null; skippedReason?: string }

/**
 * 排一顿饭。顺序有讲究：
 *   ① 先找「上一个非用餐块」——它决定你从哪儿来、要走多久；
 *   ② 用它挑食堂（同校区 + 此刻在营业 + 走最近 or 按口味）；
 *   ③ 落点必须 ≥ 上一块结束 + 走过去的时间 —— 否则就是假排程。
 */
function placeMeal(args: {
  day: DayOfWeek;
  meal: { id: string; label: string; nominal: string; durationMin: number };
  placed: TimeBlock[];
  dayCampus: string;
  dayStartMin: number;
  dayEndMin: number;
  templates: ActivityTemplate[];
  scenarios: ScenarioFields | null;
  transfer: TransferProvider;
}): MealPick {
  const { day, meal, placed, dayCampus, dayStartMin, dayEndMin, templates, scenarios, transfer } = args;
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
      id: `${day}-meal-${start}`,
      kind: 'meal',
      dayOfWeek: day,
      startMin: start,
      endMin: start + dur,
      title: `${meal.label} · ${chosen.name}`,
      place: chosen.place,
      emoji: chosen.emoji,
      reason: why + (chosen.note ? `（${chosen.note}）` : '')
        + (need > 0 && anchor?.place ? `；从${anchor.place}走过去约 ${need} 分钟` : '')
        + (tail > 0 && next?.place ? `；吃完走到${next.place}约 ${tail} 分钟` : ''),
      source: 'template',
    },
  };
}

/* ============================================================
 * 八、内部：活动模块
 * ========================================================== */

function buildCandidates(
  templates: ActivityTemplate[],
  scenarios: ScenarioFields | null,
  floatingTasks: UserTask[],
  taskActive: (t: UserTask) => boolean,
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
  const custom = floatingTasks.filter(taskActive).map(customTemplate);
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
  newId: (day: number, kind: string, startMin: number) => string;
  policy: PhasePolicy;
  transfer: TransferProvider;
  dayStartMin: number;
  dayEndMin: number;
}): TimeBlock | null {
  const { tpl, day, placed, dayCampus, newId, policy, transfer, dayStartMin, dayEndMin } = args;

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
      const floor = Math.max(gap.startMin, z.startMin);
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
        id: newId(day, tpl.kind, s),
        kind: tpl.kind,
        dayOfWeek: day,
        startMin: s,
        endMin: s + dur,
        title: tpl.name,
        place: tpl.place,
        emoji: tpl.emoji,
        reason: tpl.note ?? '常用模块，按空档大小自动选了这个时长',
        // 用户自定义的模块要能一眼分辨出来（后续「确认 → 行为记录」靠这个）
        source: tpl.category === 'custom' ? 'user' : 'template',
      };
    }
  }
  return null;
}

/* ============================================================
 * 九、内部：学习块填充
 * ========================================================== */

function studyCandidates(
  policy: PhasePolicy,
  dayCampus: string,
  templates: ActivityTemplate[],
): ActivityTemplate[] {
  const wanted = policy.studyPlaces.map((p, i) => {
    const hit = templates.find((t) => t.place === p && t.category === 'study');
    if (hit) return hit;
    return {
      id: `study-policy-${i}`,
      name: `自习 · ${p}`,
      emoji: '📚',
      category: 'study' as const,
      kind: 'study' as const,
      durations: [45, 60, 90],
      place: p,
      campus: campusLabel(campusOfName(p)) as ActivityTemplate['campus'],
      windows: [],
      priority: 60,
      verified: true,
    };
  });
  const extra = templates.filter(
    (t) => t.category === 'study'
      && campusLabel(campusOfName(t.place ?? '')) === campusLabel(dayCampus)
      && !wanted.some((w) => w.place === t.place),
  );
  return [...wanted, ...extra];
}

function fillStudy(args: {
  day: DayOfWeek;
  placed: TimeBlock[];
  /** 今天可用于自习的总分钟数（已扣掉留白与活动） */
  budget: number;
  policy: PhasePolicy;
  templates: ActivityTemplate[];
  dayCampus: string;
  newId: (day: number, kind: string, startMin: number) => string;
  transfer: TransferProvider;
  dayStartMin: number;
  dayEndMin: number;
}): TimeBlock[] {
  const { day, placed: placedIn, budget, policy, templates, dayCampus, newId, transfer, dayStartMin, dayEndMin } = args;
  let placed = placedIn;

  const isWeekend = day === 6 || day === 7;
  if (isWeekend && !policy.weekendWork) return []; // 这个阶段不占周末
  if (budget < MIN_CHUNK) return [];

  const cands = studyCandidates(policy, dayCampus, templates);
  const blocks: TimeBlock[] = [];
  let remaining = budget;

  // 每次都重新算空档：放完一块后布局变了，下一块的走路时间也要跟着重算
  while (remaining >= MIN_CHUNK) {
    const gaps = [...freeGaps(dayStartMin, dayEndMin, placed)]
      .sort((a, b) => (b.endMin - b.startMin) - (a.endMin - a.startMin));
    let best: { start: number; dur: number; tpl: ActivityTemplate } | null = null;

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
      id: newId(day, 'study', best.start),
      kind: 'study',
      dayOfWeek: day,
      startMin: best.start,
      endMin: best.start + best.dur,
      title: best.tpl.name,
      place: best.tpl.place,
      emoji: best.tpl.emoji,
      reason: `阶段策略：单块不超过 ${policy.maxBlockMin} 分钟，这块用了 ${best.dur} 分钟`,
      source: 'template',
    });
    placed = [...placed, blocks[blocks.length - 1]];
    remaining -= best.dur;
  }
  return blocks;
}

/* ============================================================
 * 十、内部：转场
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
  for (let i = 0; i < dayBlocks.length - 1; i++) {
    const prev = dayBlocks[i];
    const next = dayBlocks[i + 1];
    if (!prev.place || !next.place || prev.place === next.place) continue; // 同一栋楼，不用赶

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
    } satisfies TransferHint;

    if (SOFT_KINDS.has(next.kind) && !next.locked) continue; // 软块不报警

    if (slackMin < 0) {
      issues.push({
        level: 'error',
        blockId: next.id,
        message: `${dayName}：${prev.title} → ${next.title} 要走 ${Math.round(info.minutes)} 分钟，`
          + `但中间只有 ${gap} 分钟 —— 会迟到 ${Math.abs(slackMin)} 分钟，建议提前出发或换个安排`,
      });
    } else if (slackMin < TIGHT_SLACK) {
      issues.push({
        level: 'warn',
        blockId: next.id,
        message: `${dayName}：${prev.title} → ${next.title} 走 ${Math.round(info.minutes)} 分钟，`
          + `只剩 ${slackMin} 分钟余量，偏紧`,
      });
    }
  }
}

/* ============================================================
 * 十一、展示辅助
 * ========================================================== */

/** 一天的块按时间排序后转成展示用字符串（周程页/测试都用） */
export function describeDay(blocks: TimeBlock[], dayOfWeek: DayOfWeek): string[] {
  return blocks
    .filter((b) => b.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => `${toHHmm(b.startMin)}-${toHHmm(b.endMin)} ${b.emoji ?? ''}${b.title}`
      + (b.place ? ` @${b.place}` : ''));
}
