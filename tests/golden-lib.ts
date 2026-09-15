/**
 * Golden baseline 工具库（T1.6 / A4）
 * 依据：`docs/scheduler-v2-spec.md` §9-T1.6 / §10 AC-1·AC-2·AC-3 / §10.4
 *
 * 三件事：
 *   ① normalizeBlock / normalizePlan —— 「构造等价」口径（AC-2）：只比块的**内容**，
 *      `id` 不参与比对（§6.4：新 id 规则会变）。见 `GoldenBlock` 的字段说明。
 *   ② hardViolations —— 硬约束违反数（AC-1）：同一天块间重叠 + 通勤「来不及」。
 *   ③ planMetrics —— 指标：cost（复用 `objective::evaluate`）、硬违反、软目标达成率、
 *      churn、issue 分级计数。
 *
 * ⚠️ 本文件是**纯函数**：不读时钟、不发请求、不用随机。耗时统计由调用方（快照器/对比器）
 *    在**外面**测量后放入 `timing`，不进快照的可比对部分（否则每次拍快照都不同）。
 * ⚠️ 顶部注释禁止出现「星号 + 斜杠」的连续写法（会提前闭合块注释，Node 报语法错）。
 */
import type { PhasePolicy, TimeBlock, WeekPlan } from '@/types';
import { DEFAULT_WEIGHTS } from '@/lib/planner/model.ts';
import { evaluate } from '@/lib/planner/objective.ts';
import type { CostBreakdown, EvalContext } from '@/lib/planner/objective.ts';

/* ============================================================
 * ① 构造等价口径（AC-2）
 * ========================================================== */

/**
 * 参与「构造等价」比对的块内容。
 *
 * 设计取舍：**只放 AC-2 明文列举的「时间/类型/标题/地点」**（外加 `dayOfWeek`），
 * 刻意**不含** `room` / `courseId` / `teacher` / `source` —— 这些是衍生信息，
 * 把它们塞进断言会让「换了个等价教室」这种无意义差异把 AC-2 判红。
 * 需要看全量时用 `normalizeBlockFull`（仅供诊断，不用于断言）。
 */
export interface GoldenBlock {
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  kind: TimeBlock['kind'];
  title: string;
  /** 无地点时统一写 `null`（不是 `undefined`）——便于 JSON 往返后仍可比 */
  place: string | null;
}

export function normalizeBlock(b: TimeBlock): GoldenBlock {
  return {
    dayOfWeek: b.dayOfWeek,
    startMin: b.startMin,
    endMin: b.endMin,
    kind: b.kind,
    title: b.title,
    place: b.place ?? null,
  };
}

/** 全量块（含 id / 转场 / 理由）—— 只给诊断和人工排查用，**不要**拿来断言 AC-2 */
export function normalizeBlockFull(b: TimeBlock): Record<string, unknown> {
  return {
    ...normalizeBlock(b),
    id: b.id,
    room: b.room ?? null,
    courseId: b.courseId ?? null,
    teacher: b.teacher ?? null,
    source: b.source,
    locked: b.locked ?? false,
    transfer: b.transfer ?? null,
  };
}

/** 稳定排序键：天 → 开始 → 结束 → 类型 → 标题 → 地点（全序，保证两版可比） */
function blockSortKey(b: GoldenBlock): string {
  return [
    String(b.dayOfWeek).padStart(2, '0'),
    String(b.startMin).padStart(4, '0'),
    String(b.endMin).padStart(4, '0'),
    b.kind,
    b.title,
    b.place ?? '',
  ].join('|');
}

/** 计划 → 规范化块数组（已排序；与 `plan.blocks` 的原始顺序无关） */
export function normalizePlan(plan: WeekPlan): GoldenBlock[] {
  return plan.blocks.map(normalizeBlock).sort((a, b) => (blockSortKey(a) < blockSortKey(b) ? -1 : 1));
}

/* ============================================================
 * ② 硬约束违反（AC-1）
 * ========================================================== */

export interface HardViolations {
  /** 同一天内时间区间互相重叠的块**对**数 */
  overlaps: number;
  /** 挂有转场信息、且余量为负（即会迟到）的块数 */
  lateTransfers: number;
  total: number;
}

function byDay(plan: WeekPlan): Map<number, TimeBlock[]> {
  const m = new Map<number, TimeBlock[]>();
  for (const b of plan.blocks) {
    const list = m.get(b.dayOfWeek);
    if (list) list.push(b); else m.set(b.dayOfWeek, [b]);
  }
  return m;
}

/** 同一天内两两判交叠（块数很小，O(n²) 足够；不做「只比相邻」的近似，避免漏嵌套） */
export function overlapPairs(plan: WeekPlan): number {
  let n = 0;
  for (const list of byDay(plan).values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.startMin < b.endMin && b.startMin < a.endMin) n += 1;
      }
    }
  }
  return n;
}

export function lateTransferCount(plan: WeekPlan): number {
  return plan.blocks.filter((b) => b.transfer != null && b.transfer.slackMin < 0).length;
}

export function hardViolations(plan: WeekPlan): HardViolations {
  const overlaps = overlapPairs(plan);
  const lateTransfers = lateTransferCount(plan);
  return { overlaps, lateTransfers, total: overlaps + lateTransfers };
}

/* ============================================================
 * ③ 指标（cost / 软目标达成率 / churn）
 * ========================================================== */

/** 软目标达成率（0–1）；越大越好。数据取自 `evaluate().raw`，避免二次实现口径 */
export interface SoftAchievement {
  /** 自习投入 / 目标自习量 */
  studyAchieved: number;
  /** 实际留白 / 要求留白 */
  blankKept: number;
}

export interface PlanMetrics {
  weekNo: number;
  blockCount: number;
  courseMin: number;
  studyMin: number;
  /** === `CostBreakdown.total` */
  cost: number;
  /** 分项明细（诊断用） */
  costBreakdown: CostBreakdown;
  hard: HardViolations;
  soft: SoftAchievement;
  churn: number;
  errorIssues: number;
  warnIssues: number;
  infoIssues: number;
}

function ratio(actual: number, target: number): number {
  if (!(target > 0)) return 1; // 无目标视为「已达成」，不制造假缺口
  return Math.min(1, actual / target);
}

/**
 * 计算一份计划的指标。**确定性**：同输入必同输出（不含耗时、不读时钟）。
 */
export function planMetrics(plan: WeekPlan, ctx: EvalContext): PlanMetrics {
  const cost = evaluate(plan, ctx);
  const r = cost.raw;
  const sum = (kind: TimeBlock['kind']) =>
    plan.blocks.filter((b) => b.kind === kind).reduce((s, b) => s + (b.endMin - b.startMin), 0);

  return {
    weekNo: plan.weekNo,
    blockCount: plan.blocks.length,
    courseMin: sum('course'),
    studyMin: sum('study'),
    cost: cost.total,
    costBreakdown: cost,
    hard: hardViolations(plan),
    soft: {
      studyAchieved: ratio(r.studyMin, r.targetStudyMin),
      blankKept: ratio(r.blankMin, r.requiredBlankMin),
    },
    churn: cost.churn,
    errorIssues: plan.issues.filter((i) => i.level === 'error').length,
    warnIssues: plan.issues.filter((i) => i.level === 'warn').length,
    infoIssues: plan.issues.filter((i) => i.level === 'info').length,
  };
}

/** 便捷：组装一个只含必需品的最小 `EvalContext`（无 commits、无 previousPlan → churn = 0） */
export function defaultEvalContext(weekNo: number, policy: PhasePolicy): EvalContext {
  return { weekNo, policy, weights: DEFAULT_WEIGHTS };
}

/* ============================================================
 * ④ 比对与打印小工具
 * ========================================================== */

/** JSON 深比较（按稳定序列化），返回差异描述；相等返回 null */
export function diffJson(a: unknown, b: unknown): string | null {
  const sa = JSON.stringify(a, null, 2);
  const sb = JSON.stringify(b, null, 2);
  if (sa === sb) return null;
  const la = sa.split('\n');
  const lb = sb.split('\n');
  const lines: string[] = [];
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n && lines.length < 12; i += 1) {
    if (la[i] !== lb[i]) {
      lines.push(`  行 ${i + 1}:\n    - ${la[i] ?? '(缺)'}\n    + ${lb[i] ?? '(缺)'}`);
    }
  }
  return lines.join('\n');
}
