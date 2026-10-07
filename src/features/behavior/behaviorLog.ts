/**
 * 行为记录 · 转发壳（2026-10-07）
 * ============================================================
 * 本模块的实现**整体下沉到 `lib/behaviorLog.ts`**（R5 域对治理：行为数据是数据层
 * 而非 activity/week 任一功能域 —— 下沉后 activity 域（GoalsPage/GoalMonitor）与
 * week 域（useWeekPlan/BlockCard）都从 lib 取，不再新增任何 features 横向依赖）。
 * 历史消费方统一从这里转发，零改动兼容。
 */
export * from '@/lib/behaviorLog';
