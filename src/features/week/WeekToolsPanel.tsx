/**
 * 周计划页 · 工具面板栈（F2d/A5 拆出的第 ⑤ 组纯展示子组件 · 架构规格书 §8.1）
 * ============================================================
 * 从 `WeekPlanView.tsx` 原样搬出：操作条（回到今天/撤销/重做/重新排一遍/**⚙️ 调整**）
 * 与高频用户干预面板（偏好校正采集/容量预警）。
 *
 * 2026-09-28：低频面板（加一件事 / 指定食堂 / 不可时段 / 调课停课 / 偏好校正清单）
 * 全部收进「⚙️ 调整」抽屉（`AdjustDrawer`）——本组件只留那个**触发按钮**，
 * 按钮与上面四个操作同级，抽屉本体由 `WeekPlanView` 渲染。
 *
 * 2026-10-07：**「🏠 我的住处」「⏰ 我的作息」搬去「我的画像」页**
 * （`features/week/HardBoundaryCard.tsx`，经组合根注入 `PersonaResult`）——
 * 它们不是「这周临时调一下」的干预项，而是长期硬边界，放画像页语义更顺；
 * 本面板因此不再接收 `layer` / `updateLayer` 两个 props。
 *
 * 纯展示：不取数、不落库 —— 所有变更经回调上抛（T3 攒批语义不变）。
 */
import type { UserTask } from '@/lib/planner/templates';
import type { CorrectionRule } from '@/lib/planner/corrections';
import type { Goal } from '@/features/activity/goalStore';
import { saveGoals } from '@/features/activity/goalStore';
import { addDays } from '@/lib/date';
import { engineLabel } from '@/lib/engineMode';
import { useEngineMode } from './useEngineMode';
import { SlotEditor } from './SlotEditor';
import { CourseOverrideEditor } from './CourseOverrideEditor';
import { PendingEditsBar, countPendingEdits } from './PendingEditsBar';
import { CorrectionCapture } from '@/features/feedback/CorrectionCapture';
import { LearnedPreferencesPanel } from '@/features/feedback/LearnedPreferencesPanel';
import { AchievementPanel } from '@/features/activity/GoalEditor';
import type { CorrectionRule as CorrectionRuleT } from '@/lib/planner/corrections';

/** 目标分解容量预警（useWeekPlan 产出） */
export interface GoalWarningLike {
  goalId: string;
  message: string;
}

export interface WeekToolsPanelProps {
  weekNo: number;
  goals: readonly Goal[];
  rules: CorrectionRule[];
  /** 目标变更（视图持有 goals state；store 落库在回调里完成） */
  onGoalsChange: (next: Goal[]) => void;
  notify: (kind: 'add' | 'delete' | 'move' | 'info', message: string, action?: { label: string; run: () => void }) => void;
  /* 操作条 */
  onGoToToday?: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  undoDepth: number;
  redoDepth: number;
  setReplanToken: (next: number | ((v: number) => number)) => void;
  /** 打开「⚙️ 调整」抽屉（按钮在操作条那一排；抽屉状态归 WeekPlanView） */
  onOpenAdjust: () => void;
  /* T3「攒批」标记：视图层已记下改动但尚未应用 */
  pendingEdits: boolean;
  /** 本周被改过时间/地点的块 id —— 待生效状态条数「改了 N 处」的来源 */
  editedBlockIds: ReadonlySet<string>;
  /** 「已跳过 N 块」的判定仍要看它（状态条的"查看改动"接的是「全部恢复」） */
  edits: { userTasks: UserTask[]; excludedBlockIds: string[] };
  handleRestoreAll: () => void;
  /* 面板回调 */
  timeAskNote: string | null;
  handleAddRule: (rule: CorrectionRuleT) => void;
  handleAddTaskFromDraft: (draft: import('@/features/feedback/planIntent').TaskDraft) => void;
  handleRemoveBlocks: (days: import('@/types').DayOfWeek[], blockKind?: import('@/types').BlockKind) => void;
  /* 拖拽反馈 + 容量预警 */
  dragNote: string | null;
  goalWarnings: GoalWarningLike[];
  dismissedWarnings: string[];
  setDismissedWarnings: (updater: (prev: string[]) => string[]) => void;
}

export function WeekToolsPanel({
  weekNo, goals, onGoalsChange, notify,
  onGoToToday, handleUndo, handleRedo, undoDepth, redoDepth, setReplanToken,
  onOpenAdjust,
  pendingEdits, editedBlockIds, edits, handleRestoreAll,
  timeAskNote,
  handleAddRule, handleAddTaskFromDraft, handleRemoveBlocks,
  dragNote, goalWarnings, dismissedWarnings, setDismissedWarnings,
}: WeekToolsPanelProps) {
  /* 引擎切换（2026-10-06）：全局单例，读同一份真源 —— 见 `@/lib/engineMode` */
  const [engineMode, setEngineMode] = useEngineMode();

  /* 待生效计数（提案第 7 条）。纯函数 `countPendingEdits`，口径与 BlockCard 的
     「✏️ 已改」同源（都取 `editedBlockIds`），不另立一套判断。 */
  const pendingItems = countPendingEdits({
    pendingEdits,
    excludedCount: edits.excludedBlockIds.length,
    userTaskCount: edits.userTasks.length,
    editedIds: editedBlockIds,
  });
  return (
    <>
      {/* 操作条：回到今天 / 撤销 / 重做 / 重新排一遍 */}
      <div className="flex flex-wrap items-center gap-2">
        {onGoToToday && (
          <button
            type="button"
            onClick={() => {
              onGoToToday();
              // 切周渲染完成后再定位：把今天那一列滚到视口中央，当天安排完整可见
              window.setTimeout(() => {
                document.querySelector('[data-today-col]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 80);
            }}
            title="回到今天所在的那一周，并定位到今天"
            className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-ink-soft ring-1 ring-ink/15 transition hover:bg-slate-50"
          >
            📍 回到今天
          </button>
        )}
        <button
          type="button"
          onClick={handleUndo}
          disabled={undoDepth === 0}
          title="撤销上一步改动（Ctrl+Z）"
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ring-1 transition ${
            undoDepth > 0
              ? 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'
              : 'cursor-not-allowed bg-white/50 text-ink-faint/50 ring-ink/10'
          }`}
        >
          ↩ 撤销{undoDepth > 0 ? `（${undoDepth}）` : ''}
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={redoDepth === 0}
          title="重做（Ctrl+Shift+Z）"
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ring-1 transition ${
            redoDepth > 0
              ? 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'
              : 'cursor-not-allowed bg-white/50 text-ink-faint/50 ring-ink/10'
          }`}
        >
          ↪ 重做{redoDepth > 0 ? `（${redoDepth}）` : ''}
        </button>
        <button
          type="button"
          onClick={() => setReplanToken((v) => v + 1)}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ring-1 transition ${
            pendingEdits
              ? 'bg-slate-800 text-white ring-slate-800'
              : 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'
          }`}
        >
          重新排一遍
        </button>
        {/* ⚙️ 调整：与上面四个操作同级 —— 低频干预入口（加事/调课/不可时段/食堂/偏好）
            收敛成一个抽屉。按钮放这一排，抽屉本体由 WeekPlanView 渲染。 */}
        <button
          type="button"
          onClick={onOpenAdjust}
          title="加一件事 / 调课停课 / 不可时段 / 指定食堂 / 偏好校正"
          className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-ink-soft ring-1 ring-ink/15 transition hover:bg-slate-50"
        >
          ⚙️ 调整
        </button>
        {/* 引擎切换（2026-10-06）：本地引擎 vs 移植进来的 CY 引擎。
            同一份输入、两套算法 —— 切完周计划会自动重排，直接对比产出差异。
            开关是全局单例（`@/lib/engineMode`），本机专属、不上云。 */}
        <div
          className="ml-auto flex items-center gap-0.5 rounded-lg border border-ink/10 bg-white p-0.5"
          title={`当前引擎：${engineLabel(engineMode)}`}
        >
          <span className="px-1.5 text-[11px] text-ink-faint">引擎</span>
          {(['ours', 'cy'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEngineMode(m)}
              aria-pressed={engineMode === m}
              title={m === 'cy' ? 'CY 线（beta-v2 @ 950f2ace）移植版引擎' : '本地线（feat/ux-round4）引擎'}
              className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
                engineMode === m
                  ? 'bg-brand text-white'
                  : 'text-ink-soft hover:bg-brand-light hover:text-brand'
              }`}
            >
              {m === 'cy' ? 'CY' : '本地'}
            </button>
          ))}
        </div>
        {/* T3：改动不再自动应用 —— 必须**明说**还没生效，否则用户会以为按钮坏了。
            ⚠️ 2026-10-07：原先这里是两个小字（"你加了 N 件事"/"已跳过 N 块"）+
            一句"点左边「重新排一遍」才会生效"，全和四个操作按钮并排在同一个
            flex-wrap 里 ⟹ **位置随窗口宽度漂移**，"点左边"在换行后还会指错地方。
            现在统一交给下方那条**独立状态条**（带摘要 + 就地主 CTA + 全部恢复）。 */}
      </div>

      {/* 「有改动待生效」独立状态条（提案第 7 条）。放操作条**之后**、日列之前：
          它是「操作条的下文」，用户读完按钮就往下看到"那这些改动还没生效"。
          🔑 计数用纯函数 `countPendingEdits`，口径与 BlockCard 的「✏️ 已改」同源。 */}
      {pendingEdits && pendingItems.length > 0 && (
        <PendingEditsBar
          edits={pendingItems}
          onReplan={() => setReplanToken((v) => v + 1)}
          onInspect={edits.excludedBlockIds.length > 0 ? handleRestoreAll : undefined}
        />
      )}

      {/* 🏠 我的住处 / ⏰ 我的作息 已于 2026-10-07 搬到「我的画像」页
          （`features/week/HardBoundaryCard.tsx`，由组合根 App.tsx 注入 `PersonaResult`）。
          本面板不再重复挂载 —— 两处入口同一份 store 的老口径不变，只是位置换了。 */}

      {timeAskNote && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
          {timeAskNote}
        </div>
      )}

      {/* ── 阶段 B：偏好校正层（采集建议；清单本体在「⚙️ 调整」抽屉） ── */}
      <CorrectionCapture
        onAdd={handleAddRule}
        onAddTask={handleAddTaskFromDraft}
        onRemoveBlocks={handleRemoveBlocks}
      />

      {/* R1：拖拽如实提示（放不下/课程不能删） */}
      {dragNote && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
          {dragNote}
        </div>
      )}

      {/* 目标分解容量预警（诚实原则：排不下就明说，三选项由用户定） */}
      {goalWarnings.filter((w) => !dismissedWarnings.includes(w.goalId)).length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
          {goalWarnings.filter((w) => !dismissedWarnings.includes(w.goalId)).map((w) => {
            const g = goals.find((x) => x.id === w.goalId);
            const apply = (patch: Partial<Goal>, message: string) => {
              if (!g) return;
              const next = goals.map((x) => (x.id === g.id ? { ...x, ...patch } : x));
              saveGoals(next);
              onGoalsChange(next);
              setDismissedWarnings((prev) => [...prev, w.goalId]);
              notify('info', `${message} —— 点「重新排一遍」生效`);
            };
            return (
              <div key={w.goalId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>⚠️ {w.message}</span>
                {g?.dueAt && (
                  <button type="button" onClick={() => apply({ dueAt: addDays(g.dueAt!, 14) }, '已延长截止 2 周')} className="rounded bg-white px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline">
                    延 2 周
                  </button>
                )}
                {g?.totalHours && (
                  <button type="button" onClick={() => apply({ totalHours: Math.round(g.totalHours! * 0.8 * 10) / 10 }, '已减少 20% 总时长')} className="rounded bg-white px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline">
                    减 20%
                  </button>
                )}
                {g?.pace !== 'sprint' && (
                  <button type="button" onClick={() => apply({ pace: 'sprint' }, '已切换为冲刺节奏')} className="rounded bg-white px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline">
                    转冲刺
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
