/**
 * 目标分解算法（v1 基础 + v2 槽位扩展 · 2026-09-27）
 * ============================================================
 * v1（§6.8）：总量按 pace 曲线切周预算 → 平均摊到有空的天。
 * v2（§5.5/§14/§16）：里程碑切段 → 槽位分配（打底/主线/收口）→ 执行率校准。
 *
 * ── 硬不变量（§9 S5.5）───────────────────────────────────────
 *   `milestones` 为空 / 无 dueAt / 无 totalHours → **与 v1 输出逐点一致**。
 *   v2 只在 milestone 存在时走新路径。
 *
 * ── v2 的槽位（§6.10.1）─────────────────────────────────────
 *   打底 → fragment（15–25 分，可插空隙）
 *   主线 → deep（90 分，整块不可打断，essential: true）
 *   收口 → sprint（30–45 分，锚定主线那天）
 */
import type { UserTask } from '@/lib/planner/templates';
import { currentWeekNo } from '@/lib/date';
import type { Goal, GoalKind } from './goalStore';
import { PARALLEL_DISCOUNT, type GoalPrefs } from './goalPrefs.ts';
import { resolveSkeleton } from './resolveSkeleton';
import type { ResolvedSlot } from './resolveSkeleton';

/** 一天的可排区间（与引擎口径一致） */
const DAY_SPAN_MIN = 16 * 60;
const MIN_BLOCK = 25;
const MAX_BLOCK = 120;
const CAP_RATIO = 0.6; // 目标类任务占本周自由容量的上限

export interface DecomposeWarning {
  goalId: string;
  title: string;
  message: string;
}

export interface DecomposeOutput {
  tasks: UserTask[];
  warnings: DecomposeWarning[];
}

/** 目标 kind → 块 kind（重启补课等模块复用；单一真源在此） */
export const KIND_TO_BLOCK: Record<GoalKind, 'study' | 'activity'> = {
  contest: 'study', study: 'study', interest: 'activity', habit: 'activity',
};

/** 类型级经验值（小时）—— GoalEditor 的建议值兜底；具体目标模板由上层提供 */
export const EXPERIENCE_HOURS: Record<GoalKind, number> = {
  contest: 60, study: 40, interest: 20, habit: 30,
};

/** pace 权重曲线：j=0 为本周，j=W-1 为截止周；返回各周权重 */
export function paceWeights(pace: Goal['pace'], W: number): number[] {
  if (W <= 0) return [];
  if (pace === 'sprint') return Array.from({ length: W }, (_, j) => Math.pow(1.6, j));
  if (pace === 'both') {
    return Array.from({ length: W }, (_, j) => 1 + (j >= W - 3 ? Math.pow(1.5, j - (W - 3) + 1) - 1 : 0));
  }
  return Array(W).fill(1); // steady / 未选
}

function snap5(min: number): number {
  return Math.round(min / 5) * 5;
}

/** 单目标分解：产出本周的任务块（每天 ≤1 块，落在有空天里课程最少的日子）
 *
 * `budgetOverrideMin`（2026-09-28 注水法）：调用方（goalTasksOf）公平分配后的
 * 周预算。给了就**整体替换**本函数自算的预算 —— 单目标不传时行为与旧版逐点一致。
 */
export function decomposeGoal(
  goal: Goal,
  weekNo: number,
  termStart: string,
  prefs: GoalPrefs,
  courseMinByDay?: Record<number, number>,
  budgetOverrideMin?: number,
  /** 其它长目标已占用的天（分钟）—— 分布时避开，防止多目标挤同几天（2026-10-07） */
  goalLoadByDay?: Record<number, number>,
): { tasks: UserTask[]; warning: DecomposeWarning | null } {
  const blockKind = KIND_TO_BLOCK[goal.kind];
  if (!goal.dueAt || !goal.totalHours) {
    // 无截止/无总量 → 不猜分解参数：维持旧行为（每周 60 分钟，仅 steady/未选节奏）
    if (goal.pace === 'sprint') return { tasks: [], warning: null };
    return {
      tasks: [{
        id: `goal-${goal.id}-w${weekNo}`,
        title: goal.title,
        emoji: goal.emoji,
        kind: blockKind,
        category: 'custom',
        weeks: [weekNo],
        durationMin: 60,
        priority: 70,
        note: '你的目标 · 每周固定投入（补全截止日期与总时长后可按节奏分解）',
      }],
      warning: null,
    };
  }

  const dueWeek = currentWeekNo(termStart, goal.dueAt);
  const weeksLeft = dueWeek - weekNo;
  if (weeksLeft < 0) return { tasks: [], warning: null }; // 已过期，不排

  const W = weeksLeft + 1; // 含本周
  const weights = paceWeights(goal.pace, W);
  const discount = PARALLEL_DISCOUNT[prefs.parallelCount] ?? 1;
  const budgetMin = budgetOverrideMin
    ?? (goal.totalHours * 60) * (weights[0] / weights.reduce((a, b) => a + b, 0)) * discount;

  // 分布：有空天按「课程量升序」排 —— 避开课程密日。
  // 🔴 天数 = 按单块硬顶（120 分钟）算出的**最少**天数（2026-10-07 RAY 实测
  //   「长目标把空闲排满」）：旧实现 days.map 给每个有空天都排一块（600 ÷ 7 =
  //   天天 85 分钟）—— 视觉上就是「空闲全被吃掉」。现在**大块少天**：
  //   600 分钟 → 5 天 × 120（周末留白）；300 分钟 → 3 天 × 100；
  //   225 分钟 → 2 天 × ~115。宁可块大一点，也不为平摊而天天见。
  const freeDays = [...prefs.freeDays].sort(
    (a, b) => ((courseMinByDay?.[a] ?? 0) + (goalLoadByDay?.[a] ?? 0))
      - ((courseMinByDay?.[b] ?? 0) + (goalLoadByDay?.[b] ?? 0)),
  );
  const days = freeDays.length > 0 ? freeDays : [1, 2, 3, 4, 5];
  const usedDays = Math.max(1, Math.min(days.length, Math.ceil(budgetMin / MAX_BLOCK)));
  const perBlock = Math.max(MIN_BLOCK, Math.min(MAX_BLOCK, snap5(budgetMin / usedDays)));

  const tasks: UserTask[] = days.slice(0, usedDays).map((dow) => ({
    id: `goal-${goal.id}-w${weekNo}-d${dow}`,
    title: goal.title,
    emoji: goal.emoji,
    kind: blockKind,
    category: 'custom',
    weeks: [weekNo],
    durationMin: perBlock,
    priority: 70,
    note: `你的目标 · 本周预算 ${Math.round(budgetMin)} 分钟（${usedDays} 天 × ${perBlock} 分钟）`,
  }));

  // 容量守卫：超 60% 不静默砍 —— 产出预警交上层展示（三选项由用户选）
  let warning: DecomposeWarning | null = null;
  if (courseMinByDay && budgetMin > 0) {
    const freeMinutes = DAY_SPAN_MIN * 7 - Object.values(courseMinByDay).reduce((a, b) => a + b, 0);
    if (budgetMin > freeMinutes * CAP_RATIO) {
      warning = {
        goalId: goal.id,
        title: goal.title,
        message: `「${goal.title}」本周需要约 ${Math.round(budgetMin)} 分钟，超过自由时间的 60% —— 建议三选一：延长截止日期 / 切为冲刺节奏 / 减少总时长`,
      };
    }
  }

  return { tasks, warning };
}

/**
 * 全部目标 → 本周任务（WeekPlanView 的接入点）。
 * warnings 由调用方展示（面板/提示条），**不静默丢弃**。
 *
 * 分配算法（2026-09-28）：先算每个目标的「本周需求」（weeklyDemandMin），
 * 再按 study / activity 两类分别做**加权注水法**分配类别上限 ——
 * 替换掉旧的「按目标顺序先到先得吃 cap」（那是任意的：换个顺序结果就变，
 * 需求小的目标会被挤到 0）。cap 循环保留作最后一道网（块长 clamp 可能
 * 让任务合计略微超过分配额，此时仍是"超出部分剔除 + 预警"）。
 */
export function goalTasksOf(
  goals: readonly Goal[],
  weekNo: number,
  termStart: string,
  prefs: GoalPrefs,
  courseMinByDay?: Record<number, number>,
  freeMinutes?: number,
  /** 🆕 S5.5：执行率校准（0.5–1.2）；null = 无数据 → 不校准 */
  adherence?: number | null,
  /** 🆕 S5.5：画像（让 ACH/PLAN 影响目标分解） */
  persona?: import('@/types').PersonaProfile | null,
): DecomposeOutput {
  const tasks: UserTask[] = [];
  const warnings: DecomposeWarning[] = [];

  // G3 精力预算表：按 kind 归类累计周预算，超 cap 的部分剔除并预警
  const caps: Record<'study' | 'activity', number> = {
    study: prefs.weeklyCaps.studyMin,
    activity: prefs.weeklyCaps.activityMin,
  };
  const used: Record<'study' | 'activity', number> = { study: 0, activity: 0 };

  // ── 第一遍：算需求与权重 ──
  const rawInfos = goals.map((goal) => ({
    goal,
    demand: weeklyDemandMin(goal, weekNo, termStart, prefs, adherence, persona),
    capKind: blockKindOf(goal.kind),
  }));

  // ── 软上限（长计划增强计划书 §1.3，RAY 拍板「软上限+降权」）──
  // 活跃目标超过 5 个 → 排序键（截止临近度 desc, 优先级 desc, id 稳定序）
  // 第 6 名起需求按 50% 计入注水。**不拦截建目标**，只降权 + 明说（诚实纪律）。
  const SOFT_GOAL_LIMIT = 5;
  const overLimit = new Set<string>();
  if (goals.length > SOFT_GOAL_LIMIT) {
    const ranked = [...rawInfos]
      .filter((x) => x.demand != null)
      .sort((a, b) =>
        deadlineProximity(b.goal, weekNo, termStart) - deadlineProximity(a.goal, weekNo, termStart)
        || (b.goal.priority ?? 3) - (a.goal.priority ?? 3)
        || a.goal.id.localeCompare(b.goal.id));
    for (const x of ranked.slice(SOFT_GOAL_LIMIT)) overLimit.add(x.goal.id);
    warnings.push({
      goalId: 'soft-limit',
      title: '目标过多',
      message: `活跃目标 ${goals.length} 个，超过 ${SOFT_GOAL_LIMIT} 个：本周优先临近截止 / 高优先级的前 ${SOFT_GOAL_LIMIT} 个，其余目标的需求按 50% 计入分配 —— 建议结转或归档部分目标`,
    });
  }
  const infos = rawInfos.map((x) => ({
    ...x,
    demand: x.demand != null && overLimit.has(x.goal.id) ? Math.round(x.demand * 0.5) : x.demand,
  }));

  // ── 第二遍：按类别注水（加权最大最小公平）──
  const alloc = new Map<string, number>();
  for (const kind of ['study', 'activity'] as const) {
    const group = infos.filter((x) => x.capKind === kind && x.demand != null);
    if (group.length === 0) continue;
    const allocs = waterFillAlloc(
      group.map((x) => x.demand as number),
      group.map((x) => priorityWeight(x.goal)),
      caps[kind],
    );
    group.forEach((x, i) => alloc.set(x.goal.id, Math.max(0, Math.round(allocs[i]))));
  }

  // ── 第三遍：按分配额分解 + cap 兜底 + 预警 ──
  // 🔴 分解顺序 = 优先级 desc（2026-10-07）：高优先目标先挑天（goalLoadByDay 累计），
  //   低优先目标自动避开已被占的天 —— 否则两目标挑到同几天 → 同日超容量 →
  //   低优先的块在放置层被静默挤掉（RAY 实测「只排最优先的目标」）。
  const goalLoadByDay: Record<number, number> = {};
  const orderedInfos = [...infos].sort((a, b) =>
    (b.goal.priority ?? 3) - (a.goal.priority ?? 3)
    || deadlineProximity(b.goal, weekNo, termStart) - deadlineProximity(a.goal, weekNo, termStart)
    || a.goal.id.localeCompare(b.goal.id));
  for (const { goal, demand } of orderedInfos) {
    const r = decomposeGoalV2(goal, weekNo, termStart, prefs, courseMinByDay, adherence, persona, alloc.get(goal.id), goalLoadByDay);
    const capKind = blockKindOf(goal.kind);
    let kept = 0;
    let droppedMin = 0;
    for (const t of r.tasks) {
      const dur = t.durationMin ?? 0;
      // 分布天占用登记（v1 任务 id 带 -d{dow}）—— 供后续目标避开
      const m = /-d(\d+)$/.exec(t.id);
      if (m) goalLoadByDay[Number(m[1])] = (goalLoadByDay[Number(m[1])] ?? 0) + dur;
      if (used[capKind] + dur <= caps[capKind]) {
        used[capKind] += dur;
        tasks.push(t);
        kept += 1;
      } else {
        droppedMin += dur;
      }
    }
    if (kept === 0 && r.tasks.length > 0) {
      warnings.push({
        goalId: goal.id,
        title: goal.title,
        message: `「${goal.title}」未排入：本周${capKind === 'study' ? '学习' : '兴趣'}预算（${caps[capKind]} 分钟）已被其他目标用满 —— 可在偏好中上调上限`,
      });
    } else if (droppedMin > 0) {
      warnings.push({
        goalId: goal.id,
        title: goal.title,
        message: `「${goal.title}」有 ${droppedMin} 分钟超出本周${capKind === 'study' ? '学习' : '兴趣'}预算（${caps[capKind]} 分钟）未排入 —— 可上调上限`,
      });
    }
    // 注水分配不足必须说出来（对齐 roll.ts「降档必须说出来」纪律）
    const a = alloc.get(goal.id);
    if (demand != null && a != null && a < demand - 4) {
      warnings.push({
        goalId: goal.id,
        title: goal.title,
        message: `「${goal.title}」本周需求约 ${Math.round(demand)} 分钟，按优先级公平分配后只能排 ${a} 分钟（类别上限 ${caps[capKind]} 分钟由各目标分摊）—— 可提高优先级或上调上限`,
      });
    }
    if (r.warning) warnings.push(r.warning);
  }
  void freeMinutes; // 预留：全目标合计守卫（当前按单目标判定 + 类预算判定）
  return { tasks, warnings };
}

function blockKindOf(kind: GoalKind): 'study' | 'activity' {
  return kind === 'contest' || kind === 'study' ? 'study' : 'activity';
}

/* ============================================================
 * S5.5（2026-09-27）：分解算法 v2 —— 里程碑切段 + 槽位生成
 * ==========================================================
 * 硬不变量：milestones 为空 / 无 dueAt / 无 totalHours → **走 v1 路径，逐点一致**。
 * v2 新增：按里程碑切段 → 槽位分配（resolveSkeleton）→ adherence 校准。
 *
 * ── adherence（§12.4 B2 / §6.5）────────────────────────────
 *   adherence = null → k = 1（无数据不校准）
 *   adherence = doneMin / markedMin → clamp(0.5, 1.2)
 *   上限 1.2 防一次爆发把下周排爆；下限 0.5 防彻底放弃。
 *
 * ── persona 接入（§12.3 A1）─────────────────────────────────
 *   ACH ≥ 70 → 意愿默认"尽量多排" → multiplier ×1.15
 *   ACH ≤ 35 → 意愿默认"有空再说" → multiplier ×0.85
 *   其余 → ×1.0
 *   （仅作默认，Goal.priority 可覆盖）
 */

/* ============================================================
 * 加权注水法（2026-09-28，RAY 拍板「长目标分配要有成熟算法」）
 * ==========================================================
 * 把一周的类别容量当水池，按「加权最大最小公平」（weighted max-min
 * fairness，OS/网络调度的经典算法，Linux CFS / WFQ 同族）分配：
 *   1. 每个目标按权重瓜分剩余容量（share_i = remaining × w_i / Σw）；
 *   2. 需求小于份额的目标拿满自己的需求（"已满足"，退出本轮）；
 *   3. 剩余容量在还没满足的目标之间继续瓜分，直到分完或全部满足。
 *
 * 效果：需求小的目标不会被"先到先得"的目标挤到 0；需求大的目标
 * 按权重（优先级）分盈余，而不是整个吃掉类别上限。
 */
export function waterFillAlloc(demands: number[], weights: number[], capacity: number): number[] {
  const n = demands.length;
  const alloc = new Array<number>(n).fill(0);
  const active = new Set<number>();
  let remaining = Math.max(0, capacity);
  for (let i = 0; i < n; i++) {
    if (demands[i] > 0 && remaining > 0) active.add(i);
  }
  // 每轮至少"满足"一个目标（或一轮分完）→ 最多 n 轮收敛，guard 防浮点抖动死循环
  let guard = 0;
  while (active.size > 0 && remaining > 1e-9 && guard++ <= n + 2) {
    const wSum = [...active].reduce((s, i) => s + (weights[i] > 0 ? weights[i] : 1), 0);
    if (wSum <= 0) break;
    const saturated: number[] = [];
    let granted = 0;
    for (const i of active) {
      const w = weights[i] > 0 ? weights[i] : 1;
      const share = (remaining * w) / wSum;
      const need = demands[i] - alloc[i];
      if (need <= share) {
        alloc[i] += need;
        granted += need;
        saturated.push(i);
      } else {
        alloc[i] += share;
        granted += share;
      }
    }
    remaining -= granted;
    for (const i of saturated) active.delete(i);
  }
  return alloc;
}

/** 优先级 → 注水权重（1–5 档；缺省 3 = 1.0）。越高优先级分到越多盈余。 */
const WEIGHT_BY_PRIORITY: Record<number, number> = { 1: 0.7, 2: 0.85, 3: 1.0, 4: 1.15, 5: 1.3 };

function priorityWeight(goal: Goal): number {
  return WEIGHT_BY_PRIORITY[goal.priority ?? 3] ?? 1;
}

/**
 * 目标的「本周需求」（注水法的 demand，不含类别上限）：
 *   · v2（有里程碑）→ 段预算 × adherence × persona；
 *   · v1（有截止+总量）→ totalHours × pace 份额 × 并行折扣；
 *   · 其余（无截止 / 无总量 / 已过期）→ null = 不参与注水，走各自旧行为。
 */
export function weeklyDemandMin(
  goal: Goal, weekNo: number, termStart: string,
  prefs: GoalPrefs,
  adherence?: number | null,
  persona?: import('@/types').PersonaProfile | null,
): number | null {
  if (!goal.dueAt || !goal.totalHours) return null;
  const dueWeek = currentWeekNo(termStart, goal.dueAt);
  const weeksLeft = dueWeek - weekNo;
  if (weeksLeft < 0) return null;

  // 截止临近度调制（计划书 §1.1）：越临近截止，本周需求预算越高（上限 +40%）。
  // v1 / v2 两条路径统一乘 —— 注水法把它当需求，天然传导到分配额。
  const proximityGain = 1 + PROXIMITY_GAIN * deadlineProximity(goal, weekNo, termStart);

  const seg = currentSegment(goal, weekNo, termStart);
  if (seg) {
    const k = adherenceK(adherence) * personaMultiplier(persona?.axes);
    return Math.round(seg.budgetMin * k * proximityGain);
  }

  const W = weeksLeft + 1;
  const weights = paceWeights(goal.pace, W);
  const discount = PARALLEL_DISCOUNT[prefs.parallelCount] ?? 1;
  return (goal.totalHours * 60) * (weights[0] / weights.reduce((a, b) => a + b, 0)) * discount * proximityGain;
}

const clampK = (v: number) => Math.max(0.5, Math.min(1.2, v));

/**
 * 截止临近度（长计划增强计划书-2026-10-07 §1.1）：0（远）→ 1（本周截止）。
 * 线性窗口 8 周：8 周以外恒 0，最后一周为 1；无截止 → 0。
 * 纯函数：不读时钟 —— 周上下文由参数注入（与 objective.ts 同一口径）。
 */
export function deadlineProximity(goal: Goal, weekNo: number, termStart: string): number {
  if (!goal.dueAt) return 0;
  const dueWeek = currentWeekNo(termStart, goal.dueAt);
  const weeksLeft = dueWeek - weekNo;
  if (weeksLeft <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - weeksLeft / 8));
}

/** 临近度 → 预算增益上限（计划书 §1.1：+40% 硬编码，测试钉住挤压上限） */
export const PROXIMITY_GAIN = 0.4;

/** 执行率校准系数；`null` = 没有数据 → 1（不惩罚） */
function adherenceK(adherence: number | null | undefined): number {
  if (adherence == null) return 1;
  return clampK(adherence);
}

/** 画像 ACH → 意愿乘数（仅作默认值；用户显式设置 priority 时覆盖）*/
function personaMultiplier(axes: Record<string, number> | undefined): number {
  if (!axes) return 1;
  const v = axes.ACH ?? 50;
  // 与 buildPhases.ts 的 P1 连续映射同口径（hiSide/loSide）
  const hi = Math.max(0, Math.min(1, (v - 50) / 20));
  const lo = Math.max(0, Math.min(1, (50 - v) / 15));
  return 1 + 0.15 * (hi - lo);
}

/** 🔥 画像推断专注时长（§12.3 A2）：PLAN 定档位 · 方法库 deepBlockMin 定基准
 *  PLAN=0 → 45 分（低计划性 → 短块）
 *  PLAN=50 → 68 分
 *  PLAN=100 → 90 分（deepBlockMin 基准）
 *  代替用户手动设置 focusMinutes —— 从画像推断。
 */
export function inferFocusMinutes(axes: Record<string, number> | undefined): number {
  if (!axes) return 90;
  const plan = Math.max(0, Math.min(100, axes.PLAN ?? 50));
  const deepBlockMin = 90; // 来自方法库 METHOD.blocks.deepBlockMin（接线后改为 resolveParam）
  return Math.round(45 + (plan / 100) * (deepBlockMin - 45));
}

/** 里程碑切段：返回当前周所在段的 { segBudget, segWeeks } */
function currentSegment(
  goal: Goal, weekNo: number, termStart: string,
): { budgetMin: number } | null {
  if (!goal.milestones?.length || !goal.dueAt || !goal.totalHours) return null;

  const ms = [...goal.milestones].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const dueWeek = currentWeekNo(termStart, goal.dueAt);
  if (weekNo > dueWeek) return null; // 已过期

  // 构建段时间线：[start, end, hours]
  const segs: Array<{ fromWk: number; toWk: number; hours: number }> = [];
  let prevWk = weekNo;
  let prevHrs = 0;

  for (const m of ms) {
    const mWk = currentWeekNo(termStart, m.dueAt);
    if (mWk <= prevWk || mWk > dueWeek) continue;
    const hrs = (m.cumulativeHours ?? 0) - prevHrs;
    if (hrs <= 0) { prevHrs = m.cumulativeHours ?? prevHrs; continue; }
    segs.push({ fromWk: prevWk, toWk: mWk, hours: hrs });
    prevWk = mWk;
    prevHrs = m.cumulativeHours ?? prevHrs;
  }
  // 最后一段（从最后一个里程碑到目标截止）
  if (prevWk < dueWeek && goal.totalHours > prevHrs) {
    segs.push({ fromWk: prevWk, toWk: dueWeek, hours: goal.totalHours - prevHrs });
  }

  // 找当前周所在的段
  for (const seg of segs) {
    if (weekNo >= seg.fromWk && weekNo <= seg.toWk) {
      const wks = seg.toWk - seg.fromWk + 1;
      return { budgetMin: Math.round((seg.hours * 60) / wks) };
    }
  }

  // 里程碑覆盖不到本周（在两个里程碑之间的空档）→ 按总剩余均摊
  const remainWks = dueWeek - weekNo + 1;
  if (remainWks > 0) {
    return { budgetMin: Math.round((goal.totalHours * 60) / remainWks) };
  }
  return null;
}

/** v2 槽位生成：把段预算分给三个槽位，产出 UserTask */
function decomposeGoalV2(
  goal: Goal, weekNo: number, termStart: string,
  prefs: GoalPrefs, courseMinByDay?: Record<number, number>,
  adherence?: number | null,
  persona?: import('@/types').PersonaProfile | null,
  budgetOverrideMin?: number,
  /** 其它长目标已占用的天（分钟）—— 分布避开（2026-10-07） */
  goalLoadByDay?: Record<number, number>,
): { tasks: UserTask[]; warning: DecomposeWarning | null } {
  // 硬不变量：无里程碑 → v1 路径
  // Q4 定向周只在「完全没有任何可用信息」时触发（无产出、无截止、无总量）
  const hasMilestones = (goal.milestones?.length ?? 0) > 0;
  const hasBudget = !!goal.dueAt && !!goal.totalHours;

  // 没有预算 → Q4 定向周
  if (!hasBudget) {
    return decomposeQ4FirstWeek(goal, weekNo, prefs);
  }

  // 有预算 + 无里程碑 → v1 平摊
  if (!hasMilestones) {
    return decomposeGoal(goal, weekNo, termStart, prefs, courseMinByDay, budgetOverrideMin, goalLoadByDay);
  }

  // 有预算 + 有里程碑 → v2 里程碑切段
  const seg = currentSegment(goal, weekNo, termStart);
  if (!seg) return decomposeGoal(goal, weekNo, termStart, prefs, courseMinByDay, budgetOverrideMin, goalLoadByDay);

  const k = adherenceK(adherence) * personaMultiplier(persona?.axes);
  const budget = budgetOverrideMin ?? Math.round(seg.budgetMin * k);
  if (budget <= 0) return { tasks: [], warning: null };

  // 槽位
  const slots = resolveSkeleton(goal);
  const freeDays = [...prefs.freeDays].sort(
    (a, b) => ((courseMinByDay?.[a] ?? 0) + (goalLoadByDay?.[a] ?? 0))
      - ((courseMinByDay?.[b] ?? 0) + (goalLoadByDay?.[b] ?? 0)),
  );
  const days = freeDays.length > 0 ? freeDays : [1, 2, 3, 4, 5];
  const pr = goal.priority ?? 3;
  const basePriority = 60 + (pr - 1) * 5;

  const tasks: UserTask[] = [];
  let seq = 0;
  const mkId = () => `goal-${goal.id}-t${++seq}`;
  // 🔥 画像推断专注时长（替代手动 focusMinutes）
  const focusMin = inferFocusMinutes(persona?.axes);

  for (const slot of slots) {
    const slotBudget = Math.round(budget * slot.weight);
    if (slotBudget <= 0) continue;

    if (slot.shape === 'deep') {
      // 主线：每块由画像推断（PLAN 高 → 接近 90 分），需要整块时间
      const n = Math.max(1, Math.min(days.length, Math.round(slotBudget / focusMin)));
      for (let i = 0; i < n; i++) {
        tasks.push({
          id: mkId(),
          title: `${goal.title} · ${slot.name}`,
          emoji: goal.emoji,
          kind: 'study',
          weeks: [weekNo],
          durationMin: focusMin,
          priority: basePriority + 10,
          essential: pr >= 4,
          note: `${slot.action} · 本周预算 ${slotBudget} 分钟 · 专注 ${focusMin} 分（画像推断）`,
          ...(goal.place ? { place: goal.place } : {}),
        });
      }
    } else if (slot.shape === 'fragment') {
      const n = Math.min(days.length, Math.max(1, Math.round(slotBudget / 20)));
      for (let i = 0; i < n; i++) {
        tasks.push({
          id: mkId(),
          title: `${goal.title} · ${slot.name}`,
          emoji: goal.emoji,
          kind: 'study',
          weeks: [weekNo],
          durations: [15, 20, 25],
          priority: basePriority - 10,
          note: `${slot.action} · 本周预算 ${slotBudget} 分钟`,
        });
      }
    } else {
      const n = Math.max(1, Math.round(slotBudget / 40));
      for (let i = 0; i < n; i++) {
        tasks.push({
          id: mkId(),
          title: `${goal.title} · ${slot.name}`,
          emoji: goal.emoji,
          kind: 'study',
          weeks: [weekNo],
          durationMin: Math.min(45, Math.max(30, Math.round(slotBudget / n))),
          priority: basePriority,
          note: `${slot.action} · 本周预算 ${slotBudget} 分钟`,
        });
      }
    }
  }

  // 容量守卫（沿用 G3）
  let warning: DecomposeWarning | null = null;
  const totalBudget = tasks.reduce((s, t) => s + (t.durationMin ?? 0), 0);
  if (courseMinByDay) {
    const total = Object.values(courseMinByDay).reduce((a, b) => a + b, 0);
    const free = DAY_SPAN_MIN * 7 - total;
    if (totalBudget > free * CAP_RATIO) {
      warning = {
        goalId: goal.id,
        title: goal.title,
        message: `「${goal.title}」本周需要约 ${totalBudget} 分钟，超过自由时间的 60%`,
      };
    }
  }

  return { tasks, warning };
}

/* ============================================================
 * Q4 定向周（设计书 §20 方案一 + 二）
 * ========================================================== */

/** Q4 第 1 周：不是"学 90 分钟"，是"定 25 分钟方向" */
function decomposeQ4FirstWeek(
  goal: Goal, weekNo: number, prefs: GoalPrefs,
): { tasks: UserTask[]; warning: DecomposeWarning | null } {
  const slots = resolveSkeleton(goal);
  const mainSlot = slots.find((s) => s.slot === 'main') ?? slots[0];
  const closeSlot = slots.find((s) => s.slot === 'close') ?? slots[slots.length - 1];

  const tasks: UserTask[] = [
    {
      id: `goal-${goal.id}-w${weekNo}-dir`,
      title: `${goal.title} · ${mainSlot.name}`,
      emoji: goal.emoji,
      kind: 'study',
      category: 'custom',
      weeks: [weekNo],
      durations: [20, 25, 30],
      priority: 65,
      note: '定向周 · 本周目标 = 想清楚下一步做什么（写完进复盘）',
    },
    {
      id: `goal-${goal.id}-w${weekNo}-rev`,
      title: `${goal.title} · ${closeSlot.name}`,
      emoji: '🔁',
      kind: 'study',
      category: 'custom',
      weeks: [weekNo],
      durationMin: 20,
      priority: 60,
      note: '本周复盘 · 你想出了什么方向？写下来告诉系统',
    },
  ];
  return { tasks, warning: null };
}
