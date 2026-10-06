/**
 * 周调度器 · 对外稳定入口（Facade）
 * ============================================================
 * ⚠️ **本文件的对外形状是契约**（规格书 §4.5.3「CY 请求 ①」）：
 *    导出名、参数、返回形状**一律不得改**。
 *    既有消费方：`scripts/scheduler.test.ts`、`scripts/buildPhases.test.ts`、
 *    以及 PR #3 的 `features/week/WeekPlanView.tsx`（不在本分支）。
 *
 * P1（T1.1/T1.4）之后，真正的实现搬到：
 *   · `construct.ts` —— 7 步构造（语义键 id）
 *   · `solver.ts` / `index.ts` —— 构造 + 改进 + 解释的编排
 *   · `explain.ts` —— 理由/说明/问题
 *   · `campusLookup.ts` —— 校区粗查与转场注入接口（避免与 construct 成环）
 *
 * 本文件现在只做两件事：
 *   ① **re-export** 旧导出（调用点零改动）；
 *   ② `buildWeekPlan` 作为**兼容转调**：把 `BuildWeekPlanInput` 映射成 `PlanRequest`，
 *      交给 `construct`（= 旧 7 步），因此块内容与旧引擎逐块一致（AC-2）。
 */
import type { DayOfWeek, PhasePolicy, Schedule, ScenarioFields, TimeBlock, WeekPlan, RollingState } from '@/types';
import { toHHmm } from '../../constants/time.ts';
import type { ActivityTemplate, UserTask } from './templates.ts';
import type { Commit, PlanRequest } from './model.ts';
import { construct } from './construct.ts';

/* ============================================================
 * 一、re-export（对外 API 不变）
 * ========================================================== */

export { campusFallbackTransfer, campusOfName } from './campusLookup.ts';
export type { TransferInfo, TransferProvider } from './campusLookup.ts';

export {
  activeInWeek, effectiveCourses, effectiveSlots, slotsOn,
} from './construct.ts';
export type { EffectiveSlot } from './construct.ts';

/* ============================================================
 * 二、兼容入口
 * ========================================================== */

/**
 * 待办工作区 → 排程约束的桥接形状（任务四 P3-1 草案，BLOCKERS 2026-10-06 申报、CY 追认待）。
 * `kind: 'recent'` 映射为 `UserTask`（本周一次性块）；`'longterm'` 映射为 `Commit`
 * （可拆分 + 交期，"本周累计推进"语义）。**可选字段**：不传 = 旧行为逐字段一致。
 */
export interface TodoLike {
  id: string;
  title: string;
  kind: 'recent' | 'longterm';
  /** 预计投入分钟（引擎产能核算依赖） */
  effortMin: number;
  /** 交期（粗粒度完成时段解析所得，见 memo 特性 plannedDoneToDueAt） */
  dueAt?: Commit['dueAt'];
  splittable?: boolean;
}

export interface BuildWeekPlanInput {
  schedule: Schedule;
  /** 目标周次（1-based） */
  weekNo: number;
  /** 该周所属阶段策略 */
  policy: PhasePolicy;
  /** 画像场景字段 —— 决定运动 / 夜宵等模块是否参与 */
  scenarios?: ScenarioFields | null;
  /**
   * 完整画像（批 4.3，1A-③）：引擎读它算 socialCap（SOC≥70 → 每天 2 次社交）
   * 与块级偏好；此前 `BuildWeekPlanInput` 没有这个字段可传 → 画像两条通路静默失灵。
   * 不传 = 旧行为（construct 里 `req.persona ?? null` 兜底）。
   */
  persona?: import('@/types').PersonaProfile | null;
  /** 用户自定义模块 */
  tasks?: UserTask[];
  /** 模块库，默认 DEFAULT_TEMPLATES */
  templates?: ActivityTemplate[];
  /** 转场时间来源，默认 campusFallbackTransfer */
  transfer?: import('./campusLookup.ts').TransferProvider;
  /** 一天的可排程区间，默认 07:00–23:00 */
  dayStart?: string;
  dayEnd?: string;
  /** 是否排三餐（默认 true） */
  withMeals?: boolean;

  /* —— P2 新增（全部可选：不传 = 旧行为，老调用点零改动）—— */
  /**
   * 跨周负荷状态（上一周的产物）。UI 侧用 `rollingForWeek(planState, weekNo)` 取，
   * 别直接读 `planState.rolling` —— 那会在同一周内自我强化降档（见 planLock.ts）。
   */
  rolling?: RollingState | null;
  /**
   * 最近若干周的**实际**负荷（按星期几，下标 0 = 周一）。
   * UI 侧由 `actualLoadByDow(records, weekMonday)` 得到。
   * 与 `rolling.loadByDow`（计划值）互为补充：实际优先、计划兜底。
   */
  actualLoadByDow?: number[] | null;
  /** 上一版计划（供增量重排算脏区域）；首次排程传 null */
  previousPlan?: WeekPlan | null;
  /** 上一版的提交项快照（供增量重排识别交期变化） */
  previousCommits?: Commit[] | null;
  /** 「从现在开始排」的分钟数（自当日 00:00 起的绝对分钟） */
  fromNow?: number | null;
  /** 与 `fromNow` 配套的星期几（1 = 周一） */
  fromNowDay?: DayOfWeek | null;
  /** 待办工作区的未完成待办（任务四 W3）：缺省/空数组 = 旧行为，零漂移 */
  pendingTodos?: TodoLike[];
  /**
   * P1-5（2026-10-06 收官批次·批次 5，CY 裁决 R3）：每周活动量下限（分钟），透传
   * `PlanRequest.weeklyActivityMin`。缺省 undefined = 不生效（golden 零漂移）。
   * 契约: BuildWeekPlanInput/PlanRequest 增 weeklyActivityMin?（可选字段，opt-in）。
   */
  weeklyActivityMin?: number;
  /**
   * P1-7 部分（裁决 R3）：三餐步行预算（分钟），透传 `PlanRequest.mealWalkBudgetMin`。
   * 契约: BuildWeekPlanInput/PlanRequest 增 mealWalkBudgetMin?（可选字段，opt-in）。
   */
  mealWalkBudgetMin?: number;
}

export interface BuildWeekPlanResult {
  plan: import('@/types').WeekPlan;
  /** 生成过程说明（面向用户） */
  notes: string[];
}

/** `BuildWeekPlanInput` → `PlanRequest`（旧入口到新管道的唯一适配点） */
export function toPlanRequest(input: BuildWeekPlanInput): PlanRequest {
  // M4-W3（任务四 P3-2，BLOCKERS 2026-10-06 申报）：待办 → 两条既有引擎通道。
  //   · recent → UserTask（`tasks`，本周一次性块，priority 70：高于普通活动、低于作业 78）
  //   · longterm → Commit（`commits`，可拆分 + 交期，priority 92 略高于缺省 90）
  // pendingTodos 缺省/空时下面两个数组都是空 → 与旧行为**逐字段一致**（黄金零漂移）。
  const todoTasks: UserTask[] = [];
  const todoCommits: Commit[] = [];
  for (const t of input.pendingTodos ?? []) {
    if (t.kind === 'longterm') {
      todoCommits.push({
        id: t.id,
        title: t.title,
        kind: 'study',
        effortMin: t.effortMin,
        splittable: t.splittable ?? true,
        priority: 92,
        weeks: [input.weekNo],
        ...(t.dueAt ? { dueAt: t.dueAt } : {}),
      });
    } else {
      todoTasks.push({
        id: t.id,
        title: t.title,
        emoji: '📌',
        kind: 'activity',
        durationMin: t.effortMin,
        weeks: [input.weekNo],
        priority: 70,
        note: '来自待办工作区（最近待办）',
      });
    }
  }
  return {
    schedule: input.schedule,
    weekNo: input.weekNo,
    policy: input.policy,
    commits: todoCommits, // 旧入口没有提交项（P1 兼容层：走 tasks）；待办经 pendingTodos 进入
    scenarios: input.scenarios ?? null,
    ...(input.persona != null ? { persona: input.persona } : {}),
    tasks: [...(input.tasks ?? []), ...todoTasks],
    transfer: input.transfer,
    dayStart: input.dayStart,
    dayEnd: input.dayEnd,
    withMeals: input.withMeals,
    // P2：条件展开 —— 不传的字段**不出现**在对象上，保持与旧行为逐字段一致。
    // 显式把 `null` 归成「不传」（`PlanRequest` 的可选字段不带 null）：
    // UI 手里就是 `WeekPlan | null` / `number | null`，要求它先判空是没必要的负担。
    ...(input.rolling != null ? { rolling: input.rolling } : {}),
    ...(input.actualLoadByDow != null ? { actualLoadByDow: input.actualLoadByDow } : {}),
    ...(input.previousPlan != null ? { previousPlan: input.previousPlan } : {}),
    ...(input.previousCommits != null ? { previousCommits: input.previousCommits } : {}),
    ...(input.fromNow != null ? { fromNow: input.fromNow } : {}),
    ...(input.fromNowDay != null ? { fromNowDay: input.fromNowDay } : {}),
    // P1-5/P1-7：条件展开 —— 不传的字段不出现，保持与旧行为逐字段一致（零漂移）
    ...(input.weeklyActivityMin != null ? { weeklyActivityMin: input.weeklyActivityMin } : {}),
    ...(input.mealWalkBudgetMin != null ? { mealWalkBudgetMin: input.mealWalkBudgetMin } : {}),
  };
}

/**
 * 旧入口：把「这一周」排成时间轴。
 *
 * @deprecated 新代码请用 `index.ts::planWeekV2(req)`（含改进阶段与诊断）。
 *             本函数保留是为了让现有 UI / 测试**零改动**。
 */
export function buildWeekPlan(input: BuildWeekPlanInput): BuildWeekPlanResult {
  const { plan, notes } = construct(toPlanRequest(input), { templates: input.templates });
  return { plan, notes };
}

/* ============================================================
 * 三、展示辅助
 * ========================================================== */

/** 一天的块按时间排序后转成展示用字符串（周程页/测试都用） */
export function describeDay(blocks: TimeBlock[], dayOfWeek: DayOfWeek): string[] {
  return blocks
    .filter((b) => b.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => `${toHHmm(b.startMin)}-${toHHmm(b.endMin)} ${b.emoji ?? ''}${b.title}`
      + (b.place ? ` @${b.place}` : ''));
}
