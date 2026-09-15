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
import type { DayOfWeek, PhasePolicy, Schedule, ScenarioFields, TimeBlock } from '@/types';
import { toHHmm } from '../../constants/time.ts';
import type { ActivityTemplate, UserTask } from './templates.ts';
import type { PlanRequest } from './model.ts';
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
  transfer?: import('./campusLookup.ts').TransferProvider;
  /** 一天的可排程区间，默认 07:00–23:00 */
  dayStart?: string;
  dayEnd?: string;
  /** 是否排三餐（默认 true） */
  withMeals?: boolean;
}

export interface BuildWeekPlanResult {
  plan: import('@/types').WeekPlan;
  /** 生成过程说明（面向用户） */
  notes: string[];
}

/** `BuildWeekPlanInput` → `PlanRequest`（旧入口到新管道的唯一适配点） */
export function toPlanRequest(input: BuildWeekPlanInput): PlanRequest {
  return {
    schedule: input.schedule,
    weekNo: input.weekNo,
    policy: input.policy,
    commits: [], // 旧入口没有提交项（P1 兼容层：走 tasks）
    scenarios: input.scenarios ?? null,
    tasks: input.tasks ?? [],
    transfer: input.transfer,
    dayStart: input.dayStart,
    dayEnd: input.dayEnd,
    withMeals: input.withMeals,
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
