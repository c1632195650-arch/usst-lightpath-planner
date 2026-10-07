import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { PersonaProfile, Schedule } from '@/types';
import { CAL_EVENTS } from '@/data/usst';
import { fromISO, mondayOf } from '@/lib/date';
import { MonthCalendar } from '@/features/calendar/MonthCalendar';
import { DeadlineBoard } from '@/features/calendar/DeadlineBoard';
import { TodayCard } from '@/features/overview/TodayCard';
import { WeekStrip } from '@/features/overview/WeekStrip';
import { OverviewStats, PersonaStatusCard } from '@/features/overview/OverviewStats';

interface Props {
  schedule: Schedule;
  weekNo: number;
  todayIso: string;
  persona: PersonaProfile | null;
  selectedDate?: string;
  onOpenWeek: (iso: string) => void;
  onStartPersona: () => void;
  /** §11.3 ④ 每张卡可下钻：数字卡点了去对应页（缺省则该卡不渲染可点样式与箭头） */
  onGotoTodos?: () => void;
  onGotoGoals?: () => void;
  onGotoProfile?: () => void;
}

/**
 * 总览页 · 12 列 Bento（设计总成 §11.3）
 * ============================================================
 * **2026-10-08 版式对齐（页面模板批）**：此前是「左 8 右 4 两栏堆叠」——数字卡与节奏条
 * 都挤在左 8 里，与升级案 HTML 的 Bento 结构对不上。现按 §11.3 的 mock 原样排：
 *
 *   ┌ 深色焦点卡（span 12，全页唯一的「重」）─────────────────┐
 *   ├ 本周课时 (4) │ 待办 (4)     │ 连续记录 (4)             ┤
 *   ├ 一周节奏 (8) ──────────────│ 状态 (4)                 ┤
 *   ├ 校历 (6) ──────────────────│ 接下来的节点 (6)          ┤
 *
 * 跨度只用 4 / 6 / 8 / 12（§8.5 明令不用 5 和 7 —— 既切不出三等分也切不出两等分）。
 * 「必须有 / 绝不能有」四条逐条对账：
 *   ① 深色焦点卡全页唯一 ✅（TodayCard；其余全是浅色卡）
 *   ② 一张「一周节奏」横条 + 今天高亮 ✅（WeekStrip 已按 34px 横条重做）
 *   ③ 3 个数字卡、每张配 `.dz` 迷你示意 ✅（OverviewStats；状态卡另占一格，同规范 mock）
 *   ④ 每张卡可下钻 ✅（节奏格 → 那一周；待办/连续记录/状态卡 → 对应页；节点行 → 那一周）
 *   ✕ 第二张深色卡 / 完整课表搬到总览 / 纯数字卡堆叠 / 不可点的信息砖 —— 均无
 */
export function OverviewPage({
  schedule, weekNo, todayIso, persona, selectedDate, onOpenWeek, onStartPersona,
  onGotoTodos, onGotoGoals, onGotoProfile,
}: Props) {
  /* 校历默认展开（2026-10-08 两侧栏批）：左栏是 300×整带高度，收起态在里面几乎全空；
     展开的月历正好填满这根栏。要回到「默认收起」改回 useState(false) 即可。 */
  const [calendarOpen, setCalendarOpen] = useState(true);

  /** 收起态展示本月节点数，让用户知道展开能看到什么。 */
  const thisMonth = fromISO(todayIso).getMonth();
  const thisYear = fromISO(todayIso).getFullYear();
  const monthEventCount = CAL_EVENTS.filter((event) => {
    const d = fromISO(event.date);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  return (
    /* 总览仪表盘栅格（lg+ 一屏不滚动）。
       ⚠️ **JSX 顺序 = 栅格排布顺序**：CSS 栅格是稀疏自动排布，item 按 DOM 顺序找第一个空位。
       所以两侧栏必须在 DOM 里**先于**要夹住的卡片出现，否则会被挤到第三行去
       （踩过：校历/节点写在末尾 → 它们落到了模块带下面的新行，两侧还是空的）。
       正确顺序：焦点卡 → 校历(跨两行) → 三张数字卡 → 节点(跨两行) → 一周节奏 → 状态。
       12 列分配（CY 圈定「两侧栏夹住中间」）：校历 3 ┃ 课时 2 · 待办 2 · 连续 2 ┃ 节点 3；
       下一行 节奏 4 ┃ 状态 2（中间 6 列）。竖线落在 25% / 41.7% / 58.3% / 75%，
       且 58.3% 那条上下贯通（待办|连续 与 节奏|状态 对齐）。 */
    <div className="overview-grid">
      <div className="lg:col-span-12">
        <TodayCard
          schedule={schedule}
          todayIso={todayIso}
          weekNo={weekNo}
          persona={persona}
          onOpenWeek={() => onOpenWeek(todayIso)}
          onStartPersona={onStartPersona}
        />
      </div>

      {/* 两侧栏之一：校历常驻最左一列，`row-span-2` 贯穿整个「模块带」（下面两行）。 */}
      <section className="overview-rail panel flex min-h-0 flex-col p-4 lg:col-span-3 lg:row-span-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
              <Icon name="calendar-days" size="sm" className="shrink-0 text-brand" />
              校历
            </h2>
            {!calendarOpen && (
              <p className="mt-1 text-[12px] text-ink-soft">
                本月 {monthEventCount} 个校园节点 · 展开可按日期跳到那一周
              </p>
            )}
          </div>
          <button
            onClick={() => setCalendarOpen((open) => !open)}
            aria-expanded={calendarOpen}
            className="button-secondary shrink-0 px-3 py-1.5 text-[12.5px]"
          >
            {calendarOpen ? '收起' : '展开'}
          </button>
        </div>

        {calendarOpen && (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-ink/10 pt-3">
            <MonthCalendar
              events={CAL_EVENTS}
              selectedDate={selectedDate}
              onSelectDate={onOpenWeek}
            />
          </div>
        )}
      </section>

      {/* 模块带第一行：三张数字卡（各自 lg:col-span-2，共 6 列）—— 夹在两侧栏之间 */}
      <OverviewStats
        schedule={schedule}
        weekNo={weekNo}
        todayIso={todayIso}
        persona={persona}
        onGotoTodos={onGotoTodos}
        onGotoGoals={onGotoGoals}
      />

      {/* 两侧栏之二：接下来的节点常驻最右一列，同样贯穿整个模块带（内部滚动）。 */}
      <div className="overview-rail min-h-0 lg:col-span-3 lg:row-span-2">
        <DeadlineBoard />
      </div>

      {/* 模块带第二行：一周节奏 span 4 + 状态 span 2（中间 6 列）。 */}
      <div className="lg:col-span-4">
        <WeekStrip
          schedule={schedule}
          weekNo={weekNo}
          weekMonday={mondayOf(todayIso)}
          todayIso={todayIso}
          onSelectDay={onOpenWeek}
        />
      </div>

      <PersonaStatusCard persona={persona} onGotoProfile={onGotoProfile} />
    </div>
  );
}
