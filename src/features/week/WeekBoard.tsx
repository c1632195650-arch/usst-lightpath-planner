import { useMemo } from 'react';
import type { DayOfWeek, PlanIssue, TimeBlock } from '@/types';
import { addDays } from '@/lib/date';

/**
 * 周概览 · 七密度卡（UI v2 批次 D2，设计稿 §4.2 上层）
 * ============================================================
 * 上层是「节奏尺」，不是「内容墙」：每张卡只有 星期+日期 / 4px 密度条 / 条数统计，
 * 不显示课程名。今天 = 上理红描边 + 红日期；周末 = 斜纹表示「可自由支配」。
 * 点卡 → 下潜到当日流水（DayAgenda）。冲突数只认 time-conflict 机器码。
 */

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

interface Props {
  blocks: TimeBlock[];
  issues: PlanIssue[];
  /** 当前周的周一 ISO（算日期号用） */
  weekMonday: string;
  /** 今天在本周的星期几（1-7；不在本周 = null，不描红） */
  todayDow: DayOfWeek | null;
  /** 当前下潜选中的天（卡上高亮） */
  selectedDay: DayOfWeek | null;
  onSelectDay: (d: DayOfWeek) => void;
}

export function WeekBoard({ blocks, issues, weekMonday, todayDow, selectedDay, onSelectDay }: Props) {
  const perDay = useMemo(() => {
    const counts = new Map<DayOfWeek, { n: number; hasSolid: boolean }>();
    for (let d = 1 as DayOfWeek; d <= 7; d++) {
      const list = blocks.filter((b) => b.dayOfWeek === d && b.kind !== 'commute' && b.kind !== 'blank');
      counts.set(d, { n: list.length, hasSolid: list.length > 0 });
    }
    return counts;
  }, [blocks]);

  const conflictByDay = useMemo(() => {
    const m = new Map<DayOfWeek, number>();
    for (const iss of issues) {
      if (iss.code !== 'time-conflict' || iss.blockId == null) continue;
      const b = blocks.find((x) => x.id === iss.blockId);
      if (b) m.set(b.dayOfWeek, (m.get(b.dayOfWeek) ?? 0) + 1);
    }
    return m;
  }, [issues, blocks]);

  return (
    <div data-testid="week-board" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      {DAY_LABELS.map((label, i) => {
        const day = (i + 1) as DayOfWeek;
        const date = new Date(`${addDays(weekMonday, i)}T00:00:00`);
        const isToday = todayDow === day;
        const isSelected = selectedDay === day;
        const stat = perDay.get(day) ?? { n: 0, hasSolid: false };
        const conflicts = conflictByDay.get(day) ?? 0;
        const weekend = day >= 6;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelectDay(day)}
            className={[
              'lift rounded-xl border bg-white p-2.5 text-left',
              'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
              'hover:border-brand/30 hover:bg-brand-light/25',
              isToday ? 'border-school-red/60 shadow-[inset_0_0_0_1px_rgba(158,27,50,0.35)]' : 'border-ink/10',
              isSelected ? 'ring-2 ring-brand/40' : '',
              weekend && !stat.hasSolid ? 'weekend-hatch' : '',
            ].join(' ')}
          >
            <span className="flex items-baseline justify-between gap-1">
              <span className={`text-[11px] font-semibold ${isToday ? 'text-school-red' : 'text-ink-soft'}`}>
                {label}{isToday ? '·今' : ''}
              </span>
              <span className={`text-sm font-semibold tabular-nums ${isToday ? 'text-school-red' : 'text-ink'}`}>
                {date.getDate()}
              </span>
            </span>
            {/* 密度条：一格一事，最多 8 格（>8 折叠），4px 高——节奏尺不画内容 */}
            <span className="mt-2 flex h-1 items-stretch gap-0.5" aria-hidden="true">
              {Array.from({ length: Math.min(stat.n, 8) }, (_, k) => (
                <span key={k} className="h-1 w-full rounded-full bg-brand/70" />
              ))}
              {stat.n === 0 && <span className="h-1 w-full rounded-full bg-ink/[0.08]" />}
              {stat.n > 8 && <span className="h-1 w-2 rounded-full bg-brand/40" />}
            </span>
            <span className="mt-1.5 block text-[10.5px] font-medium tabular-nums">
              {stat.n === 0
                ? <span className="text-ink-faint">空闲</span>
                : <span className="text-ink-soft">{stat.n} 项{conflicts > 0 && <span className="ml-1 text-[#965C18]">· {conflicts} 冲突</span>}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
