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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonaProfile, PlanPersistState, Schedule, WeekPlan } from '@/types';
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
import { lockLevelsOf, lockedPlacementsOf, rollingForWeek, withRolling } from '@/features/plan/planLock';
import { movesOfWeek } from './userPlanStore';
import type { UserPlanLayer } from './userPlanStore';
import { DAY_LABELS, localizedDaysFor, nowMinutes, sameRolling } from './weekViewUtils';
import { loadRoutine, routineToDayWindow } from './routineStore';
import { assignmentsOfWeek } from './assignmentStore';
import { goalTasksOf, type DecomposeWarning } from '@/features/activity/goalDecompose';
import { loadGoalPrefs } from '@/features/activity/goalPrefs';
import { periodStartMin, periodEndMin } from '@/constants/time';
import type { Goal } from '@/features/activity/goalStore';
import { loadRecords, actualLoadByDow, summarizeWeek } from '@/features/behavior/behaviorLog';
import { fetchWeather } from '@/features/weather/weather';
import type { WeatherReport } from '@/features/weather/weather';
import type { CorrectionRule } from '@/lib/planner/corrections';
import type { UserTask } from '@/lib/planner/templates';

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
  lifeMode: string | null;
  /** 「从此刻开始排」（T2.3）；总览恒 false —— 总览要完整一天 */
  fromNowOn?: boolean;
  /** 手动重排令牌（总览不用） */
  replanToken?: number;
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
    layer, goals, rules, lifeMode, fromNowOn = false, replanToken = 0,
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
   * 未采集 → `routineToDayWindow()` 返回 null → 不传 `dayStart/dayEnd` → 引擎走缺省窗口。
   */
  const dayWindow = useMemo(() => routineToDayWindow(loadRoutine()), [replanToken]);

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
        const eventTasks = expandDeadlines(DEADLINES, schedule.termStart, schedule.totalWeeks);
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
        if (!cancelled) setGoalWarnings(decomp.warnings);
        const tasks: UserTask[] = [
          ...eventTasks,
          ...userTasks,
          // R5：目标 → 排程任务（goals 攒着语义见上方 ref 注释）
          ...decomp.tasks,
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
            tasks,
          }),
          // Q1a：作息边界（`usst-routine-v1`）→ `dayStart`/`dayEnd`；未采集时不传，
          // 引擎走 `'07:00'/'23:00'` 缺省（问卷规格书 §6.2 的「组装层翻译」落点）
          ...(dayWindow ?? {}),
          lockLevels: effectiveLockLevels,
          lockedPlacements: effectivePlacements,
          mealPlaces: curLayer.mealPlaces,
          homeBase: curLayer.homeBase ?? null,
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
          previousPlan: lastPlanRef.current,
          fromNow: nowMin,
          fromNowDay: nowMin != null ? (todayDow as never) : null,
          excludedBlockIds: curLayer.excluded,
          corrections: [...rulesRef.current],
        };
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
    // （点「定住」要立刻重排）。rules 经 phase 传播。weather 保持原重排时机。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSchedule, weekNo, phase, persona, weather, planState, fromNowOn, replanToken]);

  return { plan, notes, loading, backendOk, diag, transferInfo, goalWarnings, weather };
}
