/**
 * 疲劳与可行性调节 —— 排程引擎「记得你」的那一半
 * ============================================================
 * 前面几层解决的是「**这一周怎么排最好**」；这一层解决
 * 「**跟上一周比，这周该松还是该紧**」。
 *
 * 输入是跨周累积的滚动状态（`RollingState`，由 `nextRollingFrom` 产出、
 * 经应用层用真实执行记录沉淀），输出是**逐日的有效自习目标**。
 *
 * ⚠️ 为什么必须收敛成一个单点实现，而不是各处就地调整：
 *   自习目标同时被三处消费 ——
 *     · `construct`  决定每天到底排多少自习
 *     · `objective`  算「自习缺口」这项成本
 *     · `explain`    判断「本周自习未达标」要不要报警
 *   三处各算各的，就会出现「构造按 96 分钟排、评分按 120 分钟扣分」这种
 *   自相矛盾 —— 引擎会认为一份本来合理的计划质量很差，进而让 `improve`
 *   把它往错的方向推。所以 `effectiveStudyMin()` 是**唯一出口**。
 *
 * ⚠️ 刻意**只下调、不上调**：负荷轻时因子恒为 1，不给用户加量。
 *   「你上周偷懒了，这周补回来」是反内卷价值下最不该有的行为 ——
 *   引擎的职责是别把人排垮，不是替人上强度。
 */
import type { PhasePolicy, RollingState } from '@/types';

/**
 * 阈值全部由**实测**定，不是拍脑袋：
 * 用真实课表（MOCK_SCHEDULE）跑 dev 引擎，工作日日均「日程占用」为
 *   开学适应期 446 分钟 ｜ 常规学习期 476 ｜ 期末冲刺期 572。
 * 所以 480（8 小时）以下视为正常，600（10 小时）以上视为连轴转。
 */
export const FATIGUE = {
  /** 日均占用低于此值 = 轻松，不做调节（分钟） */
  loadLow: 480,
  /** 日均占用高于此值 = 连轴转，压到最低档（分钟） */
  loadHigh: 600,
  /** 调节下限：最低压到基准目标的 75%（120 → 90，约等于适应期强度） */
  minFactor: 0.75,
  /** 逐日可行性下限：反复没做的那天，自习目标最低压到 60% */
  minFeasible: 0.6,
  /** 跨周累积的指数衰减系数（0.5 = 本周观测与历史各占一半） */
  ewmaAlpha: 0.5,
} as const;

/**
 * 参与负荷统计的星期几 —— 与 `objective` 的 `countableDays` **必须同口径**。
 * 否则「日均负荷」在两边指的不是同一件事：不占周末的学期里，
 * 把周六周日两个低负荷日算进平均，会把真实强度稀释掉。
 */
export function countableDaysOf(policy: PhasePolicy): number[] {
  return policy.weekendWork ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
}

/** 本地星期名（不从 `construct.ts` 借，避免 construct → explain → fatigue → construct 成环） */
const DAY_CN: Record<number, string> = {
  1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日',
};

export interface FatigueAdjustment {
  /** 全局疲劳系数（0.75–1）；1 = 未调节 */
  factor: number;
  /** 阶段策略给的基准目标（分钟） */
  baseDailyMin: number;
  /**
   * 只含**全局疲劳**调节后的每日目标（不含逐日可行性）—— 供文案展示
   * （「120 → 96 分钟」里的 96；逐日可行性是另一句话）。
   */
  adjustedDailyMin: number;
  /** 逐日有效自习目标（长度 8，索引 1..7 有效；0 位占位） */
  studyMinByDow: number[];
  /** 用于算疲劳的工作日日均占用（分钟）；无滚动数据时 null */
  observedDailyMin: number | null;
  /** 因可行性被下调的日子（1..7） */
  softenedDays: number[];
  /** 可展示的理由；空数组 = 完全没有调节 */
  reasons: string[];
}

function hmText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/**
 * 由阶段策略 + 滚动状态算出本周的自习调节。
 *
 * 无滚动数据（首次使用、或还没积累到任何一周）时**恒为 no-op** ——
 * 这是 golden 快照能保持稳定的前提：`rolling` 缺省时本函数不改动任何东西。
 */
export function fatigueAdjustment(
  policy: PhasePolicy,
  rolling?: RollingState | null,
): FatigueAdjustment {
  const base = policy.dailyStudyMin;
  const studyMinByDow = [0, base, base, base, base, base, base, base];
  const days = countableDaysOf(policy);

  /* —— 全局疲劳：用**跨周滚动平均**的逐日占用 —— */
  const recent = rolling?.recentLoad ?? [];
  const total = days.reduce((n, d) => n + (recent[d - 1] ?? 0), 0);
  const observedDailyMin = total > 0 ? Math.round(total / days.length) : null;

  let factor = 1;
  if (observedDailyMin != null && observedDailyMin > FATIGUE.loadLow) {
    const t = Math.min(
      1,
      (observedDailyMin - FATIGUE.loadLow) / (FATIGUE.loadHigh - FATIGUE.loadLow),
    );
    factor = Math.round((1 - (1 - FATIGUE.minFactor) * t) * 100) / 100;
  }

  /* —— 逐日可行性：反复没做的那天少排一点 —— */
  const feas = rolling?.feasibleByDow ?? [];
  const softenedDays: number[] = [];
  for (const d of days) {
    const f = Math.min(1, Math.max(FATIGUE.minFeasible, feas[d - 1] ?? 1));
    studyMinByDow[d] = Math.round(base * factor * f);
    if (f < 1) softenedDays.push(d);
  }

  const reasons: string[] = [];
  if (factor < 1) {
    reasons.push(
      `最近工作日日均占用约 ${hmText(observedDailyMin ?? 0)}（偏高），`
      + `本周自习目标 ${base} → ${Math.round(base * factor)} 分钟 —— 连着排满，这周松一点更好`,
    );
  }
  if (softenedDays.length > 0) {
    const names = softenedDays.slice(0, 3).map((d) => DAY_CN[d] ?? `周${d}`).join('、');
    const tail = softenedDays.length > 3 ? ` 等 ${softenedDays.length} 天` : '';
    reasons.push(
      `${names}${tail}的自习最近总是没做，这几天少排一点`
      + `（约 ${studyMinByDow[softenedDays[0]]} 分钟）`,
    );
  }

  return {
    factor,
    baseDailyMin: base,
    adjustedDailyMin: Math.round(base * factor),
    studyMinByDow,
    observedDailyMin,
    softenedDays,
    reasons,
  };
}

/** 某天的有效自习目标 —— 构造 / 评分 / 解释三处**唯一的取值出口** */
export function effectiveStudyMin(adj: FatigueAdjustment, day: number): number {
  return adj.studyMinByDow[day] ?? adj.baseDailyMin;
}

/** 整周自习目标（分钟）—— 与 `objective` 的「自习缺口」同一口径 */
export function weeklyStudyTarget(policy: PhasePolicy, adj: FatigueAdjustment): number {
  return countableDaysOf(policy).reduce((n, d) => n + effectiveStudyMin(adj, d), 0);
}
