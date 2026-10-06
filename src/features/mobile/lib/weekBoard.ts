/**
 * 光溯移动端 · WeekBoard 纯逻辑（M3 · 2026-10-07）
 * ============================================================
 * 周视图（替换只读的 WeekGlance）的**纯函数层**：七天行模型、周次范围标签、
 * 切周偏移钳制。不碰 React、不碰网络 —— tests/mobile/weekBoard.test.ts 直测。
 * 数据与异步重算（recomputeWeek）在组件层（WeekBoard.tsx）。
 */
import type { WeekPlan } from '@/types';
import type { UserPlanLayer } from '@/features/week/userPlanStore';
import { applyLayerToBlocks, parseDate } from './sync.ts';

const DOW_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export interface WeekBoardRow {
  /** 1=周一 … 7=周日 */
  dow: number;
  label: string;
  /** 「10/05」形日期（学期锚点换算；termStart 解析不了 = 空串） */
  dateLabel: string;
  isToday: boolean;
  /** 未完成件数（覆盖层 done 剔除后） */
  openCount: number;
}

/** 切周偏移钳制：目标周必须落在 [1, totalWeeks]，越界就停在本边界 */
export function clampWeekOffset(next: number, baseWeekNo: number, totalWeeks: number): number {
  let target = baseWeekNo + next;
  if (target < 1) target = 1;
  if (target > totalWeeks) target = totalWeeks;
  return target - baseWeekNo;
}

/** 「第 N 周 · 10/05–10/11」里的日期段（学期锚点：termStart = 第 1 周周一） */
export function weekRangeLabel(termStart: string, weekNo: number): string {
  const base = parseDate(termStart);
  if (base == null) return '';
  const monday = new Date(base + (weekNo - 1) * 7 * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const f = (d: Date) => `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${f(monday)}–${f(sunday)}`;
}

/** 七天行模型：给定 plan + 覆盖层 → 每天未完成件数（只读，不改任何状态） */
export function weekBoardRows(
  plan: WeekPlan | null,
  layer: UserPlanLayer,
  weekNo: number,
  todayDow: number,
  termStart: string,
): WeekBoardRow[] {
  if (!plan) return [];
  const base = parseDate(termStart);
  const mondayMs = base != null ? base + (weekNo - 1) * 7 * 86_400_000 : null;
  const rows: WeekBoardRow[] = [];
  for (let dow = 1; dow <= 7; dow++) {
    const { blocks, doneIds } = applyLayerToBlocks(plan, layer, weekNo, dow);
    const openCount = blocks.filter((b) => !doneIds.has(b.id)).length;
    let dateLabel = '';
    if (mondayMs != null) {
      const d = new Date(mondayMs + (dow - 1) * 86_400_000);
      dateLabel = `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    rows.push({
      dow,
      label: DOW_CN[dow],
      dateLabel,
      isToday: dow === todayDow,
      openCount,
    });
  }
  return rows;
}
