/**
 * MorningCard —— 今日晨报卡（F5·C1，2026-10-24）
 * ============================================================
 * 数据全走 morningBrief 纯函数（离线可用、零 LLM）；可收起（收起态只留一行，
 * 不丢入口）。通知侧（planBriefNotifications/scheduleBriefs）由调用侧在
 * 同步成功后另行排程——本卡只负责**应用内呈现**，与通知文案同源。
 */
import { useMemo, useState } from 'react';
import type { TimeBlock } from '@/types';
import { morningBrief, type BriefDeadline } from './lib/morningBrief';
import { loadUserDeadlines, mergeDeadlines, upcomingDeadlines } from '@/features/calendar/deadlineStore';
import { DEADLINES } from '@/data/usst';
import { Icon } from '@/components/icons/Icon';

export function MorningCard(props: {
  blocksToday: readonly TimeBlock[];
  nowMin: number;
  deadlines?: readonly BriefDeadline[];
}) {
  const [open, setOpen] = useState(true);
  // F5 接线①（2026-10-25）：deadlineStore（用户重要日 ∪ 静态校历）→ 晨报提醒信号。
  // 调用方未显式传 deadlines 时自动取 upcoming 72h 窗（与 morningBrief 的 WARN_WINDOW 同口径）。
  const autoDeadlines = useMemo<BriefDeadline[]>(() => {
    if (props.deadlines) return [];
    try {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      return upcomingDeadlines(mergeDeadlines(DEADLINES, loadUserDeadlines()), iso, 8)
        .filter(({ daysLeft }) => daysLeft >= -3 && daysLeft <= 3)
        .map(({ deadline }) => ({ id: deadline.id ?? deadline.title, title: deadline.title, dueISO: deadline.date }));
    } catch {
      return [];
    }
  }, [props.deadlines]);
  const brief = useMemo(() => {
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return morningBrief({
      blocksToday: props.blocksToday, todos: [], goals: [],
      nowMin: props.nowMin, dateKey,
      deadlines: props.deadlines ?? autoDeadlines,
    });
  }, [props.blocksToday, props.nowMin, props.deadlines, autoDeadlines]);
  const hasWarning = brief.warnings.length > 0;
  return (
    <section data-testid="m-morning-card" className="rounded-card border border-ink/5 bg-paper-card p-4 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Icon name="sparkle" size="sm" className="shrink-0 text-brand" />
          {brief.title}
        </span>
        <span className="text-[11px] text-ink-faint">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {brief.lines.map((l) => (
            <p key={l} className="text-[12.5px] leading-5 text-ink-soft">{l}</p>
          ))}
          {hasWarning && brief.warnings.map((w) => (
            <p key={w} data-testid="m-morning-warning" className="rounded-lg bg-warn-light px-2.5 py-1.5 text-[12px] font-medium text-warn-text">{w}</p>
          ))}
        </div>
      )}
    </section>
  );
}
