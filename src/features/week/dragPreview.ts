/**
 * 跨列甩放的统一落点（WP4b-B5，2026-09-27）
 * ============================================================
 * 修复前：拖到某列的空白处没有任何 dragover 兜底 —— 影子不出现（预览 null），
 * 松手 onDrop 退回「列末尾」，用户看到的和拿到的不一致。
 *
 * 修复后：列级 onDragOver 用 `dropTargetMin(null, day, blocks)` 把影子**直接画在
 * 列末尾**；松手 onDrop 用同一个函数取落点 —— 预览位恒等于最终位（所见即所得）。
 *
 * 纯函数、不依赖 React —— node --test 可直跑（tests/dragPreview.test.ts）。
 */

/** 影子/落点的最小描述（结构兼容 WeekPlanView 的 DragPreview） */
export interface DragPreviewSpot {
  day: number;
  atMin: number;
}

/** 列内最后一件事情的结束时间；空列从早八起算（与 WeekPlanView 既有口径一致） */
export function columnTailMin(baseBlocks: ReadonlyArray<{ endMin: number }>): number {
  return baseBlocks.length ? baseBlocks[baseBlocks.length - 1].endMin : 8 * 60;
}

/**
 * 松手落点 = 影子位置：本列有预览用预览值，否则退回「列末尾 + 10 分钟」。
 * `preview` 传 `null` 即「悬停兜底目标」—— 两处必须用同一函数，才不会影子一套、落点一套。
 */
export function dropTargetMin(
  preview: DragPreviewSpot | null,
  day: number,
  baseBlocks: ReadonlyArray<{ endMin: number }>,
): number {
  if (preview && preview.day === day) return preview.atMin;
  return columnTailMin(baseBlocks) + 10;
}
