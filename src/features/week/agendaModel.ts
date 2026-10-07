/**
 * 当日流水（DayAgenda）纯模型（UI v2 批次 D1，设计总成 §11 /week 双层视图）
 * ============================================================
 * 与渲染分离（零依赖可测）。三条数据纪律：
 *   ① 冲突判定**只认 PlanIssue 机器码**（code === 'time-conflict'），绝不匹配中文 message；
 *   ② 空档识别是纯几何（当天块序列的空洞），展示为虚线降透明，不算问题；
 *   ③ 重叠分钟数取几何实值，顶部「重叠 X 分钟」行不二次发明数字。
 */
import type { DayOfWeek, PlanIssue, TimeBlock } from '@/types';

/** 当天块按开始时间排序（流水顺序） */
export function agendaBlocksForDay(blocks: TimeBlock[], day: DayOfWeek): TimeBlock[] {
  return blocks
    .filter((b) => b.dayOfWeek === day)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

export interface AgendaGap {
  startMin: number;
  endMin: number;
}

/**
 * 空档识别（纯几何）：当天 [dayStart, dayEnd] 窗口内，相邻块之间的空洞。
 * 课程表首尾之外的空白也算空档（展示为虚线降透明，提示「这块没排东西」）。
 */
export function findDayGaps(blocks: TimeBlock[], day: DayOfWeek, dayStart = 8 * 60, dayEnd = 22 * 60): AgendaGap[] {
  const items = agendaBlocksForDay(blocks, day).filter((b) => b.endMin > dayStart && b.startMin < dayEnd);
  const gaps: AgendaGap[] = [];
  let cursor = dayStart;
  for (const b of items) {
    if (b.startMin > cursor) gaps.push({ startMin: cursor, endMin: Math.min(b.startMin, dayEnd) });
    cursor = Math.max(cursor, b.endMin);
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) gaps.push({ startMin: cursor, endMin: dayEnd });
  return gaps.filter((g) => g.endMin - g.startMin >= 10); // <10 分钟的碎空不渲染（噪声）
}

export interface AgendaOverlap {
  aId: string;
  bId: string;
  /** 几何实值重叠分钟 */
  overlapMin: number;
}

/** 几何重叠对（同天、同刻交集 > 0） */
export function overlapPairs(blocks: TimeBlock[]): AgendaOverlap[] {
  const out: AgendaOverlap[] = [];
  const byDay = new Map<DayOfWeek, TimeBlock[]>();
  for (const b of blocks) {
    const list = byDay.get(b.dayOfWeek) ?? [];
    list.push(b);
    byDay.set(b.dayOfWeek, list);
  }
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const ov = Math.min(sorted[i].endMin, sorted[j].endMin) - Math.max(sorted[i].startMin, sorted[j].startMin);
        if (ov > 0) out.push({ aId: sorted[i].id, bId: sorted[j].id, overlapMin: ov });
        else break; // 按开始排序，后面更靠后，不再有交集
      }
    }
  }
  return out;
}

/**
 * 真冲突 = 几何重叠对 ∩ `time-conflict` 机器码背书。
 * issue.blockId 指向冲突对中的一块（引擎 issueCourseConflict 语义）——
 * 几何找对、机器码背书，文案不参与判定。
 */
export function confirmedOverlaps(blocks: TimeBlock[], issues: PlanIssue[]): AgendaOverlap[] {
  const flagged = new Set(
    issues.filter((iss) => iss.code === 'time-conflict' && iss.blockId != null).map((iss) => iss.blockId as string),
  );
  if (flagged.size === 0) return [];
  return overlapPairs(blocks).filter((p) => flagged.has(p.aId) || flagged.has(p.bId));
}

/** 每块的重叠分钟（描边 + 行内标注共用一个来源） */
export function overlapMinByBlock(overlaps: AgendaOverlap[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of overlaps) {
    m.set(p.aId, Math.max(m.get(p.aId) ?? 0, p.overlapMin));
    m.set(p.bId, Math.max(m.get(p.bId) ?? 0, p.overlapMin));
  }
  return m;
}

/** 顶部「重叠 X 分钟」行的合计（当天真冲突去重求和：按对去重） */
export function overlapTotalMin(overlaps: AgendaOverlap[]): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const p of overlaps) {
    const key = `${p.aId}~${p.bId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sum += p.overlapMin;
  }
  return sum;
}

/**
 * nowline 位置（分钟 → 当天 0-1 进度）。窗口外返回 null（不渲染线）。
 * 渲染层职责：60s 刷新、无平滑动画、reduced-motion 静止——模型只算位置。
 */
export function nowlineProgress(nowMin: number | null, dayStart = 8 * 60, dayEnd = 22 * 60): number | null {
  if (nowMin == null || nowMin < dayStart || nowMin > dayEnd) return null;
  return (nowMin - dayStart) / (dayEnd - dayStart);
}

/** 冲突对里的另一块 id（并排渲染用） */
export function partnerOf(overlaps: AgendaOverlap[], blockId: string): string | null {
  for (const p of overlaps) {
    if (p.aId === blockId) return p.bId;
    if (p.bId === blockId) return p.aId;
  }
  return null;
}
