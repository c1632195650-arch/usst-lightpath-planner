/**
 * 光溯移动端 · 时间燃烧条（新任务三 §3.3）
 * ============================================================
 * 进度 = (nowMin - startMin) / (endMin - startMin)，钳制 [0,1]；
 * 颜色相位：<33% 绿 · 33-66% 琥珀 · >66% 红；
 * 边界：nowMin < startMin → 未开始（进度 0，剩「还有 N 分钟开始」）；
 *       nowMin ≥ endMin → 已结束 → **null**（该块已从「当前块」排除，UI 不渲染）。
 * 纪律：纯函数（时间全入参），跨午夜按线性分钟数处理（startMin/endMin 同一天轴）。
 */
export type BurnPhase = 'upcoming' | 'green' | 'amber' | 'red';

export interface BurnInfo {
  /** 已过/总时长 ∈ [0,1] */
  ratio: number;
  /** 含义随 phase 变：upcoming = 距开始分钟数；其余 = 剩余分钟数 */
  remainMin: number;
  phase: BurnPhase;
}

export function burnRatio(startMin: number, endMin: number, nowMin: number): BurnInfo | null {
  const dur = endMin - startMin;
  if (!Number.isFinite(dur) || dur <= 0) return null; // 时长非法（坏块）→ 不画条
  if (nowMin < startMin) {
    return { ratio: 0, remainMin: startMin - nowMin, phase: 'upcoming' };
  }
  if (nowMin >= endMin) return null;
  const ratio = Math.min(1, Math.max(0, (nowMin - startMin) / dur));
  const phase: BurnPhase = ratio < 1 / 3 ? 'green' : ratio <= 2 / 3 ? 'amber' : 'red';
  return { ratio, remainMin: endMin - nowMin, phase };
}
