import { useMemo, useState } from 'react';
import type { CalEvent } from '@/types';
import { addDays, fromISO, toISO, todayISO, weekdayOf } from '@/lib/date';

const EVENT_STYLE: Record<CalEvent['type'], { dot: string; label: string; emoji: string }> = {
  term: { dot: '#d43a45', label: '学期', emoji: '🏫' },
  holiday: { dot: '#f5b840', label: '假期', emoji: '🎉' },
  anniversary: { dot: '#e0a21e', label: '校庆', emoji: '🎂' },
  exam: { dot: '#f07e88', label: '考试', emoji: '📝' },
  activity: { dot: '#4db98a', label: '活动', emoji: '🏆' },
};

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
      {/* 月份切换 */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shift(-1)} className="w-9 h-9 rounded-full grid place-items-center text-ink-soft hover:bg-brand/5 border-2 border-ink/10 shadow-sticker">‹</button>
        <div className="text-[17px] font-bold text-ink">{monthLabel}</div>
        <button onClick={() => shift(1)} className="w-9 h-9 rounded-full grid place-items-center text-ink-soft hover:bg-brand/5 border-2 border-ink/10 shadow-sticker">›</button>
      </div>

      {/* 星期表头 */}
      <div className="grid grid-cols-7 mb-1">
        {weekHeader.map((w, i) => (
          <div key={w} className={`text-center text-[12px] py-1.5 font-bold ${i >= 5 ? 'text-coral' : 'text-ink-soft'}`}>{w}</div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid grid-cols-7 gap-1">
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
              className={`relative aspect-[0.9] rounded-xl flex flex-col items-center justify-center transition-all text-[13.5px] ${
                !inMonth ? 'text-transparent pointer-events-none' : ''
              } ${
                isToday
                  ? 'bg-brand text-white font-bold shadow-sticker-brand scale-105'
                  : isSelected
                    ? 'bg-brand-light text-brand font-bold ring-2 ring-brand/40'
                    : weekend
                      ? 'text-ink-soft hover:bg-white hover:shadow-sticker'
                      : 'text-ink hover:bg-white hover:shadow-sticker'
              }`}
            >
              <span className="tabular-nums">{dayNum}</span>
              {evs.length > 0 && (
                <span className="flex gap-0.5 mt-0.5">
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

      {/* 图例 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-4 text-[11.5px] text-ink-faint">
        {Object.entries(EVENT_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="text-[12px]">{v.emoji}</span>
            {v.label}
          </span>
        ))}
      </div>
    </div>
  );
}
