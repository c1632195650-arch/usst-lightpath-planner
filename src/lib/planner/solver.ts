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
import type { LockedPlacement, LockLevel, PlanIssue, PlanIssueCode, PhasePolicy, TimeBlock, WeekPlan } from '@/types';
import {
  DEFAULT_SOLVER_CONFIG, DEFAULT_WEIGHTS, emptyRollingState,
  type Commit, type Diagnostics, type PlanRequest, type PlanResult, type RollingState,
  type SolverConfig, type Weights,
} from './model.ts';
import { attachTransfers, construct, DAY_NAME, type ConstructCtx } from './construct.ts';
import type { TransferProvider } from './campusLookup.ts';
import { campusFallbackTransfer } from './campusLookup.ts';
import { evaluate } from './objective.ts';
import { fatigueAdjustment, weeklyStudyTarget } from './fatigue.ts';
import { improve } from './improve.ts';
import { explain, issueLockConflict } from './explain.ts';

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
 * 二·五、锁定块的位置恢复（让「锁」成为真功能）
 *
 * 背景（这是 P1 留下的一处半成品）：
 *   · `construct` 每一步都从头排，**完全不读 `lockLevels`**；
 *   · `improve` 只保证「不主动移动 hard 块」（`movableBlocks` 过滤掉它们）。
 *   两者叠加 → 块一旦被构造阶段排到别处，**没有任何环节把它带回来**。
 *   结果是：UI 上显示「已定住」，改点别的东西块就跑了 —— 比没有锁更糟。
 * ========================================================== */

export interface LockApplyResult {
  plan: WeekPlan;
  /** 成功写回原位的块 id（按 id 升序，确定性） */
  restored: string[];
  /** 没能写回原位的：与新课/新安排冲突 */
  conflicts: Array<{ id: string; title: string; dayOfWeek: number; reason: string }>;
}

function blocksOverlap(a: TimeBlock, b: TimeBlock): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * 把 `lockLevels='hard'` 的块写回它们的快照位置。
 *
 * 规则（都是刻意的）：
 *  · **只处理 hard**：soft/free 交给 churn 与 improve，不该被钉死；
 *  · **快照里有、这次没排出来的块**跳过（任务被删了，没什么可恢复的）；
 *  · **换天则不恢复**：跨天搬动会连带影响另一天的布局，超出「锁」的承诺范围；
 *  · **与别的块重叠则不恢复，并报 `lock-conflict`** —— 宁可如实告诉用户
 *    「你锁的这块放不回去了」，也**绝不悄悄挪走**。锁的意义就是「可预期」，
 *    一次静默违背就会让用户再也不信它。
 */
export function applyLockedPlacements(
  plan: WeekPlan,
  placements: Record<string, LockedPlacement> | undefined,
  lockLevels: Record<string, LockLevel> | undefined,
): LockApplyResult {
  const untouched: LockApplyResult = { plan, restored: [], conflicts: [] };
  if (!placements || !lockLevels) return untouched;

  const targets = Object.keys(placements).sort().filter((id) => lockLevels[id] === 'hard');
  if (targets.length === 0) return untouched;

  const working = [...plan.blocks];
  const restored: string[] = [];
  const conflicts: LockApplyResult['conflicts'] = [];

  for (const id of targets) {
    const idx = working.findIndex((b) => b.id === id);
    if (idx < 0) {
      // 这次没排出这个块。**不能静默跳过** —— 用户看到的是「我锁的那块不见了」，
      // 而界面上什么提示都没有。如实说，哪怕它可能只是任务被删了。
      // 用 info 而非 warn：这一条更可能是用户自己的改动造成的，不该和真冲突同等报警。
      plan.issues.push({
        level: 'info',
        code: 'lock-conflict',
        message: `你锁定的「${placements[id].title ?? id}」这次没能排进计划（可能被新课占掉了时间），解开锁定或调整那天的安排都可以`,
      });
      conflicts.push({ id, title: placements[id].title ?? id, dayOfWeek: placements[id].dayOfWeek, reason: '这次没能排出来' });
      continue;
    }
    const block = working[idx];
    const snap = placements[id];
    if (block.dayOfWeek !== snap.dayOfWeek) {
      conflicts.push({
        id, title: block.title, dayOfWeek: snap.dayOfWeek,
        reason: `现在被排到了周${block.dayOfWeek}`,
      });
      continue;
    }
    // 时间与地点是一体的：只还原时间会出现「13:30 在图书馆」这种半还原状态
    const next: TimeBlock = { ...block, startMin: snap.startMin, endMin: snap.endMin };
    if (snap.place === undefined) delete next.place; else next.place = snap.place;
    if (snap.room === undefined) delete next.room; else next.room = snap.room;

    const clash = working.find((b) => b.id !== id && blocksOverlap(next, b));
    if (clash) {
      conflicts.push({ id, title: block.title, dayOfWeek: snap.dayOfWeek, reason: `与「${clash.title}」时间重叠` });
      continue;
    }
    working[idx] = next;
    restored.push(id);
  }

  if (restored.length === 0 && conflicts.length === 0) return untouched;

  for (const c of conflicts) {
    plan.issues.push(issueLockConflict(DAY_NAME[c.dayOfWeek] ?? `周${c.dayOfWeek}`, c.title, c.reason));
  }
  return { plan: { ...plan, blocks: working }, restored, conflicts };
}

/**
 * 按当前位置**重挂**整周转场。
 *
 * 为什么必须在 `improve` 之后再跑一次（这是修一个既有缺陷）：
 *   `attachTransfers` 只在 `construct` 里调用过一次，而 `improve` 之后会移动块 ——
 *   全仓**没有任何地方重挂**。于是被移动过的块及其后继块的 `transfer.minutes/slackMin`
 *   都是旧值，`countHardViolations` 里的 `lateTransfers` 也跟着错。
 *   之前没暴露只是因为实测 `improve` 的 `accepted` 一直是 0。
 *
 * 做法：先按 `code` 清掉上一轮全部 transfer 类 issue（否则会重复累积），
 * 再逐天重算。**这里正是 `PlanIssue.code` 第一次真正派上用场** ——
 * 靠中文 message 做字符串匹配是没法可靠地做这件事的。
 */
export function reattachTransfers(plan: WeekPlan, transfer: TransferProvider): WeekPlan {
  const TRANSFER_CODES: ReadonlyArray<PlanIssueCode> = ['transfer-late', 'transfer-tight', 'transfer-no-place'];
  const blocks = plan.blocks.map((b) => {
    const c: TimeBlock = { ...b };
    delete c.transfer; // 位置可能已变，旧转场一律作废（含「同一栋楼不用赶」那条）
    return c;
  });
  const issues: PlanIssue[] = plan.issues.filter(
    (i) => !(i.code !== undefined && TRANSFER_CODES.includes(i.code)),
  );
  const days = [...new Set(blocks.map((b) => b.dayOfWeek))].sort((a, b) => a - b);
  for (const day of days) {
    const dayBlocks = blocks
      .filter((b) => b.dayOfWeek === day)
      .sort((a, b) => a.startMin - b.startMin);
    attachTransfers(dayBlocks, transfer, DAY_NAME[day] ?? `周${day}`, issues);
  }
  return { ...plan, blocks, issues };
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
  // 跨周自适应（§4.4）：构造 / 改进 / 评分 / 解释必须共用同一份目标
  const adj = fatigueAdjustment(req.policy, req.rolling);

  // ③ 构造（必然可行）
  const built = construct(n.req, ctx);
  let plan0 = built.plan;
  if (n.cycle) {
    plan0.issues.push({
      level: 'error',
      message: `提交项依赖成环（${n.cycle.join(' → ')}），已忽略环上的依赖以免排不出计划`,
    });
  }

  // ③.5 锁定块写回原位 —— 必须在 improve 之前（improve 会以「当前位置」为基准做邻域搜索）
  const lockRes = applyLockedPlacements(plan0, req.lockedPlacements, req.lockLevels);
  plan0 = lockRes.plan;

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
      rolling: req.rolling,
      // PR-A：评分口径必须与下面组装 `evaluate` 时一致，否则 improve 会朝旧目标爬
      scoring: config.scoring,
      transferTrust: config.transferTrust,
      // PR-B：把转场数据源交给 improve —— 没有它，"为了少走 10 分钟而重排"这类候选
      // 根本不会进候选表（实测：只改度量时计划逐块不变）
      transfer: n.req.transfer ?? undefined,
    });
    plan = res.plan;
    iterations = res.iterations;
    acceptedCount = res.accepted.length;
  }

  // ④.5 重挂转场 —— improve 会移动块，而 `attachTransfers` 只在 construct 里跑过一次
  if (config.solver === 'lns' || lockRes.restored.length > 0) {
    plan = reattachTransfers(plan, n.req.transfer ?? campusFallbackTransfer);
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
    rolling: req.rolling,
    scoring: config.scoring,
    transferTrust: config.transferTrust,
    transfer: n.req.transfer ?? undefined,
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
    // 有滚动数据才带上：这样「没启用自适应」与「启用了但不需要调节」可区分
    fatigue: req.rolling
      ? {
        factor: adj.factor,
        baseDailyMin: adj.baseDailyMin,
        observedDailyMin: adj.observedDailyMin,
        weeklyTargetMin: weeklyStudyTarget(req.policy, adj),
        softenedDays: adj.softenedDays,
      }
      : undefined,
  };

  // 自适应说明排在求解器日志之前 —— 它解释的是「为什么目标变了」，优先级更高
  const notes = [...ex.notes, ...adj.reasons];
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
