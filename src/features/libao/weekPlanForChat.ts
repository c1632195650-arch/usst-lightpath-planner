/**
 * 对话场景的一周排程（路线 C2：技术并轨）
 * ============================================================
 * 与「周计划」页**共用同一个引擎**（`planWeek()`），而不是另起一套模板。
 *
 * 为什么必须并轨：旧的那套是硬编码时间的模板（08:00 / 11:45 / 19:00），
 * 不排转场、不读校历、不认用户锁定块。于是同一个 App 里有两套输出，
 * 对话里那份明显更差 —— 用户连着看两处就会发现对不上。这就是「双轨」的破绽。
 * （那套模板 `lib/lbao.ts::lbaoRecommend` 已于 2026-09-19 整体删除，
 *   最后一个残留调用点 `features/week/WeekView.tsx` 也已切到本模块。）
 *
 * 与周计划页的唯一差别是**输出形态**：那边铺完整时间轴，这边只取要点
 * （见 `summarizeWeekPlan`）。**数据同源、呈现分层** ——
 * 「对话给建议、周页给执行」本就是产品设计上该有的分工，不是妥协。
 *
 * ⚠️ 两遍法**不在本文件里手写**：编排统一走 `planner/planWeek.ts`（唯一编排点）。
 *    原先这里与 `features/week/WeekPlanView.tsx` 各抄了一份，同一套逻辑两个副本。
 *
 * ── 2026-09-20 扩展：从「排一周」到「把一件事排进去」 ──────────
 * 本文件是 `features/libao/**` 接触引擎的**唯一接缝**（见 `AGENTS.md` 与
 * 记忆里的「防腐层」约定），所以「对话 → 日程」这条链路的引擎侧全部收在这里：
 *
 *   `goalToTasks`        意图槽位 → 引擎认的 `UserTask[]`（照 `events.ts::expandDeadlines`
 *                        的范式：窗口取样 + 稳定 id + `essential` 独立预算）
 *   `planWeekWithTasks`  把 tasks 送进 `planWeek`（与周计划页同一条路）
 *   `checkGoalFeasibility`  **干跑**：先不落盘，跑一次引擎对比 issues/stats，
 *                        把「能不能排」从 LLM 的嘴上搬到引擎的事实上
 *
 * 三条都不新增引擎侧依赖：只多 import 了 `planWeekV2`（= `solveWeek`，同步、不联网）
 * 作为干跑原语 —— 用 `planWeek` 干跑会在浏览器里真发一轮后端请求，而干跑只需要
 * 「排得下吗」，不需要精确的步行分钟数。
 */
import type { PersonaProfile, PhaseKind, PlanIssue, Schedule, TimeBlock, WeekPlan } from '@/types';
import { toPlanRequest } from '@/lib/planner/schedule';
import { planWeek } from '@/lib/planner/planWeek';
import { planWeekV2 } from '@/lib/planner/index';
import type { UserTask } from '@/lib/planner/templates';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { methodCardsForPhase, examSprintStep, type MethodPhase } from '@/lib/planner/methods';
import { TERM_CALENDAR } from '@/constants/term';
import { toHHmm, toMinutes } from '@/constants/time';
import { WEEKDAY_CN, addDays, currentWeekNo, diffDays, weekdayOf } from '@/lib/date';
import { topQuestions, type IntentSlots } from './libaoIntent';

/** 学期阶段策略来自校历常量。按 `termStart` 反查比写死学年 key 更扛得住换学期。 */
function calendarOf(schedule: Schedule) {
  return (
    Object.values(TERM_CALENDAR).find((c) => c.termStart === schedule.termStart) ??
    TERM_CALENDAR['2026-2027-1']
  );
}

/**
 * 排一周，供对话使用。
 *
 * @returns `null` = 排不了（该周不在学期范围内）→ 调用方应降级为纯引导，**不要编造日程**。
 *
 * 后端未连通时**不失败**：`planWeek` 的降级策略保证仍能给出结果 ——
 * 转场退回跨校区估算值。估算值也远好过硬编码模板，这是与周计划页一致的
 * 降级行为（那边也是 `backendOk=false` 时继续显示）。
 */
export async function planWeekForChat(
  schedule: Schedule,
  profile: PersonaProfile | null,
  weekNo: number,
): Promise<WeekPlan | null> {
  return planWeekWithTasks(schedule, profile, weekNo, []);
}

/**
 * 排一周，并把**用户的目标**一起算进去。
 *
 * 与 `planWeekForChat` 的唯一差别是多了一条 `tasks` —— 但这条差别是关键：
 * 此前对话侧调用引擎时**从不传 tasks**，于是「梨宝把我说的那件事排进去」
 * 在技术上无路可走（引擎根本不知道有这件事）。周计划页早就走通了这条通道
 * （校历事件 + 天气都从这儿进），补的只是对话侧的接线。
 */
export async function planWeekWithTasks(
  schedule: Schedule,
  profile: PersonaProfile | null,
  weekNo: number,
  tasks: UserTask[],
): Promise<WeekPlan | null> {
  const semester = buildPhasesFromCalendar(schedule, profile, calendarOf(schedule));
  const phase = phaseOfWeek(semester.plan, weekNo);
  if (!phase) return null;

  const result = await planWeek(
    toPlanRequest({
      schedule,
      weekNo,
      policy: phase.policy,
      scenarios: profile?.scenarios ?? null,
      tasks,
    }),
  );
  return result.plan;
}

/**
 * 把周计划压成几句可对话的话。
 *
 * **只陈述引擎算出来的事实**，不替用户做决定 —— 「决策层不拍板」是这个产品
 * 既定的智能边界（见项目记忆 §1）。所以这里只输出「哪天满」「哪里紧」
 * 「哪天空」，而不是「你应该把自习挪到周四」。
 */
export function summarizeWeekPlan(plan: WeekPlan): string[] {
  const out: string[] = [];
  const byDay = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    label: WEEKDAY_CN[day % 7],
    blocks: plan.blocks.filter((b) => b.dayOfWeek === day),
  }));

  // 1) 哪天最满 —— 这是「结合你的课表」最直观的证据
  const busiest = [...byDay].sort((a, b) => b.blocks.length - a.blocks.length)[0];
  if (busiest && busiest.blocks.length > 0) {
    out.push(`${busiest.label}最满，排了 ${busiest.blocks.length} 个块`);
  }

  // 2) 时间紧张的地方。直接引用引擎的判定（转场是实测出来的），不在这里重复判断 ——
  //    否则就成了「两处各算一遍」，正是双轨问题的翻版。
  const tight = plan.issues.filter((i) => i.level === 'error' || i.level === 'warn');
  for (const t of tight.slice(0, 2)) out.push(t.message);
  if (tight.length === 0) out.push('走路和转场的余量都在安全范围内');

  // 3) 整天空着的天 —— 对「那我能干点啥」这类追问最有用
  const free = byDay.filter((d) => d.blocks.length === 0).map((d) => d.label);
  if (free.length > 0) out.push(`${free.join('、')}基本空着`);

  // 4) 量的口径：自习总量 + **日均**留白。
  //    刻意不报留白总时长 —— 实测一周能到 63 小时，那个数字看着像系统压根没干活，
  //    日均才是人读得懂的（「每天留出 9 小时」）。
  const h = (min: number) => Math.round((min / 60) * 10) / 10;
  out.push(
    `自习 ${h(plan.stats.studyMin)}h · 日均留白 ${h(plan.stats.blankMin / 7)}h · 共 ${plan.stats.blockCount} 个块`,
  );

  return out;
}

/**
 * 引擎阶段口径 → 方法库阶段口径。
 * 方法库没有「期中」独立档（byPhase 只有 适应期/常规/期末），冲刺并入期末。
 * 纯映射、确定性 —— 两套枚举的字面量都在类型上钉死，漏分支会被 tsc 抓住。
 */
function phaseToMethod(kind: PhaseKind): MethodPhase {
  switch (kind) {
    case 'adapt':
      return '适应期';
    case 'normal':
    case 'midterm':
      return '常规';
    case 'sprint':
    case 'exam':
      return '期末';
  }
}

/**
 * 本周的方法建议（2026-09-20 P3②：methods.ts 参数在 planWeek 侧的显式消费点）。
 *
 * 与 `summarizeWeekPlan` 的分工：那边只陈述**引擎算出来的事实**（哪天满、哪里紧），
 * 这边给**方法论建议**（怎么学）—— 数据来自方法库编译产物（methodParams.generated），
 * 纯函数、不查库、不 fetch、不读时钟；建议层只提示，不替用户拍板（L4 边界不变）。
 *
 * 输出 0–2 条：
 *   · 冲刺/考试周 → `examSprintStep`（距考试周结束的换算天数决定冲刺阶段口径）
 *   · 阶段方法卡 top1（`methodCardsForPhase`，contested 恒置底）
 */
export function methodAdviceForChat(
  schedule: Schedule,
  profile: PersonaProfile | null,
  weekNo: number,
): string[] {
  const semester = buildPhasesFromCalendar(schedule, profile, calendarOf(schedule));
  const phase = phaseOfWeek(semester.plan, weekNo);
  const out: string[] = [];

  if (phase && (phase.kind === 'sprint' || phase.kind === 'exam')) {
    const daysLeft = Math.max(0, (phase.toWeek - weekNo) * 7);
    const sprint = examSprintStep(daysLeft);
    out.push(`考试节奏（${sprint.stage}）：${sprint.action}`);
  }

  const [card] = methodCardsForPhase(phase ? phaseToMethod(phase.kind) : 'any', 1);
  if (card) out.push(`方法建议：《${card.title}》—— ${card.summary}`);

  return out;
}

/* ============================================================
 * 三、目标 → 可排任务
 * ============================================================ */

/**
 * 没给结束时间时的默认备赛窗口（天）。
 * 3 周 —— 够覆盖「报名到初赛」这种典型跨度，又不会把半个学期铺满。
 * ⚠️ 用了默认窗口就必须在草稿里**说出来**（`checkGoalFeasibility` 的 `caveats`），
 *    否则用户会以为这是他给的时间。
 */
export const DEFAULT_GOAL_SPAN_DAYS = 21;

/** 没给单次时长时的默认块长。与校历事件准备块同档（`events.ts` 用 45/60/90）。 */
export const DEFAULT_BLOCK_MIN = 90;

/** 最早可开始时刻 —— 总不能让「数学建模备赛」被排到 07:00（同 `events.ts` 的理由）。 */
const GOAL_EARLIEST_MIN = toMinutes('09:00');

/** 窗口天数上限：防「时间待定且无锚点」时算出一个荒唐的长窗口。 */
const MAX_GOAL_DAYS = 120;

/** ISO 日期 → DayOfWeek（1=周一 … 7=周日；`weekdayOf` 是 0=周日） */
function isoToDayOfWeek(iso: string): number {
  const wd = weekdayOf(iso);
  return wd === 0 ? 7 : wd;
}

/** 标题 → 稳定 id 片段。**必须确定性**：id 里出现随机数会让每次生成都是「新块」。 */
function slugOf(title: string): string {
  const s = title.replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, '');
  return s.slice(0, 16) || 'goal';
}

/** 写进 `UserTask.note` 的理由 —— 与 `TimeBlock.reason` 同一哲学：可解释、可反驳。 */
function noteForGoal(slots: IntentSlots): string {
  const bits = [`来自对话：${slots.raw.slice(0, 40)}`];
  if (slots.when) bits.push(`时间：${slots.when.text}`);
  if (slots.certainty === 'unknown') bits.push('确切时间还没定，先按预估窗口排');
  return bits.join('｜');
}

/**
 * 意图槽位 → 引擎认的任务列表。
 *
 * 与 `lib/planner/events.ts::expandDeadlines` **同一套范式**（窗口取样 + 稳定 id +
 * `essential` 独立预算 + `notBeforeMin` 防清晨）。刻意复用而不是另写一套：
 * 同一件事（「把目标铺进窗口」）在两处用两种铺法，正是「日程看起来像随便排的」
 * 最常见的来源 —— 校历事件块和对话排的块会呈现出明显不同的节奏。
 *
 * @returns 空数组 = 排不了（没目标名 / 窗口不在学期内）→ 调用方应如实说明，**不要编日程**。
 */
export function goalToTasks(
  slots: IntentSlots,
  schedule: Schedule | null,
  today: string,
): UserTask[] {
  const out: UserTask[] = [];
  if (!schedule?.termStart || !slots.title) return out;

  // ① 窗口：有锚点用锚点，没锚点从今天起算
  const from = slots.dateFrom ?? today;
  let to = slots.dateTo ?? addDays(from, DEFAULT_GOAL_SPAN_DAYS - 1);
  if (diffDays(from, to) < 0) to = from;
  if (diffDays(from, to) > MAX_GOAL_DAYS) to = addDays(from, MAX_GOAL_DAYS - 1);

  // ② 候选日：用户点名了星期就只留那一天（「每周三」）
  const wantDow = slots.when?.weekday ?? null;
  const span = diffDays(from, to);
  const days: string[] = [];
  for (let i = 0; i <= span; i++) {
    const d = addDays(from, i);
    if (wantDow != null && isoToDayOfWeek(d) !== wantDow) continue;
    days.push(d);
  }
  if (days.length === 0) return out;

  // ③ 块数：给了总量按总量摊；只给频率按频率乘周数；都没给就一块。
  const blockMin = slots.durationMin != null && slots.durationMin > 0 ? slots.durationMin : DEFAULT_BLOCK_MIN;
  let nBlocks: number;
  if (slots.totalHours != null && slots.totalHours > 0) {
    nBlocks = Math.max(1, Math.ceil((slots.totalHours * 60) / blockMin));
  } else if (slots.perWeekCount != null && slots.perWeekCount > 0) {
    const spanWeeks = Math.max(1, Math.ceil((span + 1) / 7));
    nBlocks = Math.max(1, slots.perWeekCount * spanWeeks);
  } else {
    nBlocks = 1;
  }

  // ④ 窗口内均匀取样 + 同一天去重（与 `expandDeadlines` 逐行同构）
  const picked = new Set<number>();
  for (let i = 0; i < nBlocks; i++) {
    const at = nBlocks >= days.length ? i % days.length : Math.floor((i * days.length) / nBlocks);
    picked.add(Math.min(days.length - 1, Math.max(0, at)));
  }

  // ⑤ 生成任务。id **只与「目标 + 周次 + 星期」有关，不含时间** ——
  //    语义键含时间会让引擎把同一块认成「删一个 + 新增一个」（见 `userPlanStore` 的 id 纪律）。
  const slug = slugOf(slots.title);
  for (const idx of [...picked].sort((a, b) => a - b)) {
    const iso = days[idx];
    const wk = currentWeekNo(schedule.termStart, iso);
    if (!Number.isFinite(wk) || wk < 1 || wk > schedule.totalWeeks) continue;
    const dow = isoToDayOfWeek(iso);
    out.push({
      id: `goal-${slug}-w${wk}d${dow}`,
      title: slots.title,
      emoji: '🎯',
      // 备赛/备考本质上是「学」，用餐/活动都不对；非必做的事才降为 activity
      kind: slots.essential ? 'study' : 'activity',
      category: 'custom',
      dayOfWeek: dow,
      // ⚠️ 刻意**不给 `startMin`**：给了就成了 hard 锁定的固定块，引擎再也动不了它，
      //    而用户说的是「安排一下」，不是「钉死在这一刻」。时段偏好靠 `notBeforeMin` 表达。
      weeks: [wk],
      durationMin: blockMin,
      ...(slots.place ? { place: slots.place } : {}),
      priority: slots.priorityHint,
      ...(slots.essential ? { essential: true } : {}),
      notBeforeMin: slots.window?.fromMin ?? GOAL_EARLIEST_MIN,
      note: noteForGoal(slots),
    });
  }
  return out;
}

/* ============================================================
 * 四、可行性把关（干跑）
 * ============================================================ */

export type GoalVerdictKind =
  | 'ok'                    // 排得下，无新增问题
  | 'tight'                 // 排得下，但会变紧 or 挤占自习
  | 'conflict'              // 排得下但引入冲突 → 出方案 A/B
  | 'infeasible'            // 排不进去 → 说明卡点 + 给可选项
  | 'needs_clarification';  // 槽位不齐 → 追问

/** 新增的问题（按 `code` 归并计数后的增量） */
export interface GoalAddedIssue {
  code: string;
  level: PlanIssue['level'];
  count: number;
  sample: string;
}

export interface GoalVerdict {
  kind: GoalVerdictKind;
  /** `needs_clarification` 时的追问话术（≤2 条） */
  questions: string[];
  /** 相对基线**新增**的问题 */
  added: GoalAddedIssue[];
  /** 自习时长变化（分钟，负数 = 被挤掉） */
  studyDeltaMin: number;
  /** 真正落进计划的块数 */
  placedCount: number;
  /** 候选块数 —— `placedCount < candidates` 就说明有块排不进去 */
  candidateCount: number;
  /** 落点的人类可读描述，供草稿卡逐条显示 */
  placedAt: string[];
  /** 必须如实告知用户的口径（用了默认窗口 / 时间待定…） */
  caveats: string[];
  /** 结论的一句话理由，供梨宝回话直接引用 */
  reasons: string[];
}

/** 问题归并键：`code` 优先。中文 `message` 会变（含动态数字），拿它当键会让 diff 失真。 */
function issueKey(i: PlanIssue): string {
  return i.code ?? i.message;
}

function countIssues(plan: WeekPlan): Map<string, { level: PlanIssue['level']; n: number; sample: string }> {
  const m = new Map<string, { level: PlanIssue['level']; n: number; sample: string }>();
  for (const i of plan.issues) {
    const k = issueKey(i);
    const cur = m.get(k);
    if (cur) cur.n += 1;
    else m.set(k, { level: i.level, n: 1, sample: i.message });
  }
  return m;
}

/**
 * 干跑：把候选任务**先在内存里排一遍**，看会变成什么样。
 *
 * 这是整套方案里最要紧的一步 —— 它把「能不能排」从 LLM 的嘴上搬到**引擎的事实上**。
 * LLM 会说「当然可以」，引擎会算出来那天到底还有没有空档、转场来不来得及。
 *
 * 刻意用 `planWeekV2`（= `solveWeek`，同步、不联网）而不是 `planWeek`：
 *   · 干跑只需要回答「排得下吗」，不需要精确的步行分钟数；
 *   · `planWeek` 在浏览器里会真发一轮后端请求 —— 用户在等他说话的时间里，
 *     我们不该先把干跑跑成一个网络往返；
 *   · 同步实现让这个函数**可以被确定性测试**。
 *
 * 纯函数：不落盘、不改任何状态。**调用方拿到 verdict 之后才谈执行。**
 */
export function checkGoalFeasibility(args: {
  slots: IntentSlots;
  schedule: Schedule | null;
  profile: PersonaProfile | null;
  /**
   * ⚠️ 已废弃、被忽略：干跑改为按候选块**真正落在的周**逐周跑（见关三），
   * 不再是「在调用方给的某一周排一遍」。保留这个可选参数是为了兼容
   * 仍按旧签名调用的调用方，不让它们类型报错 —— 新代码不要再传。
   */
  weekNo?: number;
  /** 本周已经在用的任务（校历事件 / 天气 / 用户自己加的）—— 必须在场，否则基线失真 */
  tasks?: UserTask[];
  today: string;
}): GoalVerdict {
  const { slots, schedule, profile, today } = args;
  const existing = args.tasks ?? [];
  const caveats: string[] = [];

  const base: GoalVerdict = {
    kind: 'ok',
    questions: [],
    added: [],
    studyDeltaMin: 0,
    placedCount: 0,
    candidateCount: 0,
    placedAt: [],
    caveats,
    reasons: [],
  };

  // ── 关一：槽位齐不齐 ────────────────────────────────────────
  if (slots.missing.length > 0) {
    return {
      ...base,
      kind: 'needs_clarification',
      questions: topQuestions(slots),
      reasons: ['信息还不够，先问清楚再动手 —— 猜一个排进去，比慢一轮更糟。'],
    };
  }

  if (!schedule?.termStart) {
    return { ...base, kind: 'infeasible', reasons: ['还没有课表，我算不出往哪儿插。'] };
  }

  const semester = buildPhasesFromCalendar(schedule, profile, calendarOf(schedule));

  // ── 关二：能不能展开成任务 ─────────────────────────────────
  const candidates = goalToTasks(slots, schedule, today);
  if (candidates.length === 0) {
    return {
      ...base,
      kind: 'infeasible',
      reasons: ['这个时间窗口落不到本学期的任何一周里，我排不进去。'],
    };
  }

  // 诚实标注：用了默认窗口就是用了，别说成是用户给的
  if (!slots.dateTo) {
    caveats.push(`你没说到什么时候为止，我按 ${DEFAULT_GOAL_SPAN_DAYS} 天的窗口先铺了一版。`);
  }
  if (slots.certainty === 'unknown') {
    caveats.push('你说时间还没定 —— 这版是**预估窗口**，日期定下来告诉我，我重排。');
  }
  if (!slots.place) {
    caveats.push('没给地点 —— 转场时间按同校区估算，等你说地点我再校准。');
  }

  // ── 关三：干跑对比（**按候选块真正落在的周**逐周跑）─────────
  // 🔴 这里曾只在「当前周」跑一遍 —— 而目标窗口往往在后面几周，
  //    当前周的计划里根本没有这些块，于是一律误报「排不进去」。
  //    这个 bug 是浏览器 E2E 实测抓到的（槽位全对、结论却是 infeasible），
  //    单元测试的窗口恰好跨到当前周，所以没暴露 —— 回归用例见
  //    「把关：窗口全在后面的周」。
  const byWeek = new Map<number, UserTask[]>();
  for (const t of candidates) {
    const w = t.weeks?.[0];
    if (!Number.isFinite(w)) continue;
    const list = byWeek.get(w as number) ?? [];
    list.push(t);
    byWeek.set(w as number, list);
  }

  const titles = new Set(candidates.map((t) => t.title));
  const placed: Array<{ week: number; block: TimeBlock }> = [];
  const addedAcc = new Map<string, GoalAddedIssue>();
  let studyDeltaMin = 0;

  for (const [w, wkTasks] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const wkPhase = phaseOfWeek(semester.plan, w);
    if (!wkPhase) continue; // 该周不在学期内 —— goalToTasks 理论上已滤掉
    const mkInput = (tasks: UserTask[]) => ({
      schedule,
      weekNo: w,
      policy: wkPhase.policy,
      scenarios: profile?.scenarios ?? null,
      tasks,
    });

    const before = planWeekV2(toPlanRequest(mkInput(existing))).plan;
    const after = planWeekV2(toPlanRequest(mkInput([...existing, ...wkTasks]))).plan;

    for (const b of after.blocks) {
      if (titles.has(b.title)) placed.push({ week: w, block: b });
    }
    studyDeltaMin += after.stats.studyMin - before.stats.studyMin;

    const beforeCount = countIssues(before);
    for (const [code, v] of countIssues(after)) {
      const prev = beforeCount.get(code)?.n ?? 0;
      if (v.n <= prev) continue;
      const acc = addedAcc.get(code);
      if (acc) acc.count += v.n - prev;
      else addedAcc.set(code, { code, level: v.level, count: v.n - prev, sample: v.sample });
    }
  }
  const added = [...addedAcc.values()];

  // ── 关四：真的落进去了吗 ───────────────────────────────────
  // 按 title 认领 —— 固定块（给了 dayOfWeek+startMin）与浮动块分别由 construct 的两条
  // 分支生成，`source` 一个是 'user' 一个是 'template'，只有 title 两端都稳定。
  const placedAt = placed
    .slice()
    .sort((a, b) =>
      a.week - b.week || a.block.dayOfWeek - b.block.dayOfWeek || a.block.startMin - b.block.startMin)
    .map(({ week, block }) =>
      `第${week}周 ${WEEKDAY_CN[block.dayOfWeek % 7]} ${toHHmm(block.startMin)}-${toHHmm(block.endMin)}`);

  const reasons: string[] = [];
  const hasError = added.some((a) => a.level === 'error');
  const hasWarn = added.some((a) => a.level === 'warn');

  if (placed.length === 0) {
    return {
      ...base,
      kind: 'infeasible',
      candidateCount: candidates.length,
      added,
      studyDeltaMin,
      caveats,
      reasons: ['这一周腾不出放它的地方 —— 一块都没落下去。'],
    };
  }

  if (hasError) {
    reasons.push('排进去会撞上硬冲突（重叠或转场来不及）—— 得换个时间或换个安排。');
    return { ...base, kind: 'conflict', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, reasons };
  }

  // ── 关四之二：要的量，窗口装得下吗 ─────────────────────────
  // 窗口里最多一天一块（`goalToTasks` 的取样会按天去重），所以存在一个容量上限。
  // 用户说「一共 2000 小时」时，若只按取样结果排下去，会静默交付「42 小时」——
  // 那是**看起来排上了、其实差得远**，比直接说排不下更糟（core §5.1 第 5 条「诚实」）。
  const wantMin = slots.totalHours != null ? slots.totalHours * 60 : 0;
  const gotMin = candidates.length * (slots.durationMin ?? DEFAULT_BLOCK_MIN);
  if (wantMin > gotMin) {
    const hours = (m: number) => Math.round((m / 60) * 10) / 10;
    caveats.push(
      `这个窗口最多放得下约 ${hours(gotMin)} 小时，离你说的 ${hours(wantMin)} 小时还差 ${hours(wantMin - gotMin)} 小时。`,
    );
    reasons.push('按现在的窗口和单次时长，目标量放不下 —— 得拉长窗口、加长单次，或降一档目标。');
    return { ...base, kind: 'conflict', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, reasons };
  }

  if (placed.length < candidates.length) {
    // 部分落不下 —— **如实说，不掩盖**（掩盖会让用户以为全排上了）
    reasons.push(`${candidates.length} 块里有 ${candidates.length - placed.length} 块没找到位置。`);
    return { ...base, kind: 'conflict', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, reasons };
  }

  if (studyDeltaMin < -60) {
    reasons.push(`会挤掉约 ${Math.abs(studyDeltaMin)} 分钟自习。`);
    return { ...base, kind: 'tight', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, reasons };
  }

  if (hasWarn) {
    for (const a of added.filter((x) => x.level === 'warn').slice(0, 2)) reasons.push(a.sample);
    return { ...base, kind: 'tight', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, reasons };
  }

  reasons.push('排得下，没有新增冲突。');
  return { ...base, kind: 'ok', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, reasons };
}

/**
 * 草稿卡的文案（**只陈述事实 + 给选项，不替用户拍板** —— core §4 的 L3/L4 边界）。
 *
 * 特别注意 `conflict` / `infeasible` 两支：它们输出的是**选项与后果**，
 * 不是「你应该……」。这是「懂分寸」在产品文案上的落点。
 */
export function describeVerdict(v: GoalVerdict): string[] {
  const out: string[] = [];
  for (const c of v.caveats) out.push(`· ${c}`);
  for (const p of v.placedAt) out.push(`· 排到：${p}`);
  for (const r of v.reasons) out.push(`· ${r}`);

  if (v.kind === 'needs_clarification') {
    for (const q of v.questions) out.push(`· ${q}`);
  }
  if (v.kind === 'conflict') {
    out.push('· 可以：① 换个时间段；② 缩短或拆分；③ 顶掉现有的一块。你说哪个，我来改。');
  }
  if (v.kind === 'infeasible') {
    out.push('· 可以：① 挪到下一周；② 降一档目标量；③ 先告诉我你愿意让出哪一块。');
  }
  return out;
}
