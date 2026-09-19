/**
 * WeekPlanView —— 周计划时间轴（只读「感受测试」版）
 * ============================================================
 * 消费 `planWeek()` 的产物：一天一列时间轴，块上直接标
 * 「几分钟走到下一件事」，问题清单和「为什么这么排」都能看到。
 *
 * 这是排程引擎的第一个 UI 出口 —— 先让 CY **看**排得对不对，
 * 「改参数/改决定」的交互等感受反馈回来再做。
 *
 * 数据流（App → 本组件）：
 *   schedule + weekNo + persona
 *     → buildPhasesFromCalendar（这个阶段该多紧）
 *     → planWeek()（两遍法编排：第一遍收集点对 → 后端实测转场 → 第二遍真结果）
 *
 * ⚠️ 两遍法**不在本组件里手写**。编排已抽到 `planner/planWeek.ts`（唯一编排点），
 *    本组件只负责注入「怎么取转场」（浏览器里 = 调后端 route）和一个失败提示。
 *    原先是本组件与 `features/libao/weekPlanForChat.ts` 各写一份 —— 同一套编排
 *    写两份，任何一处调整都要改两遍，且必然漂移。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BlockKind, DayOfWeek, PlanIssue, PlanPersistState, Schedule, TimeBlock, WeekPlan,
} from '@/types';
import type { Diagnostics } from '@/lib/planner/model';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { toPlanRequest } from '@/lib/planner/schedule';
import { planWeek } from '@/lib/planner/planWeek';
import { fetchRouteBatch } from '@/lib/planner/transfer';
import { expandDeadlines, eventsNearWeek } from '@/lib/planner/events';
import { fetchWeather, weatherHints } from '@/features/weather/weather';
import type { WeatherAdvice, WeatherReport, WeatherDay } from '@/features/weather/weather';
// 行为记录（2026-09-19 起只读）：「做了/没做」入口已下线，历史记录仍喂 actualLoadByDow
import { loadRecords, actualLoadByDow } from '@/features/behavior/behaviorLog';
import type { BehaviorRecord } from '@/features/behavior/behaviorLog';
import {
  isLockedThisWeek, lockCount, lockedPlacementsOf, lockLevelsOf, longLockKey,
  rollingForWeek, withLongLock, withRolling, withoutLock, withoutLongLock,
} from '@/features/plan/planLock';
import { TERM_CALENDAR } from '@/constants/term';
import { toHHmm, humanizeMinutes } from '@/constants/time';
import { addDays, currentWeekNo, diffDays, todayISO, weekdayOf } from '@/lib/date';
import { DEADLINES } from '@/data/usst';
// ── 阶段 A：二次修改能力（加块 / 删块 / 手动重排）────────────────
import { AddTaskPanel } from './AddTaskPanel';
// ── R2：块级编辑（改时间/时长/地点，同日改）─────────────────────
import { EditBlockPanel } from './EditBlockPanel';
// ── R2：用户覆盖层（一次性收口所有用户改动）────────────────────
import {
  addTask, applyPendingMoves, canUndo, clearRedo, excludeBlock, includeBlock, loadUserPlan,
  makeLayerId, movesOfWeek, popRedo, popUndo, pushRedoSnapshot, pushUndoSnapshot,
  removeAssignment, removeMove, saveUserPlan, undoDepth, redoDepth,
  upsertAssignment, upsertMove,
  type Assignment, type MealPlaces, type UserPlanLayer,
} from './userPlanStore';
import { dragTo } from '@/lib/planner/ripple';
import { freeGapsOf, snap10, type TimeGap } from './timeScale';
import { Toasts, type ToastItem, type ToastKind } from './toast';
// 作业的**纯函数**仍从 assignmentStore 取（存储已并入覆盖层，那边只留纯逻辑）
import { assignmentId, assignmentsOfWeek, clampEstimate } from './assignmentStore';
// ── S4：用户指定食堂 ──────────────────────────────────────────
import { MealPlaceSetting } from './MealPlaceSetting';
import { SlotEditor } from './SlotEditor';
// ── R3：调课/停课覆盖层 + 时间追问 ────────────────────────────
import { CourseOverrideEditor } from './CourseOverrideEditor';
import { TimeAskDialog, type TimeAskRequest } from './TimeAskDialog';
import { DeleteAskDialog } from './DeleteAskDialog';
import { applyCourseOverrides } from '@/lib/planner/courseOverrides';
import { localizedPlan, unionAffectedDays } from '@/lib/planner/localizedReplan';
import { fillGap } from '@/lib/planner/ripple';
// ── R4 / R5：活动登记与成就统计 ────────────────────────────────
import { goalTasksOf, loadGoals } from '@/features/activity/goalStore';
import { AchievementPanel } from '@/features/activity/GoalEditor';
import type { UserTask } from '@/lib/planner/templates';
// ── 阶段 B/E：偏好校正层 + 自然语言意图 ──────────────────────────
import { CorrectionCapture } from '@/features/feedback/CorrectionCapture';
import { LearnedPreferencesPanel } from '@/features/feedback/LearnedPreferencesPanel';
import { loadRules, saveRules, upsertRule } from '@/features/feedback/store';
import { detectScope, scopeReason } from '@/features/feedback/parseCorrection';
import type { TaskDraft } from '@/features/feedback/planIntent';
import type { CorrectionRule } from '@/lib/planner/corrections';

interface Props {
  schedule: Schedule;
  weekNo: number;
  persona: import('@/types').PersonaProfile | null;
  /** 排程持久化状态（锁 / 扰动）—— 由 App 持有，本组件只读+回写 */
  planState: import('@/types').PlanPersistState | null;
  onPlanStateChange: (next: import('@/types').PlanPersistState) => void;
  /**
   * 当前生活模式（阶段 D）。
   *
   * 在这之前它**只影响配色与文案**（`weekPlanAdapter.ts`），
   * 点了「猛攻模式」排得一样松 —— 现在它会真正改变阶段策略的强度。
   */
  lifeMode: string | null;
}

/**
 * R6.1：这次排程「受影响的天」是哪些 —— `null` = 没有定点诉求，整周重排。
 *
 * 只看**能指出具体星期**的改动：不可时段、调课/停课、拖动/改块的位置、加的事。
 * 任一改动说不清哪天（例如没指定星期的事），就退回整周重排 ——
 * 那样虽然抖，但比「自以为知道其实不知道」安全。
 */
function localizedDaysFor(
  layer: UserPlanLayer,
  applied: ReadonlyArray<{ id: string; courseName: string }>,
  weekNo: number,
): number[] | null {
  const rules: Array<{ days?: number[] }> = [];
  for (const s of layer.slots) rules.push({ days: s.days });
  for (const m of layer.moves) if (m.weekNo === weekNo) rules.push({ days: [m.dayOfWeek] });
  for (const t of layer.tasks) if (t.dayOfWeek != null) rules.push({ days: [t.dayOfWeek] });
  for (const a of layer.assignments) void a;
  void applied;
  return unionAffectedDays(rules, weekNo);
}

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const KIND_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  course: { bg: 'bg-blue-100 border-blue-400', text: 'text-blue-900', label: '课' },
  meal: { bg: 'bg-amber-100 border-amber-400', text: 'text-amber-900', label: '饭' },
  study: { bg: 'bg-green-100 border-green-400', text: 'text-green-800', label: '学' },
  activity: { bg: 'bg-purple-100 border-purple-400', text: 'text-purple-900', label: '动' },
  user: { bg: 'bg-pink-100 border-pink-400', text: 'text-pink-900', label: '我' },
  commute: { bg: 'bg-gray-100 border-gray-400', text: 'text-gray-700', label: '走' },
  blank: { bg: 'bg-white border-gray-200', text: 'text-gray-400', label: '空' },
};

const ISSUE_STYLE = {
  error: 'bg-red-50 border-red-300 text-red-800',
  warn: 'bg-amber-50 border-amber-300 text-amber-800',
  info: 'bg-blue-50 border-blue-300 text-blue-800',
} as const;

/**
 * 「现在几点」→ 当日绝对分钟。UI 层读时钟是允许的（引擎层不许，见规格书纯函数纪律）。
 *
 * 取整到 **5 分钟**而不是精确到分：否则用户 14:03 打开页面、14:04 刷新，
 * `fromNow` 变了 → 引擎重排 → 一整列块微调，看起来像「页面自己乱动」。
 * 对齐到 5 分钟档位后，同一档内多次重排结果一致。
 */
function nowMinutes(): number {
  const d = new Date();
  const raw = d.getHours() * 60 + d.getMinutes();
  return Math.floor(raw / 5) * 5;
}

/**
 * 两份滚动状态是否等价 —— 用来避免无意义的持久化写入。
 *
 * 为什么不直接 `JSON.stringify` 比较：`rolling.upcoming` 是数组，
 * 顺序理论上稳定，但直接用字符串比较会因任何字段顺序差异误判为「变了」，
 * 从而多写一次 localStorage 并触发下一轮渲染。逐字段比更准也更省。
 */
function sameRolling(
  a: PlanPersistState['rolling'],
  b: PlanPersistState['rolling'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.recentLoad.length !== b.recentLoad.length) return false;
  for (let i = 0; i < a.recentLoad.length; i++) {
    if (a.recentLoad[i] !== b.recentLoad[i]) return false;
  }
  if (a.loadByDow.length !== b.loadByDow.length) return false;
  for (let i = 0; i < a.loadByDow.length; i++) {
    if (a.loadByDow[i] !== b.loadByDow[i]) return false;
  }
  if (a.upcoming.length !== b.upcoming.length) return false;
  for (let i = 0; i < a.upcoming.length; i++) {
    const x = a.upcoming[i];
    const y = b.upcoming[i];
    if (x.id !== y.id || x.dueAtWeek !== y.dueAtWeek || x.urgency !== y.urgency) return false;
  }
  return true;
}

function BlockCard({
  block, date, locked, onToggleLock, onExclude,
  assignmentMin, onSetAssignment, onClearAssignment,
  edited, onEditBlock, onRevertEdit,
  dragging, onDragStartCard, onDragEndCard,
  isNew, onDismissNew,
}: {
  block: TimeBlock;
  /** 这个块所属的 ISO 日期 —— 供无障碍标注（行为记录已下线，2026-09-19） */
  date: string;
  /** 用户已把这块「定住」 */
  locked: boolean;
  onToggleLock: (block: TimeBlock) => void;
  /**
   * 「🗑 删除这块」。
   * 语义：把它从计划里拿掉，重排也不会回来（走 `excluded` 通道，可「全部恢复」）。
   * 课程块不给：课是既成事实，改课走「调课」。
   */
  onExclude: (block: TimeBlock) => void;
  /** T6：这门课本周已标记的作业时长（分钟）；`undefined` = 没标 */
  assignmentMin?: number;
  onSetAssignment: (courseId: string, courseTitle: string, minutes: number) => void;
  onClearAssignment: (courseId: string) => void;
  /** R2：本周用户是否改过这块的位置（改时间/时长/地点） */
  edited?: boolean;
  /** R2：保存块级编辑（同日改；跨天是拖拽的事） */
  onEditBlock: (block: TimeBlock, next: { startMin: number; endMin: number; place?: string }) => void;
  /** R2：撤销对这块的改动，回到引擎安排 */
  onRevertEdit: (block: TimeBlock) => void;
  /** R1：正在被拖动（自己变淡，看得出手里拿的是哪块） */
  dragging: boolean;
  onDragStartCard: (block: TimeBlock) => void;
  onDragEndCard: () => void;
  /** 🆕 新日程标注（2026-09-19）：刚添加的事在日程里高亮，点击后消失 */
  isNew?: boolean;
  onDismissNew?: () => void;
}) {
  /**
   * T6 的展开状态：点「📝 作业」后才显示时长输入框。
   * 用局部 state 而不是提到父组件 —— 它是**纯 UI 状态**，
   * 放上去只会让父组件的 state 又多一个，还多一层 props 传递。
   */
  const [asgOpen, setAsgOpen] = useState(false);
  const [asgMin, setAsgMin] = useState(60);
  /** R2：块级编辑面板的展开状态（同 T6，纯 UI 状态） */
  const [editOpen, setEditOpen] = useState(false);
  const style = KIND_STYLE[block.kind] ?? KIND_STYLE.blank;
  const t = block.transfer;
  // 校历事件展开出来的准备块（光电杯材料、四六级真题…）单独标出来 ——
  // 否则用户只看到「又一个活动块」，意识不到它和那个截止日有关
  const isEvent = Boolean(block.fromEventId);
  return (
    <div
      draggable={block.kind !== 'course' && block.source !== 'course'}
      onDragStart={(e) => {
        // dataTransfer 里带 id 是给**跨天**用的：目标列靠它知道拖过来的是哪一块
        e.dataTransfer.setData('text/plain', block.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStartCard(block);
      }}
      onDragEnd={onDragEndCard}
      title={dragging ? '松手放到目标位置；拖到右侧投放区可删除' : '可以直接拖到别的天 / 别的时段'}
      onClick={() => { if (isNew && onDismissNew) onDismissNew(); }}
      className={`rounded-lg border-l-4 ${style.bg} px-2.5 py-2 ${isEvent ? 'ring-1 ring-purple-300' : ''} ${dragging ? 'opacity-50 ring-2 ring-brand' : ''} ${isNew ? 'ring-2 ring-green-400' : ''} ${block.kind !== 'course' && block.source !== 'course' ? 'cursor-grab' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[13px] font-semibold ${style.text}`}>
          {locked && <span title="已定住：重排时不动">🔒 </span>}
          {block.emoji ? `${block.emoji} ` : ''}{block.title}
          {isNew && <span className="ml-1 rounded bg-green-600 px-1 align-middle text-[9px] text-white">🆕 新</span>}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
          {toHHmm(block.startMin)}–{toHHmm(block.endMin)}
        </span>
      </div>
      {locked && (
        <div className="mt-1 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
          已定住 · 重排时不会挪动
        </div>
      )}
      {isEvent && (
        <div className="mt-1 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800">
          校历事件 · 提前准备
        </div>
      )}
      {/* 地点 —— 标题里已经说了就不再重复（T5）。
          例：「第一食堂 🍚 / @第一食堂」纯属噪音；重复信息会淹没真正要看的时刻。 */}
      {block.place && !block.title.includes(block.place) && (
        <div className="mt-0.5 text-[11px] text-ink-soft">
          @{block.place}{block.room ? ` ${block.room}` : ''}
        </div>
      )}
      {t && (
        <div className={`mt-1 rounded px-1.5 py-0.5 text-[11px] ${t.tight ? 'bg-white/70 text-red-700' : 'text-ink-soft'}`}>
          🚶 {t.fromPlace} → {t.toPlace}：{t.minutes} 分钟
          （余 {t.slackMin}{t.tight ? ' · 紧' : ''}）
        </div>
      )}
      {block.reason && (
        <div className="mt-1 text-[11px] leading-snug text-ink-faint">💡 {block.reason}</div>
      )}

      {/* 操作按钮区（2026-09-19 改版）：
          · 「做了 / 没做」执行标记**已下线**（用户确认不需要）——
            行为记录的 UI 入口随之移除，历史数据仍在本地，actualLoad 通道不破坏。
          · 「🗑 删除」沿用原「✕ 不做」的通道与 hover 浮现交互，只把文案改直白。 */}
      <div className="group mt-1.5 flex items-center gap-1.5">
        {/* 「定住」—— 把这块从「引擎可动的软块」变成「用户确认过的硬块」。
            ⚠️ 已锁定时**常显**（否则用户看不出这块被锁了）；未锁时 hover 才出现。 */}
        <button
          type="button"
          onClick={() => onToggleLock(block)}
          title={locked ? '解除锁定，允许重排时挪动' : '定住：以后重排都保持这个时间与地点'}
          className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-opacity ${
            locked
              ? 'bg-slate-800 text-white'
              : 'bg-white/70 text-ink-soft opacity-0 hover:bg-slate-100 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        >
          {locked ? '🔒 已定住' : '🔓 定住'}
        </button>
        {/* 「🗑 删除」—— 把块从计划里拿掉，重排也不会回来。
            课程块不给：它是既成事实，改课走「调课」。
            拖到右侧投放区是同一件事的另一条路径。 */}
        {block.kind !== 'course' && block.source !== 'course' && (
          <button
            type="button"
            onClick={() => onExclude(block)}
            title="删除这块：从计划里拿掉，重排也不会回来（可在上方「全部恢复」撤销）"
            className="rounded bg-white/70 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft opacity-0 transition-opacity hover:bg-red-50 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
          >
            🗑 删除
          </button>
        )}
        {/* T6：作业 —— 只对课程块有意义。
            引擎不知道「这节课留了作业」，所以要用户说一句；时长也由用户填
            （「高数作业」和「大物实验报告」能差三倍，引擎猜不准，猜了也是噪音）。
            已标记时常显（让用户一眼看出这门课的作业已排进计划）。 */}
        {block.kind === 'course' && block.courseId && (
          <button
            type="button"
            onClick={() => setAsgOpen((v) => !v)}
            title={assignmentMin != null
              ? `已标记作业 ${assignmentMin} 分钟 —— 点一下可修改或取消`
              : '这节课留了作业？记一下要多久，引擎会给你留时间'}
            className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-opacity ${
              assignmentMin != null
                ? 'bg-indigo-600 text-white'
                : 'bg-white/70 text-ink-soft opacity-0 hover:bg-indigo-50 hover:text-indigo-700 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {assignmentMin != null ? `📝 ${assignmentMin}分` : '📝 作业'}
          </button>
        )}
        {/* R2：「改」—— 改这块的时间/时长/地点（不用删掉重加）。
            课程块不给：课程时间变动是「调课」（R3），走另一个入口，
            语义不同（「只这周 / 以后都这样」），不能混。
            已改过的块常显（让用户知道这块有自己的改动在身）。 */}
        {block.kind !== 'course' && block.source !== 'course' && (
          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            title={edited ? '这块被你改过 —— 点一下可再改或恢复引擎安排' : '改这块的时间、时长或地点'}
            className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-opacity ${
              edited
                ? 'bg-teal-600 text-white'
                : 'bg-white/70 text-ink-soft opacity-0 hover:bg-teal-50 hover:text-teal-700 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {edited ? '✏️ 已改' : '✏️ 改'}
          </button>
        )}
      </div>

      {/* R2：块级编辑面板 —— 同日改；改动攒着，「重新排一遍」才生效（T3 语义） */}
      {editOpen && block.kind !== 'course' && block.source !== 'course' && (
        <EditBlockPanel
          block={block}
          edited={edited ?? false}
          onSave={(next) => { onEditBlock(block, next); setEditOpen(false); }}
          onRevert={() => { onRevertEdit(block); setEditOpen(false); }}
          onCancel={() => setEditOpen(false)}
        />
      )}

      {/* T6：作业时长输入 —— **用户自己填**，不给「智能默认」。
          输入框里的 60 只是个起点，确认前用户能看到并改掉。 */}
      {asgOpen && block.kind === 'course' && block.courseId && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1.5 text-[11px] text-indigo-900">
          <span>这门课的作业要多久？</span>
          <input
            type="number"
            min={10}
            max={600}
            step={10}
            value={asgMin}
            onChange={(e) => setAsgMin(Number(e.target.value))}
            className="w-16 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-[11.5px]"
          />
          <span>分钟</span>
          <button
            type="button"
            onClick={() => {
              onSetAssignment(block.courseId as string, block.title, asgMin);
              setAsgOpen(false);
            }}
            className="rounded bg-indigo-700 px-2 py-0.5 text-[11px] font-medium text-white"
          >
            记下
          </button>
          {assignmentMin != null && (
            <button
              type="button"
              onClick={() => { onClearAssignment(block.courseId as string); setAsgOpen(false); }}
              className="rounded bg-white px-2 py-0.5 text-[11px] text-indigo-900 ring-1 ring-indigo-300"
            >
              取消标记
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function WeekPlanView({ schedule, weekNo, persona, planState, onPlanStateChange, lifeMode }: Props) {
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState(true);
  /**
   * 求解器诊断（规格书 §4.4）—— 排得「好不好」的量化凭据。
   * 以前只有「有没有冲突」这一个二值信号，现在能说出硬约束违反数、
   * 加权质量分（越低越好）和耗时。这是答辩时「算法依据」的答案。
   */
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  /** 天气是可选增强：拉不到就是 null，页面不显示天气条、排程也不受影响 */
  const [weather, setWeather] = useState<WeatherReport | null>(null);
  /**
   * 上一版计划 —— 增量重排（T2.1）的基准。
   *
   * 为什么用 `ref` 而不是 `useState`：它**不应该触发渲染**。
   * 放进 state 会让「算出计划 → 存计划 → 触发渲染 → effect 重跑」形成环，
   * 而这里的语义本就是「记住上一次算出来的东西给下一次用」，是 ref 的经典用法。
   */
  const lastPlanRef = useRef<WeekPlan | null>(null);
  /**
   * 「从此刻开始排」开关（P2-T2.3）。
   *
   * 为什么要做成开关而不是默认开：引擎的 `fromNow` 会**砍掉今天已经过去的时间**，
   * 于是今天这一列的块会明显比别的天少。用户如果不知道这是自己开的，
   * 会以为是 bug。默认关（= 完整排一周），由用户主动点。
   *
   * 只在**本周**才有意义 —— 回看第三周时「现在」不是那周的现在。
   */
  const [fromNowOn, setFromNowOn] = useState(false);

  /**
   * **用户覆盖层**（R2）—— 一次性收口所有「用户对本周期计划做过的事」：
   * 加的事 / 删的块 / 改过的位置 / 不可时段 / 调课停课 / 指定的食堂 / 课程作业。
   *
   * 独立 localStorage（key `usst-user-plan-v1`），与 `behaviorLog` 同一模式。
   * 在 R2 之前这些数据散在 `planEditsStore` 与 `assignmentStore` 两个 key 里，
   * 再加三类就碎成一地 —— 所以合并；旧数据由 `loadUserPlan()` 自动迁移。
   */
  const [layer, setLayer] = useState<UserPlanLayer>(() => loadUserPlan());

  /**
   * 统一的写回入口：**任何**对覆盖层的改动都走它 ——
   *   · 落库（`saveUserPlan`）
   *   · 标记「有改动待生效」（T3：不自动重排，由「重新排一遍」统一应用）
   *
   * 收成一个函数，是为了保证这两件事**永远同时发生** ——
   * 否则某个 handler 忘了标记，用户就会以为按钮没反应。
   */
  const updateLayer = useCallback((fn: (prev: UserPlanLayer) => UserPlanLayer) => {
    setLayer((prev) => {
      pushUndoSnapshot(prev); // 撤销栈：任何改动前先留一份底
      const next = fn(prev);
      saveUserPlan(next);
      return next;
    });
    clearRedo(); // 🔴 发生新改动 → 重做历史作废（标准撤销/重做语义）
    setPendingEdits(true);
    setUndoDepth(undoDepth());
    setRedoDepth(0);
  }, []);

  /* ---------- Toast 操作反馈（2026-09-19） ---------- */
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const notify = useCallback((kind: ToastKind, message: string, action?: ToastItem['action']) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    const duration = kind === 'delete' ? 5000 : 2500; // 删除给足反悔窗口
    setToasts((prev) => [...prev.slice(-3), { id, kind, message, action, duration }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * 撤销（Ctrl+Z / 顶栏按钮）—— 弹出最近一份覆盖层快照恢复。
   * 撤销后界面通过 `shownPlan` 立即反映（moves/excluded 都在显示口径里），
   * 不需要强制重排。
   */
  const [undoDepthState, setUndoDepth] = useState(0);
  const [redoDepthState, setRedoDepth] = useState(0);
  const handleUndo = useCallback(() => {
    const snap = popUndo();
    if (!snap) return;
    pushRedoSnapshot(layer); // 回退前的样子进重做栈
    setLayer(snap);
    saveUserPlan(snap);
    setUndoDepth(undoDepth());
    setRedoDepth(redoDepth());
    notify('info', '已撤销上一步改动');
  }, [layer, notify]);

  /** 重做（Ctrl+Shift+Z / Ctrl+Y）—— 与撤销互为逆操作 */
  const handleRedo = useCallback(() => {
    const snap = popRedo();
    if (!snap) return;
    pushUndoSnapshot(layer);
    setLayer(snap);
    saveUserPlan(snap);
    setUndoDepth(undoDepth());
    setRedoDepth(redoDepth());
    notify('info', '已重做');
  }, [layer, notify]);

  /** 删除类 Toast 的「撤销」按钮 —— 一键恢复到删除前 */
  const undoAction = useCallback((): ToastItem['action'] => {
    return { label: '撤销', run: () => handleUndo() };
  }, [handleUndo]);

  // Ctrl+Z（Cmd+Z）撤销 / Ctrl+Shift+Z 与 Ctrl+Y 重做 —— 输入框里打字时不拦截
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const onInput = (() => {
        const t = e.target as HTMLElement | null;
        return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      })();
      if (onInput) return;
      if (k === 'z' && e.shiftKey) { e.preventDefault(); handleRedo(); }
      else if (k === 'z') { e.preventDefault(); handleUndo(); }
      else if (k === 'y') { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  /** 派生视图：下面大量代码引用 `edits.xxx` / `assignments`，这里指向同一份数据 */
  const edits = { userTasks: layer.tasks, excludedBlockIds: layer.excluded };
  const assignments = layer.assignments;

  /**
   * 偏好校正规则（阶段 B）—— 用户提过的要求。
   * ⚠️ 仍走 `feedback/store`（那是另一条线，与覆盖层数据不重叠）。
   */
  const [rules, setRules] = useState<CorrectionRule[]>(() => loadRules());

  /** 手动重排令牌（阶段 A3）：递增即让主 effect 重跑 */
  const [replanToken, setReplanToken] = useState(0);

  /**
   * 是否有「攒着没应用」的改动（T3）。
   *
   * 为什么要有它：加块 / 删块**不再立刻重排**（否则删一个块，整周跟着抖动，
   * 用户根本看不清自己改了什么）。改动先记进覆盖层，由「重新排一遍」统一应用。
   * 但界面上必须**明说**「有改动还没生效」—— 否则用户会以为按钮没反应。
   */
  const [pendingEdits, setPendingEdits] = useState(false);

  /**
   * 转场收敛诊断（P2-T2.4）—— 问了几轮路、还有几条没问到。
   * `uncovered` 非空时页面要如实说「个别转场是估算」，不能把估算值当实测显示。
   */
  const [transferInfo, setTransferInfo] = useState<{
    rounds: number;
    uncovered: string[];
  } | null>(null);

  const semester = useMemo(
    // 阶段 C/D：把用户的偏好校正 + 生活模式传下去 —— 从这一刻起，
    // 用户提的要求与切过的模式都真正影响排程。
    // `rules` / `lifeMode` 一变，semester → phase → 主 effect 会连锁重跑。
    () => buildPhasesFromCalendar(schedule, persona, TERM_CALENDAR['2026-2027-1'], rules, lifeMode),
    [schedule, persona, rules, lifeMode],
  );
  const phase = phaseOfWeek(semester.plan, weekNo);

  /**
   * R3：调课 / 停课 → **派生课表**。
   *
   * 为什么在这里派生而不是改 `schedule`：导入的课表是事实来源，
   * 改它就没法撤销、也没法「只影响这一周」。`applyCourseOverrides` 产出副本，
   * 原始对象一个字符都不动（有单测守着）。
   *
   * 用 `useMemo` 是必要的：主 effect 依赖 `"schedule"`，若每次渲染都新建对象，
   * 会陷入「排完 → 新对象 → 重排」的死循环。
   */
  const derived = useMemo(
    () => applyCourseOverrides(schedule, layer.courseOverrides, weekNo),
    [schedule, layer.courseOverrides, weekNo],
  );
  /** 真正喂给引擎的课表（不含覆盖时 = 原对象同一引用） */
  const effectiveSchedule = derived.schedule;

  /** R5：用户的长期目标（成就统计的「往哪算」维度） */
  const [goals, setGoals] = useState(() => loadGoals());
  const [activityVersion, setActivityVersion] = useState(0);

  /** R3.4：语言输入没说时间 → 挂起草稿，弹框追问 */
  const [timeAsk, setTimeAsk] = useState<{ draft: TaskDraft; ask: TimeAskRequest } | null>(null);
  /** 时间追问被放弃时的提示（T-R3-6：不建块，如实说） */
  const [timeAskNote, setTimeAskNote] = useState<string | null>(null);

  /** 行为记录（2026-09-19 起只读）：不再有新的标记写入，历史数据喂 actualLoadByDow */
  const [records] = useState<BehaviorRecord[]>(() => loadRecords());

  /** T6：本周「课程 → 作业时长」的索引（避免在每个块上线性查找） */
  const assignmentByCourse = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assignmentsOfWeek(assignments, weekNo)) {
      map.set(a.courseId, a.estimatedMin);
    }
    return map;
  }, [assignments, weekNo]);

  /**
   * 天气数据（2026-09-19 改版：**不再有单独的天气栏**）。
   *
   * 天气的唯一落点是**每一天列的标题下方**：晴天显示概况（☀ 小雨 19–24℃），
   * 达到提醒阈值（下雨/高低温/大风）的日子显示带时段的人话提醒
   * （「记得带伞 · 下午降水概率 80%」—— `judgeDay` 产出）。
   *
   * ⚠️ 硬限制要如实知道：`fetchWeather(7)` 只有「今天起未来 7 天」，
   * 回看本周的周一到周五时那天**没有数据**，对应列不显示天气 —— 不猜、不装。
   */
  const weatherByDate = useMemo(() => {
    const map = new Map<string, WeatherDay>();
    if (!weather) return map;
    for (const d of weather.days) map.set(d.date, d);
    return map;
  }, [weather]);

  /** 提醒（含时段）按日期索引 —— 一天最多一条（`judgeDay` 的取舍），Map 足够 */
  const adviceByDate = useMemo(() => {
    const map = new Map<string, WeatherAdvice>();
    for (const a of weatherHints(weather)) map.set(a.date, a);
    return map;
  }, [weather]);

  /** 本周的周一（ISO）—— 把「周次 + 星期几」还原成具体日期，行为记录按它定位 */
  const weekMonday = useMemo(
    () => addDays(schedule.termStart, (weekNo - 1) * 7),
    [schedule.termStart, weekNo],
  );
  const dateOfDay = useCallback(
    (dayOfWeek: number) => addDays(weekMonday, dayOfWeek - 1),
    [weekMonday],
  );

  /**
   * 「此刻」是否落在本周 —— `fromNow` 的前置条件。
   *
   * 为什么必须判：`fromNow` 是「现在几点」，回看/预看别的周时那个时间点不在那一周里，
   * 传进去会让引擎把「今天」的剩余时间砍掉，而实际上那一周整天都还没开始。
   */
  const isCurrentWeek = useMemo(() => {
    const today = todayISO();
    return today >= weekMonday && today < addDays(weekMonday, 7);
  }, [weekMonday]);

  /** 今天在本周的星期几（1–7）；不在本周 = null */
  const todayDow = useMemo(() => {
    if (!isCurrentWeek) return null;
    const d = weekdayOf(todayISO()); // 0 = 周日
    return (d === 0 ? 7 : d) as number;
  }, [isCurrentWeek]);

  /**
   * 实际负荷（按星期几）—— 喂给引擎的 `actualLoadByDow`（P2-T2.2）。
   *
   * 窗口是「本周之前 4 周」：不含本周，因为本周的执行结果还没发生（或刚开始），
   * 把它算进「跨周疲劳」等于用未来推现在。
   */
  const actualLoad = useMemo(
    () => actualLoadByDow(records, addDays(weekMonday, -7 * 4), 4),
    [records, weekMonday],
  );

  /**
   * 上一周的滚动状态。走 `rollingForWeek` 而不是直接读 `planState.rolling` ——
   * 直接读会在同一周内自我强化降档（排满 → 下周松 → 又加满 → 更松），
   * 判据与理由写在 `planLock.ts`。
   */
  const prevRolling = useMemo(
    () => rollingForWeek(planState, weekNo),
    [planState, weekNo],
  );

  /* 「做了 / 没做」执行标记已于 2026-09-19 按用户决定下线：
     标记入口（mark）与执行情况面板移除；`records` 仍从本地加载 ——
     历史数据继续喂 `actualLoadByDow`（跨周疲劳），通道不破坏、只是不再新增。 */

  /**
   * 定住 / 解除（**S1：定住 = 长期锁**）。
   *
   * 用户原话：「定住代表『以后每周都留着』」「单双周按单双周分别定住」。
   * 所以这里写的**不再是 blockId**（那东西含周次，换周即失效），
   * 而是 `{odd|even}-d{天}-{类型}-{起}-{止}` —— 后续所有同奇偶的周都认。
   *
   * 解除时两套 key 都清：长期锁 + 可能的同名块锁 —— 留一半会出现
   * 「显示已解锁但引擎还钉着」。
   */
  const toggleLock = useCallback((block: TimeBlock) => {
    const now = new Date().toISOString();
    const longKey = longLockKey(weekNo, block);
    const willLock = !isLockedThisWeek(planState, weekNo, block);
    const next = willLock
      ? withLongLock(planState, weekNo, block, now)
      : withoutLongLock(withoutLock(planState, block.id, now), longKey, now);
    onPlanStateChange(next);
    notify('info', willLock
      ? `已定住「${block.title}」—— 以后每周这个时段都会留着`
      : `已解除「${block.title}」的锁定`);
  }, [planState, onPlanStateChange, weekNo, notify]);

  /* ============================================================
   * 阶段 A：用户干预（加块 / 删块 / 手动重排）
   * ========================================================== */

  const handleAddTask = useCallback((task: UserTask) => {
    updateLayer((prev) => ({ ...prev, tasks: addTask(prev.tasks, task) }));
    // 🆕 标注：新加的事在日程表里高亮显示，直到用户点击确认（块的 id 由任务 id 派生）
    setRecentTaskIds((prev) => [...prev, task.id]);
    notify('add', `已加入「${task.title}」—— 重排后会标注 🆕 出现在日程里`);
  }, [updateLayer, notify]);

  /**
   * 「这块我不做」。
   *
   * 课程块**不给删** —— 它是既成事实（`resolveLockLevel` 也把它判成 hard）。
   * 引擎侧还有一层保护，这里只是别让用户点了没反应还以为坏了。
   */
  const handleExcludeBlock = useCallback((block: TimeBlock) => {
    if (block.kind === 'course' || block.source === 'course') return;
    if (layer.excluded.includes(block.id)) return;
    updateLayer((prev) => ({ ...prev, excluded: excludeBlock(prev.excluded, block.id) }));
    // 删除后**马上问空档怎么处理**（补上/留白/重排）——不再让用户自己想起「重排」
    setDeleteAsk({
      id: block.id, title: block.title,
      day: block.dayOfWeek, startMin: block.startMin, endMin: block.endMin,
    });
  }, [updateLayer, layer.excluded]);

  /** 删除弹窗挂起的空档信息（块已进 excluded，块本体由 shownPlan 过滤掉） */
  const [deleteAsk, setDeleteAsk] = useState<{
    id: string; title: string; day: number; startMin: number; endMin: number;
  } | null>(null);

  /**
   * 全部恢复。
   *
   * 为什么只能「全部」而不能「逐块恢复」：被排除的块**已经不在计划里了**，
   * 界面上没有它的位置可点。要支持逐块恢复得先有一份「已跳过清单」的可视化 ——
   * 那是下一轮的事，本期先把「反悔」这条最常用的路径留出来。
   */
  const handleRestoreAll = useCallback(() => {
    updateLayer((prev) => ({ ...prev, excluded: [] }));
  }, [updateLayer]);

  /** 🆕 新日程标注：新加任务的任务 id 列表（块的 id 以 `-{taskId}` 结尾，可可靠匹配） */
  const [recentTaskIds, setRecentTaskIds] = useState<string[]>([]);

  /** S4：改「我常去的食堂」 */
  const handleMealPlacesChange = useCallback((next: MealPlaces) => {
    updateLayer((prev) => ({ ...prev, mealPlaces: next }));
  }, [updateLayer]);

  /* ============================================================
   * R2：块级编辑（改时间/时长/地点）
   * ========================================================== */

  /**
   * 保存块级编辑 → 写 `MoveRecord{ source:'edit' }`（hard）。
   *
   * 两个关键决策：
   *   · **blockId 原样保留**（id 是逻辑身份，moves 是物理位置 —— 见 userPlanStore）。
   *     本面板只能同日改，`dayOfWeek` 直接沿用块自身的值。
   *   · **不自动重排**（T3）：记进覆盖层 + 标「待生效」，由「重新排一遍」统一应用。
   *     否则用户连着改三块，每改一块整周抖一次。
   */
  const handleEditBlock = useCallback(
    (block: TimeBlock, next: { startMin: number; endMin: number; place?: string }) => {
      updateLayer((prev) => ({
        ...prev,
        moves: upsertMove(prev.moves, {
          weekNo,
          blockId: block.id,
          dayOfWeek: block.dayOfWeek,
          startMin: next.startMin,
          endMin: next.endMin,
          place: next.place ?? block.place,
          room: block.room,
          source: 'edit',
        }),
      }));
      notify('move', `已调整「${block.title}」→ ${DAY_LABELS[block.dayOfWeek - 1]} ${toHHmm(next.startMin)}–${toHHmm(next.endMin)} · 重排后生效`);
    },
    [weekNo, updateLayer, notify],
  );

  /** 撤销对某块的改动 —— 删掉那条 MoveRecord，重排后回到引擎安排 */
  const handleRevertEdit = useCallback(
    (block: TimeBlock) => {
      updateLayer((prev) => ({ ...prev, moves: removeMove(prev.moves, block.id, weekNo) }));
    },
    [weekNo, updateLayer],
  );

  /**
   * 屏幕上显示的那一版：计划 + **用户已改动但还没重排的位置**（T3 + R1.7）。
   *
   * 不.add 这一步的话，用户拖完 / 改完看到的还是旧位置 —— 点了像没点。
   * 位置改动 leaving 到下一次「重新排一遍」时由引擎正式吸收（`moves` 已并入 `lockedPlacements`）。
   */
  const moveMap = useMemo(() => movesOfWeek(layer.moves, weekNo), [layer.moves, weekNo]);
  const shownPlan = useMemo(() => {
    if (!plan) return null;
    const moved = applyPendingMoves(plan, moveMap);
    // 🔴 已删除的块**立刻从屏幕上消失**（2026-09-19 修复）：
    //    之前只写存储不过滤显示，用户删了块却看它还挂着，像没删掉。
    //    「怎么处理空档」由删除弹窗问（补上/留白/重排），但「它没了」必须马上可见。
    if (layer.excluded.length === 0) return moved;
    const excluded = new Set(layer.excluded);
    return { ...moved, blocks: moved.blocks.filter((b) => !excluded.has(b.id)) };
  }, [plan, moveMap, layer.excluded]);

  /** 本周被用户改过的块 id 集合 —— BlockCard 用它决定「✏️ 已改」的常显样式 */
  const editedBlockIds = useMemo(() => new Set(moveMap.keys()), [moveMap]);

  /**
   * 拖拽反馈：正在拖哪一块 + 拖不动时的原因。
   * 「拖不动」必须**明说** —— 否则用户会以为拖拽坏了（R1.6 / T-R1-5）。
   */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragNote, setDragNote] = useState<string | null>(null);

  /**
   * **拖拽实时预览**（2026-09-19 交互改版）。
   *
   * 用户原话：「拖动过程中需要看到它会被放到哪个位置，以低透明度显示，
   * 同时显示其他日程向后延的新位置」—— 松手前就能看到结局，不再盲拖。
   *
   * 实现：`onDragOver` 时调 `dragTo()`（纯函数，毫秒级）算出「如果现在松手」
   * 的完整结果，画成影子 —— 落点是半透明虚线块，被顺延的块**直接画在它们
   * 的新位置**（整列呈现的就是未来布局）；放不下/撞课时影子变红色禁止样式。
   * 松手时 `handleDrop` 走同一条纯函数 —— **所见即所得**。
   *
   * 节流：只在悬停目标（天:时刻）变化时重算，不是 dragOver 的每一帧。
   */
  interface DragPreview {
    day: number;
    atMin: number;
    ok: boolean;
    reason?: string;
    /** 影子块（落点）的位置与标题 */
    startMin: number;
    endMin: number;
    title: string;
    /** 被顺延块 → 新位置（渲染时直接画到新位置） */
    displaced: Map<string, { start: number; end: number }>;
  }
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const previewKeyRef = useRef('');

  const updatePreview = useCallback((day: number, atMin: number, coord: string) => {
    if (!draggingId || !shownPlan) return;
    // 🔴 去重 key 必须是**鼠标坐标**而不是落点时刻：
    //    预览会重排布局 → 鼠标底下的块变了 → 落点变了 → key 变了 → 再重算 →
    //    无限震荡（块在新旧位置来回跳）。坐标不动就不重算 —— 布局冻结在当前预览。
    if (previewKeyRef.current === coord) return;
    previewKeyRef.current = coord;

    const src = shownPlan.blocks.find((b) => b.id === draggingId);
    if (!src) { setPreview(null); return; }
    const dur = src.endMin - src.startMin;
    const res = dragTo(shownPlan.blocks, draggingId, day, atMin, {
      // 与 handleDrop 完全同口径 —— 预览必须严格等于松手结果
      dayStartMin: 7 * 60,
      dayEndMin: 23 * 60,
    });
    const snapped = Math.round(atMin / 10) * 10;
    // ok 时影子画在真实落点；被拒时画在悬停处并标红（用户得知道「这里不行」）
    const dragRec = res.records.find((r) => r.source === 'drag');
    const ghost = dragRec
      ? { startMin: dragRec.startMin, endMin: dragRec.endMin }
      : { startMin: snapped, endMin: snapped + dur };
    const displaced = new Map<string, { start: number; end: number }>();
    if (res.ok) {
      for (const r of res.records) {
        if (r.source === 'ripple') displaced.set(r.blockId, { start: r.startMin, end: r.endMin });
      }
    }
    setPreview({
      day, atMin, ok: res.ok, reason: res.reason, title: src.title,
      startMin: ghost.startMin, endMin: ghost.endMin, displaced,
    });
  }, [draggingId, shownPlan]);

  const clearPreview = useCallback(() => {
    previewKeyRef.current = '';
    setPreview(null);
  }, []);

  /**
   * 🔴 拖拽结束的**兜底清理**（挂在 window 上，不依赖源元素还活着）。
   *
   * 为什么必须：预览期间被拖的块会从列表里**卸载**（它变成了影子），
   * 而浏览器的 `dragend` 派发给源元素 —— 元素都没了，事件没人收，
   * `draggingId` 就会残留 → 那块永远卡在半透明「拖动中」样式。
   * window 级监听永远收得到，drop / dragend / 取消 / Escape 全覆盖。
   */
  useEffect(() => {
    if (!draggingId) return;
    const onEnd = () => {
      setDraggingId(null);
      clearPreview();
    };
    window.addEventListener('dragend', onEnd);
    window.addEventListener('drop', onEnd);
    return () => {
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('drop', onEnd);
    };
  }, [draggingId, clearPreview]);

  /**
   * 落位计算（R1）—— 把某一块送到「星期几 + 起点」。
   *
   * 关键三点：
   *   · **blockId 不重写**：跨天后 id 仍带旧的 `d` 段，`dayOfWeek` 字段单独记录。
   *     写回 id 会让引擎认成「删一个 + 新增一个」→ churn 虚高、锁失效（R1.3）。
   *   · **顺延**：占到的软块自动往后排（`makeRoom`），被挪的记成 `ripple`（soft），
   *     拖的那块是 `drag`（hard）—— 用户明确表达的位置，重排不许动。
   *   · **放不下就告知**，绝不制造重叠（硬约束 H1 是验收基准）。
   *
   * ⚠️ 基准是 `shownPlan`（屏幕上正显示的那一版，含未生效的手动改动）——
   *    与预览同一基准，用户看到的影子才严格等于松手结果。
   */
  const handleDrop = useCallback((blockId: string, day: number, atMin: number) => {
    if (!shownPlan) return;
    const res = dragTo(shownPlan.blocks, blockId, day, atMin, {
      // 天的可用区间与引擎同口径（`construct` 里 `'07:00'` / `'23:00'` 是默认值）
      dayStartMin: 7 * 60,
      dayEndMin: 23 * 60,
    });
    clearPreview();
    if (!res.ok) {
      setDragNote(res.reason ?? '放不下');
      return;
    }
    setDragNote(null);
    const moved = shownPlan.blocks.find((b) => b.id === blockId);
    updateLayer((prev) => {
      let moves = prev.moves;
      for (const r of res.records) {
        moves = upsertMove(moves, {
          weekNo, blockId: r.blockId, dayOfWeek: r.dayOfWeek,
          startMin: r.startMin, endMin: r.endMin, source: r.source,
        });
      }
      return { ...prev, moves };
    });
    if (moved) {
      notify('move', `已移动「${moved.title}」→ ${DAY_LABELS[day - 1]} ${toHHmm(res.records[0].startMin)} · Ctrl+Z 撤销`);
    }
  }, [shownPlan, clearPreview, updateLayer, weekNo, notify]);

  /**
   * **拖拽删除投放区**（2026-09-19）：拖动时屏幕右侧浮现「🗑 拖到这里删除」，
   * 松手到它上面 → 该块进删除通道（与块上的「🗑 删除」按钮走**同一个** `excluded`
   * 通道，可用顶部的「全部恢复」一键撤销 —— 撤销比确认轻，所以不做二次弹窗）。
   */
  const [deleteHover, setDeleteHover] = useState(false);
  const handleDropToDelete = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDeleteHover(false);
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    setDraggingId(null);
    clearPreview();
    if (!id || !shownPlan) return;
    const block = shownPlan.blocks.find((b) => b.id === id);
    if (!block) return;
    if (block.kind === 'course' || block.source === 'course') {
      setDragNote('课程不能删除 —— 要改课程时间请用「调课」');
      return;
    }
    // 与「🗑 删除」按钮同一条通道 —— 删除后同样弹「空档怎么处理」
    handleExcludeBlock(block);
  }, [draggingId, shownPlan, handleExcludeBlock, clearPreview]);

  /* 双层时间视图（悬停时间轴 / 坐标拖拽 / 边缘调时）已于 2026-09-19 晚
     按用户决定整体回退 —— 恢复单一卡片流 + 空闲块 + 悬停块式拖拽。 */

  /* ============================================================
   * T6：作业（用户填时长）
   * ========================================================== */

  const handleSetAssignment = useCallback(
    (courseId: string, courseTitle: string, minutes: number) => {
      const item: Assignment = {
        id: assignmentId(courseId, weekNo),
        courseId,
        courseTitle,
        weekNo,
        estimatedMin: clampEstimate(minutes),
        createdAt: new Date().toISOString(),
      };
      updateLayer((prev) => ({ ...prev, assignments: upsertAssignment(prev.assignments, item) }));
    },
    [weekNo, updateLayer],
  );

  const handleClearAssignment = useCallback((courseId: string) => {
    updateLayer((prev) => ({
      ...prev,
      assignments: removeAssignment(prev.assignments, assignmentId(courseId, weekNo)),
    }));
  }, [weekNo, updateLayer]);

  /* ============================================================
   * 阶段 B：偏好校正（提要求 / 撤销）
   * ========================================================== */

  const handleAddRule = useCallback((rule: CorrectionRule) => {
    setRules((prev) => {
      const next = upsertRule(prev, rule);
      saveRules(next);
      return next;
    });
  }, []);

  const handleRulesChange = useCallback((next: CorrectionRule[]) => {
    setRules(next);
    saveRules(next);
  }, []);

  /* ============================================================
   * 阶段 E：自然语言 → 可执行意图
   * ========================================================== */

  /**
   * 从自然语言草稿加一件事（R3.4 / R3.5）。
   *
   * 两条追问都遵循「**不猜**」：
   *   · 说了星期但没说几点 → 弹框问（排错时间比留白更糟）；
   *   · 「是不是长期」听不出来（`detectScope` 返回 `ask`）→ 弹框问，
   *     而不是默认一次性让用户日后发现「我明明每周都要」。
   * 长期与否由 `detectScope()` 一处判定（`features/feedback/parseCorrection.ts`），
   * 与 S1 的长期锁、R4 的不可时段共用同一个概念出口。
   */
  const handleAddTaskFromDraft = useCallback((d: TaskDraft) => {
    const scope = detectScope(d.utterance ?? '');
    const askTime = d.dayOfWeek != null && d.startMin == null;
    if (askTime || scope === 'ask') {
      setTimeAsk({
        draft: d,
        ask: {
          title: d.title,
          dayOfWeek: d.dayOfWeek ?? 1,
          durationMin: d.durationMin,
          askTime,
          askScope: scope === 'ask',
        },
      });
      return;
    }
    commitDraft(d, d.startMin ?? null, scope === 'long');
  }, [weekNo]);

  /**
   * 真正落库（追问拿到答案后才调）。
   *
   * `weeks` 的取值就是「长期 / 一次性」的全部差别：
   *   · `[weekNo]` → 只这一周
   *   · `[]`       → 长期（`taskActive()` 判定：空 = 全学期）
   */
  const commitDraft = useCallback((d: TaskDraft, startMin: number | null, long: boolean) => {
    const task: UserTask = {
      id: makeLayerId('ut'),
      title: d.title,
      kind: d.kind,
      ...(d.dayOfWeek != null ? { dayOfWeek: d.dayOfWeek } : {}),
      // 只有指定了星期才带开始时间 —— 否则会变成「固定块」，反而捆住引擎的手脚
      ...(d.dayOfWeek != null && startMin != null ? { startMin } : {}),
      durationMin: d.durationMin,
      weeks: long ? [] : [weekNo],
      priority: 80,
      note: long ? '你通过一句话加的（每周）' : '你通过一句话加的',
    };
    handleAddTask(task);
  }, [handleAddTask, weekNo]);

  /**
   * 拿掉某几天（可限类型）的安排。
   *
   * 做法：把**当前计划里**匹配的块加进排除清单 —— 于是重排时它们不会回来。
   * 依赖 `plan` 是有意的：用户看到的是屏幕上这一版，删的也该是这一版里的块。
   */
  const handleRemoveBlocks = useCallback((days: DayOfWeek[], blockKind?: BlockKind) => {
    if (!plan) return;
    const ids = plan.blocks
      .filter((b) => days.includes(b.dayOfWeek))
      .filter((b) => blockKind == null || b.kind === blockKind)
      // 课程是既成事实 —— 引擎侧也有一层保护，这里再挡一次，让语义更清楚
      .filter((b) => b.kind !== 'course' && b.source !== 'course')
      .map((b) => b.id);
    if (ids.length === 0) return;
    updateLayer((prev) => {
      let excluded = prev.excluded;
      for (const id of ids) excluded = excludeBlock(excluded, id);
      return { ...prev, excluded };
    });
  }, [plan, updateLayer]);

  // 天气与周次无关（都是「未来 7 天」），所以只拉一次；
  // 换周时靠下面的 filter（weatherToTasks 按 weekNo 过滤）而不是重拉。
  useEffect(() => {
    let cancelled = false;
    // past_days=6：窗口恒为「过去 6 天 + 未来 7 天」—— 无论今天周几，
    // 本周七天都有天气（否则周末打开，周一到周五全是空白 —— 实测教训）
    fetchWeather(7, 6).then((r) => { if (!cancelled) setWeather(r); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!phase) { setPlan(null); return; }
        // 校历事件 → 本周准备块（光电杯材料 / 四六级真题 / 期中复习…）。
        // 这一步就是「把截止日变成日程」：事件不再只是旁边一个倒计时数字。
        const eventTasks = expandDeadlines(DEADLINES, schedule.termStart, schedule.totalWeeks);
        // 天气 → 当天提醒块（带伞 / 防暑 / 保暖 / 防风）。
        // 与事件走**同一条 tasks 通道**，引擎完全不知道有「天气」这回事。
        // 差别在权重：天气块优先级只有 45–55（事件准备块是 88），
        // 挤不进日程也没关系 —— 提醒还有天气条那条独立路径。
        // 阶段 A：把**用户自己加的事**也并进来。
        // 它们与校历事件走同一条 `UserTask` 通道 —— 引擎不知道「这是用户加的」，
        // 也就不需要为它改任何代码。指定了「星期 + 时间」的会变成固定块
        // （判定见 `construct`：`dayOfWeek != null && startMin != null`）。
        const userTasks = edits.userTasks.filter(
          (t) => !t.weeks?.length || t.weeks.includes(weekNo),
        );
        /**
         * ⚠️ T1（2026-09-19）：**天气不再进 `tasks`**。
         *
         * 此前 `weatherToTasks(...)` 会产出一条 30 分钟的 activity 块，
         * 于是时间轴上出现「🌧️ 带伞 · 小雨」这样一个占半小时的日程 —— 荒谬：
         * 「带伞」是一条提醒，不是一件要做半小时的事。
         * 现在改成当天列顶部的**备注条**（见下方 `weatherByDay` 的渲染）。
         */
        const tasks = [
          ...eventTasks,
          ...userTasks,
          // R5：目标 → 排程任务（2026-09-19）。设立了截止日期并选了节奏的目标，
          // 按节奏生成每周投入块 / 截止前冲刺块（与作业同一 UserTask 通道）。
          // ⚠️ goals 刻意不在 effect 依赖里：目标改动「攒着」，点「重新排一遍」生效（T3 语义一致）。
          ...goalTasksOf(goals, weekNo, schedule.termStart),
          /**
           * T6：作业 → `UserTask`。
           *
           * 引擎不知道「这节课留了作业」，所以由界面翻译成「一件要花 N 分钟的 study」。
           * `priority: 78` —— 高于普通活动（26–66）、低于校历事件准备块（88）；
           * **不设 `essential`**：作业重要，但还没到「有硬截止日」那一档，
           * 不该像备考那样抢独立预算。
           */
          ...assignmentsOfWeek(assignments, weekNo).map((a): UserTask => ({
            id: a.id,
            title: `${a.courseTitle} 作业`,
            emoji: '📝',
            kind: 'study',
            durationMin: a.estimatedMin,
            weeks: [weekNo],
            priority: 78,
            note: `课程作业 —— 预计 ${a.estimatedMin} 分钟（你自己填的）`,
          })),
        ];
        // ── P2：把「动态能力」的三组输入接进来 ────────────────────────
        //   · rolling / actualLoadByDow → 跨周疲劳（T2.2）
        //   · previousPlan              → 增量重排的脏区域基准（T2.1）
        //   · fromNow / fromNowDay      → 「从此刻开始排」（T2.3）
        // 三组都是**可选**：不传就退回 P1 的全量排程行为，不会因为这里出错而排不出来。
        const nowMin = fromNowOn && isCurrentWeek ? nowMinutes() : null;

        /**
         * R2：把「用户改过的位置」（`layer.moves`）并进锁。
         *
         * 为什么必须并进来：用户改过/拖过的块，如果只写进 localStorage 而**不告诉引擎**，
         * 下一次 construct 从头排一遍就把它挪回去了 —— 用户会说「我改的怎么又跑了」。
         *
         * 锁级别按来源分：
         *   · `drag` / `edit`  → **hard**（用户明确表达的位置，重排不许动）
         *   · `ripple`         → **soft**（被顺延带出来的连带结果，引擎后续还可以再调）
         */
        const moveMap = movesOfWeek(layer.moves, weekNo);
        const effectiveLockLevels = { ...lockLevelsOf(planState) };
        const effectivePlacements = { ...lockedPlacementsOf(planState) };
        for (const [id, m] of moveMap) {
          effectiveLockLevels[id] = m.source === 'ripple' ? 'soft' : 'hard';
          effectivePlacements[id] = {
            dayOfWeek: m.dayOfWeek,
            startMin: m.startMin,
            endMin: m.endMin,
            ...(m.place !== undefined ? { place: m.place } : {}),
            ...(m.room !== undefined ? { room: m.room } : {}),
          };
        }
        const req = {
          ...toPlanRequest({
            // R3：喂的是**派生后的课表**（已应用调课/停课），原始 `schedule` 不受影响
            schedule: effectiveSchedule, weekNo, policy: phase.policy,
            scenarios: persona?.scenarios ?? null,
            tasks,
          }),
          // 锁的两半都要传：
          //   · lockLevels     → improve 不主动移动 hard 块、churn 按锁加权
          //   · lockedPlacements → solver 在构造之后把 hard 块**写回原位**
          // 少了后者，construct 从头排一遍就会把块挪走，锁变成装饰。
          // 注意用 **effective*** 版本：已并入用户改/拖过的位置（见上方 R2 注释）。
          lockLevels: effectiveLockLevels,
          lockedPlacements: effectivePlacements,
          // S4：用户指定的食堂（早/午/晚可分别设；留空 = 引擎不填地点）
          mealPlaces: layer.mealPlaces,
          // R6.2：用户声明的不可时段 → 硬约束
          unavailable: layer.slots.map((s) => ({
            id: s.id,
            days: s.days,
            fromMin: s.fromMin,
            toMin: s.toMin,
            weeks: s.weeks,
            createdAtWeek: s.createdAtWeek,
            title: s.title,
          })),
          // 跨周疲劳：计划值兜底、实际值优先（引擎里 mergeLoad 决定）
          rolling: prevRolling,
          actualLoadByDow: actualLoad,
          // 增量重排的「上一版」= 本次之前算出来的那一版
          previousPlan: lastPlanRef.current,
          fromNow: nowMin,
          fromNowDay: nowMin != null ? (todayDow as never) : null,
          // 阶段 A：用户删掉的块。不告诉引擎的话，下一轮构造又会把它排回来 ——
          // 用户会觉得「删了没用」。引擎侧在 `construct` 末尾过滤（课程受保护）。
          excludedBlockIds: edits.excludedBlockIds,
          // 阶段 C：校正层透传给引擎。
          // 当前 `construct` 主要消费的是「阶段策略」那条路径（经 buildPhases），
          // 这个字段留给「时段/地点黑名单」这类更细的约束（本轮已备好口子）。
          corrections: rules,
        };
        // 两遍法编排交给公共入口 `planWeek()` —— 原先这一段在本组件和
        // `features/libao/weekPlanForChat.ts` 各写了一份，是同一套逻辑的两个副本。
        // 我们只注入「转场怎么取」：浏览器里 = 调后端批量问路（拿不到就退回估算）。
        //
        // P2 起改成注入 `fetchRoutes`（**每次给一批对，返回实测分钟**）而不是
        // `transferFactory`（一次给整批）。差别在收敛循环要**增量**地问：
        // 第 1 轮问候选对、第 2 轮再补上一轮新出现的相邻对。用工厂做不到这点
        // —— 它的入参是「整批布局」，只能在开头问一次。
        const result = await planWeek(req, {
          fetchRoutes: async (pairs) => {
            const routes = await fetchRouteBatch(pairs);
            // 一条实测都没拿到 → 转场全是估算值，页面要如实提示
            if (!cancelled && pairs.length > 0) {
              const anyHit = Object.values(routes).some((v) => v && typeof v.minutes === 'number');
              if (anyHit) setBackendOk(true);
            }
            return routes;
          },
        });
        /**
         * R6.1 **定点修改**：改动只影响相关天 —— 其余六天保留上一版。
         *
         * 为什么要有这一步：用户说的是「周四下午别排」，整周重排会让
         * 「我明明只改了一处」变成「七天全抖一遍」，他无法判断自己的要求是否生效。
         * 引擎仍排一整周（它必须看全局才知道紧松），排完再按天融合。
         *
         * ⚠️ 只在**同一周的上一版**时才融合：跨周本来就该整体重排；
         * ⚠️ 没有上一版（首次排程）时也只能整体接受。
         */
        const prev = lastPlanRef.current;
        const days = localizedDaysFor(layer, derived.applied, weekNo);
        const fused = days !== null && prev && prev.weekNo === weekNo
          ? localizedPlan(prev, result.plan, days).plan
          : result.plan;
        if (!cancelled) {
          setPlan(fused);
          setNotes(
            days && days.length > 0
              ? [...result.notes, `本次只重排了${days.map((d) => DAY_LABELS[d - 1]).join('、')}（其它天保持上一版）`]
              : result.notes,
          );
          setDiag(result.diagnostics);
          setTransferInfo({
            rounds: result.transferRounds ?? 1,
            uncovered: result.transferUncovered ?? [],
          });
          lastPlanRef.current = result.plan;
          // ── 补上 P1 留下的断链：把本次产物写回持久化状态 ──────────
          // 原先 `result.nextRolling` 产出来了却**没有任何地方接收** →
          // `planState.rolling` 永远是 null，跨周疲劳既传不下去也用不上。
          // 现在写回；下一周排程时经 `rollingForWeek` 读出来喂回引擎。
          //
          // ⚠️ 依赖里刻意**不含 planState**：本 effect 会因 planState 变化而重跑
          //    （点「定住」要立刻重排），若这里再无条件写回，就会
          //    「重排 → 写 planState → 触发重排」无限循环。
          //    所以只在 rolling / churn 真的变了才写。
          {
            const now = new Date().toISOString();
            const churn = result.diagnostics.churnMin;
            const next = withRolling(planState, weekNo, result.nextRolling, churn, now);
            const changed = planState?.lastPlanWeek !== weekNo
              || planState?.churnMin !== next.churnMin
              || !sameRolling(planState?.rolling ?? null, next.rolling);
            if (changed) onPlanStateChange(next);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          // T3：这一轮排完了 —— 「待生效」标记清零
          setPendingEdits(false);
        }
      }
    })();
    return () => { cancelled = true; };
    // planState 在依赖里：点了「定住」要立刻按新锁重排，而不是等下次刷新
    //
    // ⚠️ `fromNowOn` 也必须在依赖里 —— 它决定 `nowMin`（见上方 L375），
    //    漏掉会导致「⏱ 从此刻开始排」开关**点了不生效**：开关变了、effect 不重跑，
    //    用户得先做别的操作（比如点一次「定住」）才会看到变化。这是 P2 留下的漏项。
    //
    // ⚠️ `edits` 同理（阶段 A）：用户加了块 / 删了块要**立刻**反映到计划上，
    //    否则他会以为按钮没反应。`replanToken` 则是「手动重排」的触发器。
    // ⚠️ T3（2026-09-19）：`edits` **不在**依赖数组里 ——
    //    加块 / 删块**不再立刻重排**。删一个块就让整周跟着抖，用户根本看不清
    //    自己改了什么；改动先攒着，由「重新排一遍」统一应用（见 `pendingEdits`）。
    //
    //    `assignments` 同理（T6）：标记作业也只是**攒着**，
    //    点「重新排一遍」时本 effect 会在新一轮渲染里读到最新的 `assignments`。
  }, [effectiveSchedule, weekNo, phase, persona, weather, planState, fromNowOn, replanToken]);

  if (loading) {
    return <div className="panel px-6 py-10 text-center text-sm text-ink-soft">正在排这一周……</div>;
  }
  if (!phase || !plan) {
    return <div className="panel px-6 py-10 text-center text-sm text-ink-soft">这个周次不在学期范围内。</div>;
  }

  const issues: PlanIssue[] = plan.issues;
  /** 本周与下周的校历节点 —— 让「为什么这周多出准备块」有出处 */
  const nearEvents = eventsNearWeek(DEADLINES, schedule.termStart, weekNo);

  return (
    <div className="space-y-4">
      {/* 阶段头：现在处于什么阶段、策略是什么、为什么 */}
      <div className="panel px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold text-ink">第 {weekNo} 周 · {phase.name}</h2>
          <span className="text-[12px] text-ink-soft">
            每天自习目标 {phase.policy.dailyStudyMin} 分 · 单块 ≤{phase.policy.maxBlockMin} 分 ·
            留白 {Math.round(phase.policy.blankRatio * 100)}% ·
            晚间{phase.policy.eveningAllowed ? '可用' : '不排'} ·
            周末{phase.policy.weekendWork ? '排' : '不排'}
          </span>
        </div>
        <ul className="mt-2 space-y-0.5">
          {phase.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="text-[11.5px] leading-relaxed text-ink-faint">· {r}</li>
          ))}
        </ul>
        {/* 求解器诊断：排得「好不好」的量化凭据。
            刻意不用绿色高亮 —— 它是给人核对的事实，不是「成功了」的庆祝。 */}
        {diag && (
          <div className="mt-2 border-t border-ink/10 pt-1.5 font-mono text-[11px] text-ink-faint">
            {diag.hardViolations === 0 ? '硬约束违反 0' : `⚠ 硬约束违反 ${diag.hardViolations}`}
            {' · '}质量分 {Math.round(diag.cost.total)}
            {' · '}{diag.iterations} 次迭代
            {' · '}{Math.round(diag.elapsedMs)} ms
            {lockCount(planState) > 0 && <>{' · '}已定住 {lockCount(planState)} 块</>}
            {diag.churnMin > 0 && <>{' · '}本次挪动 {diag.churnMin} 分钟</>}
          </div>
        )}
        {/* 锁太多会挤掉引擎的自由度 —— 与其让用户自己发现排不出来，不如先说一句 */}
        {lockCount(planState) >= 6 && (
          <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800">
            已经定住 {lockCount(planState)} 块了 —— 定住的越多，引擎能腾挪的空间越小，排出来可能比较勉强
          </div>
        )}

        {/* ── P2 控制条：从此刻开始排（T2.3） ────────────────────────
            为什么只在「当前周」出现：`fromNow` 的语义是「今天剩下的时间」，
            回看第 3 周时不存在这个时间点。放出来只会让人误以为能对历史周生效。
            为什么默认关：开了之后今天这一列会明显变短（过去的时间被砍掉），
            不解释的话用户会当成 bug —— 所以标签本身就把后果写出来了。 */}
        {isCurrentWeek && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink/10 pt-2">
            <button
              type="button"
              onClick={() => setFromNowOn((v) => !v)}
              className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
                fromNowOn
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50'
              }`}
            >
              {fromNowOn ? '⏱ 只排剩下的时间' : '⏱ 从此刻开始排'}
            </button>
            <span className="text-[11px] text-ink-faint">
              {fromNowOn
                ? '今天已经过去的时间不再安排，其余日子不受影响'
                : '完整排满这一周（默认）'}
            </span>
          </div>
        )}

        {/* ── P2 转场收敛如实提示（T2.4 / AC-10） ────────────────────
            收敛成功时不显示任何东西（正常情况不需要夸奖）。
            只有「还有路没问到」才提示 —— 这时块上的分钟数是估算值，
            用户有权知道，而不是把一个猜的数字当实测值看。 */}
        {transferInfo && transferInfo.uncovered.length > 0 && (
          <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11.5px] text-ink-soft">
            有 {transferInfo.uncovered.length} 处转场时间仍是**估算值**
            （后端暂无这些路线的实测数据）：{transferInfo.uncovered.slice(0, 3).join('、')}
            {transferInfo.uncovered.length > 3 ? ' 等' : ''}
          </div>
        )}

        {!backendOk && (
          <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800">
            后端未连通，转场时间是估算值 —— 跑 <code className="font-mono">python server/app.py</code> 后刷新
          </div>
        )}
      </div>

      {/* 本周节点 —— 事件不再只是「旁边一个倒计时」，这里说明它怎么进了日程 */}
      {nearEvents.length > 0 && (
        <div className="panel px-4 py-3 sm:px-5">
          <h3 className="text-[14px] font-semibold text-ink">这周的节点</h3>
          <ul className="mt-2 space-y-1.5">
            {nearEvents.map((d) => {
              const left = diffDays(todayISO(), d.date);
              return (
                <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                  <span>{d.emoji}</span>
                  <span className="font-medium text-ink">{d.title}</span>
                  <span className="font-mono text-[11px] text-ink-faint">{d.date}</span>
                  <span className={left >= 0 && left <= 7 ? 'text-red-600' : 'text-ink-soft'}>
                    {left === 0 ? '就是今天' : left > 0 ? `还有 ${left} 天` : `已过 ${-left} 天`}
                  </span>
                  {d.prep && (
                    <span className="text-purple-700">→ 已排准备块</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── 阶段 A：二次修改能力 ──────────────────────────────────
          用户的干预入口。加进去 / 删掉的事会**立刻**重排
          （`edits` 在主 effect 的依赖数组里）。 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleUndo}
          disabled={undoDepthState === 0}
          title="撤销上一步改动（Ctrl+Z）"
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ring-1 transition ${
            undoDepthState > 0
              ? 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'
              : 'cursor-not-allowed bg-white/50 text-ink-faint/50 ring-ink/10'
          }`}
        >
          ↩ 撤销{undoDepthState > 0 ? `（${undoDepthState}）` : ''}
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={redoDepthState === 0}
          title="重做（Ctrl+Shift+Z）"
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ring-1 transition ${
            redoDepthState > 0
              ? 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'
              : 'cursor-not-allowed bg-white/50 text-ink-faint/50 ring-ink/10'
          }`}
        >
          ↪ 重做{redoDepthState > 0 ? `（${redoDepthState}）` : ''}
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
        {/* T3：改动不再自动应用 —— 必须**明说**还没生效，否则用户会以为按钮坏了 */}
        {pendingEdits && (
          <span className="rounded-md bg-amber-50 px-2 py-1 text-[11.5px] text-amber-900 ring-1 ring-amber-700/20">
            改动已记下，点左边「重新排一遍」才会生效
          </span>
        )}
        {edits.userTasks.length > 0 && (
          <span className="text-[11.5px] text-ink-faint">你加了 {edits.userTasks.length} 件事</span>
        )}
        {edits.excludedBlockIds.length > 0 && (
          <span className="text-[11.5px] text-ink-faint">
            已跳过 {edits.excludedBlockIds.length} 块
            <button
              type="button"
              onClick={handleRestoreAll}
              className="ml-1.5 rounded bg-white px-2 py-0.5 text-[11px] text-brand ring-1 ring-brand/25 hover:bg-brand/5"
            >
              全部恢复
            </button>
          </span>
        )}
      </div>

      <AddTaskPanel onAdd={handleAddTask} weekNo={weekNo} />

      {/* S4：我常去的食堂 —— 引擎不猜（T2），但给用户一个显式设定的地方 */}
      <MealPlaceSetting value={layer.mealPlaces} onChange={handleMealPlacesChange} />

      {/* R4：不可时段声明（多条并存）+ 用途追问 */}
      <SlotEditor
        weekNo={weekNo}
        slots={layer.slots}
        goals={goals}
        mondayISO={dateOfDay(1)}
        onChange={(next) => updateLayer((prev) => ({ ...prev, slots: next }))}
      />

      {/* R3：调课 / 停课 —— 走覆盖层，原始课表永不改动 */}
      <CourseOverrideEditor
        schedule={schedule}
        weekNo={weekNo}
        overrides={layer.courseOverrides}
        onChange={(next) => updateLayer((prev) => ({ ...prev, courseOverrides: next }))}
      />
      {derived.applied.length > 0 && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-[11.5px] text-ink-soft">
          这周已应用 {derived.applied.length} 处调课/停课：
          {derived.applied
            .map((a) => `${a.courseName} ${a.periodLabel} ${a.action === 'cancel' ? '停课' : '调课'}`)
            .join('、')}
        </div>
      )}
      {timeAskNote && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
          {timeAskNote}
        </div>
      )}

      {/* ── 阶段 B：偏好校正层 ────────────────────────────────────
          采集用户的改进建议。本期**只记录、不参与排程**（面板内已如实说明）。 */}
      <CorrectionCapture
        onAdd={handleAddRule}
        onAddTask={handleAddTaskFromDraft}
        onRemoveBlocks={handleRemoveBlocks}
      />

      {/* R5：投入与成就 —— 所有数字由 `aggregate.ts` 现算，面板里不存累计值 */}
      <AchievementPanel key={activityVersion} weekNo={weekNo} />

      <LearnedPreferencesPanel rules={rules} onChange={handleRulesChange} />

      {/* 天气（2026-09-19 改版）：单独的天气栏已移除 ——
          天气的唯一落点在下面每一天列的标题下方（有数据的日子才显示）。 */}

      {/* 执行情况面板已下线（2026-09-19，用户确认不需要）：
          「做了 / 没做」入口随之移除，历史记录仍留在本地供 actualLoad 消费。 */}

      {/* R1：拖拽 —— 原生 drag-and-drop，零新增依赖。
          放进前后的次序是 HTML5 drag 的约定：`dragover` 不 preventDefault 的话 drop 不会触发。 */}
      {dragNote && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
          {dragNote}
        </div>
      )}

      {/* 七天时间轴 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {DAY_LABELS.map((name, idx) => {
          const day = idx + 1;
          const baseBlocks = (shownPlan ?? plan).blocks
            .filter((b) => b.dayOfWeek === day)
            .sort((a, b) => a.startMin - b.startMin);
          const study = baseBlocks.filter((b) => b.kind === 'study')
            .reduce((n, b) => n + (b.endMin - b.startMin), 0);

          /**
           * 拖拽实时预览（悬停块式）：影子画在卡片流里；源块保留原位（不卸载）。
           * 🔴 源块不许卸载：dragend 派发给源元素，卸载则事件丢失（透明度卡死）。
           */
          const dayPreview = preview && preview.day === day ? preview : null;
          const gaps = freeGapsOf(baseBlocks, day);
          /** 这一天最后一件事的结束时间 —— 拖到空白处的默认落点 */
          const tailMin = baseBlocks.length ? baseBlocks[baseBlocks.length - 1].endMin : 8 * 60;
          const movedBlocks = dayPreview?.ok
            ? baseBlocks.map((b) => {
                const d = dayPreview.displaced.get(b.id);
                return d ? { ...b, startMin: d.start, endMin: d.end } : b;
              })
            : baseBlocks;
          const ghost = dayPreview
            ? {
                startMin: dayPreview.startMin, endMin: dayPreview.endMin,
                ok: dayPreview.ok, title: dayPreview.title, reason: dayPreview.reason,
              }
            : null;
          /** 渲染序列：块 + 空闲块 + 影子（按时间合并） */
          const renderItems: Array<
            | { kind: 'block'; startMin: number; block: TimeBlock }
            | { kind: 'gap'; startMin: number; gap: TimeGap }
            | { kind: 'ghost'; startMin: number; ghost: NonNullable<typeof ghost> }
          > = [
            ...movedBlocks.map((b) => ({ kind: 'block' as const, startMin: b.startMin, block: b })),
            ...gaps.map((g) => ({ kind: 'gap' as const, startMin: g.startMin, gap: g })),
            ...(ghost ? [{ kind: 'ghost' as const, startMin: ghost.startMin, ghost }] : []),
          ].sort((a, b) => a.startMin - b.startMin);
          return (
            <div
              key={day}
              className="panel p-3"
              onDragLeave={(e) => {
                // 只在真正离开这一列（而不是移进列内某个子元素）时清预览
                if (!e.currentTarget.contains(e.relatedTarget as Node) && preview?.day === day) clearPreview();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || draggingId;
                // 没有悬停预览时（直接落到空白），退回「列末尾」
                const atMin = preview && preview.day === day ? preview.atMin : tailMin + 10;
                if (id) handleDrop(id, day, atMin);
                setDraggingId(null);
                clearPreview();
              }}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-ink">{name}</span>
                {study > 0 && (
                  <span className="text-[11px] text-ink-faint">自习 {Math.round(study / 60 * 10) / 10}h</span>
                )}
              </div>

              {/* 天气 —— 就在星期名称下面（2026-09-19 改版）。
                  有提醒（下雨/高低温/大风）显示带时段的人话提醒，
                  平常日子显示一行概况；那天没有数据（过去的日子）就不显示 —— 不猜。 */}
              {(() => {
                const wd = weatherByDate.get(dateOfDay(day));
                if (!wd) return null;
                const adv = adviceByDate.get(dateOfDay(day));
                const range = wd.tMin != null && wd.tMax != null ? `${wd.tMin}–${wd.tMax}℃` : '';
                if (adv) {
                  return (
                    <div
                      title={adv.detail}
                      className={`mb-1.5 rounded border-l-2 px-2 py-1 text-[11px] leading-relaxed ${
                        adv.severity === 'warn'
                          ? 'border-amber-400 bg-amber-50 text-amber-900'
                          : 'border-slate-300 bg-slate-50 text-ink-soft'
                      }`}
                    >
                      {adv.emoji} <strong>{adv.label}</strong> · {wd.text} {range}：{adv.detail}
                    </div>
                  );
                }
                const emoji = wd.rainProb >= 50 ? '🌧️' : wd.rainProb >= 20 ? '⛅' : '☀️';
                return (
                  <div className="mb-1.5 rounded bg-slate-50 px-2 py-1 text-[11px] text-ink-soft">
                    {emoji} {wd.text} {range}
                  </div>
                );
              })()}

              {/* 卡片流 + 空闲块（≥30 分钟）+ 拖拽影子 */}
              <div className="space-y-1.5">
                  {renderItems.length === 0 && (
                    <div className="rounded-lg border border-dashed border-ink/15 px-3 py-4 text-center text-[12px] text-ink-faint">
                      这一天没有安排
                    </div>
                  )}
                  {renderItems.map((item) => {
                    // 影子块：拖动预览的落点（半透明虚线）或不可落位警告（红色）
                    if (item.kind === 'ghost') {
                      const g = item.ghost;
                      // 影子上必须拦住 dragover：不拦的话事件冒到列容器，落点会被重算
                      const ghostProps = {
                        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); },
                      };
                      return g.ok ? (
                        <div
                          key="drag-ghost"
                          {...ghostProps}
                          className="rounded-lg border-2 border-dashed border-brand/60 bg-brand/5 px-2.5 py-2 text-[12.5px] font-medium text-brand opacity-60"
                        >
                          📍 {g.title}
                          <span className="ml-1 font-mono text-[11px]">{toHHmm(g.startMin)}–{toHHmm(g.endMin)}</span>
                          <div className="mt-0.5 text-[10.5px] font-normal text-brand/70">松手放到这里</div>
                        </div>
                      ) : (
                        <div
                          key="drag-ghost"
                          {...ghostProps}
                          className="rounded-lg border-2 border-dashed border-red-400 bg-red-50 px-2.5 py-2 text-[12.5px] font-medium text-red-700"
                        >
                          🚫 放不到这里 —— {g.reason ?? '放不下'}
                        </div>
                      );
                    }
                    if (item.kind === 'gap') {
                      return (
                        <div
                          key={`gap-${item.gap.startMin}`}
                          className="rounded-lg border border-dashed border-ink/20 bg-paper/60 px-2.5 py-1.5 text-[11px] text-ink-faint"
                        >
                          ⬜ 空闲 {toHHmm(item.gap.startMin)}–{toHHmm(item.gap.endMin)}
                          （{humanizeMinutes(item.gap.endMin - item.gap.startMin)}）
                        </div>
                      );
                    }
                    const b = item.block;
                    const newTaskId = recentTaskIds.find((tid) => b.id.endsWith(`-${tid}`));
                    return (
                      <BlockCard
                        key={b.id}
                        block={b}
                        date={dateOfDay(day)}
                        locked={isLockedThisWeek(planState, weekNo, b)}
                        onToggleLock={toggleLock}
                        onExclude={handleExcludeBlock}
                        assignmentMin={b.courseId ? assignmentByCourse.get(b.courseId) : undefined}
                        onSetAssignment={handleSetAssignment}
                        onClearAssignment={handleClearAssignment}
                        edited={editedBlockIds.has(b.id)}
                        onEditBlock={handleEditBlock}
                        onRevertEdit={handleRevertEdit}
                        dragging={draggingId === b.id}
                        onDragStartCard={(blk) => { setDraggingId(blk.id); clearPreview(); }}
                        onDragEndCard={() => { setDraggingId(null); clearPreview(); }}
                        isNew={!!newTaskId}
                        onDismissNew={newTaskId ? () => setRecentTaskIds((prev) => prev.filter((tid) => tid !== newTaskId)) : undefined}
                      />
                    );
                  })}
                </div>
            </div>
          );
        })}
      </div>

      {/* 拖拽删除投放区 —— 只在拖动时浮现（侧边固定，不随页面滚动）。
          松手 = 删除（与块上「🗑 删除」同通道，可「全部恢复」撤销）。 */}
      {draggingId && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDeleteHover(true); }}
          onDragLeave={() => setDeleteHover(false)}
          onDrop={handleDropToDelete}
          className={`fixed right-4 top-1/2 z-50 -translate-y-1/2 select-none rounded-xl border-2 border-dashed px-3.5 py-6 text-center text-[12.5px] font-semibold leading-relaxed shadow-lg transition-colors ${
            deleteHover
              ? 'scale-105 border-red-500 bg-red-100 text-red-700'
              : 'border-red-300 bg-white/95 text-red-600'
          }`}
        >
          🗑<br />拖到这里<br />删除
        </div>
      )}

      {/* 问题清单 + 汇总 */}
      <div className="panel px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-ink">这一周的情况</h3>
          <span className="text-[12px] text-ink-soft">
            上课 {(plan.stats.courseMin / 60).toFixed(1)}h · 自习 {(plan.stats.studyMin / 60).toFixed(1)}h ·
            留白 {(plan.stats.blankMin / 60).toFixed(1)}h · {plan.stats.blockCount} 个块
          </span>
        </div>
        {issues.length === 0 ? (
          <p className="mt-2 text-[12px] text-green-700">没有发现问题 —— 转场余量都在安全范围内。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {issues.map((iss, i) => (
              <li key={i} className={`rounded-md border px-2.5 py-1.5 text-[12px] leading-snug ${ISSUE_STYLE[iss.level]}`}>
                [{iss.level === 'error' ? '会迟到' : iss.level === 'warn' ? '偏紧' : '提示'}] {iss.message}
              </li>
            ))}
          </ul>
        )}
        {notes.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-ink/10 pt-2">
            {notes.map((n, i) => (
              <li key={i} className="text-[11.5px] text-ink-faint">· {n}</li>
            ))}
          </ul>
        )}
      </div>

      {/* 删除后的空档处理（2026-09-19）：补上来 / 留空白 / 整周重排 / 取消删除 */}
      {deleteAsk && (
        <DeleteAskDialog
          title={deleteAsk.title}
          timeText={`${DAY_LABELS[deleteAsk.day - 1] ?? `周${deleteAsk.day}`} ${toHHmm(deleteAsk.startMin)}–${toHHmm(deleteAsk.endMin)}`}
          onFill={() => {
            let fillCount = 0;
            if (shownPlan) {
              // 补上来：只动软事，课程/三餐不动（规则在 `fillGap`，纯函数有单测）
              const moves = fillGap(
                shownPlan.blocks, deleteAsk.day,
                deleteAsk.startMin, deleteAsk.endMin, deleteAsk.id,
              );
              fillCount = moves.length;
              if (moves.length > 0) {
                updateLayer((prev) => {
                  let next = prev.moves;
                  for (const m of moves) {
                    next = upsertMove(next, {
                      weekNo, blockId: m.blockId, dayOfWeek: m.dayOfWeek,
                      startMin: m.startMin, endMin: m.endMin, source: 'ripple',
                    });
                  }
                  return { ...prev, moves: next };
                });
              }
            }
            setDeleteAsk(null);
            notify('move', fillCount > 0
              ? `空档已补上：${fillCount} 个日程前移 · Ctrl+Z 撤销`
              : '空档附近没有可前移的日程 —— 保持空白');
          }}
          onKeepGap={() => {
            setDeleteAsk(null);
            notify('delete', `已删除「${deleteAsk.title}」· 空档留白`, undoAction());
          }}
          onReplan={() => {
            setDeleteAsk(null);
            notify('info', '已删除，正在整周重新排……');
            setReplanToken((v) => v + 1);
          }}
          onCancel={() => {
            // 取消删除：把块从删除通道里拿出来，它立刻回到表上
            updateLayer((prev) => ({ ...prev, excluded: includeBlock(prev.excluded, deleteAsk.id) }));
            setDeleteAsk(null);
            notify('info', `已恢复「${deleteAsk.title}」`);
          }}
        />
      )}

      {/* R3.4：时间与「长期/一次性」追问 —— 拿不到答案就不建块 */}
      {timeAsk && (
        <TimeAskDialog
          req={timeAsk.ask}
          hintText={timeAsk.ask.askScope ? scopeReason('ask') : undefined}
          onConfirm={(startMin, long) => {
            commitDraft(
              timeAsk.draft,
              timeAsk.ask.askTime ? startMin : timeAsk.draft.startMin ?? null,
              long,
            );
            setTimeAsk(null);
            setTimeAskNote(null);
          }}
          onCancel={() => {
            // T-R3-6：不填就不建块 —— 留白比排一块假的好，但要如实告诉他留下了空窗
            setTimeAsk(null);
            setTimeAskNote(
              `「${timeAsk.ask.title}」还没定时间，所以没有排进去 —— 那段时间会留给你，随时可以手动补`,
            );
          }}
        />
      )}

      {/* 操作反馈 Toast（右上角，自动消失；删除类带撤销按钮） */}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
