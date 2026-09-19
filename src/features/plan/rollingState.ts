/**
 * 滚动状态的沉淀 —— 「跨周滚动」这一环的应用层
 * ============================================================
 * 引擎刻意**按周独立求解**：它不知道上周发生了什么。「记得你上周怎么过的」
 * 这件事由本模块负责：把「引擎排出来的本周负荷」与「用户实际执行记录」
 * 合并成一份跨周累积的 `RollingState`，存进 `planState.rolling`，
 * 下一周再作为 `PlanRequest.rolling` 喂回引擎（引擎侧消费见 `planner/fatigue.ts`）。
 *
 * 三条规则，全部来自同一个已确认的决定 ——「负荷来源 = **实际优先、计划兜底**」：
 *   1. 某天**有反馈**（点过「做了/没做」）→ 用**实际完成**的分钟数；
 *   2. 某天**没反馈** → 退回引擎的计划值（没数据 ≠ 没做，记 0 会让引擎误以为你闲着）；
 *   3. 累积用 EWMA（`FATIGUE.ewmaAlpha`）—— 单周的异常不该被永久记恨，
 *      但也不能一到下周就忘光。
 *
 * ⚠️ **自指陷阱（本模块存在的首要理由）**
 *   如果把「本周自己排出来的负荷」沉淀进 rolling，而 rolling 又立刻被用来排本周，
 *   就会形成正反馈：排得满 → 以为你累 → 排得更空 → 更以为你累。
 *   用户什么都不做，计划却一周比一周空 —— 这是反馈闭环最经典的失效方式。
 *   所以喂给引擎时必须过 `rollingForPlan()`：**只有知识截止周早于本周才用**，
 *   本周的经验只对下周及以后生效。
 */
import type { RollingState } from '@/types';
import { FATIGUE } from '@/lib/planner/fatigue.ts';
import type { BehaviorRecord } from '@/features/behavior/behaviorLog';
import { emptyPlanState, normalizePlanState } from '@/features/plan/planLock.ts';
import type { PlanPersistState } from '@/types';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 保留两位小数（避免 `0.6666666` 这类值进入持久化，让状态对不上、测试难写） */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface WeekRollingResult {
  rolling: RollingState;
  /** 这一周有多少天拿到了反馈（0 = 整周没有任何真实数据） */
  feedbackDays: number;
  /**
   * 本周完成率（按**计划时长加权**，不是按块数）；没有任何反馈时为 `null`。
   * `null` 与 `0` 的差别很重要：`0` 会被读成「一个都没做」，而实际含义是「还没有数据」。
   */
  doneRate: number | null;
  /** 本周实际完成的分钟数（所有类别合计） */
  actualMin: number;
}

/**
 * 把一周的观测沉淀成滚动状态。
 *
 * ⚠️ `base` 必须是**上一周的滚动基线**，不是 `planState.rolling` 本身：
 *   用户会在同一周里反复操作（每标记一次「做了/没做」就重算一次），
 *   若拿自己的上一次输出当基线，同一周点两次就会把负荷算两遍。
 *   正确的基线由 `rollingBaseFor()` 给出 —— 本周内任意次重算都从同一个起点出发。
 *
 * @param engine    引擎刚产出的 `nextRolling`（其 `loadByDow` = 本周**计划**的逐日负荷）
 * @param base      历史基线（上周的滚动状态）；null = 首次
 * @param records   全部行为记录（本函数自己按日期筛，调用方不必先过滤）
 * @param weekDates 被沉淀那一周的 7 个 ISO 日期（**周一起**，index 0 = 周一）
 * @param weekNo    被沉淀的周次 → 写进 `throughWeek`
 */
export function mergeWeekRolling(input: {
  engine: RollingState;
  base: RollingState | null;
  records: BehaviorRecord[];
  weekDates: string[];
  weekNo: number;
}): WeekRollingResult {
  const { engine, base, records, weekDates, weekNo } = input;
  const recentLoad: number[] = [];
  const feasibleByDow: number[] = [];
  let feedbackDays = 0;
  let actualMin = 0;
  let doneMin = 0;
  let markedMin = 0;

  for (let i = 0; i < 7; i += 1) {
    const dow = i + 1;
    const date = weekDates[i];
    const planned = engine.loadByDow[dow] ?? 0;
    const ofDay = date ? records.filter((r) => r.date === date) : [];

    if (ofDay.length > 0) {
      /* —— 有反馈：实际优先 —— */
      feedbackDays += 1;
      const dayDoneMin = ofDay
        .filter((r) => r.status === 'done')
        .reduce((n, r) => n + r.plannedMin, 0);
      const dayMarkedMin = ofDay.reduce((n, r) => n + r.plannedMin, 0);
      actualMin += dayDoneMin;
      doneMin += dayDoneMin;
      markedMin += dayMarkedMin;

      const base0 = base?.recentLoad?.[i] ?? dayDoneMin;
      recentLoad[i] = Math.round(FATIGUE.ewmaAlpha * dayDoneMin + (1 - FATIGUE.ewmaAlpha) * base0);
      feasibleByDow[i] = round2(clamp(
        dayDoneMin / Math.max(1, dayMarkedMin),
        FATIGUE.minFeasible,
        1,
      ));
    } else {
      /* —— 没反馈：计划兜底（不能记 0，否则「没数据」会被当成「很闲」）—— */
      const b = base?.recentLoad?.[i];
      recentLoad[i] = b == null
        ? planned
        : Math.round(FATIGUE.ewmaAlpha * planned + (1 - FATIGUE.ewmaAlpha) * b);
      feasibleByDow[i] = base?.feasibleByDow?.[i] ?? 1;
    }
  }

  return {
    rolling: {
      recentLoad,
      // 原样保留引擎的原始计划负荷与即将到来的交期（后者每周都该刷新）
      loadByDow: engine.loadByDow,
      upcoming: engine.upcoming,
      feasibleByDow,
      throughWeek: weekNo,
    },
    feedbackDays,
    doneRate: markedMin > 0 ? round2(doneMin / markedMin) : null,
    actualMin,
  };
}

/**
 * 取「可以喂给本周排程」的滚动状态。
 *
 * 只有 `throughWeek < weekNo` 才返回 —— 这是**自指的唯一防线**：
 * 本周沉淀出来的状态（`throughWeek === weekNo`）不能在排本周时被用上，
 * 否则「计划 → 负荷 → 更松的计划」会自我强化。
 *
 * 来源不明（`throughWeek` 缺失）的历史状态一律**不用**：宁可少一次自适应，
 * 也不要拿一份不知道截止在哪一周的数据去改目标。
 */
export function rollingForPlan(
  state: PlanPersistState | null | undefined,
  weekNo: number,
): RollingState | undefined {
  const r = state?.rolling;
  if (!r) return undefined;
  const through = r.throughWeek;
  if (through == null) return undefined;
  return through < weekNo ? r : undefined;
}

/**
 * 沉淀当前周时该用的**历史基线**。
 *
 * 三种来源，优先级从高到低：
 *   1. `rolling.throughWeek < weekNo` → 那个 `rolling` 就是基线（正常跨周路径）；
 *   2. `rolling.throughWeek === weekNo` → 本周已经沉淀过一次，回到存下来的
 *      `rollingBase` 重算（**保证本周内重复重算幂等**，不会自我叠加）；
 *   3. 其它（没有历史 / 来源不明 / 是「未来」的知识）→ null（宁可从零开始）。
 */
export function rollingBaseFor(
  state: PlanPersistState | null | undefined,
  weekNo: number,
): RollingState | null {
  const r = state?.rolling;
  if (!r || r.throughWeek == null) return null;
  if (r.throughWeek < weekNo) return r;
  if (r.throughWeek === weekNo) return state?.rollingBase ?? null;
  return null;
}

/** 把这一周的沉淀写回持久化状态（连同基线一起存，`lastPlanWeek` 一并更新） */
export function withWeekRolling(
  state: PlanPersistState | null | undefined,
  result: WeekRollingResult,
  base: RollingState | null,
  weekNo: number,
  now = '',
): PlanPersistState {
  const prev = normalizePlanState(state) ?? emptyPlanState(now);
  return {
    ...prev,
    rolling: result.rolling,
    rollingBase: base,
    lastPlanWeek: weekNo,
    updatedAt: now || prev.updatedAt,
  };
}

/**
 * 这一周**是否已经发生**（可贡献知识）。
 *
 * 为什么必须卡这条：未来的周没有任何「实际负荷」可言，把它自己的计划值当成观测
 * 沉淀下去，就是纯粹的自指 —— 而且用户每次往后翻一周就沉淀一次，
 * 目标会被一路拉低（计划少了 → 负荷估计跟着少 → 下周目标更低）。
 * 规则因此是：**未来的周只消费滚动状态，不沉淀**。
 */
export function isSettledWeek(weekNo: number, currentWeekNo: number): boolean {
  return weekNo <= currentWeekNo;
}

/** 给界面用的一句话总结；没有任何反馈时返回 null（不假装有数据） */
export function rollingSummary(result: WeekRollingResult): string | null {
  if (result.feedbackDays === 0) return null;
  const pct = result.doneRate == null ? null : Math.round(result.doneRate * 100);
  return `上周有反馈的 ${result.feedbackDays} 天里，实际完成 ${Math.round(result.actualMin / 60 * 10) / 10} 小时`
    + (pct == null ? '' : `（完成率 ${pct}%）`);
}
