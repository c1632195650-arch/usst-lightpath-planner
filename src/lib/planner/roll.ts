/**
 * 排程引擎 v2 · 滚动视野（Rolling，P2-T2.2）
 * ============================================================
 * 依据：规格书 §5.3「产能与负荷模型」的**跨天加成**一行、§4.4 `RollingState`、
 *       §9-T2.2「滚动视野 `roll.ts`：`RollingState` 生产与消费；`loadByDow` 影响 capacity」。
 *
 * ── 这个文件补的是 P1 留下的一处**断链** ──────────────────────────
 * P1 只做了**生产端**：`solver.nextRollingFrom()` 会算出 `recentLoad` / `loadByDow`
 * 并挂到 `PlanResult.nextRolling`。但**全仓没有任何地方读它** ——
 * 于是「一周很累、下一周自动松一点」这条产品差异化的第三条（§4.1 表第 3 行）
 * 只有产出、没有消费，跨周永远是同一个强度。
 *
 * 本文件就是**消费端**：把 `RollingState` 翻译成「这一天该不该降档」。
 *
 * ── 口径（规格书 §5.3，逐字对齐） ────────────────────────────────
 * ```
 * 跨天加成：
 *     若 rolling.loadByDow[day] 显著高于均值 → capacity(day) 下调 10%（软）
 * ```
 * 三条实现约定：
 *   1. **「显著高于均值」的判据**由本文件显式定义（见 `LOAD_HIGH_RATIO`），
 *      因为规格书只给了「显著」二字，没给阈值 —— 不定义就没法写测试。
 *   2. **是「软」的**：只下调 10%，不是砍掉；且只在构造阶段的**预算**上体现，
 *      不引入新的硬约束（H1–H8 一条都没加）。
 *   3. **数据不足时不动**：`rolling` 为空 / 该天无历史 / 历史天数不够，
 *      一律返回 1.0（不降档）。**宁可不少排，不可凭空少排** ——
 *      这是 §12.5.5「不猜」纪律在数值上的落地。
 *
 * 设计纪律：纯函数 —— 不读时钟、不 fetch、不用随机。
 */
import type { RollingState } from '@/types';

/** 负荷口径的来源（诊断与 note 用，便于解释「这次为什么松了」） */
export type LoadSource = 'actual' | 'planned' | 'none';

/** 单日负荷判定的结果（`capacityFactor` = 1.0 表示不降档） */
export interface DayLoadDecision {
  /** 星期几（1 = 周一） */
  dayOfWeek: number;
  /** 该天历史负荷（分钟）；无数据为 0 */
  load: number;
  /** 历史平均负荷（分钟） */
  mean: number;
  /** 是否判为「显著偏高」 */
  high: boolean;
  /** 容量系数：`high` 时 0.9，否则 1.0 */
  capacityFactor: number;
}

/** `dayCapacityFactors()` 的完整结果：逐日判定 + 负荷数据来自哪里 */
export interface RollingDecision {
  days: DayLoadDecision[];
  /** 负荷口径来源（实际 / 计划 / 无数据）——供 note 措辞与诊断 */
  source: LoadSource;
}

/* ============================================================
 * 一、阈值（规格书只说「显著」，这里把它定义成可测的常数）
 * ========================================================== */

/**
 * 「显著高于均值」的判据：`load >= mean * LOAD_HIGH_RATIO` 且
 * `load - mean >= LOAD_HIGH_ABS_MIN`。
 *
 * 为什么要**两个**条件而不是一个比值：
 *   · 只看比值 → 均值很小时会被噪声触发（均值 20 分钟、某天 40 分钟就「翻倍」了，
 *     但那点负荷根本谈不上累）；
 *   · 只看绝对值 → 在高负荷的一周里完全不敏感（每天 300 分钟，某天 400 也不算「显著」）。
 *   两个都要满足，才是「既明显偏高、又确实是负担」。
 */
export const LOAD_HIGH_RATIO = 1.15;
/** 绝对增量下限（分钟）——防止低负荷下的比值噪声 */
export const LOAD_HIGH_ABS_MIN = 30;

/** 偏高档的容量下调比例（规格书 §5.3：下调 10%） */
export const HEAVY_DAY_CAPACITY_FACTOR = 0.9;

/**
 * 历史最少天数：不足则**不做任何判定**。
 *
 * 理由：第一周排程时 `rolling` 是空的或只有零；拿一两天的数据去推「习惯」
 * 会得到「周一很累」这种随机结论，然后用户第一次用就被无理由降档。
 */
export const MIN_HISTORY_DAYS = 3;

/* ============================================================
 * 二、负荷口径：**实际优先、计划兜底**
 * ========================================================== */

/**
 * 合并「实际负荷」与「计划负荷」，得到用于判定的逐日负荷序列。
 *
 * 既定口径（CY《项目进度对齐》§4.1 第 3 行 / §5 P1）：
 *   **实际优先、计划兜底** —— 行为记录里「真的做了多久」比「计划要多久」更能
 *   说明你累不累；但只有计划、没有实际记录时，计划就是唯一可用的信号。
 *
 * 逐项规则（`length` 取两者较长者，短的一侧按 0 处理 —— 缺口补 0 而不是跳过，
 * 与 `behaviorLog.actualLoadByDate()` 同一策略）：
 *   · 有实际记录（> 0）→ 用实际；
 *   · 实际为 0、计划 > 0 → 用计划（兜底）；
 *   · 两者都 0 → 0（那天什么都没排，不构成负荷）。
 *
 * @param planned 计划负荷（`RollingState.loadByDow` 的 1..7 位）
 * @param actual  实际负荷（`behaviorLog.actualLoadByDate()` 的产物）；给不出传 null
 */
export function mergeLoad(
  planned: readonly number[],
  actual: readonly number[] | null | undefined,
): { load: number[]; source: LoadSource } {
  if (!actual || actual.length === 0) {
    return { load: [...planned], source: planned.some((v) => v > 0) ? 'planned' : 'none' };
  }
  const n = Math.max(planned.length, actual.length);
  const load: number[] = [];
  let usedActual = 0;
  let usedPlanned = 0;
  for (let i = 0; i < n; i += 1) {
    const p = planned[i] ?? 0;
    const a = actual[i] ?? 0;
    if (a > 0) { load.push(a); usedActual += 1; continue; }
    if (p > 0) { load.push(p); usedPlanned += 1; continue; }
    load.push(0);
  }
  const source: LoadSource = usedActual > 0 ? 'actual' : (usedPlanned > 0 ? 'planned' : 'none');
  return { load, source };
}

/* ============================================================
 * 三、主入口：把 RollingState 翻译成逐日容量系数
 * ========================================================== */

/**
 * 计算「本周每一天的容量系数」。
 *
 * @param rolling 上一周传来的滚动状态；`undefined` / `null` = 首次排程 → 全部 1.0
 * @param actualByDow 实际负荷（下标 0 = 周一 … 6 = 周日）；无行为记录传 null
 */
export function dayCapacityFactors(
  rolling: RollingState | undefined | null,
  actualByDow?: readonly number[] | null,
): RollingDecision {
  const none: DayLoadDecision[] = Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i + 1, load: 0, mean: 0, high: false, capacityFactor: 1,
  }));
  if (!rolling) return { days: none, source: 'none' };

  // `loadByDow` 长度 8、下标 1..7 有效（0 位占位，见 types.ts 注释）
  const byDow = rolling.loadByDow ?? [];
  const planned = [1, 2, 3, 4, 5, 6, 7].map((d) => byDow[d] ?? 0);
  const { load, source } = mergeLoad(planned, actualByDow);

  // 统计口径：**只用「真的有负荷」的天**参与均值。
  // 若把 0 也算进去（周末没课就拉低均值），「工作日偏高」会被系统性放大成
  // 「每天都偏高」，最后工作日全被降档 —— 这与用户感受相反。
  const active = load.filter((v) => v > 0);
  if (active.length < MIN_HISTORY_DAYS) return { days: none, source };

  const mean = active.reduce((n, v) => n + v, 0) / active.length;

  const days = load.map((v, i) => {
    // 该天自己没负荷 → 不判偏高（没什么可降的）
    const high = v > 0
      && v >= mean * LOAD_HIGH_RATIO
      && v - mean >= LOAD_HIGH_ABS_MIN;
    return {
      dayOfWeek: i + 1,
      load: v,
      mean: Math.round(mean),
      high,
      capacityFactor: high ? HEAVY_DAY_CAPACITY_FACTOR : 1,
    };
  });
  return { days, source };
}

/**
 * 由「逐日系数」取某一天的系数（构造阶段逐天调用）。
 * 越界 / 无数据一律 1.0。
 */
export function capacityFactorOn(
  decisions: readonly DayLoadDecision[],
  dayOfWeek: number,
): number {
  return decisions[dayOfWeek - 1]?.capacityFactor ?? 1;
}

/* ============================================================
 * 四、面向用户的说明（诚实原则：降档必须说出来）
 * ========================================================== */

/**
 * 生成「本周为什么比平时松」的 note。
 *
 * 为什么必须说出来（§4.1 表第 5 行「诚实」/ 产品核心记忆点「懂分寸」）：
 *   用户看到自习时间变少，如果没有解释，最自然的解读是「这软件最近不稳定」。
 *   明确写上「上周三你排了 7 小时，这周三给你松了 10%」，它才是一个**特性**
 *   而不是一个 **bug**。
 *
 * @returns 无降档日时返回空数组（不产生噪音）
 */
export function rollingNotes(
  decisions: readonly DayLoadDecision[],
  source: LoadSource,
): string[] {
  const heavy = decisions.filter((d) => d.high);
  if (heavy.length === 0) return [];

  const DAY_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const names = heavy.map((d) => DAY_LABEL[d.dayOfWeek - 1]).join('、');
  const basis = source === 'actual'
    ? '按你实际上做了多久算的'
    : '按上周计划排的量算的（还没有执行记录）';

  return [
    `上周 ${names} 的负荷明显偏高（${basis}），这周同一几天把自习目标下调了 10% —— 累的时候少排一点，比排满了做不完更有用`,
  ];
}
