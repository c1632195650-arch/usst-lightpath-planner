/**
 * 空闲空档计算（2026-09-19）
 * ============================================================
 * 概览卡片流里的「⬜ 空闲」块：把一天中没安排的空档显式标出来。
 *
 * ⚠️ 双层时间视图（悬停时间轴 / 坐标拖拽 / 边缘调时）已于 2026-09-19 晚按
 * 用户决定整体回退 —— 本文件只保留空闲块与拖拽吸附所需的最小部分。
 * 时间轴换算的历史实现见 git 历史（如需恢复）。
 */
import type { TimeBlock } from '@/types';

/** 一天的可排区间（与引擎 `construct` 的默认口径一致） */
export const DAY_START_MIN = 7 * 60;
export const DAY_END_MIN = 23 * 60;

/** 吸附到 10 分钟档（整块拖拽的粒度，用户指定） */
export function snap10(min: number): number {
  return Math.round(min / 10) * 10;
}

export interface TimeGap {
  startMin: number;
  endMin: number;
}

/**
 * 某一天的**空闲空档**（概览态渲染「⬜ 空闲」块用）。
 *
 * @param minLen 空档最短显示长度（默认 30 分钟 —— 更碎的是噪音，用户拍板）
 */
export function freeGapsOf(
  blocks: readonly TimeBlock[],
  day: number,
  minLen = 30,
): TimeGap[] {
  const dayBlocks = blocks
    .filter((b) => b.dayOfWeek === day)
    .sort((a, b) => a.startMin - b.startMin);
  const out: TimeGap[] = [];
  let cursor = DAY_START_MIN;
  for (const b of dayBlocks) {
    if (b.endMin <= cursor) continue;      // 早于已扫过位置（不可能，防御）
    if (b.startMin >= DAY_END_MIN) break;  // 超出当日窗口
    if (b.startMin - cursor >= minLen) {
      out.push({ startMin: cursor, endMin: Math.min(b.startMin, DAY_END_MIN) });
    }
    cursor = Math.max(cursor, b.endMin);
  }
  if (DAY_END_MIN - cursor >= minLen) {
    out.push({ startMin: cursor, endMin: DAY_END_MIN });
  }
  return out;
}
