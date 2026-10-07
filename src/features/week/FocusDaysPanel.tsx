/**
 * FocusDaysPanel —— 「选择想安排的日期」段（W3/P1-5b.1 · 2026-10-07）
 * ============================================================
 * 从 WeekView 原样搬来（周视图单窗口化后挂到「日程」页顶部）。
 * P1-5d 新增：总览点某天进来时（focusedDay），那一格显著高亮 + 「你点的那天」
 * 角标；若该天还没选上，再给一枚「加进想安排的日期」小按钮（点了 = onToggleDay）。
 */
import { useMemo } from 'react';
import { weekDates } from '@/lib/date';

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

interface Props {
  weekMonday: string;
  selectedDays: string[];
  /** 总览点进来的那一天（ISO）；null = 没有定位目标 */
  focusedDay: string | null;
  onToggleDay: (iso: string) => void;
  onSelectWholeWeek: () => void;
  onClearDays: () => void;
}

export function FocusDaysPanel({ weekMonday, selectedDays, focusedDay, onToggleDay, onSelectWholeWeek, onClearDays }: Props) {
  const days = useMemo(() => weekDates(weekMonday), [weekMonday]);
  const selectedSet = useMemo(() => new Set(selectedDays), [selectedDays]);

  return (
    <section className="panel p-4 sm:p-5" data-testid="focus-days-panel">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="section-label">FOCUS DAYS</p>
          <h3 className="mt-3 text-lg font-semibold tracking-tight text-ink">选择想安排的日期</h3>
        </div>
        <div className="flex gap-3 text-sm">
          <button onClick={onSelectWholeWeek} className="font-semibold text-brand transition-colors hover:text-brand-dark">整周</button>
          <button onClick={onClearDays} className="font-medium text-ink-faint transition-colors hover:text-ink">清空</button>
        </div>
      </div>
      {/* W6-A（CY 拍板「A 硬约束」）：诚实说明约束语义 —— 这排不再是装饰 */}
      <p className="-mt-2 mb-3 text-[11.5px] leading-5 text-ink-soft" data-testid="focus-days-hint">
        选中的天会真的排上自习与任务；没选的天只留课程和三餐。全不选 = 整周照常。
      </p>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((d, i) => {
          const sel = selectedSet.has(d);
          const isFocused = focusedDay === d;
          return (
            <div
              key={d}
              className={`relative flex min-h-16 flex-col rounded-xl border transition-all duration-fast ease-out ${
                isFocused ? 'ring-2 ring-brand ring-offset-1' : ''
              } ${sel ? 'border-brand bg-brand text-white shadow-sm' : 'border-ink/10 bg-white text-ink-soft hover:border-brand/30 hover:bg-brand-light/30'}`}
            >
              {isFocused && (
                <span
                  data-testid="focus-day-you-clicked"
                  className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-medium text-white shadow-sm"
                >
                  你点的那天
                </span>
              )}
              <button
                onClick={() => onToggleDay(d)}
                aria-label={`${DAY_LABELS[i]} ${d}${sel ? '，已选' : ''}`}
                className="flex flex-1 flex-col items-center justify-center py-2"
              >
                <span className="text-xs font-medium">{DAY_LABELS[i]}</span>
                <span className="mt-1 text-sm font-semibold tabular-nums">{Number(d.slice(8, 10))}</span>
              </button>
              {isFocused && !sel && (
                <button
                  data-testid="focus-day-add"
                  onClick={() => onToggleDay(d)}
                  className="pb-1 text-[9px] font-medium text-brand underline underline-offset-1"
                >
                  加进想安排的日期
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
