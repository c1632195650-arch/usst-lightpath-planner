/**
 * 排程引擎 v2 · 求解编排（Solver，T1.4）
 * ============================================================
 * 依据：规格书 §5.1 主流程、§9-T1.4、§4.4（PlanResult / Diagnostics）。
 *
 *   planWeekV2(req) = normalize → construct → improve → explain → assemble
 *
 * 与旧引擎的关系：
 *   · 旧入口 `schedule.ts::buildWeekPlan` 保留，内部转调 `construct`（**只构造、不改进**）；
 *   · 新入口 `index.ts::planWeekV2` 走本文件（默认 `solver='lns'` = 构造 + 改进）。
 *
 * ⚠️ 确定性：除 `diagnostics.elapsedMs`（耗时统计，天然非确定）外，
 *    同输入必得同输出。要断言「逐字节相同」请用 `stablePlanJson()`。
 */
import type { PhasePolicy, TimeBlock, WeekPlan } from '@/types';
import {
  DEFAULT_SOLVER_CONFIG, DEFAULT_WEIGHTS, emptyRollingState,
  type Commit, type Diagnostics, type PlanRequest, type PlanResult, type RollingState,
  type SolverConfig, type Weights,
} from './model.ts';
import { construct, type ConstructCtx } from './construct.ts';
import { evaluate } from './objective.ts';
import { improve } from './improve.ts';
import { explain } from './explain.ts';

/* ============================================================
 * 一、硬约束违反（AC-1）
 *
 * 口径：同一天内块区间两两重叠的**对**数 + 挂有转场且余量为负（会迟到）的块数。
 * ⚠️ `tests/golden-lib.ts` 里有一份**独立实现**，刻意不复用 —— 那是验收方的
 *    交叉校验，复用就失去了「自己验自己」的意义。
 * ========================================================== */

export interface HardViolations {
  overlaps: number;
  lateTransfers: number;
  total: number;
}

export function countHardViolations(plan: WeekPlan): HardViolations {
  const byDay = new Map<number, TimeBlock[]>();
  for (const b of plan.blocks) {
    const list = byDay.get(b.dayOfWeek);
    if (list) list.push(b); else byDay.set(b.dayOfWeek, [b]);
  }
  let overlaps = 0;
  for (const list of byDay.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.startMin < b.endMin && b.startMin < a.endMin) overlaps += 1;
      }
    }
  }
  const lateTransfers = plan.blocks.filter((b) => b.transfer != null && b.transfer.slackMin < 0).length;
  return { overlaps, lateTransfers, total: overlaps + lateTransfers };
}

/* ============================================================
 * 二、滚动状态（§4.4 / §5.8；P2 正式启用，P1 先如实产出）
 * ========================================================== */

/** 由本周计划与提交项推导「传给下一周」的滚动状态 */
export function nextRollingFrom(plan: WeekPlan, commits: Commit[], weekNo: number): RollingState {
  if (plan.blocks.length === 0) return emptyRollingState();

  // 每星期几的负荷（索引 1..7 使用，0 占位）
  const loadByDow = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const b of plan.blocks) {
    if (b.kind === 'blank') continue;
    loadByDow[b.dayOfWeek] += b.endMin - b.startMin;
  }

  const upcoming = commits
    .filter((c) => c.dueAt != null && c.dueAt.weekNo >= weekNo)
    .map((c) => ({
      id: c.id,
      title: c.title,
      dueAtWeek: c.dueAt?.weekNo as number,
      // capacityRemain 用 0 → 未覆盖 effort 即 0.9；这是保守值，P2 会用真实剩余产能
      urgency: urgencyOf(c, weekNo),
    }))
    .sort((a, b) => b.urgency - a.urgency || a.id.localeCompare(b.id));

  return {
    recentLoad: loadByDow.slice(1),
    loadByDow,
    upcoming,
  };
}

function urgencyOf(c: Commit, weekNo: number): number {
  if (!c.dueAt) return 0;
  const daysLeft = (c.dueAt.weekNo - weekNo) * 7 + (c.dueAt.dayOfWeek - 1);
  if (daysLeft < 0) return 1;
  if (daysLeft === 0) return 1;
  return Math.max(0.05, Math.min(1, 1 - daysLeft / 14));
}

/* ============================================================
 * 三、输入归一化（§5.1 步骤 1）
 * ========================================================== */

export interface NormalizedInput {
  req: PlanRequest;
  weights: Weights;
  config: Required<Omit<SolverConfig, 'seed'>> & { seed?: number };
  /** 依赖成环时，环上的提交项 id（按发现顺序） */
  cycle: string[] | null;
  policy: PhasePolicy;
}

/** 找出 `deps` 里的环（确定性 DFS；返回环上的 id，无环返回 null） */
export function findDepsCycle(commits: Commit[]): string[] | null {
  const byId = new Map(commits.map((c) => [c.id, c]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=未访问 1=栈上 2=已完成
  const stack: string[] = [];
  let found: string[] | null = null;

  const visit = (id: string): void => {
    if (found) return;
    const s = state.get(id) ?? 0;
    if (s === 2) return;
    if (s === 1) {
      // 回边 → 截出环
      const at = stack.indexOf(id);
      found = stack.slice(at >= 0 ? at : 0).concat(id);
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.deps ?? []) {
      if (byId.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(id, 2);
  };

  for (const c of commits) visit(c.id);
  return found;
}

function normalize(req: PlanRequest, ctx: ConstructCtx): NormalizedInput {
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...(req.weights ?? {}) };
  const config = { ...DEFAULT_SOLVER_CONFIG, ...(req.config ?? {}) } as Required<Omit<SolverConfig, 'seed'>> & { seed?: number };
  void ctx;

  const raw = req.commits ?? [];
  const cycle = findDepsCycle(raw);
  // 「有环则报 error 并降级忽略环上依赖」（§5.1 步骤 1）
  const commits = cycle
    ? raw.map((c) => (cycle.includes(c.id) ? { ...c, deps: undefined } : c))
    : raw;

  return { req: { ...req, commits }, weights, config, cycle, policy: req.policy };
}

/* ============================================================
 * 四、主入口
 * ========================================================== */

/** 求解一份周计划（构造 + 改进 + 解释 + 诊断）。确定性，除 `elapsedMs`。 */
export function solveWeek(req: PlanRequest, ctx: ConstructCtx = {}): PlanResult {
  const t0 = performance.now();
  const n = normalize(req, ctx);
  const { weights, config } = n;

  // ③ 构造（必然可行）
  const built = construct(n.req, ctx);
  const plan0 = built.plan;
  if (n.cycle) {
    plan0.issues.push({
      level: 'error',
      message: `提交项依赖成环（${n.cycle.join(' → ')}），已忽略环上的依赖以免排不出计划`,
    });
  }

  // ④ 改进（solver='greedy' 时跳过 —— 兼容旧行为）
  let plan = plan0;
  let iterations = 0;
  let acceptedCount = 0;
  if (config.solver === 'lns') {
    const res = improve(plan0, {
      weekNo: req.weekNo,
      policy: req.policy,
      weights,
      commits: n.req.commits,
      lockLevels: req.lockLevels,
      previousPlan: req.previousPlan,
      config: req.config,
    });
    plan = res.plan;
    iterations = res.iterations;
    acceptedCount = res.accepted.length;
  }

  // ⑥ 解释层（保证软块 100% 有 reason，QL-2）
  const ex = explain({ plan, notes: built.notes });
  plan = ex.plan;

  // ⑦ 组装诊断 + 滚动状态
  const cost = evaluate(plan, {
    weekNo: req.weekNo,
    policy: req.policy,
    weights,
    commits: n.req.commits,
    previousPlan: req.previousPlan,
    lockLevels: req.lockLevels,
  });
  const hard = countHardViolations(plan);

  const diagnostics: Diagnostics = {
    solver: config.solver,
    iterations,
    elapsedMs: Math.round((performance.now() - t0) * 1000) / 1000,
    cost: {
      total: cost.total,
      // 7 项分项（§10.1 AC-3 的「分项之和 === total」恒等式对的就是这七项）
      parts: {
        studyShortfall: cost.studyShortfall,
        blankDeficit: cost.blankDeficit,
        switchCost: cost.switchCost,
        transferRisk: cost.transferRisk,
        dueOverdue: cost.dueOverdue,
        churn: cost.churn,
        placeMismatch: cost.placeMismatch,
      },
    },
    hardViolations: hard.total,
    churnMin: cost.raw.churnMin,
  };

  const notes = [...ex.notes];
  if (iterations > 0) {
    notes.push(`求解器跑了 ${iterations} 轮改进，接受了 ${acceptedCount} 处调整（成本降到 ${cost.total.toFixed(1)}）`);
  }

  const result: PlanResult = {
    plan,
    notes,
    diagnostics,
    nextRolling: nextRollingFrom(plan, n.req.commits, req.weekNo),
  };
  return result;
}

/* ============================================================
 * 五、确定性辅助
 * ========================================================== */

/**
 * 稳定序列化：把 `diagnostics.elapsedMs` 归零后再 stringify。
 * AC-6（确定性）断言请用它 —— 耗时统计天然每次都不同，不该被算作「输出不一致」。
 */
export function stablePlanJson(result: PlanResult): string {
  return JSON.stringify({
    ...result,
    diagnostics: { ...result.diagnostics, elapsedMs: 0 },
  });
}
