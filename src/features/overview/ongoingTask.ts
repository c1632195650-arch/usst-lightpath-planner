/**
 * 「现在正在进行的用户排程块」（UI v2 批次 D3 深色焦点卡数据源）。
 *
 * 纯函数：时间由调用方传入（与 lib/today 同一纪律——不在函数内部读时钟）。
 * 数据来自 userPlanStore 的 user 层任务（梨宝写入/用户自建），引擎软块
 * 不在总览层重建（那是 WeekPlanView 的职责）；没有进行中事项 → null，
 * 焦点卡整体不渲染（「全页唯一重物」只在真有事时压上去）。
 */
import type { UserTask } from '@/lib/planner/templates';

export interface OngoingTask {
  task: UserTask;
  startMin: number;
  endMin: number;
  /** 0–1，进度条用 */
  progress: number;
  /** 剩余分钟 */
  remainMin: number;
}

export function ongoingUserTask(
  tasks: readonly UserTask[],
  todayDow: number,
  nowMin: number,
): OngoingTask | null {
  for (const t of tasks) {
    if (t.dayOfWeek !== todayDow || t.startMin == null) continue;
    const durationMin = t.durationMin ?? 0;
    if (durationMin <= 0) continue;
    const startMin = t.startMin;
    const endMin = startMin + durationMin;
    if (nowMin >= startMin && nowMin < endMin) {
      return {
        task: t,
        startMin,
        endMin,
        progress: (nowMin - startMin) / durationMin,
        remainMin: endMin - nowMin,
      };
    }
  }
  return null;
}
