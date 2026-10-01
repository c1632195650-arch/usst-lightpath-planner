/**
 * 周计划页容器（F1 / 页面与使用逻辑规格书 §2.1 `#/week` + §2.2 + §4.2）
 * ============================================================
 * IA 变更：`weekMonday` 状态**从 App 移入周计划页**（D2 拍板允许的那 4 处之一）。
 *
 * 状态所有权（§4.2）：
 *   · `weekMonday`（本周一 ISO，null = 本周默认）→ 由**路由**持有（`#/week/<ISO-Monday>`，
 *     App 经 props 传入、变化经 `onWeekMondayChange` 写回 hash）—— 页内 ‹ › / 📍 只发事件；
 *   · `weekSubTab`（计划 / 课表）→ **页内交互态**，本组件持有（不进路由）；
 *   · 窗口级 ← → 键切周 —— 从 App 原样搬入（weekMonday 的原生地在这里了）。
 *
 * 两个子视图原样挂载，内容零改动：
 *   · WeekPlanView（计划时间轴，编辑主场）；
 *   · WeekView（课表网格，CY 地盘 —— 本文件只传 props，不碰它内部）。
 */
import { useEffect, useState } from 'react';
import type { PersonaProfile, PlanPersistState, Schedule } from '@/types';
import { currentWeekNo, mondayOfWeekNo, shiftWeekMonday } from '@/lib/date';
import { WeekView } from './WeekView';
import { WeekPlanView } from './WeekPlanView';

export interface WeekPlanPageProps {
  schedule: Schedule;
  /** 本周一（ISO）；null = 本周默认口径（与原 App 的 `weekMonday === null` 同义） */
  weekMonday: string | null;
  /** 页内换周（‹ › / 📍 / 子视图返回）→ App 写回 `#/week/<ISO>` */
  onWeekMondayChange: (monday: string | null) => void;
  persona: PersonaProfile | null;
  planState: PlanPersistState | null;
  onPlanStateChange: (next: PlanPersistState) => void;
  /* WeekView（课表网格）所需 —— 事实层，App 持有 */
  selectedDays: string[];
  onToggleDay: (iso: string) => void;
  onSelectWholeWeek: () => void;
  onClearDays: () => void;
}

/** 周视图子模式：课表网格 vs 排程计划时间轴 */
type WeekSubTab = 'timetable' | 'plan';

export function WeekPlanPage(props: WeekPlanPageProps) {
  const {
    schedule, weekMonday, onWeekMondayChange, persona, planState, onPlanStateChange,
    selectedDays, onToggleDay, onSelectWholeWeek, onClearDays,
  } = props;

  // 默认落在「周计划」：这是编辑主场（课表网格随时可切回）
  const [weekSubTab, setWeekSubTab] = useState<WeekSubTab>('plan');

  const weekNo = weekMonday
    ? currentWeekNo(schedule.termStart, weekMonday)
    : currentWeekNo(schedule.termStart);

  /** 平移 delta 周，并限定在 [第1周, 第 totalWeeks 周] 内（边界内停下，不循环）。
   *  鼠标 ‹ › 按钮与键盘左右键共用，保证两者行为一致。（原 App 实现原样搬入） */
  const shiftWeekBy = (d: number) => {
    const base = weekMonday;
    if (!base) return;
    const next = shiftWeekMonday(base, d);
    const n = currentWeekNo(schedule.termStart, next);
    if (n < 1 || n > schedule.totalWeeks) return; // 已在首/末周，不越界
    onWeekMondayChange(next);
  };

  // 窗口级键盘：← / → 切换上一周 / 下一周（本组件挂载 = 周计划页可见）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (weekMonday === null) return; // 与原口径一致：默认本周（无参数）时不响应
      // 排除输入框 / 文本域 / 可编辑区聚焦（聊天输入、文件选择等不被劫持）
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault(); // 阻止课程表横向滚动误触
      shiftWeekBy(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekMonday, schedule.termStart, schedule.totalWeeks]);

  return (
    <div className="space-y-3">
      {/* 课表 / 周计划 切换（子视图 tab，页内态，不进路由） */}
      <div className="flex items-center gap-1 rounded-xl border border-ink/10 bg-white p-1 w-fit">
        <button
          onClick={() => setWeekSubTab('timetable')}
          className={`nav-item whitespace-nowrap ${weekSubTab === 'timetable' ? 'nav-item-active' : ''}`}
        >
          课表
        </button>
        <button
          onClick={() => setWeekSubTab('plan')}
          className={`nav-item whitespace-nowrap ${weekSubTab === 'plan' ? 'nav-item-active' : ''}`}
        >
          周计划
        </button>
      </div>
      {weekSubTab === 'plan' ? (
        <WeekPlanView
          schedule={schedule}
          weekNo={weekNo}
          persona={persona}
          planState={planState}
          onPlanStateChange={onPlanStateChange}
          lifeMode={null}
        />
      ) : (
        <WeekView
          // 无参数 `#/week`（weekMonday=null）进课表子视图 → 回落本周一（不猜其它周）
          weekMonday={weekMonday ?? mondayOfWeekNo(schedule.termStart, weekNo)}
          weekNo={weekNo}
          schedule={schedule}
          selectedDays={selectedDays}
          onToggleDay={onToggleDay}
          onSelectWholeWeek={onSelectWholeWeek}
          onClearDays={onClearDays}
          onBack={() => onWeekMondayChange(null)}
          onShiftWeek={shiftWeekBy}
        />
      )}
    </div>
  );
}
