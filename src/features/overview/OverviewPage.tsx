import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { PersonaProfile, Schedule } from '@/types';
import { CAL_EVENTS } from '@/data/usst';
import { fromISO, mondayOf } from '@/lib/date';
import { MonthCalendar } from '@/features/calendar/MonthCalendar';
import { DeadlineBoard } from '@/features/calendar/DeadlineBoard';
import { TodayCard } from '@/features/overview/TodayCard';
import { WeekStrip } from '@/features/overview/WeekStrip';
import { OverviewStats } from '@/features/overview/OverviewStats';

interface Props {
  schedule: Schedule;
  weekNo: number;
  todayIso: string;
  persona: PersonaProfile | null;
  selectedDate?: string;
  onOpenWeek: (iso: string) => void;
  onStartPersona: () => void;
  /** §11.3 ④ 每张卡可下钻：数字卡点了去对应页（缺省则该卡不显示可点样式） */
  onGotoTodos?: () => void;
  onGotoGoals?: () => void;
  onGotoProfile?: () => void;
  /** V0-3：onboarding checklist 卡（App 组装，全部完成时组件自隐藏） */
  onboardingCard?: React.ReactNode;
}

/**
 * 总览页。
 *
 * 排列顺序就是回答问题的顺序：现在要干嘛（今日卡）→ 这周什么节奏（七天条）
 * → 学期上还有什么（校历 / 节点）。校历默认收起，因为它的职能是导航而不是内容，
 * 不该比实际内容占更大面积。
 *
 * 设计总成 §11.3 版式对账（2026-10-08 页面模板批）：
 *   ① 深色焦点卡全页唯一 ✅（TodayCard；校历与节点都是浅色卡）
 *   ② 一张「一周节奏」横条 + 今天高亮 ✅（WeekStrip 已按 34px 横条重做，
 *      取代原先那张「把课表搬来」的七列竖柱图）
 *   ③ 3–4 个数字卡、每张配 `.dz` 迷你示意 ✅（OverviewStats，四张）
 *   ④ 每张卡可下钻 ✅（节奏格进那一周；待办 / 投入 / 画像卡进对应页）
 *   跨度只用 4/6/8/12（§8.5）：左 8 右 4，checklist 整行 12。
 */
export function OverviewPage({
  schedule, weekNo, todayIso, persona, selectedDate, onOpenWeek, onStartPersona,
  onGotoTodos, onGotoGoals, onGotoProfile, onboardingCard,
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
    /* UI v2 D3：12 列 Bento（跨度只用 4/6/8/12，设计稿 §10 容器纪律）——
       左 8 右 4；onboardingCard 占整行 12。三档容器由 page-shell（1200px=default 档）承担。 */
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
      {onboardingCard && <div className="lg:col-span-12">{onboardingCard}</div>}
      <div className="flex flex-col gap-4 lg:col-span-8">
        <TodayCard
          schedule={schedule}
          todayIso={todayIso}
          weekNo={weekNo}
          persona={persona}
          onOpenWeek={() => onOpenWeek(todayIso)}
          onStartPersona={onStartPersona}
        />

        <OverviewStats
          schedule={schedule}
          weekNo={weekNo}
          todayIso={todayIso}
          persona={persona}
          onGotoTodos={onGotoTodos}
          onGotoGoals={onGotoGoals}
          onGotoProfile={onGotoProfile}
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
              <h2 className="mt-2 flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
                <Icon name="calendar-days" size="md" className="shrink-0 text-brand" />
                校历
              </h2>
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

      <aside className="lg:col-span-4 lg:sticky lg:top-20">
        <DeadlineBoard />
      </aside>
    </div>
  );
}
