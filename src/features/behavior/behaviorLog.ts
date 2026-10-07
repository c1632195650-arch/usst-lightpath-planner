/**
 * 行为记录（features 侧入口）—— 实现已上移至 `@/lib/behaviorLog`（Ray 分层，2026-10-08 接入）。
 * ============================================================
 * 为什么上移：`features/activity/**`（goalPrefs/GoalEditor/refine）与 `features/week/**`
 * 都要消费行为记录，而 `lib/**` 不得 import `features/**` —— 共同上游只能落在 `lib/`。
 * 本文件保留为转发层，既有 import 路径（`@/features/behavior/behaviorLog`）零改动。
 */
export * from '@/lib/behaviorLog';
