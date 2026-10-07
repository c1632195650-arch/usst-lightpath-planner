/**
 * useWeekPlan —— 周程排程的**共享计算管线**（总览页改版 批次 3）
 * ============================================================
 * 把 `WeekPlanView` 主 effect 里的「排程计算」收拢成一个 hook：
 *   任务拼装（事件/用户/目标/作业）→ 锁合并 → planWeek 两遍法 → 定点融合
 *   → planState 回写。
 *
 * 🔴 **状态所有权不动，只挪计算**（计划书批次 3 的红线）：
 *   · layer / goals / rules 由调用方持有 —— 周程页是可编辑 state，
 *     总览页是一次性 `loadXxx()` 只读快照；
 *   · 交互态（撤销栈 / 攒批 / 拖拽 / toast / fromNowOn 开关）**不进 hook**，
 *     留在周程页 —— 总览是只读消费者，不该被拖进周程的交互复杂度。
 *
 * 🔴 **T3 攒着语义必须原样保留**：`layer` / `goals` 刻意**不在** effect 依赖里
 *   （改块/加事/调目标不立刻重排，攒到「重新排一遍」）。实现上用 ref 承载
 *   最新值，effect 重跑时读 ref —— 与原先「闭包捕获当次渲染值」等价。
 *
 * 两个消费者：
 *   · WeekPlanView —— 全功能（回写 planState、replanToken 手动重排）；
 *   · OverviewPage —— 只读（不传 `onPlanStateChange` → 不回写、不产生副作用）。
 *
 * 同一入参下两个消费者各自实例化（二者不同时挂载），引擎确定性保证结果一致。
 *
 * ── 2026-10-08 接入（RAY feat/ux-round4 批次 3 管线，e7df736 的依赖）──
 * 本树适配（逻辑按 Ray，落点按本树）：
 *   · **引擎开关移除**：Ray 的 `ours/cy` A/B 开关（planner-cy 移植对照）不随批接入 ——
 *     本树 `@/lib/planner` 是唯一权威引擎；`engineMode` 依赖与 `lib/engineMode` 不进本树。
 *   · **本树引擎输入全保留**：`persona`（整份画像）· `pendingTodos`（待办→排程约束，
 *     M4-W3）· `activeDays`（FOCUS DAYS 硬约束 W6-A）· `lifeModeExtras`（WP5 生活模式）·
 *     `weeklyActivityMin:150`（P1-5 活动量下限）· `mealAutoPlace`（WP6 三餐就近）。
 *   · 作息日窗走本树 `dayWindowWithFallback(loadRoutine(), loadBasicInfo().sleepMin)`
 *     （问卷就寝兜底；未采集 = 一个字段都不加，引擎缺省，golden 零漂移）。
 *   · 排程落地后的**待办回填**（blockId → 云端 `Todo.scheduledBlockId`）保留。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DayOfWeek, PersonaProfile, PlanPersistState, Schedule, WeekPlan } from '@/types';
import type { Diagnostics } from '@/lib/planner/model';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { toPlanRequest } from '@/lib/planner/schedule';
import { planWeek } from '@/lib/planner/planWeek';
import { fetchRouteBatch } from '@/lib/planner/transfer';
import { expandDeadlines } from '@/lib/planner/events';
import { DEADLINES } from '@/data/usst';
import { TERM_CALENDAR } from '@/constants/term';
import { addDays, todayISO, weekdayOf } from '@/lib/date';
import { applyCourseOverrides } from '@/lib/planner/courseOverrides';
import { localizedPlan } from '@/lib/planner/localizedReplan';
import { lifeModeExtrasOf } from '@/lib/planner/lifeModePolicy';
import { lockLevelsOf, lockedPlacementsOf, rollingForWeek, withRolling } from '@/features/plan/planLock';
import { movesOfWeek } from './userPlanStore';
import type { UserPlanLayer } from './userPlanStore';
import { DAY_LABELS, localizedDaysFor, nowMinutes, sameRolling } from './weekViewUtils';
import { dayWindowWithFallback, loadRoutine } from './routineStore';
import { loadBasicInfo } from '@/lib/identity';
import { assignmentsOfWeek } from './assignmentStore';
import { goalTasksOf, type DecomposeWarning } from '@/features/activity/goalDecompose';
import { loadGoalPrefs } from '@/features/activity/goalPrefs';
import { periodStartMin, periodEndMin } from '@/constants/time';
import type { Goal } from '@/features/activity/goalStore';
import { loadRecords, actualLoadByDow, summarizeWeek, goalDebtByGoal } from '@/features/behavior/behaviorLog';
import { refineTaskDurations } from '@/features/behavior/refine';
import { restartTasks } from '@/features/activity/restartTasks';
import { inferEnergyCurve } from '@/lib/planner/energyCurve';
import { loadEnergyPeak } from './energyStore';
import { fetchWeather } from '@/features/weather/weather';
import type { WeatherReport } from '@/features/weather/weather';
import type { CorrectionRule } from '@/lib/planner/corrections';
import type { UserTask } from '@/lib/planner/templates';
// ── 任务四（M4-W3）：待办 → 排程约束 + 排程后的 blockId 回填（本树闭环，保留）──
import { todosToPendingTodos } from '@/features/memo/memoLogic';
import { fetchCloudTodos, registerPlanBlocks, syncScheduledBlockIds } from '@/features/memo/webMemo';
import { loadIdentity } from '@/features/mobile/lib/auth';
import type { Todo } from '@/features/mobile/lib/memoTypes';
import { mergeDeadlines, loadUserDeadlines } from '@/features/calendar/deadlineStore';

/**
 * `DAY_LABELS` / `nowMinutes` / `sameRolling` / `localizedDaysFor` 四个工具已合并回
 * `./weekViewUtils`（P2-2）。
 *
 * 起因：F2d 把这四个搬进 `weekViewUtils` 时**没有删掉本文件里的私有副本**，
 * 于是同一份逻辑在仓里有两份**逐字节相同**的拷贝 —— 当时它们还没分叉，但这是漂移陷阱：
 * 谁修了其中一份，另一份会静默保持旧行为，而且「有测试」的那份恰好是死的那份。
 * 现在只剩一份；`tests/weekViewUtils.test.ts` 覆盖它，并用静态守卫禁止本文件再长出副本。
 */

export interface UseWeekPlanInput {
  schedule: Schedule;
  weekNo: number;
  persona: PersonaProfile | null;
  /** App 持有的持久化状态（锁/滚动）；总览只读时原样传入即可 */
  planState: PlanPersistState | null;
  /**
   * 排完写回 rolling/churn。
   * 🔴 **不传 = 只读模式**（总览）：绝不产生写回副作用。
   */
  onPlanStateChange?: (next: PlanPersistState) => void;
  /** 用户覆盖层（调用方持有：周程=可编辑 state，总览=只读快照） */
  layer: UserPlanLayer;
  goals: readonly Goal[];
  rules: readonly CorrectionRule[];
  /** 「从此刻开始排」（T2.3）；总览恒 false —— 总览要完整一天 */
  fromNowOn?: boolean;
  /** 手动重排令牌（总览不用） */
  replanToken?: number;
  /** 生活模式（WP5，本树特性）：引擎附加参数（运动配额/加餐窗口/自由格）的入口 */
  lifeMode?: string | null;
  /** FOCUS DAYS 硬约束（W6-A，本树特性）：只在这些天排软块；空数组 = 无约束 */
  activeDays?: DayOfWeek[];
}

export interface UseWeekPlanResult {
  plan: WeekPlan | null;
  notes: string[];
  loading: boolean;
  backendOk: boolean;
  diag: Diagnostics | null;
  transferInfo: { rounds: number; uncovered: string[] } | null;
  /** 目标分解容量预警（诚实原则：排不下就明说） */
  goalWarnings: DecomposeWarning[];
  /**
   * 天气（A3 数据态归 hook）：可选增强，拉不到为 null。
   * 过去 6 天 + 未来 7 天窗口 —— 两个消费者（周程/总览）原来各拉一份，现在只拉一次。
   */
  weather: WeatherReport | null;
}

export function useWeekPlan(input: UseWeekPlanInput): UseWeekPlanResult {
  const {
    schedule, weekNo, persona, planState, onPlanStateChange,
    layer, goals, rules, fromNowOn = false, replanToken = 0,
    lifeMode = null, activeDays,
  } = input;

  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendOk, setBackendOk] = useState(true);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [goalWarnings, setGoalWarnings] = useState<DecomposeWarning[]>([]);
  const [transferInfo, setTransferInfo] = useState<{ rounds: number; uncovered: string[] } | null>(null);

  /**
   * 天气（A3 数据态归 hook）。可选增强：拉不到就是 null，排程不受影响。
   * 与周次无关（恒为「过去 6 天 + 未来 7 天」），只拉一次；
   * 换周时由消费方按 weekNo 过滤，不重拉。
   */
  const [weather, setWeather] = useState<WeatherReport | null>(null);
  useEffect(() => {
    let cancelled = false;
    // past_days=6：无论今天周几，本周七天都有天气（否则周末打开，周一到周五全是空白 —— 实测教训）
    fetchWeather(7, 6).then((r) => { if (!cancelled) setWeather(r); });
    return () => { cancelled = true; };
  }, []);

  /**
   * 上一版计划 —— 增量重排（T2.1）的基准。
   * ref 而非 state：不应触发渲染（原 WeekPlanView 注释的理由原样成立）。
   */
  const lastPlanRef = useRef<WeekPlan | null>(null);

  // 🔴 T3 攒着语义：这三样**不在** effect 依赖里，用 ref 让 effect 重跑时读到最新值
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const goalsRef = useRef(goals);
  goalsRef.current = goals;
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const planStateRef = useRef(planState);
  planStateRef.current = planState;
  const onPlanStateChangeRef = useRef(onPlanStateChange);
  onPlanStateChangeRef.current = onPlanStateChange;

  /** 阶段策略：rules / lifeMode 一变 → semester → phase 连锁重算 → effect 重跑 */
  const semester = useMemo(
    () => buildPhasesFromCalendar(schedule, persona, TERM_CALENDAR['2026-2027-1'], [...rules], lifeMode),
    [schedule, persona, rules, lifeMode],
  );
  const phase = phaseOfWeek(semester.plan, weekNo);

  /** R3：调课/停课 → 派生课表（原对象不动；纯函数，两处消费各算各的也一致） */
  const effectiveSchedule = useMemo(
    () => applyCourseOverrides(schedule, layer.courseOverrides, weekNo).schedule,
    [schedule, layer.courseOverrides, weekNo],
  );

  /** 行为记录只读：历史数据喂跨周疲劳（2026-09-19 起不再新增） */
  const [records] = useState(() => loadRecords());

  /**
   * 作息边界只读快照（Q1a / 问卷规格书 §6.2 组装层翻译）。
   *
   * **自 Q1b 起随 `replanToken` 重读** —— 用户在工具面板改了作息后，点「重新排一遍」
   * 就能生效，与「手动改完攒着、点一次重排」同一口径；
   * **不引入「改设置就悄悄重排」**这种新行为。
   * 组件重新挂载（刷新 / 切页往返）时同样会重读。
   *
   * 未采集 → `dayWindowWithFallback` 返回 null → 不传 `dayStart/dayEnd` → 引擎走缺省窗口。
   * （本树裁决 R2：作息设置是唯一真源，问卷 `BasicInfo.sleepMin` 只作就寝兜底 ——
   *  不新建 PlanRequest.sleepMin 契约字段，避免第二个就寝真源。）
   */
  const dayWindow = useMemo(
    () => dayWindowWithFallback(loadRoutine(), loadBasicInfo().sleepMin ?? null),
    [replanToken],
  );

  const weekMonday = useMemo(
    () => addDays(schedule.termStart, (weekNo - 1) * 7),
    [schedule.termStart, weekNo],
  );
  const isCurrentWeek = useMemo(() => {
    const today = todayISO();
    return today >= weekMonday && today < addDays(weekMonday, 7);
  }, [weekMonday]);
  const todayDow = useMemo(() => {
    if (!isCurrentWeek) return null;
    const d = weekdayOf(todayISO());
    return (d === 0 ? 7 : d) as number;
  }, [isCurrentWeek]);

  const actualLoad = useMemo(
    () => actualLoadByDow(records, addDays(weekMonday, -7 * 4), 4),
    [records, weekMonday],
  );

  const prevRolling = useMemo(
    () => rollingForWeek(planState, weekNo),
    [planState, weekNo],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!phase) { setPlan(null); return; }
        // 以下管线与 WeekPlanView 原主 effect 逐行对应 —— 行为必须一致
        const curLayer = layerRef.current;
        const curGoals = goalsRef.current;
        // WP11：静态校历 ∪ 用户重要日（title+date 去重）—— 截止日不只旁边一个倒计时数字
        const eventTasks = expandDeadlines(
          mergeDeadlines(DEADLINES, loadUserDeadlines()),
          schedule.termStart, schedule.totalWeeks,
        );
        const userTasks = curLayer.tasks.filter(
          (t) => !t.weeks?.length || t.weeks.includes(weekNo),
        );
        // 目标分解 v1 的输入：每天课程分钟（避开密日）与全周自由容量（守卫用）
        const courseMinByDay: Record<number, number> = {};
        let bookedMin = 0;
        for (const b of schedule.courses) {
          for (const sl of b.slots) {
            const min = periodEndMin(sl.endPeriod) - periodStartMin(sl.startPeriod);
            courseMinByDay[sl.dayOfWeek] = (courseMinByDay[sl.dayOfWeek] ?? 0) + min;
            bookedMin += min;
          }
        }
        const freeMinutes = 16 * 60 * 7 - bookedMin;
        // S5.5：执行率校准（上周实际完成 / 计划；null = 无数据 → 不校准）
        const behaviorRecords = loadRecords();
        const prevWeek = summarizeWeek(behaviorRecords, weekNo - 1);
        const adherence = prevWeek.marked > 0 ? prevWeek.doneMin / prevWeek.markedMin : null;
        const decomp = goalTasksOf(curGoals, weekNo, schedule.termStart, loadGoalPrefs(), courseMinByDay, freeMinutes, adherence, persona);
        // 二期 2.1（长计划增强计划书）：最小重启 —— 上周欠账目标注入一个 25 分钟补课块。
        // 欠账表在调用方算（本域已消费 behaviorLog），activity 侧保持零新域对（R5）。
        const restart = restartTasks(
          goalDebtByGoal(behaviorRecords, weekNo - 1),
          weekNo - 2 >= 1 ? goalDebtByGoal(behaviorRecords, weekNo - 2) : new Map(),
          curGoals,
          weekNo,
        );
        // 二期 2.2：执行回流估时 —— 近 4 次实际用时中位数修正任务估时
        //（±20% 封顶、偏差 ≤15% 不动；用户显式编辑走 planEdits 在构造后覆盖，恒胜）
        const refinedTasks = refineTaskDurations(decomp.tasks, behaviorRecords);
        if (!cancelled) setGoalWarnings([...restart.warnings, ...decomp.warnings]);
        const tasks: UserTask[] = [
          ...eventTasks,
          ...userTasks,
          // R5：目标 → 排程任务（goals 攒着语义见上方 ref 注释）
          ...refinedTasks,
          // 二期 2.1：最小重启补课块（上周欠账的目标，每目标 ≤1 块）
          ...restart.tasks,
          // T6：作业 → UserTask（攒着语义同上）
          ...assignmentsOfWeek(curLayer.assignments, weekNo).map((a): UserTask => ({
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
        // ── 任务四（M4-W3）：待办 → 排程约束 ─────────────────────────
        // 手机/网页待办工作区里**未完成**的待办参与排程（云同步闭环：
        // 手机记 → 云端 SyncState → 网页排计划时带上）。
        // recent → UserTask 通道、longterm → 可拆 Commit 通道（映射规则见
        // `memoLogic.todosToPendingTodos`，确定且有测试）。
        // 🔴 拉不到云端 / 未登录 → pendingTodos 为空 = 旧行为（不阻塞排程）。
        const identity = loadIdentity();
        let memoTodos: Todo[] = [];
        if (identity?.token) {
          try {
            memoTodos = await fetchCloudTodos(identity.token);
          } catch { /* 云端拉不到 → 本轮不带待办，诚实降级 */ }
        }
        const pendingTodos = todosToPendingTodos(memoTodos, schedule.termStart, weekNo);

        const nowMin = fromNowOn && isCurrentWeek ? nowMinutes() : null;

        // R2：用户改过的位置并进锁（drag/edit → hard，ripple → soft）
        const curMoveMap = movesOfWeek(curLayer.moves, weekNo);
        const curPlanState = planStateRef.current;
        const effectiveLockLevels = { ...lockLevelsOf(curPlanState) };
        const effectivePlacements = { ...lockedPlacementsOf(curPlanState) };
        for (const [id, m] of curMoveMap) {
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
            schedule: effectiveSchedule, weekNo, policy: phase.policy,
            scenarios: persona?.scenarios ?? null,
            // 批 4.3（1A-③，本树）：完整画像进引擎 —— socialCap 与画像块级偏好的入口
            persona,
            tasks,
            // 任务四（M4-W3，本树）：待办约束（空数组 = 与旧行为逐字段一致）
            pendingTodos,
            // W6-A（本树）：FOCUS DAYS 硬约束（toPlanRequest 对空数组/undefined 原样吞掉 = 不生效）
            activeDays,
          }),
          // Q1a：作息边界（`usst-routine-v1`）→ `dayStart`/`dayEnd`；未采集时不传，
          // 引擎走 `'07:00'/'23:00'` 缺省（问卷规格书 §6.2 的「组装层翻译」落点）
          ...(dayWindow ?? {}),
          // P1-5（裁决 R3，本树）：每周活动量下限，WHO ≥150 分钟/周（健康库 aerobic-150，A 级）。
          // 引擎侧 opt-in：字段不传不生效；这里给产品缺省 150（已排够就不再补）。
          weeklyActivityMin: 150,
          lockLevels: effectiveLockLevels,
          lockedPlacements: effectivePlacements,
          mealPlaces: curLayer.mealPlaces,
          // WP6（本树裁决）：三餐自动就近食堂（离下一节课最近的；显式 mealPlaces 仍优先）
          mealAutoPlace: true,
          // WP5（本树）：生活模式的引擎附加参数（运动配额/加餐窗口/自由格）。
          // 缺省（没选模式）= undefined → 引擎默认路径，与不传逐位一致。
          lifeModeExtras: lifeModeExtrasOf(lifeMode),
          unavailable: curLayer.slots.map((s) => ({
            id: s.id,
            days: s.days,
            fromMin: s.fromMin,
            toMin: s.toMin,
            weeks: s.weeks,
            createdAtWeek: s.createdAtWeek,
            title: s.title,
          })),
          rolling: prevRolling,
          actualLoadByDow: actualLoad,
          // 二期 2.3：日内精力曲线（作息 + 画像轴 + 用户高峰微调 → 24 锚点）。
          // 不传 = 引擎用缺省曲线（golden / 无作息用户行为不变）。
          energyCurve: inferEnergyCurve({
            wakeMin: loadRoutine().wakeMin,
            sleepMin: loadRoutine().sleepMin,
            peakHour: loadEnergyPeak(),
            axes: persona?.axes ?? null,
          }),
          previousPlan: lastPlanRef.current,
          fromNow: nowMin,
          fromNowDay: nowMin != null ? (todayDow as never) : null,
          excludedBlockIds: curLayer.excluded,
          corrections: [...rulesRef.current],
        };
        // 引擎：本树 `@/lib/planner` 是唯一权威实现（Ray 的 ours/cy A/B 开关不随批接入）
        const result = await planWeek(req, {
          fetchRoutes: async (pairs) => {
            const routes = await fetchRouteBatch(pairs);
            if (!cancelled && pairs.length > 0) {
              const anyHit = Object.values(routes).some((v) => v && typeof v.minutes === 'number');
              if (anyHit) setBackendOk(true);
            }
            return routes;
          },
        });
        // R6.1 定点修改：改动只影响相关天
        const prev = lastPlanRef.current;
        const curDerived = applyCourseOverrides(schedule, curLayer.courseOverrides, weekNo);
        const days = localizedDaysFor(curLayer, curDerived.applied, weekNo);
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
          // 任务四（M4-W2-P2-3，本树）：待办 → 已排块回填。注册块位置（「已排进周三 15:00」
          // 的精确回显用）+ 把命中块 id 写回 Todo.scheduledBlockId（云端，单项 LWW）。
          // 失败不影响排程主流程（fire-and-forget，台账留痕）。
          registerPlanBlocks(fused);
          if (identity?.token && memoTodos.length > 0) {
            void syncScheduledBlockIds(identity.token, memoTodos, fused).catch(() => { /* 回填失败不阻塞 */ });
          }
          // planState 回写 —— 只在非只读模式（总览不传回调）
          const cb = onPlanStateChangeRef.current;
          if (cb) {
            const now = new Date().toISOString();
            const churn = result.diagnostics.churnMin;
            const ps = planStateRef.current;
            const next = withRolling(ps, weekNo, result.nextRolling, churn, now);
            const changed = ps?.lastPlanWeek !== weekNo
              || ps?.churnMin !== next.churnMin
              || !sameRolling(ps?.rolling ?? null, next.rolling);
            if (changed) cb(next);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // 依赖与原 effect 逐项对应：layer/goals/rules 走 ref（T3 攒着），planState 在依赖里
    // （点「定住」要立刻重排）。rules / lifeMode 经 phase 传播。weather 保持原重排时机。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSchedule, weekNo, phase, persona, weather, planState, fromNowOn, replanToken]);

  return { plan, notes, loading, backendOk, diag, transferInfo, goalWarnings, weather };
}
