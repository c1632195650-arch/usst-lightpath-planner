/**
 * 排程引擎 v2 · 改进阶段（improve）
 * ============================================================
 * 依据：`docs/scheduler-v2-spec.md` §5.7（邻域算子）/ §9-T1.3（实现与验收）。
 *
 * 五个算子（§5.7）：
 *   · `relocate`          一块平移到另一个空档（不改时长）
 *   · `swap`              交换两块的时间位置（解「顺序错误」型局部最优）
 *   · `reassign`          换块的地点（降通勤 / 修校区错配）
 *   · `resplit`           合并碎自习块 / 拆分过长块
 *   · `reschedule-place`  按提交项的 `window` / `placeId` 挪地点与时段
 *
 * 接受准则（§5.7）：默认 **First-Improvement 纯爬山** —— 每轮按**固定顺序**枚举
 * 「算子 × 可动块」，取**第一个**严格下降的移动；无下降即停。
 * 因此 `cost` **单调不增**，且**完全确定**（不注入种子也不用随机数）。
 * `config.acceptWorse = true` 时才启用模拟退火（用 `seed` 派生的 PRNG；不注入种子则用固定默认种子，
 * 仍可复现）—— 该分支 **P1 默认关闭**，留待 P2 调优。
 *
 * ⚠️ 纯函数纪律：不 fetch、不读时钟（`performance.now()` 仅在**显式**传入 `config.budgetMs` 时启用）、
 *    不改动入参 `plan`。**硬块（课程 / locked / lockLevels='hard'）永不被移动**。
 * ⚠️ 与 `construct.ts` 无耦合：本文件只消费一个已存在的 `WeekPlan`，因此可在构造重构完成前独立开工。
 */
import type { PhasePolicy, TimeBlock, WeekPlan } from '@/types';
import type { Commit, LockLevel, Place, SolverConfig, Weights } from './model.ts';
import { DEFAULT_SOLVER_CONFIG, DEFAULT_WEIGHTS, resolveLockLevel } from './model.ts';
import { BUILTIN_PLACE_INDEX, campusOfPlace } from './places.ts';
import { evaluate } from './objective.ts';
import type { EvalContext } from './objective.ts';

const EPS = 1e-9;
const DAY_START_DEFAULT = 7 * 60;
const DAY_END_DEFAULT = 23 * 60;

export type OpName = 'relocate' | 'swap' | 'reassign' | 'resplit' | 'reschedule-place';

/** 算子枚举顺序 —— **固定**，这是确定性的来源之一 */
export const OP_ORDER: readonly OpName[] = [
  'relocate', 'swap', 'reassign', 'resplit', 'reschedule-place',
];

/** 允许改动的块类型（`course` 是既成事实，永不动） */
const ASSIGNABLE_KINDS: ReadonlySet<TimeBlock['kind']> = new Set<TimeBlock['kind']>([
  'study', 'meal', 'activity',
]);

export interface ImproveContext {
  weekNo: number;
  policy: PhasePolicy;
  /** 权重；缺省 `DEFAULT_WEIGHTS` */
  weights?: Weights;
  /** 交期项（`reschedule-place` 与 `evaluate` 都会用） */
  commits?: Commit[];
  /** 地点索引；缺省 `BUILTIN_PLACE_INDEX` */
  places?: Map<string, Place>;
  /** `reassign` 的候选地点名池；缺省 = 地点索引里的全部名字 */
  candidatePlaces?: string[];
  /** 锁级别覆盖 */
  lockLevels?: Record<string, LockLevel>;
  /** 上一版计划（churn） */
  previousPlan?: WeekPlan;
  dayStartMin?: number;
  dayEndMin?: number;
  config?: Partial<SolverConfig>;
}

export interface AcceptedMove {
  op: OpName;
  blockIds: string[];
  note: string;
  delta: number;
}

export interface ImproveResult {
  plan: WeekPlan;
  costBefore: number;
  costAfter: number;
  iterations: number;
  accepted: AcceptedMove[];
}

/* ============================================================
 * 一、确定性 PRNG（仅在 acceptWorse / 注入 seed 时使用）
 * ========================================================== */

/** mulberry32 —— 小、快、可复现。同种子必同序列。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================
 * 二、小工具：窗口 / 空档 / 合法性
 * ========================================================== */

function fmt(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function cloneBlock(b: TimeBlock): TimeBlock {
  return { ...b };
}

function clonePlan(plan: WeekPlan, blocks: TimeBlock[]): WeekPlan {
  return {
    weekNo: plan.weekNo,
    blocks,
    stats: { ...plan.stats, blockCount: blocks.length },
    issues: plan.issues,
  };
}

/** 用 `patch` 替换计划中 id 相同的块（其余不动；不改入参） */
function replaceBlocks(plan: WeekPlan, patches: TimeBlock[]): WeekPlan {
  const map = new Map(patches.map((p) => [p.id, p]));
  const blocks = plan.blocks.map((b) => map.get(b.id) ?? cloneBlock(b));
  return clonePlan(plan, blocks);
}

function withExtraBlock(plan: WeekPlan, extra: TimeBlock, removeIds: string[]): WeekPlan {
  const drop = new Set(removeIds);
  const blocks = plan.blocks.filter((b) => !drop.has(b.id)).map(cloneBlock);
  blocks.push(extra);
  return clonePlan(plan, blocks);
}

/** 可动块（非 hard）；顺序 = id 升序 → 确定性 */
function movableBlocks(plan: WeekPlan, ctx: ImproveContext): TimeBlock[] {
  const lockLevels = ctx.lockLevels ?? {};
  return [...plan.blocks]
    .filter((b) => resolveLockLevel(b, lockLevels) !== 'hard')
    .filter((b) => b.kind !== 'course')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** 可排的天（周中 + 视 `weekendWork` 决定是否含周末） */
function allowedDays(policy: PhasePolicy): number[] {
  const days = [1, 2, 3, 4, 5];
  if (policy.weekendWork) days.push(6, 7);
  return days;
}

function dayBounds(ctx: ImproveContext): [number, number] {
  return [ctx.dayStartMin ?? DAY_START_DEFAULT, ctx.dayEndMin ?? DAY_END_DEFAULT];
}

/** 当天除去 `excludeIds` 后的空闲段（升序） */
function freeGaps(ctx: ImproveContext, plan: WeekPlan, day: number, excludeIds: Set<string>): Array<{ startMin: number; endMin: number }> {
  const [dayStart, dayEnd] = dayBounds(ctx);
  const busy = plan.blocks
    .filter((b) => b.dayOfWeek === day && !excludeIds.has(b.id))
    .sort((a, b) => a.startMin - b.startMin);
  const gaps: Array<{ startMin: number; endMin: number }> = [];
  let cursor = dayStart;
  for (const b of busy) {
    if (b.startMin > cursor) gaps.push({ startMin: cursor, endMin: b.startMin });
    cursor = Math.max(cursor, b.endMin);
  }
  if (cursor < dayEnd) gaps.push({ startMin: cursor, endMin: dayEnd });
  return gaps;
}

function overlapsAny(b: TimeBlock, others: TimeBlock[]): boolean {
  return others.some((o) => o.dayOfWeek === b.dayOfWeek && b.startMin < o.endMin && o.startMin < b.endMin);
}

/** 软块是否遵守阶段策略（晚间 / 周末） —— 不遵守的候选直接丢弃 */
function respectsPolicy(b: TimeBlock, ctx: ImproveContext): boolean {
  if (!ASSIGNABLE_KINDS.has(b.kind)) return true;
  if (b.dayOfWeek >= 6 && !ctx.policy.weekendWork) return false;
  if (b.startMin >= 18 * 60 && !ctx.policy.eveningAllowed) return false;
  return true;
}

/** 整份计划的硬性合法性：区间内 + 不重叠 */
function planIsValid(plan: WeekPlan, ctx: ImproveContext): boolean {
  const [dayStart, dayEnd] = dayBounds(ctx);
  for (const b of plan.blocks) {
    if (b.endMin <= b.startMin) return false;
    if (b.startMin < dayStart || b.endMin > dayEnd) return false;
    if (!respectsPolicy(b, ctx)) return false;
  }
  const byDay = new Map<number, TimeBlock[]>();
  for (const b of plan.blocks) {
    const list = byDay.get(b.dayOfWeek);
    if (list) list.push(b); else byDay.set(b.dayOfWeek, [b]);
  }
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startMin < sorted[i - 1].endMin) return false;
    }
  }
  return true;
}

/* ============================================================
 * 三、候选（算子 × 块）
 * ========================================================== */

interface Candidate {
  op: OpName;
  blockIds: string[];
  note: string;
  plan: WeekPlan;
}

/** 每算子、每块最多生成多少候选（防止邻域爆炸；顺序固定 → 截断也确定） */
const MAX_CANDIDATES_PER_BLOCK = 6;

function relocateCandidates(plan: WeekPlan, ctx: ImproveContext): Candidate[] {
  const out: Candidate[] = [];
  const days = allowedDays(ctx.policy);
  for (const b of movableBlocks(plan, ctx)) {
    const dur = b.endMin - b.startMin;
    if (dur <= 0) continue;
    let made = 0;
    for (const day of days) {
      if (made >= MAX_CANDIDATES_PER_BLOCK) break;
      const gaps = freeGaps(ctx, plan, day, new Set([b.id]));
      for (const g of gaps) {
        if (made >= MAX_CANDIDATES_PER_BLOCK) break;
        if (g.endMin - g.startMin < dur) continue;
        if (day === b.dayOfWeek && g.startMin === b.startMin) continue; // no-op
        const moved: TimeBlock = { ...b, dayOfWeek: day as TimeBlock['dayOfWeek'], startMin: g.startMin, endMin: g.startMin + dur };
        if (!respectsPolicy(moved, ctx)) continue;
        const others = plan.blocks.filter((x) => x.id !== b.id);
        if (overlapsAny(moved, others)) continue;
        out.push({
          op: 'relocate',
          blockIds: [b.id],
          note: `${b.title} 周${b.dayOfWeek} ${fmt(b.startMin)} → 周${day} ${fmt(g.startMin)}`,
          plan: replaceBlocks(plan, [moved]),
        });
        made += 1;
      }
    }
  }
  return out;
}

function swapCandidates(plan: WeekPlan, ctx: ImproveContext): Candidate[] {
  const out: Candidate[] = [];
  const mov = movableBlocks(plan, ctx);
  for (let i = 0; i < mov.length; i += 1) {
    for (let j = i + 1; j < mov.length; j += 1) {
      const a = mov[i];
      const b = mov[j];
      if (!ASSIGNABLE_KINDS.has(a.kind) || !ASSIGNABLE_KINDS.has(b.kind)) continue;
      if (a.dayOfWeek !== b.dayOfWeek) continue; // 同日内换位才有「顺序」含义
      if (a.startMin === b.startMin) continue;
      const durA = a.endMin - a.startMin;
      const durB = b.endMin - b.startMin;
      const na: TimeBlock = { ...a, startMin: b.startMin, endMin: b.startMin + durA };
      const nb: TimeBlock = { ...b, startMin: a.startMin, endMin: a.startMin + durB };
      if (!respectsPolicy(na, ctx) || !respectsPolicy(nb, ctx)) continue;
      const others = plan.blocks.filter((x) => x.id !== a.id && x.id !== b.id);
      if (overlapsAny(na, [...others, nb]) || overlapsAny(nb, others)) continue;
      out.push({
        op: 'swap',
        blockIds: [a.id, b.id],
        note: `${a.title} ⇄ ${b.title}（周${a.dayOfWeek}）`,
        plan: replaceBlocks(plan, [na, nb]),
      });
    }
  }
  return out;
}

function reassignCandidates(plan: WeekPlan, ctx: ImproveContext): Candidate[] {
  const out: Candidate[] = [];
  const index = ctx.places ?? BUILTIN_PLACE_INDEX;
  const pool = ctx.candidatePlaces
    ?? [...new Set([...index.values()].map((p) => p.name))].sort();
  for (const b of movableBlocks(plan, ctx)) {
    if (!ASSIGNABLE_KINDS.has(b.kind)) continue;
    let made = 0;
    for (const name of pool) {
      if (made >= MAX_CANDIDATES_PER_BLOCK) break;
      if (name === (b.place ?? '')) continue;
      const swapped: TimeBlock = { ...b, place: name };
      out.push({
        op: 'reassign',
        blockIds: [b.id],
        note: `${b.title} 地点 ${b.place ?? '(无)'} → ${name}`,
        plan: replaceBlocks(plan, [swapped]),
      });
      made += 1;
    }
  }
  return out;
}

function resplitCandidates(plan: WeekPlan, ctx: ImproveContext): Candidate[] {
  const out: Candidate[] = [];
  const maxBlock = ctx.policy.maxBlockMin;
  const study = movableBlocks(plan, ctx).filter((b) => b.kind === 'study').sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin);

  // 合并：同日、首尾相接（gap = 0）、合计不超上限
  for (let i = 0; i < study.length; i += 1) {
    for (let j = i + 1; j < study.length; j += 1) {
      const a = study[i];
      const b = study[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (a.endMin !== b.startMin) continue;
      if (b.endMin - a.startMin > maxBlock) continue;
      const merged: TimeBlock = { ...a, endMin: b.endMin };
      out.push({
        op: 'resplit',
        blockIds: [a.id, b.id],
        note: `合并自习 ${a.title}+${b.title} → ${a.startMin}–${b.endMin}（周${a.dayOfWeek}）`,
        plan: withExtraBlock(plan, merged, [a.id, b.id]),
      });
    }
  }

  // 拆分：单块超过上限
  for (const b of study) {
    const dur = b.endMin - b.startMin;
    if (dur <= maxBlock) continue;
    const cut = b.startMin + maxBlock;
    const first: TimeBlock = { ...b, endMin: cut };
    const second: TimeBlock = { ...b, id: `${b.id}#2`, startMin: cut };
    out.push({
      op: 'resplit',
      blockIds: [b.id],
      note: `拆分过长自习 ${b.title} → ${b.startMin}–${cut} + ${cut}–${b.endMin}`,
      plan: withExtraBlock(replaceBlocks(plan, [first]), second, []),
    });
  }
  return out;
}

function reschedulePlaceCandidates(plan: WeekPlan, ctx: ImproveContext): Candidate[] {
  const out: Candidate[] = [];
  const commits = ctx.commits ?? [];
  if (commits.length === 0) return out;
  const index = ctx.places ?? BUILTIN_PLACE_INDEX;
  for (const b of movableBlocks(plan, ctx)) {
    const commit = commits.find((c) => b.id.endsWith(`-${c.id}`) || b.id.includes(`-${c.id}-`));
    if (!commit) continue;

    // ① 拉回提交项的允许窗口
    if (commit.window && (b.startMin < commit.window.fromMin || b.endMin > commit.window.toMin)) {
      const dur = b.endMin - b.startMin;
      if (commit.window.fromMin + dur <= commit.window.toMin) {
        const shifted: TimeBlock = { ...b, startMin: commit.window.fromMin, endMin: commit.window.fromMin + dur };
        if (!overlapsAny(shifted, plan.blocks.filter((x) => x.id !== b.id)) && respectsPolicy(shifted, ctx)) {
          out.push({
            op: 'reschedule-place',
            blockIds: [b.id],
            note: `${commit.title} 拉入窗口 ${fmt(commit.window.fromMin)}–${fmt(commit.window.toMin)}`,
            plan: replaceBlocks(plan, [shifted]),
          });
        }
      }
    }

    // ② 迁到提交项首选地点
    if (commit.placeId) {
      const place = index.get(commit.placeId);
      if (place && place.name !== (b.place ?? '')) {
        out.push({
          op: 'reschedule-place',
          blockIds: [b.id],
          note: `${commit.title} 迁到首选地点 ${place.name}`,
          plan: replaceBlocks(plan, [{ ...b, place: place.name }]),
        });
      }
    }
  }
  return out;
}

function candidatesOf(op: OpName, plan: WeekPlan, ctx: ImproveContext): Candidate[] {
  switch (op) {
    case 'relocate': return relocateCandidates(plan, ctx);
    case 'swap': return swapCandidates(plan, ctx);
    case 'reassign': return reassignCandidates(plan, ctx);
    case 'resplit': return resplitCandidates(plan, ctx);
    case 'reschedule-place': return reschedulePlaceCandidates(plan, ctx);
  }
}

/* ============================================================
 * 四、主循环
 * ========================================================== */

function evalContextOf(ctx: ImproveContext): EvalContext {
  return {
    weekNo: ctx.weekNo,
    policy: ctx.policy,
    weights: ctx.weights ?? DEFAULT_WEIGHTS,
    commits: ctx.commits,
    places: ctx.places,
    dayStartMin: ctx.dayStartMin,
    dayEndMin: ctx.dayEndMin,
    previousPlan: ctx.previousPlan,
    lockLevels: ctx.lockLevels,
  };
}

/** 从 `evaluate().raw` 回填 `stats`（与目标函数同口径，不另立一套） */
function withFreshStats(plan: WeekPlan, evalCtx: EvalContext): WeekPlan {
  const r = evaluate(plan, evalCtx).raw;
  const sum = (kind: TimeBlock['kind']) =>
    plan.blocks.filter((b) => b.kind === kind).reduce((s, b) => s + (b.endMin - b.startMin), 0);
  return {
    ...plan,
    stats: {
      courseMin: sum('course'),
      studyMin: sum('study'),
      blankMin: r.blankMin,
      blockCount: plan.blocks.length,
    },
  };
}

/**
 * 对一份已存在的计划做改进。**硬块不动**；返回的 `plan` 是新对象（入参不被修改）。
 */
export function improve(input: WeekPlan, ctx: ImproveContext): ImproveResult {
  const evalCtx = evalContextOf(ctx);
  const config = ctx.config ?? {};
  const maxIterations = config.maxIterations ?? DEFAULT_SOLVER_CONFIG.maxIterations;
  const budgetMs = config.budgetMs ?? null;
  const acceptWorse = config.acceptWorse ?? false;
  const rng = mulberry32(config.seed ?? 0x5eed_1234);

  let plan = clonePlan(input, input.blocks.map(cloneBlock));
  let cost = evaluate(plan, evalCtx).total;
  const costBefore = cost;
  const accepted: AcceptedMove[] = [];
  const t0 = budgetMs != null ? performance.now() : 0;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations += 1;
    if (budgetMs != null && performance.now() - t0 > budgetMs) break;

    let best: { cand: Candidate; delta: number } | null = null;

    // First-Improvement：固定顺序枚举，取第一个严格下降的移动
    outer:
    for (const op of OP_ORDER) {
      for (const cand of candidatesOf(op, plan, ctx)) {
        if (!planIsValid(cand.plan, ctx)) continue;
        const delta = evaluate(cand.plan, evalCtx).total - cost;
        if (delta < -EPS) {
          best = { cand, delta };
          break outer;
        }
      }
    }

    if (best) {
      plan = best.cand.plan;
      cost = evaluate(plan, evalCtx).total;
      accepted.push({ op: best.cand.op, blockIds: best.cand.blockIds, note: best.cand.note, delta: best.delta });
      continue;
    }

    if (!acceptWorse) break; // 纯爬山：无下降即收敛

    // —— 模拟退火（P2 起正式使用；默认关闭）——
    const T = 1 + 9 * (1 - iterations / maxIterations);
    const flat = OP_ORDER.flatMap((op) => candidatesOf(op, plan, ctx)).filter((c) => planIsValid(c.plan, ctx));
    if (flat.length === 0) break;
    const pick = flat[Math.floor(rng() * flat.length)];
    const d = evaluate(pick.plan, evalCtx).total - cost;
    if (d < 0 || rng() < Math.exp(-d / T)) {
      plan = pick.plan;
      cost = evaluate(plan, evalCtx).total;
      accepted.push({ op: pick.op, blockIds: pick.blockIds, note: pick.note, delta: d });
    }
  }

  const finalPlan = withFreshStats(plan, evalCtx);
  return {
    plan: finalPlan,
    costBefore,
    costAfter: evaluate(finalPlan, evalCtx).total,
    iterations,
    accepted,
  };
}
