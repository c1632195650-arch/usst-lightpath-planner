/**
 * WeeklyReviewCard —— 本周复盘卡（F5·C2，2026-10-24）
 * ============================================================
 * 数据全走 weeklyReview 纯函数（behaviorLog 纯函数层 + 规则模板句，零 LLM）。
 * 自取记录（loadRecords 只读）；weekNo 缺省从记录里推（无记录 → 空态「数据累积中」）。
 */
import { useMemo, useState } from 'react';
import { loadRecords } from '@/lib/behaviorLog';
import { weeklyReview } from '@/lib/weeklyReview';
import { Icon } from '@/components/icons/Icon';

export function WeeklyReviewCard(props: { weekNo?: number }) {
  const [open, setOpen] = useState(true);
  const [records] = useState(() => loadRecords());
  const review = useMemo(() => {
    const wk = props.weekNo ?? (records.length > 0
      ? Math.max(...records.map((r) => r.weekNo ?? 0))
      : 0);
    if (wk <= 0) return null;
    return weeklyReview(records, wk, wk - 1);
  }, [records, props.weekNo]);

  return (
    <section data-testid="m-weekly-review" className="rounded-card border border-ink/5 bg-paper-card p-4 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Icon name="chart-column" size="sm" className="shrink-0 text-brand" />
          本周复盘
        </span>
        <span className="text-[11px] text-ink-faint">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {review == null ? (
            <p data-testid="m-review-empty" className="text-[12.5px] leading-5 text-ink-soft">数据累积中 —— 做完块打个勾，下周这里就有复盘</p>
          ) : review.lines.map((l) => (
            <p key={l} className="text-[12.5px] leading-5 text-ink-soft">{l}</p>
          ))}
        </div>
      )}
    </section>
  );
}
