/**
 * 网页端待办工作区 · 粗粒度完成时段选择器（任务四 W1-P1-1）
 * ============================================================
 * CY 口径：「完成时间粗糙一点，比如 2026 年九月上中下旬」——**不精确到日**。
 * 编码与移动端 `memoTypes.completeTodo` 的校验正则同口径：`YYYY-MM-上旬|中旬|下旬`。
 * 纯函数（时钟入参），可单测。
 */
import { plannedDoneLabel } from '@/features/mobile/lib/memoTypes.ts';

export const PERIOD_TAILS = ['上旬', '中旬', '下旬'] as const;
export type PeriodTail = (typeof PERIOD_TAILS)[number];

/** 'YYYY-MM' 月份选项：从 from 所在月起连续 count 个月（跨年进位） */
export function monthOptions(from: Date, count = 6): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月` });
  }
  return out;
}

/** 当下所处时段（选择器默认值）：1-10 日上旬、11-20 中旬、其余下旬 */
export function suggestPeriod(d: Date): string {
  const tail: PeriodTail = d.getDate() <= 10 ? '上旬' : d.getDate() <= 20 ? '中旬' : '下旬';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${tail}`;
}

/** 'YYYY-MM' → 该月三档时段的完整编码（顺序固定：上/中/下旬） */
export function periodValues(month: string): string[] {
  return PERIOD_TAILS.map((t) => `${month}-${t}`);
}

/** 编码 → 人类文案（'2026-09-中旬' → '2026 年 9 月中旬'）；解析失败原样返回 */
export function periodLabel(value: string): string {
  return plannedDoneLabel(value);
}
