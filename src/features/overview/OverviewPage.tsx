import { useState } from 'react';
import type { PersonaProfile, Schedule } from '@/types';
import { CAL_EVENTS } from '@/data/usst';
import { fromISO, mondayOf } from '@/lib/date';
import { MonthCalendar } from '@/features/calendar/MonthCalendar';
import { DeadlineBoard } from '@/features/calendar/DeadlineBoard';
import { TodayCard } from '@/features/overview/TodayCard';
import { WeekStrip } from '@/features/overview/WeekStrip';

interface Props {
  schedule: Schedule;
  weekNo: number;
  todayIso: string;
  persona: PersonaProfile | null;
  selectedDate?: string;
  onOpenWeek: (iso: string) => void;
  onStartPersona: () => void;
}

/**
 * 总览页。
 *
 * 排列顺序就是回答问题的顺序：现在要干嘛（今日卡）→ 这周什么节奏（七天条）
 * → 学期上还有什么（校历 / 节点）。校历默认收起，因为它的职能是导航而不是内容，
 * 不该比实际内容占更大面积。
 */
export function OverviewPage({
  schedule, weekNo, todayIso, persona, selectedDate, onOpenWeek, onStartPersona,
}: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  /** 收起态展示本月节点数，让用户知道展开能看到什么。 */
  const thisMonth = fromISO(todayIso).getMonth();
  const thisYear = fromISO(todayIso).getFullYear();
  const monthEventCount = CAL_EVENTS.filter((event) => {
    const d = fromISO(event.date);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex flex-col gap-6">
        <TodayCard
          schedule={schedule}
          todayIso={todayIso}
          weekNo={weekNo}
          persona={persona}
          onOpenWeek={() => onOpenWeek(todayIso)}
          onStartPersona={onStartPersona}
        />

        <WeekStrip
          schedule={schedule}
          weekNo={weekNo}
          weekMonday={mondayOf(todayIso)}
          todayIso={todayIso}
          onSelectDay={onOpenWeek}
        />

        <section className="panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="section-label">CALENDAR</p>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink">校历</h2>
              {!calendarOpen && (
                <p className="mt-1 text-sm text-ink-soft">
                  本月 {monthEventCount} 个校园节点 · 展开可按日期跳到那一周
                </p>
              )}
            </div>
            <button
              onClick={() => setCalendarOpen((open) => !open)}
              aria-expanded={calendarOpen}
              className="button-secondary shrink-0 px-4 py-2 text-sm"
            >
              {calendarOpen ? '收起' : '展开'}
            </button>
          </div>

          {calendarOpen && (
            <div className="mt-6 border-t border-ink/10 pt-6">
              <MonthCalendar
                events={CAL_EVENTS}
                selectedDate={selectedDate}
                onSelectDate={onOpenWeek}
              />
            </div>
          )}
        </section>
      </div>

      <aside className="lg:sticky lg:top-20">
        <DeadlineBoard />
      </aside>
    </div>
  );
}
