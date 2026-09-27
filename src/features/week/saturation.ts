/**
 * WP7-E6：满溢度纯模型（从 SaturationBar.tsx 抽出 —— node --test 跑不了 JSX，
 * 模型层可测；组件只做映射，与 MiniWeekPreview 同一手法）。
 * ============================================================
 * 口径：
 *   · occupied = 当天**非课程非 blank**块的分钟和（课程是既成事实，blank 是刻意留白）；
 *   · capacity = 可支配窗口（dayEnd−dayStart）− 课程分钟；
 *   · ratio = occupied / capacity，四档：<50% 绿 / 50-70% 黄 / 70-85% 橙 / ≥85% 红。
 * 纯函数，不读时钟、不随机。
 */
import type { TimeBlock } from '@/types';

export interface DaySaturation {
  /** 非课程块分钟和 */
  occupiedMin: number;
  /** 可支配窗口分钟（已扣课程） */
  capacityMin: number;
  /** 0-1；capacity 为 0 时恒 0（不制造假满） */
  ratio: number;
  /** 'ok' | 'warm' | 'full' | 'over' */
  level: 'ok' | 'warm' | 'full' | 'over';
}

export const SATURATION_STYLE: Record<DaySaturation['level'], { bar: string; text: string; label: string }> = {
  ok: { bar: 'bg-green-500', text: 'text-green-700', label: '还有余地' },
  warm: { bar: 'bg-amber-400', text: 'text-amber-700', label: '偏满' },
  full: { bar: 'bg-orange-500', text: 'text-orange-700', label: '很满' },
  over: { bar: 'bg-red-500', text: 'text-red-700', label: '过载' },
};

/** 纯函数：一天块集 → 满溢度。确定性，同输入必得同输出。 */
export function daySaturation(
  blocks: readonly TimeBlock[],
  dayStartMin: number,
  dayEndMin: number,
): DaySaturation {
  const courseMin = blocks
    .filter((b) => b.kind === 'course' || b.source === 'course')
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);
  const occupiedMin = blocks
    .filter((b) => b.kind !== 'course' && b.source !== 'course' && b.kind !== 'blank')
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);
  const capacityMin = Math.max(0, dayEndMin - dayStartMin - courseMin);
  const ratio = capacityMin > 0 ? Math.min(1, occupiedMin / capacityMin) : 0;
  const level: DaySaturation['level'] =
    ratio >= 0.85 ? 'over' : ratio >= 0.7 ? 'full' : ratio >= 0.5 ? 'warm' : 'ok';
  return { occupiedMin, capacityMin, ratio, level };
}
