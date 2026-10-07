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
import { eventsNearWeek } from '@/lib/planner/events';
import { weatherHints } from '@/features/weather/weather';
import type { WeatherAdvice, WeatherDay } from '@/features/weather/weather';
import {
  isLockedThisWeek, lockCount, longLockKey,
  withLongLock, withoutLock, withoutLongLock,
} from '@/features/plan/planLock';
import { TERM_CALENDAR } from '@/constants/term';
import { toHHmm } from '@/constants/time';
import { useWeekPlan } from './useWeekPlan';
import { addDays, todayISO, weekdayOf } from '@/lib/date';
import { DEADLINES } from '@/data/usst';
// ── 阶段 A：二次修改能力 + R2 块级编辑（「加一件事」表单已并入 ⚙️ 调整抽屉）──
import { EditBlockPanel } from './EditBlockPanel';
// ── R2：用户覆盖层（一次性收口所有用户改动）────────────────────
import {
  addTask, applyPendingMoves, excludeBlock, includeBlock,
  makeLayerId, movesOfWeek,
  removeAssignment, removeMove,
  upsertAssignment, upsertMove,
  type Assignment, type MealPlaces, type UserPlanLayer,
} from './userPlanStore';
// ── F2c/A4：第③层持久化态上提 store（layer+撤销栈 / rules / 会话旗标）──
import {
  redoLayer, setFromNowOn, setReplanToken,
  undoLayer, updateLayerStore, useLayerStore, useRulesStore, useSessionFlags, writeRules,
} from './useWeekPlanStore';

import { Toasts, type ToastItem, type ToastKind } from './toast';
// 作业的**纯函数**仍从 assignmentStore 取（存储已并入覆盖层，那边只留纯逻辑）
import { assignmentId, assignmentsOfWeek, clampEstimate } from './assignmentStore';
// ── S4：用户指定食堂 ──────────────────────────────────────────
// ── R3：调课/停课覆盖层 + 时间追问 ────────────────────────────
import { TimeAskDialog, type TimeAskRequest } from './TimeAskDialog';
import { DeleteAskDialog } from './DeleteAskDialog';
import { applyCourseOverrides } from '@/lib/planner/courseOverrides';
import { localizedPlan, unionAffectedDays } from '@/lib/planner/localizedReplan';
import { fillGap } from '@/lib/planner/ripple';
// ── R4 / R5：活动登记与成就统计 ────────────────────────────────
import { loadGoals } from '@/features/activity/goalStore';
import type { UserTask } from '@/lib/planner/templates';
// ── 阶段 B/E：偏好校正层 + 自然语言意图 ──────────────────────────
import { upsertRule } from '@/features/feedback/store';
import { detectScope, scopeReason } from '@/features/feedback/parseCorrection';
import type { TaskDraft } from '@/features/feedback/planIntent';
import type { CorrectionRule } from '@/lib/planner/corrections';
import { BlockCard } from './BlockCard';
import { DAY_LABELS } from './weekViewUtils';
import { NearEventsPanel, PhaseHeader } from './WeekPlanHeader';
import { useWeekPlanDrag } from './useWeekPlanDrag';
import { WeekToolsPanel } from './WeekToolsPanel';
import { WeekPlanSkeleton } from './PendingEditsBar';
import { AdjustDrawer } from './AdjustDrawer';
import { DeleteAskSection, DropToDeleteZone, WeekIssuesPanel } from './WeekDiagnostics';
import { WeekTimelineGrid } from './WeekTimelineGrid';
import type { DragPreview } from './WeekDayColumn';

interface Props {
  schedule: Schedule;
  weekNo: number;
  persona: import('@/types').PersonaProfile | null;
  /** 排程持久化状态（锁 / 扰动）—— 由 App 持有，本组件只读+回写 */
  planState: import('@/types').PlanPersistState | null;
  onPlanStateChange: (next: import('@/types').PlanPersistState) => void;
  /**
   * 「📍 回到今天」：周次状态由 App（weekMonday）持有，点击回到本周
   */
  onGoToToday?: () => void;
  /** 「去改画像」→ 由组合根经WeekPlanPage 层层透传（组件自己不碰路由） */
  onGoProfile?: () => void;
}

export function WeekPlanView({ schedule, weekNo, persona, planState, onPlanStateChange, onGoToToday, onGoProfile }: Props) {
  /**
   * 「从此刻开始排」开关（P2-T2.3）。
   *
   * 为什么要做成开关而不是默认开：引擎的 `fromNow` 会**砍掉今天已经过去的时间**，
   * 于是今天这一列的块会明显比别的天少。用户如果不知道这是自己开的，
   * 会以为是 bug。默认关（= 完整排一周），由用户主动点。
   *
   * 只在**本周**才有意义 —— 回看第三周时「现在」不是那周的现在。
   */
  const { fromNowOn, replanToken } = useSessionFlags();

  /**
   * **用户覆盖层**（R2）—— 一次性收口所有「用户对本周期计划做过的事」：
   * 加的事 / 删的块 / 改过的位置 / 不可时段 / 调课停课 / 指定的食堂 / 课程作业。
   *
   * 独立 localStorage（key `usst-user-plan-v1`）。**F2c/A4：状态上提 store**
   * （`useWeekPlanStore`）—— 持久化、撤销/重做栈都在 store；切页不再丢状态。
   */
  const { layer, undoDepth, redoDepth } = useLayerStore();

  /**
   * 统一的写回入口：**任何**对覆盖层的改动都走它 ——
   *   · 落库 + 压撤销栈 + 重做历史作废（store 内保证）
   *   · 标记「有改动待生效」（T3：不自动重排，由「重新排一遍」统一应用）
   *
   * 收成一个函数，是为了保证这两件事**永远同时发生** ——
   * 否则某个 handler 忘了标记，用户就会以为按钮没反应。
   */
  const updateLayer = useCallback((fn: (prev: UserPlanLayer) => UserPlanLayer) => {
    updateLayerStore(fn);
    setPendingEdits(true);
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
  const handleUndo = useCallback(() => {
    // 撤销/重做的栈操作与落库都在 store（useWeekPlanStore）；这里只管提示
    if (undoLayer()) notify('info', '已撤销上一步改动');
  }, [notify]);

  /** 重做（Ctrl+Shift+Z / Ctrl+Y）—— 与撤销互为逆操作 */
  const handleRedo = useCallback(() => {
    if (redoLayer()) notify('info', '已重做');
  }, [notify]);

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
   * F2c/A4：状态上提 `useRulesStore`（落库在 store 内保证）。
   */
  const rules = useRulesStore();

  // replanToken 已与 fromNowOn 一并来自 useSessionFlags()（上方解构）—— 手动重排令牌：递增即让主 effect 重跑

  /**
   * 是否有「攒着没应用」的改动（T3）。
   *
   * 为什么要有它：加块 / 删块**不再立刻重排**（否则删一个块，整周跟着抖动，
   * 用户根本看不清自己改了什么）。改动先记进覆盖层，由「重新排一遍」统一应用。
   * 但界面上必须**明说**「有改动还没生效」—— 否则用户会以为按钮没反应。
   */
  const [pendingEdits, setPendingEdits] = useState(false);

  /** ⚙️ 调整抽屉开合（按钮在操作条、抽屉在页面根，两兄弟的状态只能放共同父级） */
  const [adjustOpen, setAdjustOpen] = useState(false);

  const semester = useMemo(
    // 阶段 C：把用户的偏好校正传下去 —— 用户提的要求会影响排程。
    // `rules` 一变，semester → phase → 主 effect 会连锁重跑。
    () => buildPhasesFromCalendar(schedule, persona, TERM_CALENDAR['2026-2027-1'], rules),
    [schedule, persona, rules],
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

  /** R3.4：语言输入没说时间 → 挂起草稿，弹框追问 */
  const [timeAsk, setTimeAsk] = useState<{ draft: TaskDraft; ask: TimeAskRequest } | null>(null);
  /** 时间追问被放弃时的提示（T-R3-6：不建块，如实说） */
  const [timeAskNote, setTimeAskNote] = useState<string | null>(null);

  /** 已被用户处理（三选一/忽略）的预警 goalId —— 本地过滤，hook 里的 state 不归组件管 */
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);
  // 目标分解容量预警（goalWarnings）随排程管线由 `useWeekPlan` 产出 —— 本组件只展示

  /** T6：本周「课程 → 作业时长」的索引（避免在每个块上线性查找） */
  const assignmentByCourse = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assignmentsOfWeek(assignments, weekNo)) {
      map.set(a.courseId, a.estimatedMin);
    }
    return map;
  }, [assignments, weekNo]);

  /** 本周的周一（ISO）—— 把「周次 + 星期几」还原成具体日期，行为记录按它定位 */
  const weekMonday = useMemo(
    () => addDays(schedule.termStart, (weekNo - 1) * 7),
    [schedule.termStart, weekNo],
  );
  const dateOfDay = useCallback(
    (dayOfWeek: number) => addDays(weekMonday, dayOfWeek - 1),
    [weekMonday],
  );

  /* ---------- 「回到今天」与今天列强调（2026-09-20） ---------- */
  const todayIso = todayISO();

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
   * 上一版的 `actualLoad` / `prevRolling` memo 已随批次 3 上提进 `useWeekPlan`
   * （hook 内部自算，视图从未消费）—— F2b 清掉这两段死代码与 `records` 数据态。
   */

  /* ============================================================
   * 排程计算管线（批次 3 上提）：hook 只管「算出 plan」，
   * 交互态（撤销/攒批/拖拽/toast）留在本组件 —— 状态所有权不动。
   * ========================================================== */
  const {
    plan, notes, loading, backendOk, diag, transferInfo, goalWarnings, weather,
  } = useWeekPlan({
    schedule, weekNo, persona, planState, onPlanStateChange,
    layer, goals, rules, fromNowOn, replanToken,
  });

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
  /* ============================================================
   * R1 拖拽（F2d/A5：状态与逻辑整体收进 useWeekPlanDrag —— 第②层交互态
   * 仍与排程管线隔离、不触发重排；视图只消费快照与回调）
   * ========================================================== */
  const {
    draggingId, setDraggingId, dragNote, preview,
    updatePreview, clearPreview, deleteHover, setDeleteHover,
    handleDrop, handleDropToDelete,
  } = useWeekPlanDrag({ shownPlan, weekNo, updateLayer, notify, handleExcludeBlock });

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
    writeRules((prev) => upsertRule(prev, rule));
  }, []);

  const handleRulesChange = useCallback((next: CorrectionRule[]) => {
    writeRules(next);
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

  // 天气拉取已上提 `useWeekPlan`（F2b/A3：数据态归 hook，两页共用一次拉取）；
  // 本组件只消费 hook 返回的 `weather`（weatherByDate / weatherAdvice 派生不变）。

  /* ============================================================
   * 主 effect 已上提 `useWeekPlan()`（批次 3，见上方 hook 调用处）。
   * 原实现里的任务拼装/锁合并/两遍法/定点融合/planState 回写全部原样保留在
   * hook 内 —— 本组件只消费结果（plan/notes/loading/backendOk/diag/transferInfo），
   * 交互态（撤销/攒批/拖拽/toast）仍归本组件所有。
   * ========================================================== */

  if (loading) {
    /* 🔴 2026-10-07：原先是一句 12px 灰字，界面在此期间**完全空白**（像是点了没反应），
       内容出来时整页从空跳到满。改成同尺寸骨架屏，替换时不位移。 */
    return <WeekPlanSkeleton />;
  }
  if (!phase || !plan) {
    return <div className="panel px-6 py-10 text-center text-sm text-ink-soft">这个周次不在学期范围内。</div>;
  }

  /**
   * 问题清单取**屏幕上那一版**（`shownPlan`）的 issues，而不是引擎原生的 `plan.issues`。
   *
   * 🔴 2026-10-07 修：`applyPendingMoves` 现在会**拒掉会撞车的旧改动**并补一条
   * `lock-conflict` 说明（"你之前改动的「X」现在和「Y」撞了…"）。那条 issue 长在
   * `shownPlan` 上；若这里仍读 `plan.issues`，用户看到的就是「块悄悄弹回原位、
   * 一句解释都没有」—— 比不拦还糟。
   */
  const issues: PlanIssue[] = shownPlan?.issues ?? plan.issues;
  /** 本周与下周的校历节点 —— 让「为什么这周多出准备块」有出处 */
  const nearEvents = eventsNearWeek(DEADLINES, schedule.termStart, weekNo);

  return (
    <div className="space-y-4">
      {/* 阶段头 + 本周节点（F2d/A5：拆为 WeekPlanHeader 纯展示子组件） */}
      <PhaseHeader
        weekNo={weekNo}
        phase={phase}
        diag={diag}
        planState={planState}
        isCurrentWeek={isCurrentWeek}
        fromNowOn={fromNowOn}
        setFromNowOn={setFromNowOn}
        transferInfo={transferInfo}
        backendOk={backendOk} onGoProfile={onGoProfile}
      />
      <NearEventsPanel events={nearEvents} />

      {/* 工具面板栈（F2d/A5：操作条 + 用户干预面板拆为 WeekToolsPanel） */}
      <WeekToolsPanel
        weekNo={weekNo}
        goals={goals}
        rules={rules}
        onGoalsChange={setGoals}
        notify={notify}
        onGoToToday={onGoToToday}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        undoDepth={undoDepth}
        redoDepth={redoDepth}
        setReplanToken={setReplanToken}
        onOpenAdjust={() => setAdjustOpen(true)}
        pendingEdits={pendingEdits} editedBlockIds={editedBlockIds} edits={edits}
        handleRestoreAll={handleRestoreAll}
        timeAskNote={timeAskNote}
        handleAddRule={handleAddRule}
        handleAddTaskFromDraft={handleAddTaskFromDraft}
        handleRemoveBlocks={handleRemoveBlocks}
        dragNote={dragNote}
        goalWarnings={goalWarnings}
        dismissedWarnings={dismissedWarnings}
        setDismissedWarnings={setDismissedWarnings}
      />

      {/* ⚙️ 调整抽屉（F3/N3：加一件事/调课停课/不可时段/指定食堂/偏好校正 五 tab 收敛） */}
      <AdjustDrawer
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        weekNo={weekNo}
        schedule={schedule}
        layer={layer}
        updateLayer={updateLayer}
        rules={rules}
        goals={goals}
        handleRulesChange={handleRulesChange}
        onAddTask={handleAddTask}
        pendingEdits={pendingEdits}
        dateOfDay={dateOfDay}
        derivedApplied={derived.applied}
      />

      {/* 七天时间轴（T3：七列共享时间基准 · WeekTimelineGrid + WeekDayColumn 泳道） */}
      <WeekTimelineGrid
        allBlocks={(shownPlan ?? plan).blocks}
        todayDow={todayDow}
        dateOfDay={dateOfDay}
        weatherByDate={weatherByDate}
        adviceByDate={adviceByDate}
        recentTaskIds={recentTaskIds}
        onDismissNew={(tid) => setRecentTaskIds((prev) => prev.filter((x) => x !== tid))}
        planState={planState}
        weekNo={weekNo}
        assignmentByCourse={assignmentByCourse}
        editedBlockIds={editedBlockIds}
        draggingId={draggingId}
        preview={preview}
        setDraggingId={setDraggingId}
        updatePreview={updatePreview}
        clearPreview={clearPreview}
        handleDrop={handleDrop}
        onToggleLock={toggleLock}
        onExclude={handleExcludeBlock}
        onSetAssignment={handleSetAssignment}
        onClearAssignment={handleClearAssignment}
        onEditBlock={handleEditBlock}
        onRevertEdit={handleRevertEdit}
      />

      {/* 拖拽删除投放区（F2d/A5：拆为 WeekDiagnostics 纯展示组件） */}
      {draggingId && (
        <DropToDeleteZone
          deleteHover={deleteHover}
          setDeleteHover={setDeleteHover}
          onDrop={handleDropToDelete}
        />
      )}

      {/* 问题清单 + 汇总（F2d/A5 拆出） */}
      <WeekIssuesPanel plan={plan} issues={issues} notes={notes} />

      {/* 删除后的空档处理（2026-09-19）：补上来 / 留空白 / 整周重排 / 取消删除（F2d/A5 拆出） */}
      {deleteAsk && (
        <DeleteAskSection
          deleteAsk={deleteAsk}
          dayLabel={DAY_LABELS[deleteAsk.day - 1] ?? `周${deleteAsk.day}`}
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
