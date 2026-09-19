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
import type { PhasePolicy, RollingState, TimeBlock, WeekPlan } from '@/types';
import type { Commit, LockLevel, Place, ScoringMode, SolverConfig, Weights } from './model.ts';
import { DEFAULT_SOLVER_CONFIG, DEFAULT_WEIGHTS, resolveLockLevel } from './model.ts';
import { BUILTIN_PLACE_INDEX, campusOfPlace } from './places.ts';
import { evaluate } from './objective.ts';
import type { EvalContext } from './objective.ts';
import type { TransferProvider } from './campusLookup.ts';

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
  /** 跨周滚动状态（疲劳 / 逐日可行性）—— 必须与 `construct` 用同一份，否则两边目标不一致 */
  rolling?: RollingState;
  /** 评分口径（PR-A）；必须与 `solver` 组装 `evaluate` 时用的一致，否则"改进"会朝错方向爬 */
  scoring?: ScoringMode;
  /** 转场数据可信度折扣；缺省 `TRANSFER_TRUST` */
  transferTrust?: number;
  /**
   * 转场数据源（PR-B）。**此前 improve 完全没有它** —— 于是「为了少走 10 分钟而重排」
   * 这类改进根本不在候选表里，`transfer-aware` 评分再准也没用（实测：只改度量时计划逐块不变）。
   * 只在 `scoring === 'transfer-aware'` 且本字段存在时启用，legacy 逐位不变。
   */
  transfer?: TransferProvider;
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

/* ============================================================
 * 三·五、转场感知的邻域辅助（PR-B）
 *
 * 为什么必须加：主循环是 **first-improvement**（取第一个严格下降的移动），
 * 候选表被 `MAX_CANDIDATES_PER_BLOCK` 截断。因此**候选的排序/剪枝决定了搜索"看不看得见"好棋**。
 * 而原实现里 `reassign` 是按**字母序**取前 6 个地点、`relocate` 是按时间顺序取前 6 个空档
 * —— 与"这段路要多久"毫无关系。实测后果：把转场成本设为 25 分钟时，
 * `legacy` 与 `transfer-aware` 两档产出的计划**逐块完全相同**（度量说差 66 分，搜索却纹丝不动）。
 * ========================================================== */

/** 是否启用转场感知邻域：**两者都要满足**，否则保持 legacy 的逐位行为 */
function awareOf(ctx: ImproveContext): boolean {
  return (ctx.scoring ?? 'legacy') === 'transfer-aware' && typeof ctx.transfer === 'function';
}

/**
 * 把块放在 `(day, startMin, dur)` 时，与当天左右邻居的步行分钟合计。
 * 同时判定**可行性**：与任一侧的间隔小于步行分钟 ⇒ 这个位置根本走不到（剪掉，别占邻居候选位）。
 * 取不到数据（provider 返回 null）时按 0 计 —— 不猜、不罚。
 */
function localWalk(
  plan: WeekPlan,
  ctx: ImproveContext,
  day: number,
  startMin: number,
  dur: number,
  place: string | undefined,
  excludeIds: Set<string>,
): { minutes: number; infeasible: boolean } {
  const provider = ctx.transfer as TransferProvider;
  const end = startMin + dur;
  let prev: TimeBlock | undefined;
  let next: TimeBlock | undefined;
  for (const b of plan.blocks) {
    if (b.dayOfWeek !== day || excludeIds.has(b.id)) continue;
    if (b.endMin <= startMin && (!prev || b.endMin > prev.endMin)) prev = b;
    if (b.startMin >= end && (!next || b.startMin < next.startMin)) next = b;
  }
  let minutes = 0;
  let infeasible = false;
  const legs: Array<[string | undefined, string | undefined, number | null]> = [
    [prev?.place, place, prev ? startMin - prev.endMin : null],
    [place, next?.place, next ? next.startMin - end : null],
  ];
  for (const [from, to, gap] of legs) {
    if (!from || !to || from === to) continue;
    const info = provider(from, to);
    const m = info && typeof info.minutes === 'number' && info.minutes >= 0 ? info.minutes : 0;
    minutes += m;
    if (gap != null && gap < m) infeasible = true;
  }
  return { minutes, infeasible };
}

function relocateCandidates(plan: WeekPlan, ctx: ImproveContext): Candidate[] {
  const out: Candidate[] = [];
  const aware = awareOf(ctx);
  const days = allowedDays(ctx.policy);
  for (const b of movableBlocks(plan, ctx)) {
    const dur = b.endMin - b.startMin;
    if (dur <= 0) continue;
    const exclude = new Set([b.id]);
    // P4 无损优化：`others` 与 b 无关的候选都一样，**每个候选重算一次是纯浪费**
    const others = plan.blocks.filter((x) => x.id !== b.id);
    const entries: Array<{ cand: Candidate; walk: number; key: string }> = [];

    for (const day of days) {
      const gaps = freeGaps(ctx, plan, day, exclude);
      for (const g of gaps) {
        if (g.endMin - g.startMin < dur) continue;
        if (day === b.dayOfWeek && g.startMin === b.startMin) continue; // no-op
        const moved: TimeBlock = { ...b, dayOfWeek: day as TimeBlock['dayOfWeek'], startMin: g.startMin, endMin: g.startMin + dur };
        if (!respectsPolicy(moved, ctx)) continue;
        if (overlapsAny(moved, others)) continue;

        let walk = 0;
        if (aware) {
          const lw = localWalk(plan, ctx, day, g.startMin, dur, b.place, exclude);
          if (lw.infeasible) continue;   // 走不到的位置不进候选表（省下的名额给能到的）
          walk = lw.minutes;
        }
        entries.push({
          cand: {
            op: 'relocate',
            blockIds: [b.id],
            note: `${b.title} 周${b.dayOfWeek} ${fmt(b.startMin)} → 周${day} ${fmt(g.startMin)}`,
            plan: replaceBlocks(plan, [moved]),
          },
          walk,
          key: `${day}-${g.startMin}`,
        });
        // legacy 语义：边生成边截断（顺序即优先级）
        if (!aware && entries.length >= MAX_CANDIDATES_PER_BLOCK) break;
      }
      if (!aware && entries.length >= MAX_CANDIDATES_PER_BLOCK) break;
    }

    if (aware) {
      // transfer-aware：先按「与左右邻居的步行分钟」升序（同价按时间顺序稳定），再截断
      entries.sort((x, y) => x.walk - y.walk || x.key.localeCompare(y.key));
    }
    for (const e of entries.slice(0, MAX_CANDIDATES_PER_BLOCK)) out.push(e.cand);
  }
  return out;
}

function swapCandidates(plan: WeekPlan, ctx: ImproveContext): Candidate[] {
  const out: Candidate[] = [];
  const mov = movableBlocks(plan, ctx);
  // P4 无损优化：先按天建表 —— 原来每个候选对都要 filter 一遍全表并展开成新数组（O(n) 分配/对）
  const byDayBlocks = new Map<number, TimeBlock[]>();
  for (const b of plan.blocks) byDayBlocks.set(b.dayOfWeek, [...(byDayBlocks.get(b.dayOfWeek) ?? []), b]);
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
      const dayList = (byDayBlocks.get(a.dayOfWeek) ?? []).filter((x) => x.id !== a.id && x.id !== b.id);
      if (overlapsAny(na, dayList) || overlapsAny(na, [nb]) || overlapsAny(nb, dayList)) continue;
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
  const aware = awareOf(ctx);
  for (const b of movableBlocks(plan, ctx)) {
    if (!ASSIGNABLE_KINDS.has(b.kind)) continue;
    const dur = b.endMin - b.startMin;
    const exclude = new Set([b.id]);
    const entries: Array<{ cand: Candidate; walk: number }> = [];
    for (const name of pool) {
      if (name === (b.place ?? '')) continue;
      let walk = 0;
      if (aware) {
        // 原地换地点（时间不变）→ 看与左右邻居的步行合计；走不到的直接剪掉。
        // ⚠️ 原实现是按**字母序**取前 6 个地点 —— 与路程完全无关，等于随机换地方。
        const lw = localWalk(plan, ctx, b.dayOfWeek, b.startMin, dur, name, exclude);
        if (lw.infeasible) continue;
        walk = lw.minutes;
      }
      const reassigned: TimeBlock = { ...b, place: name };
      entries.push({
        cand: {
          op: 'reassign',
          blockIds: [b.id],
          note: `${b.title} 地点 ${b.place ?? '(无)'} → ${name}`,
          plan: replaceBlocks(plan, [reassigned]),
        },
        walk,
      });
      if (!aware && entries.length >= MAX_CANDIDATES_PER_BLOCK) break;
    }
    if (aware) entries.sort((x, y) => x.walk - y.walk || x.cand.note.localeCompare(y.cand.note));
    for (const e of entries.slice(0, MAX_CANDIDATES_PER_BLOCK)) out.push(e.cand);
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
        const movedPlace: TimeBlock = { ...b, place: place.name };
        out.push({
          op: 'reschedule-place',
          blockIds: [b.id],
          note: `${commit.title} 迁到首选地点 ${place.name}`,
          plan: replaceBlocks(plan, [movedPlace]),
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
    rolling: ctx.rolling,
    scoring: ctx.scoring,
    transferTrust: ctx.transferTrust,
    // PR-D：把 provider 交给目标函数**现算** —— 于是不需要每候选重挂提示
    transfer: ctx.transfer,
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
  const aware = awareOf(ctx);   // transfer-aware 且拿到了 provider 才启用转场感知邻域

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
        // 用**整份计划**的合法性校验（现状语义）。
        //    ⚠️ 已查清的**事实**（2026-09-19，P8）：construct 排出的计划含 8~10 个周末三餐软块，
        //    而 `respectsPolicy` 对 study/meal/activity 要求「周末需 weekendWork、18 点后需
        //    eveningAllowed」——5 份 golden 语料的 policy 都不允许 ⇒ **整份校验恒 false**
        //    ⇒ 每个候选都被判非法，`improve` 在这些语料上**从未评估过任何候选**。
        //    但**不要因此改这里**：实测把校验改成"只看被改动的块"后，候选确实被评估了，
        //    结果**接受数仍为 0、计划逐块不变**（说明这些计划本就局部最优），
        //    代价却是运行时间 ~2×。⇒ 现状的"空转"没有质量问题，只是**掩盖**而非致因。
        //    真正该警惕的是：将来若 construct 产出「**可改进**」的计划，这个恒 false 的校验
        //    会**静默**把改进阶段关掉。届时按 ADR-010 的方案（候选级校验 + 保留整份兜底）改，
        //    并**重拍 golden 快照**。
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
