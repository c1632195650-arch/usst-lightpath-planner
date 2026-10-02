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
import type { PersonaProfile, PlanIssue, Schedule, TimeBlock, WeekPlan } from '@/types';
import type { PlanRequest } from '@/lib/planner/model';
import { toPlanRequest } from '@/lib/planner/schedule';
import { planWeek } from '@/lib/planner/planWeek';
import { planWeekV2 } from '@/lib/planner/index';
import type { UserTask } from '@/lib/planner/templates';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { diffDays as diffPlanDays, localizedPlan } from '@/lib/planner/localizedReplan';
import { TERM_CALENDAR } from '@/constants/term';
import { toHHmm, toMinutes } from '@/constants/time';
import { WEEKDAY_CN, addDays, currentWeekNo, diffDays, weekdayOf } from '@/lib/date';
import { isSingleDayEvent, topQuestions, type IntentSlots, type SlotKey } from './libaoIntent';
import { classifyGoal, evidenceLine, type GoalCategory } from './taxonomy';

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
      // 批 4.3（1A-③）：对话侧同样把完整画像喂进引擎（socialCap 链路）
      persona: profile,
      tasks,
    }),
  );
  return result.plan;
}

/* ============================================================
 * 二·五、单日重排（批 3，5A-②）：「只重排周X，其余天原样」
 * ========================================================== */

/**
 * 非目标天保位（纯函数）：`changedDays` 之外的天 = 用户点名要保留的。
 * next 相对 prev 在这些天**位移/消失**的块 → hard move 钉回 prev 的位置；
 * next 在这些天**新增**的块不用 pin —— 融合层（localizedPlan）直接沿用 prev
 * 的天，用户看不见它。目标天的块不 pin —— 那是重排的对象本身。
 *
 * source 用 'edit'（hard）：「其余天保持原样」是用户确认过的约束，下次重排也不许动。
 */
export function dayReplanPins(prev: WeekPlan, next: WeekPlan, changedDays: number[]): MoveRecord[] {
  const want = new Set(changedDays);
  const nextById = new Map(next.blocks.map((b) => [b.id, b]));
  const pins: MoveRecord[] = [];
  for (const b of prev.blocks) {
    if (want.has(b.dayOfWeek)) continue;
    const nb = nextById.get(b.id);
    if (nb && nb.dayOfWeek === b.dayOfWeek && nb.startMin === b.startMin && nb.endMin === b.endMin) continue;
    pins.push({
      weekNo: next.weekNo,
      blockId: b.id,
      dayOfWeek: b.dayOfWeek,
      startMin: b.startMin,
      endMin: b.endMin,
      ...(b.place ? { place: b.place } : {}),
      ...(b.room ? { room: b.room } : {}),
      source: 'edit',
    });
  }
  return pins;
}

export interface DayReplanResult {
  /** 融合后的计划：目标天用新排，其余天沿用上一版 */
  plan: WeekPlan;
  /** 落盘用：非目标天被引擎挪动的块 → hard pin 钉回原位 */
  pins: MoveRecord[];
  /** 目标天里引擎**真的改动**了的天（空 = 没什么可优化） */
  changedDays: number[];
}

/**
 * 「只重排某几天」的对话侧入口。引擎整周照算（必须看全局才知道目标天是紧是松），
 * 排完用 R6.1 定点融合：目标天用新版、其余天保留上一版 —— 用户审稿成本从七天
 * 降回一天。previousPlan 缺失时返回「整周新版 + 空 pins」的**降级结果**，调用方
 * （执行层）必须拒绝它：没有上一版就兑现不了「其余天原样」的承诺。
 */
export async function replanDaysForChat(args: {
  schedule: Schedule;
  profile: PersonaProfile | null;
  weekNo: number;
  tasks: UserTask[];
  days: number[];
  previousPlan: WeekPlan | null;
}): Promise<DayReplanResult | null> {
  if (args.days.length === 0) return null;
  const next = await planWeekWithTasks(args.schedule, args.profile, args.weekNo, args.tasks);
  if (!next) return null;
  const fused = localizedPlan(args.previousPlan, next, args.days);
  const actualChanged = args.previousPlan
    ? diffPlanDays(args.previousPlan, next).filter((d) => args.days.includes(d))
    : args.days;
  const pins = args.previousPlan ? dayReplanPins(args.previousPlan, next, args.days) : [];
  return { plan: fused.plan, pins, changedDays: actualChanged };
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
  // 双保险（强化计划 B）：没给单次时长、且总量摊下来只有一块时，块长直接用总量
  // （封顶单次上限）——「一共 1 小时」不该被默认块长 90 撑成自相矛盾的排法。
  const GOAL_SINGLE_MAX_MIN = 180;
  let blockMin = slots.durationMin != null && slots.durationMin > 0 ? slots.durationMin : DEFAULT_BLOCK_MIN;
  let nBlocks: number;
  if (slots.totalHours != null && slots.totalHours > 0) {
    nBlocks = Math.max(1, Math.ceil((slots.totalHours * 60) / blockMin));
    if (slots.durationMin == null && nBlocks === 1) {
      blockMin = Math.min(Math.round(slots.totalHours * 60), GOAL_SINGLE_MAX_MIN);
    }
  } else if (slots.perWeekCount != null && slots.perWeekCount > 0) {
    const spanWeeks = Math.max(1, Math.ceil((span + 1) / 7));
    nBlocks = Math.max(1, slots.perWeekCount * spanWeeks);
  } else {
    nBlocks = 1;
  }

  // 批 2（6C）：有截止目标的后程加长 —— 均匀取样下按窗口三分位给块长阶梯
  // （60/90/120）：距截止越近块越长，呈现「冲刺」形态（探针实录：30h 备考
  // 十周的均匀摊平和三天冲刺一个样，不像备考）。只在「给了总量 + 有截止 +
  // 没显式给单次时长 + 块数 ≥3」时启用 —— 习惯目标和用户 explicit 的块长不动。
  const pacingOn = slots.totalHours != null && slots.totalHours > 0
    && slots.dateTo != null && slots.durationMin == null && nBlocks >= 3;
  const blockLenFor = (dayIdx: number): number => {
    if (!pacingOn) return blockMin;
    const third = days.length / 3;
    if (dayIdx < third) return 60;
    if (dayIdx < third * 2) return 90;
    return 120;
  };

  // ④ 窗口内均匀取样 + 同一天去重（与 `expandDeadlines` 逐行同构）
  const picked = new Set<number>();
  for (let i = 0; i < nBlocks; i++) {
    const at = nBlocks >= days.length ? i % days.length : Math.floor((i * days.length) / nBlocks);
    picked.add(Math.min(days.length - 1, Math.max(0, at)));
  }

  // ⑤ 生成任务。id **只与「目标 + 周次 + 星期」有关，不含时间** ——
  //    语义键含时间会让引擎把同一块认成「删一个 + 新增一个」（见 `userPlanStore` 的 id 纪律）。
  const slug = slugOf(slots.title);
  // 批次 1（交互升级方案 4.4）：用户点名的钟点收窄引擎放置窗 —— 零引擎侧改动，
  // 仍走既有 `notBeforeMin`/`notAfterMin` 通道（D4 已为 window 接好）。clock 优先
  // 于 window（「晚上6点到8点」不该被放宽回整个晚上）；单端点缺哪端就回退哪端
  // 的 window 口径，再缺回默认（09:00 起）。**仍不给 `startMin` 硬锁定** ——
  // 「软偏好、引擎可挪」的哲学不变，草稿卡会如实展示实际排到的时段。
  const goalNotBefore = slots.clock?.startMin ?? slots.window?.fromMin ?? GOAL_EARLIEST_MIN;
  const goalNotAfter = slots.clock?.endMin ?? slots.window?.toMin;
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
      durationMin: blockLenFor(idx),
      ...(slots.place ? { place: slots.place } : {}),
      priority: slots.priorityHint,
      ...(slots.essential ? { essential: true } : {}),
      notBeforeMin: goalNotBefore,
      // D4：窗口上界不再丢 —— 「晚上」= 23:00 前结束，引擎放置受 notAfterMin 约束；
      // 批次 1：clock 有 endMin 时优先（用户点名的钟点上界）
      ...(goalNotAfter != null ? { notAfterMin: goalNotAfter } : {}),
      // D4：用户点名块豁免活动预算与每日上限 —— 「出去玩 1 小时」不再被静默挤掉
      budgetExempt: true,
      note: pacingOn
        ? `${noteForGoal(slots)}｜临近截止的块已按 60/90/120 分钟阶梯加长`
        : noteForGoal(slots),
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
  /**
   * D4：排不进去时**挡路的既有块**（引擎干跑扫出，≤5 条，hint 含 `周X(M.D) HH:MM–HH:MM`）。
   * 有了它，describeVerdict 列事实而不是硬编码「①②③」，协商话术才有依据（B③）。
   */
  blockingBlocks?: BlockingBlockInfo[];
  /** D4：用户真的给了投入量吗 —— 没给就不该出现「降一档目标量」这类话术 */
  canReduceScope?: boolean;
}

/** 挡路块的最小描述（PickOption 的素材；blockId 供「顶掉这块」的 replace 语义用） */
export interface BlockingBlockInfo {
  title: string;
  hint: string;
  blockId?: string;
  /** 批次 2（交互升级方案 5.4）：与目标块时段窗的重叠分钟数 —— 反馈精简按它
   *  排序取「最相关」的 top1-2，其余并入「另有 N 处时段被占」。 */
  overlapMin?: number;
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
  /**
   * D7：干跑基线里要**挖掉**的引擎块（「与挡路块互换」方案的 dry-run 语义：
   * 换掉它 = 它先让位）。课程块引擎侧自带保护，挖不掉也无需挖。
   */
  excludeBlockIds?: string[];
  today: string;
}): GoalVerdict {
  const { slots, schedule, profile, today, excludeBlockIds } = args;
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
  // 批次 1（交互升级方案 4.1）：钟点通道的口径说明进草稿卡 —— 歧义不许装作听懂，
  // 矛盾改判（clock 赢）也要说出口，用户才有机会纠正。
  if (slots.clock?.ambig) {
    caveats.push(`「${slots.clock.text}」没说上下午 —— 我先按上午的钟点理解，不对的话告诉我。`);
  }
  if (slots.clock?.conflicted) {
    caveats.push(`你给的钟点与「${slots.clock.conflicted}」不一致 —— 按你说的钟点排。`);
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

  // D4：placed 改按 id 认领（候选 id 内嵌在引擎块 id 的语义键里）——
  // 此前按 title 认领，同名块会误认领「别的块替它落了地」。
  const placed: Array<{ week: number; block: TimeBlock }> = [];
  const addedAcc = new Map<string, GoalAddedIssue>();
  const blockingAcc: BlockingBlockInfo[] = [];
  let studyDeltaMin = 0;

  for (const [w, wkTasks] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const wkPhase = phaseOfWeek(semester.plan, w);
    if (!wkPhase) continue; // 该周不在学期内 —— goalToTasks 理论上已滤掉
    const mkInput = (tasks: UserTask[]) => {
      const req = toPlanRequest({
        schedule,
        weekNo: w,
        policy: wkPhase.policy,
        scenarios: profile?.scenarios ?? null,
        tasks,
      });
      // D7：swap 方案的干跑基线要把被换掉的块挖掉（construct 的排除机制）
      return excludeBlockIds?.length ? { ...req, excludedBlockIds: excludeBlockIds } : req;
    };

    const before = planWeekV2(mkInput(existing)).plan;
    const after = planWeekV2(mkInput([...existing, ...wkTasks])).plan;

    // D4：placed 改按 id 认领（候选 id 内嵌在引擎块 id 的语义键里，`w{w}-d{d}-{kind}-custom-{taskId}`）
    // —— 此前按 title 认领，同名块会误认领「别的块替它落了地」。
    for (const b of after.blocks) {
      if (b.id && candidates.some((t) => b.id.includes(t.id))) placed.push({ week: w, block: b });
    }
    studyDeltaMin += after.stats.studyMin - before.stats.studyMin;

    // D4（B③）：扫本周基线里的既有块 —— 与候选的星期×时段窗重叠的 activity/study 块
    // 就是「挡路的」。LLM 协商话术只许引用这些事实，不许硬编码「①②③」。
    for (const b of before.blocks) {
      if (b.kind !== 'activity' && b.kind !== 'study') continue;
      const hit = wkTasks.find((t) =>
        (t.dayOfWeek == null || t.dayOfWeek === b.dayOfWeek)
        && (t.notBeforeMin ?? 0) < b.endMin && b.startMin < (t.notAfterMin ?? 24 * 60));
      if (!hit) continue;
      // 批次 2：重叠分钟数 —— 反馈精简的「最相关」排序依据
      const overlapMin = Math.max(0,
        Math.min(hit.notAfterMin ?? 24 * 60, b.endMin) - Math.max(hit.notBeforeMin ?? 0, b.startMin));
      const monday = addDays(schedule.termStart, (w - 1) * 7);
      const md = addDays(monday, b.dayOfWeek - 1).slice(5).replace('-', '.');
      const info: BlockingBlockInfo = {
        title: b.title,
        hint: `${WEEKDAY_CN[b.dayOfWeek % 7]}(${md}) ${toHHmm(b.startMin)}–${toHHmm(b.endMin)}`,
        blockId: b.id,
        overlapMin,
      };
      if (!blockingAcc.some((x) => x.hint === info.hint && x.title === info.title)) blockingAcc.push(info);
    }

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
  const blockingBlocks = blockingAcc.slice(0, 5);

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
  // D4：用户是否真的给了投入量 —— 没给就别说「降一档目标量」（对「出去玩」说这话很荒谬）
  const canReduceScope = slots.durationMin != null || slots.totalHours != null || slots.perWeekCount != null;

  if (placed.length === 0) {
    return {
      ...base,
      kind: 'infeasible',
      candidateCount: candidates.length,
      added,
      studyDeltaMin,
      caveats,
      blockingBlocks,
      canReduceScope,
      reasons: ['这一周腾不出放它的地方 —— 一块都没落下去。'],
    };
  }

  if (hasError) {
    reasons.push('排进去会撞上硬冲突（重叠或转场来不及）—— 得换个时间或换个安排。');
    return { ...base, kind: 'conflict', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, blockingBlocks, canReduceScope, reasons };
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
    return { ...base, kind: 'conflict', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, blockingBlocks, canReduceScope, reasons };
  }

  if (placed.length < candidates.length) {
    // 部分落不下 —— **如实说，不掩盖**（掩盖会让用户以为全排上了）
    reasons.push(`${candidates.length} 块里有 ${candidates.length - placed.length} 块没找到位置。`);
    return { ...base, kind: 'conflict', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, blockingBlocks, canReduceScope, reasons };
  }

  if (studyDeltaMin < -60) {
    reasons.push(`会挤掉约 ${Math.abs(studyDeltaMin)} 分钟自习。`);
    return { ...base, kind: 'tight', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, blockingBlocks, canReduceScope, reasons };
  }

  if (hasWarn) {
    for (const a of added.filter((x) => x.level === 'warn').slice(0, 2)) reasons.push(a.sample);
    return { ...base, kind: 'tight', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, canReduceScope, reasons };
  }

  reasons.push('排得下，没有新增冲突。');
  // ok/tight 不带 blockingBlocks —— 排都排上了，「挡路事实」只在真排不下时才有意义
  return { ...base, kind: 'ok', candidateCount: candidates.length, placedCount: placed.length, placedAt, added, studyDeltaMin, caveats, canReduceScope, reasons };
}

/**
 * 批次 2（交互升级方案 5.4）· 类型标签：冲突反馈每条带「卡在哪一类」的标签。
 * 按语义关键词映射（issue 的中文 sample 本来就带这些词），不引入新数据依赖。
 */
export function tagLine(line: string): string {
  const body = line.replace(/^·\s*/, '');
  if (/放不下|装得下|挤掉|挤占|容量|目标量/.test(body)) return `· 📦 量放不下：${body}`;
  if (/撞|重叠|已有「/.test(body)) return `· ⏰ 时间撞：${body}`;
  if (/转场|步行|来不及/.test(body)) return `· 🚶 转场不够：${body}`;
  if (/时段|窗口|晚上|下午|早上|中午/.test(body)) return `· 🪟 时段窗卡住：${body}`;
  return line;
}

/**
 * 草稿卡的文案（**只陈述事实 + 给选项，不替用户拍板** —— core §4 的 L3/L4 边界）。
 *
 * 批次 2 反馈精简（交互升级方案 5.4）：
 *   · 总行数 ≤6 —— 口径说明合并成一行；conflict/infeasible 不再平铺落点
 *     （版面让给卡点与选项，落点在重排后的草稿卡里如实展示）；
 *   · 挡路块按与目标块的重叠时长排序取 top2，其余并入「另有 N 处时段被占」；
 *   · 每条卡点带类型标签（tagLine）。
 */
export function describeVerdict(v: GoalVerdict): string[] {
  const out: string[] = [];
  const blocked = v.kind === 'conflict' || v.kind === 'infeasible';

  // 口径说明合并成一行（默认窗口/没地点/待定/钟点歧义 共用一条）
  if (v.caveats.length > 0) out.push(`· ${v.caveats.slice(0, 3).join('；')}`);

  // 落点：排上了才谈落点（ok/tight）；blocked 的版面让给卡点与选项
  if (!blocked && v.placedAt.length > 0) {
    for (const p of v.placedAt.slice(0, 2)) out.push(`· 排到：${p}`);
    const rest = v.placedAt.length - 2;
    if (rest > 0) out.push(`· 另有 ${rest} 块排在后面的周`);
  }

  // 理由：blocked 只说最相关的一条，其余进选项的 hint
  for (const r of v.reasons.slice(0, blocked ? 1 : 2)) out.push(tagLine(`· ${r}`));

  // 挡路事实：按重叠度取 top2 + 一行汇总
  const blocks = [...(v.blockingBlocks ?? [])].sort((a, b) => (b.overlapMin ?? 0) - (a.overlapMin ?? 0));
  for (const b of blocks.slice(0, 2)) out.push(`· ⏰ 时间撞：${b.hint} 已有「${b.title}」`);
  const restBlocks = blocks.length - 2;
  if (restBlocks > 0) out.push(`· 另有 ${restBlocks} 处时段被占`);

  if (v.kind === 'needs_clarification') {
    for (const q of v.questions) out.push(`· ${q}`);
  }
  if (v.kind === 'conflict') {
    // 强化计划 D（2026-10-02）：不再硬编码「①②③」承诺 —— 真编号选项由
    // `proposeReplanOptions` 干跑产出、在 LbaoChat 侧追加；这里只给**说得出口**的
    // 方向，避免「承诺了编号、实际一个都拿不出」的脱节（真机实录）。
    out.push('· 可以说「换个时间」「缩短或拆分」，或者告诉我愿意让出哪一块 —— 我来改。');
  }
  if (v.kind === 'infeasible') {
    // D4：去硬编码 —— 有挡路事实时给「顶掉其中一块」的方向；
    // 用户根本没给投入量时，不说「降一档目标量」（对「出去玩」说这话很荒谬）。
    if (v.blockingBlocks?.length) {
      out.push('· 可以：① 用新安排顶掉其中一块（说「把X替换掉」就行）；② 换个日子或下一周；③ 换个时间段。你说哪个，我来改。');
    } else if (v.canReduceScope) {
      out.push('· 可以：① 挪到下一周；② 降一档目标量；③ 先告诉我你愿意让出哪一块。');
    } else {
      out.push('· 可以：① 挪到下一周；② 换个时间段；③ 先告诉我你愿意让出哪一块。');
    }
  }
  return out;
}

/**
 * 批次 3（交互升级方案 6.2）· 本周类目分钟统计。
 * 照 `summarizeWeekPlan` 的读侧范式：不改锁死的 types.ts、不给 TimeBlock 加字段
 * —— 分类只是读侧视图（kind + title 关键词 → taxonomy）。
 */
export function categoryMinutesOfWeek(plan: WeekPlan, cat: GoalCategory): number {
  let total = 0;
  for (const b of plan.blocks) {
    if (b.kind !== 'activity' && b.kind !== 'study') continue;
    if (classifyGoal(b.title) === cat) total += b.endMin - b.startMin;
  }
  return total;
}

/* ============================================================
 * 批次 2（交互升级方案 5.1-5.3）· 快捷选项（能按钮不打字）
 * ============================================================
 * 每个追问都配 2-4 个快捷项 + 永远保留自由输入（「其他」路径 = 输入框本体）。
 * **value 必须是规则层解析得动的原话** —— 按钮点击 = send(value)，
 * 走既有解析与编号兜底，双保险；这里用测试锁死「value 可解析」的互通性。
 */
export interface QuickOption {
  /** 按钮上的人话 */
  label: string;
  /** 点击后作为用户消息发出的文本（必须可被 parseIntentSlots / parseOptionChoice 解析） */
  value: string;
  /** 次行小字（干跑事实 / 依据），可缺省 */
  hint?: string;
}

/**
 * 追问快捷项生成器（纯函数）。
 * · when：按今天日期给「还没过去的」说法 —— 周日不推「这周六」；
 * · effort：单日事件给单次时长档位，长期诉求给频率档位（口径见 5.3）；
 * · place：高频校园点（value 带「在」以喂 extractPlace）。
 * 批次 3 叠加类目/依据后在此扩 hint。
 */
export function quickOptionsFor(
  slot: SlotKey | 'place',
  slots: IntentSlots,
  opts?: { today?: string; plan?: WeekPlan | null; exercisePerWeek?: number },
): QuickOption[] {
  switch (slot) {
    case 'when': {
      const out: QuickOption[] = [
        { label: '今天晚上', value: '今天晚上' },
        { label: '明天下午', value: '明天下午' },
        { label: '明天晚上', value: '明天晚上' },
      ];
      // weekdayOf：0=周日。周六已过（周日）→ 推下周六
      const dow = opts?.today ? weekdayOf(opts.today) : undefined;
      out.push(dow != null && dow >= 1 && dow <= 6
        ? { label: '这周六晚上', value: '这周六晚上' }
        : { label: '下周六晚上', value: '下周六晚上' });
      return out;
    }
    case 'effort': {
      // 批次 3（6.3/6.4）：按钮卡次行小字 = 时长概念锚（tips 轮换）；
      // 推荐档（第二项）的次行给**带来源的依据行**（健康库/方法库 + 本周已排量）。
      const cat = classifyGoal(slots.title);
      const tips = cat === 'generic' ? TAXONOMY_TIPS_FALLBACK : null;
      const catTips = tips ?? TAXONOMY_TIPS(cat);
      const evidence = evidenceLine(cat, {
        ...(opts?.plan ? { weekMinutes: categoryMinutesOfWeek(opts.plan, cat) } : {}),
        ...(opts?.exercisePerWeek != null ? { exercisePerWeek: opts.exercisePerWeek } : {}),
      });
      if (isSingleDayEvent(slots)) {
        const items = [
          { label: '45 分钟', value: '45分钟' },
          { label: '60 分钟', value: '60分钟' },
          { label: '90 分钟', value: '90分钟' },
          { label: '2 小时', value: '2小时' },
        ];
        return items.map((it, i) => ({
          ...it,
          hint: i === 1 && evidence ? evidence : catTips[i % catTips.length],
        }));
      }
      const items = [
        { label: '每周 1-2 次', value: '每周2次' },
        { label: '每周 3-4 次', value: '每周4次' },
        { label: '每天 30 分钟', value: '每天都来，每次30分钟' },
      ];
      return items.map((it, i) => ({
        ...it,
        hint: i === 0 && evidence ? evidence : catTips[i % catTips.length],
      }));
    }
    case 'place':
      return [
        { label: '图书馆', value: '在图书馆' },
        { label: '操场', value: '在操场' },
        { label: '体育馆', value: '在体育馆' },
        { label: '空教室', value: '在空教室' },
      ];
    default:
      return [];
  }
}

import { TAXONOMY } from './taxonomy';
const TAXONOMY_TIPS = (cat: GoalCategory): string[] => TAXONOMY[cat].tips;
const TAXONOMY_TIPS_FALLBACK: string[] = ['说个大概时长就行，我按你的日历找空档'];

/** blocked 编号方案 → 按钮卡。value 用「方案N」—— parseOptionChoice 确定性接住，
 *  不经 LLM（强化计划 D 的兜底通道原样复用）。 */
export function replanOptionButtons(options: ReadonlyArray<{ label: string }>): QuickOption[] {
  return options.map((o, i) => ({ label: o.label, value: `方案${i + 1}`, hint: '引擎干跑过，真排得上' }));
}

/* ============================================================
 * D7：replan 协商方案（每个方案都过一次引擎干跑，可行的才呈现）
 * ============================================================
 * blocked 时的三个方向（工作单 §9）：① 与挡路块互换（replace 语义，干跑时把它
 * 从基线挖掉）② 顺延一周 ③ 降单次时长。**每个方案必须过引擎干跑**——
 * 排得上的才作为编号选项呈现；LLM 只负责转述与引用（replan_id），禁止编「排好了」。
 * 只提议不落盘：用户选中后仍走 runGoalSlots → 草稿卡 → 确认（L4 边界不变）。
 */
export interface ReplanOption {
  /** 稳定 id（swap:<blockId> / move_next_week / reduce_duration），LLM 引用凭据 */
  id: string;
  /** 编号选项的人类可读文案 */
  label: string;
  /** 选中后直接走 runGoalSlots 的调整槽位 */
  slots: IntentSlots;
}

export function proposeReplanOptions(args: {
  slots: IntentSlots;
  verdict: GoalVerdict;
  schedule: Schedule | null;
  profile: PersonaProfile | null;
  /** D7：协商基线的既有任务（与干跑同源，否则挡路事实对不上） */
  tasks?: UserTask[];
  today: string;
}): ReplanOption[] {
  const { slots, verdict, schedule, profile, today, tasks } = args;
  if (!schedule?.termStart) return [];
  // RV 锚点：ok/tight 的 verdict 没有协商的必要
  if (verdict.kind === 'ok' || verdict.kind === 'tight' || verdict.kind === 'needs_clarification') return [];

  const feasible = (s: IntentSlots, excludeBlockIds?: string[]): boolean => {
    const v = checkGoalFeasibility({
      slots: { ...s, missing: [] }, schedule, profile, today,
      ...(tasks?.length ? { tasks } : {}),
      ...(excludeBlockIds?.length ? { excludeBlockIds } : {}),
    });
    return v.kind === 'ok' || v.kind === 'tight';
  };

  const options: ReplanOption[] = [];

  // ① 与挡路块互换：干跑把该块从基线挖掉 —— 「换掉它」的语义在引擎层面成立
  for (const b of (verdict.blockingBlocks ?? []).slice(0, 2)) {
    if (!b.blockId) continue;
    const s: IntentSlots = { ...slots, intent: 'replace', targetHint: b.title, missing: [] };
    if (feasible(s, [b.blockId])) {
      options.push({ id: `swap:${b.blockId}`, label: `用「${slots.title}」换掉 ${b.hint} 的「${b.title}」`, slots: s });
    }
  }

  // ② 顺延一周
  if (slots.dateFrom) {
    const s: IntentSlots = {
      ...slots,
      dateFrom: addDays(slots.dateFrom, 7),
      ...(slots.dateTo ? { dateTo: addDays(slots.dateTo, 7) } : {}),
      missing: [],
    };
    if (feasible(s)) options.push({ id: 'move_next_week', label: `挪到下一周（${s.dateFrom} 起）`, slots: s });
  }

  // ③ 降单次时长（≥30 分钟下限）
  if (slots.durationMin != null && slots.durationMin > 30) {
    const s: IntentSlots = { ...slots, durationMin: Math.max(30, Math.floor(slots.durationMin / 2)), missing: [] };
    if (feasible(s)) options.push({ id: 'reduce_duration', label: `单次降到 ${s.durationMin} 分钟`, slots: s });
  }

  // ④ 降一档目标量（总量型诉求，强化计划 D 2026-10-02）：此前 ③ 只认 durationMin，
  // 纯总量诉求（「一共10小时」但窗口只装得下 1.5 小时）在 blocked 态一个编号方案
  // 都拿不到，而 verdict 文案仍承诺「回①②③」—— 承诺与能力脱节（真机实录）。
  if (slots.totalHours != null && slots.totalHours > 0 && verdict.candidateCount > 0) {
    const capacityHours = Math.round(((verdict.candidateCount * (slots.durationMin ?? DEFAULT_BLOCK_MIN)) / 60) * 2) / 2;
    if (capacityHours > 0 && capacityHours < slots.totalHours) {
      const s: IntentSlots = { ...slots, totalHours: capacityHours, missing: [] };
      if (feasible(s)) {
        options.push({ id: 'reduce_total', label: `降一档目标量：先排这个窗口装得下的约 ${capacityHours} 小时`, slots: s });
      }
    }
  }

  // ⑤ 换空档（批次 3 · 6.5）：从明天起扫 14 天，把窗口收成单日干跑 ——
  // 真排得上的前 2 天各出一条，label 直接用干跑落点（改到周X HH:MM–HH:MM）。
  // **每个候选都过干跑闸**：排不上的日子一个都不许出现（不编「排好了」）。
  if (slots.dateFrom) {
    const moveOptions: ReplanOption[] = [];
    for (let off = 1; off <= 14 && moveOptions.length < 2; off++) {
      const day = addDays(slots.dateFrom, off);
      // 「换个日子」= 放开星期钉（when.weekday/recurring），时段窗/钟点照旧收窄 ——
      // 否则候选日永远撞同一根钉（探针实录：周一晚上被占，扫 14 天全是周一）。
      const s: IntentSlots = { ...slots, when: undefined, dateFrom: day, dateTo: day, missing: [] };
      if (!feasible(s)) continue;
      const v = checkGoalFeasibility({
        slots: { ...s, missing: [] }, schedule, profile, today,
        ...(tasks?.length ? { tasks } : {}),
      });
      const at = v.placedAt[0] ?? '';
      const dowCn = WEEKDAY_CN[isoToDayOfWeek(day) % 7];
      moveOptions.push({
        id: `move_to:${day}`,
        label: `改到${dowCn}${at ? ` ${at.split(' ').slice(1).join(' ')}` : ''}`.trim(),
        slots: s,
      });
    }
    options.push(...moveOptions);
  }

  // ⑥ 拆分（批次 3 · 6.5）：单次减半 + 频率翻倍（纯总量诉求则只减单次 ——
  // goalToTasks 会按更短的块长摊出更多块）。单次 <60 分钟没有拆的意义；
  // 单日事件没法「分两天」；循环约定（每周一）随翻倍放开星期钉。
  if (slots.durationMin != null && slots.durationMin >= 60 && !isSingleDayEvent(slots)) {
    const half = Math.max(30, Math.floor(slots.durationMin / 2));
    const s: IntentSlots = {
      ...slots,
      durationMin: half,
      ...(slots.perWeekCount != null ? { perWeekCount: Math.min(14, slots.perWeekCount * 2) } : {}),
      ...(slots.when?.recurring ? { when: undefined } : {}),
      missing: [],
    };
    if (feasible(s)) {
      const per = slots.perWeekCount != null ? `× 每次 ${half} 分钟` : '';
      options.push({ id: 'split', label: `拆成两天排${per}`, slots: s });
    }
  }

  return options.slice(0, 4);
}

/* ============================================================
 * WP9：改排程执行器（cancel / reschedule / replace）
 * ============================================================
 * 放在防腐层（libao↔planner 唯一接缝）而不是 LbaoChat：
 *  · 匹配/落层全是纯函数，node --test 可直测；
 *  · LbaoChat 只负责「说话与确认」，不碰层结构。
 *
 * 目标匹配口径（WP9）：**模糊但可解释** —— 归一空白后互相包含即命中；
 * 先 user 待办（removeTask 通道），再引擎块（excluded 通道，只认
 * activity/study —— 课程不取消不拖拽，改课走调课）。
 * 找不到 / 命中多个 → 返回原样由调用方**追问**，绝不硬猜（core §4）。
 */
import { addSlot, excludeBlock, makeLayerId, removeTask, upsertMove, type MoveRecord, type UnavailableSlot, type UserPlanLayer } from '@/features/week/userPlanStore';
import { dragTo } from '@/lib/planner/ripple';

export type DraftKind = 'create' | 'reschedule' | 'cancel' | 'replace' | 'query';

export interface CancelTarget {
  taskId?: string;   // user 层任务 id（layer.tasks）
  blockId?: string;  // 引擎块 id（layer.excluded 通道）
  title: string;
  origin: 'user' | 'plan';
  hint: string;      // 给用户看的位置线索
}

const normTitle = (s: string): string => (s || '').replace(/\s+/g, '');

const dowOfISO = (iso: string): number => {
  const wd = weekdayOf(iso);
  return wd === 0 ? 7 : wd;
};

export function findCancelTargets(
  query: string,
  userTasks: readonly UserTask[],
  planBlocks: readonly TimeBlock[],
  /**
   * D3（B②）：给了学期锚点就把 hint 升级成「周X(M.D) HH:MM–HH:MM」。
   * 候选带日期，LLM/规则才有依据消歧「明天的那个」这类指代 ——
   * 此前 hint 只有「周X HH:MM」，「明天」结构上不可命中，只能反复追问。
   */
  weekInfo?: { termStart: string; weekNo: number },
): CancelTarget[] {
  const needle = normTitle(query);
  if (!needle) return [];
  const md = (dow: number): string | null => {
    if (!weekInfo) return null;
    const monday = addDays(weekInfo.termStart, (weekInfo.weekNo - 1) * 7);
    return addDays(monday, dow - 1).slice(5).replace('-', '.');
  };
  const out: CancelTarget[] = [];
  for (const t of userTasks) {
    const title = normTitle(t.title);
    if (title.includes(needle) || needle.includes(title)) {
      const d = t.dayOfWeek ? md(t.dayOfWeek) : null;
      out.push({
        taskId: t.id,
        title: t.title,
        origin: 'user',
        // D3：WEEKDAY_CN 自带「周」前缀（且不再走 dayOfWeek-1 的错位下标）
        hint: `${t.dayOfWeek ? `${WEEKDAY_CN[t.dayOfWeek % 7]}${d ? `(${d})` : ''}` : '不限天'} · ${t.durationMin ?? '?'} 分钟`,
      });
    }
  }
  for (const b of planBlocks) {
    if (b.kind !== 'activity' && b.kind !== 'study') continue; // 课程不在此通道
    // D3：同一任务会同时出现在 layer.tasks 与引擎 plan（用户任务渲染成块）——
    // 不去重的话，取消/替换任何固定用户任务都会得到「两个候选」，被迫挑块。
    if (b.id.includes('-user-') && out.some((c) => c.taskId && b.id.endsWith(`-user-${c.taskId}`))) continue;
    const title = normTitle(b.title);
    if (title.includes(needle) || needle.includes(title)) {
      const d = md(b.dayOfWeek);
      out.push({
        blockId: b.id,
        title: b.title,
        origin: 'plan',
        hint: `${WEEKDAY_CN[b.dayOfWeek % 7]}${d ? `(${d})` : ''} ${toHHmm(b.startMin)}–${toHHmm(b.endMin)}`,
      });
    }
  }
  return out;
}

/** 取消落层：user → removeTask；引擎块 → excluded（重排后也不回来）。纯函数。 */
export function applyCancel(layer: UserPlanLayer, target: CancelTarget): UserPlanLayer {
  if (target.origin === 'user' && target.taskId) {
    return { ...layer, tasks: removeTask(layer.tasks, target.taskId) };
  }
  if (target.origin === 'plan' && target.blockId) {
    return { ...layer, excluded: excludeBlock(layer.excluded, target.blockId) };
  }
  return layer;
}

/** reschedule 候选：非课程块、标题互相包含。返回块本体（调用方做 dragTo）。 */
export function findMoveTargets(query: string, planBlocks: readonly TimeBlock[]): TimeBlock[] {
  const needle = normTitle(query);
  if (!needle) return [];
  return planBlocks
    .filter((b) => b.kind !== 'course' && b.source !== 'course')
    .filter((b) => {
      const title = normTitle(b.title);
      return title.includes(needle) || needle.includes(title);
    })
    .sort((a, b) => (a.dayOfWeek - b.dayOfWeek) || (a.startMin - b.startMin));
}

export interface ReschedulePreview {
  ok: boolean;
  reason?: string;
  /** 确认后 upsertMove 落层的记录（source='drag'，用户明确表达） */
  move?: MoveRecord;
  /** 「挪后涟漪」：哪些块被顺延（草稿卡预览用） */
  displaced: Array<{ title: string; day: number; start: string; end: string }>;
}

/**
 * 预览一次改期：走 ripple.dragTo 同一条纯函数（合规校验继承拖拽），
 * ok 时给出确认后要落层的 move 与被顺延清单；不 ok 给人话原因。
 */
export function planReschedule(
  blocks: readonly TimeBlock[],
  blockId: string,
  weekNo: number,
  newDay: number,
  startMin: number,
): ReschedulePreview {
  const res = dragTo(blocks, blockId, newDay, startMin, { dayStartMin: 7 * 60, dayEndMin: 23 * 60 });
  const drag = res.records.find((r) => r.source === 'drag');
  if (!res.ok || !drag) {
    return { ok: false, reason: res.reason ?? '挪不过去', displaced: [] };
  }
  const src = blocks.find((b) => b.id === blockId);
  return {
    ok: true,
    move: {
      weekNo,
      blockId,
      dayOfWeek: newDay,
      startMin: drag.startMin,
      endMin: drag.endMin,
      place: src?.place,
      room: src?.room,
      source: 'drag',
    },
    displaced: res.records
      .filter((r) => r.source === 'ripple')
      .map((r) => {
        const b = blocks.find((x) => x.id === r.blockId);
        return { title: b?.title ?? r.blockId, day: r.dayOfWeek, start: toHHmm(r.startMin), end: toHHmm(r.endMin) };
      }),
  };
}

/* ============================================================
 * H2：模式问询窗口的干跑模型（ModeSetupDialog 消费）
 * ============================================================
 * construct 是同步纯函数 → 六模式「点选即预览」毫秒级；
 * 干跑抛错返回 { error }，调用方降级，不白屏。
 * 落在防腐层（而非 modeSetup.ts）：construct/lifeModeExtrasOf 属 lib/planner，
 * libao 侧只有本文件这一个接缝（AGENTS §三红线 6）。
 */
import { construct } from '@/lib/planner/construct';
import { lifeModeExtrasOf } from '@/lib/planner/lifeModePolicy';

export interface ModePreviewStats {
  studyHours: number;
  blankHours: number;
  sportCount: number;
  extraMealCount: number;
}

export type ModePreviewResult =
  | { mode: string; plan: WeekPlan; stats: ModePreviewStats }
  | { mode: string; error: string };

/** 模式干跑的基准请求：与 planWeekWithTasks 同一套 policy 来源（buildPhases 校历链） */
export function modeSetupRequest(
  schedule: Schedule,
  profile: PersonaProfile | null,
  weekNo: number,
): PlanRequest | null {
  const semester = buildPhasesFromCalendar(schedule, profile, calendarOf(schedule));
  const phase = phaseOfWeek(semester.plan, weekNo);
  if (!phase) return null;
  return toPlanRequest({
    schedule,
    weekNo,
    policy: phase.policy,
    scenarios: profile?.scenarios ?? null,
    tasks: [],
  });
}

/** 六模式干跑：复制 req + 注入 lifeModeExtras → construct 同步出预览与三个人话统计 */
export function modePreview(req: PlanRequest, modeId: string): ModePreviewResult {
  try {
    const extras = lifeModeExtrasOf(modeId);
    const withExtras: PlanRequest = extras ? { ...req, lifeModeExtras: extras } : req;
    const { plan } = construct(withExtras);
    const minutesOf = (pred: (b: TimeBlock) => boolean) =>
      plan.blocks.filter(pred).reduce((n, b) => n + (b.endMin - b.startMin), 0);
    const round1 = (min: number) => Math.round((min / 60) * 10) / 10;
    return {
      mode: modeId,
      plan,
      stats: {
        studyHours: round1(minutesOf((b) => b.kind === 'study')),
        blankHours: round1(minutesOf((b) => b.kind === 'blank')),
        // 模板 id 形如 sport-field / sport-gym（语义键见 construct.placeTemplate）
        sportCount: plan.blocks.filter((b) => /sport/.test(b.id)).length,
        extraMealCount: plan.blocks.filter((b) => /meal-(tea|night-snack)/.test(b.id)).length,
      },
    };
  } catch (e) {
    return { mode: modeId, error: e instanceof Error ? e.message : '这个模式排不出来，换一个试试' };
  }
}


/* ============================================================
 * V2-1：多目标挑块 —— 候选匹配（LbaoChat clarify 接续消费）
 * ============================================================ */
/** 用户回复 → 命中的候选（归一后互相包含）。可能 0/1/N 个：调用方按数分发，不硬猜。 */
export function matchCandidate(reply: string, candidates: readonly CancelTarget[]): CancelTarget[] {
  const needle = normTitle(reply);
  if (!needle) return [];
  return candidates.filter((c) => {
    const t = normTitle(c.title);
    return t.includes(needle) || needle.includes(t);
  });
}

/* ============================================================
 * V2-2：「这段时间别排」（hold）执行器
 * ------------------------------------------------------------
 * 与调课的边界：hold =「这段时间不可用」（写 layer.slots，引擎重排时让位、
 * 拖拽合规闸同源拒收）；调课 =「某节课时间变了」（CourseOverrideEditor，覆盖层）。
 * 两者语义不同，入口也不同 —— 别混。
 */
export interface HoldSlotDraft {
  day: number;
  fromMin: number;
  toMin: number;
}

/** hold 槽位 → 时段草稿：要天（weekday/日期），窗缺省整天（07:00–23:00）；没有天 = 追问 */
export function holdSlotFrom(slots: IntentSlots): HoldSlotDraft | { need: 'time' } {
  const day = slots.when?.weekday
    ?? (slots.dateFrom ? (() => { const wd = weekdayOf(slots.dateFrom); return wd === 0 ? 7 : wd; })() : undefined);
  if (day == null) return { need: 'time' };
  return { day, fromMin: slots.window?.fromMin ?? 7 * 60, toMin: slots.window?.toMin ?? 23 * 60 };
}

/** 时段草稿 → UnavailableSlot（一次性，只作用于当前周；引擎与拖拽闸同源消费） */
export function holdToUnavailableSlot(d: HoldSlotDraft, weekNo: number, title?: string): UnavailableSlot {
  return {
    id: makeLayerId('hold'),
    days: [d.day],
    fromMin: d.fromMin,
    toMin: d.toMin,
    weeks: [weekNo],
    scope: 'once',
    createdAtWeek: weekNo,
    ...(title ? { title } : {}),
  };
}
