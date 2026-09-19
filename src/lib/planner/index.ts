/**
 * 排程引擎 v2 · 对外入口（规格书 §4.5.1）
 * ============================================================
 * ```ts
 * planWeekV2(req: PlanRequest): PlanResult     // 新引擎（构造 + 改进 + 解释 + 诊断）
 * buildWeekPlan(input): BuildWeekPlanResult    // 兼容旧入口（只构造，UI 零改动）
 * planWeek(req): Promise<PlanResult>           // 两遍法编排（§4.5.2）
 * ```
 *
 * ⚠️ 依赖方向：本文件**只**依赖 `solver.ts` / `schedule.ts` / `construct.ts` / `planWeek.ts`，
 *    而 `planWeek.ts` 依赖 `solver.ts`（不依赖本文件）—— 刻意避免环。
 */
import type { PlanRequest, PlanResult } from './model.ts';
import { solveWeek } from './solver.ts';

/** 新引擎入口：`normalize → construct → improve → explain → assemble` */
export function planWeekV2(req: PlanRequest): PlanResult {
  return solveWeek(req);
}

/* —— 兼容旧入口（规格书 §4.5.3「CY 请求 ①」：对外形状不变）—— */
export { buildWeekPlan, toPlanRequest, describeDay } from './schedule.ts';
export type { BuildWeekPlanInput, BuildWeekPlanResult } from './schedule.ts';

/* —— 两遍法编排（规格书 §4.5.2「CY 请求 ②」）—— */
export { planWeek } from './planWeek.ts';
export type { PlanWeekOptions, TransferFactory } from './planWeek.ts';

/* —— 暴露构造阶段，供 AC-2「构造等价」独立验收（不经过 improve）—— */
export { construct } from './construct.ts';
export type { ConstructCtx, ConstructResult } from './construct.ts';

/* —— 诊断与确定性辅助 —— */
export { countHardViolations, stablePlanJson, nextRollingFrom, findDepsCycle, applyLockedPlacements, reattachTransfers } from './solver.ts';
export type { LockApplyResult } from './solver.ts';

/* —— 跨周自适应（疲劳 / 逐日可行性）—— */
export { FATIGUE, countableDaysOf, fatigueAdjustment, effectiveStudyMin, weeklyStudyTarget } from './fatigue.ts';
export type { FatigueAdjustment } from './fatigue.ts';

/* —— 类型再导出，方便消费方只 import 一个入口 —— */
export type {
  Commit, Diagnostics, Place, PlanRequest, PlanResult, PlanVariant, RollingState,
  SolverConfig, Weights,
} from './model.ts';
