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
import { Icon } from '@/components/icons/Icon';

export function MorningCard(props: {
  blocksToday: readonly TimeBlock[];
  nowMin: number;
  deadlines?: readonly BriefDeadline[];
}) {
  const [open, setOpen] = useState(true);
  const brief = useMemo(() => {
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return morningBrief({
      blocksToday: props.blocksToday, todos: [], goals: [],
      nowMin: props.nowMin, dateKey, deadlines: props.deadlines,
    });
  }, [props.blocksToday, props.nowMin, props.deadlines]);
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
