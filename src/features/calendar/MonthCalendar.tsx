import { useMemo, useState } from 'react';
import type { CalEvent } from '@/types';
import { addDays, fromISO, toISO, todayISO, weekdayOf } from '@/lib/date';
import { EVENT_STYLE } from '@/constants/chartColors';

interface Props {
  events: CalEvent[];
  selectedDate?: string;
  onSelectDate: (iso: string) => void;
}

export function MonthCalendar({ events, selectedDate, onSelectDate }: Props) {
  const today = todayISO();
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const eventMap = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of events) (map[e.date] ??= []).push(e);
    return map;
  }, [events]);

  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const offset = (first.getDay() + 6) % 7; // 周一=0
    const start = addDays(toISO(first), -offset);
    const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, i) => {
      const iso = addDays(start, i);
      const d = fromISO(iso);
      return { iso, inMonth: d.getMonth() === ym.m && d.getFullYear() === ym.y };
    });
  }, [ym]);

  const shift = (delta: number) => {
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const monthLabel = `${ym.y} 年 ${ym.m + 1} 月`;
  const weekHeader = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div>
      {/* Small previous/next controls leave the calendar grid as the primary reading surface. */}
      <div className="mb-5 flex items-center justify-between">
        <button onClick={() => shift(-1)} className="icon-button" aria-label="上个月">‹</button>
        <div className="text-lg font-semibold tracking-tight text-ink">{monthLabel}</div>
        <button onClick={() => shift(1)} className="icon-button" aria-label="下个月">›</button>
      </div>

      {/* 周末用琥珀而不是品牌靛蓝：否则会和「今天 / 已选」的主色撞在一起，弱化选中态。 */}
      <div className="mb-2 grid grid-cols-7">
        {weekHeader.map((w, i) => (
          <div key={w} className={`py-2 text-center text-[11px] font-semibold ${i >= 5 ? 'text-accent' : 'text-ink-faint'}`}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {cells.map(({ iso, inMonth }) => {
          const dayNum = fromISO(iso).getDate();
          const isToday = iso === today;
          const isSelected = iso === selectedDate;
          const evs = eventMap[iso] ?? [];
          const wd = weekdayOf(iso);
          const weekend = wd === 0 || wd === 6;

          return (
            <button
              key={iso}
              onClick={() => inMonth && onSelectDate(iso)}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-all duration-300 ease-in-out ${
                !inMonth ? 'text-transparent pointer-events-none' : ''
              } ${
                isToday
                  ? 'border-brand bg-brand text-white font-semibold shadow-sm'
                  : isSelected
                    ? 'border-brand/30 bg-brand-light text-brand font-semibold'
                    : weekend
                      ? 'border-transparent text-ink-soft hover:border-ink/10 hover:bg-white'
                      : 'border-transparent text-ink hover:border-ink/10 hover:bg-white'
              }`}
            >
              <span className="tabular-nums">{dayNum}</span>
              {evs.length > 0 && (
                <span className="mt-1 flex gap-0.5">
                  {evs.slice(0, 2).map((e, i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: isToday ? '#fff' : EVENT_STYLE[e.type].dot }}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-ink-faint">
        {Object.entries(EVENT_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.dot }} />
            {v.label}
          </span>
        ))}
      </div>
    </div>
  );
}
