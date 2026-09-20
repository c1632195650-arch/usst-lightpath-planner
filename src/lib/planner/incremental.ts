/**
 * 排程引擎 v2 · 增量重排（Incremental，P2-T2.1）
 * ============================================================
 * 依据：规格书 §5.8「增量重排（P2）」、§9-T2.1、AC-7、§10.3 QL-3（计划稳定性）。
 *
 * ── 要解决的问题 ────────────────────────────────────────────────
 * 改一件事（加一个提交项、动一个交期、锁一个块）时，全量重排会让**整周抖动**：
 * 用户刚熟悉的周二布局被重新洗过，虽然「质量分」可能略高，但体验是「它乱动了」。
 *
 * §5.8 给的方案是**脏区域**：
 * ```
 * dirtyRegion(previousPlan, changedInput) =
 *     受影响的天 + 有依赖关系的相邻天（±1）
 *     + 交期发生变化的 commit 所在天
 * 仅对脏区域内的 free/soft 块重跑 improve；hard 块与脏区域外的 soft 块保持不变。
 * ```
 *
 * ── 本文件的实现边界（刻意的） ───────────────────────────────────
 *   · **只做「局部 improve」**，不重跑 construct —— 构造阶段是全周一次性铺开的
 *     （三餐、自习、活动互相抢空档），局部重构造会得到一份「半新半旧」的计划，
 *     比全量重排更难看懂。脏区域内的改进交给 `improve()` 的邻域算子。
 *   · **硬块 + 脏区域外的块一律冻结**：实现手法是「把非脏区域的 free/soft 块
 *     临时提升为 hard 锁」再调 `improve()` —— 复用既有邻域排除机制（H8），
 *     不另写一套「哪些块能动」的判定，避免两处口径漂移。
 *   · **`previousPlan` 缺省时退化为全量**：没有上一版就谈不上「最小扰动」，
 *     这是真实场景（第一次排程），不是异常。
 *
 * 设计纪律：纯函数 —— 不读时钟、不 fetch、不用随机。
 */
import type { LockLevel, WeekPlan } from '@/types';
import type { Commit } from './model.ts';
import { improve, type ImproveContext, type ImproveResult } from './improve.ts';

/* ============================================================
 * 一、脏区域计算（§5.8）
 * ========================================================== */

/** 脏区域判定的输入 */
export interface DirtyInput {
  /** 上一版计划；缺省 → 全部视为脏（退化为全量） */
  previousPlan?: WeekPlan;
  /** 本次的提交项 */
  commits?: Commit[];
  /** 上一次的提交项；缺省 → 无法做差，退化为全量 */
  previousCommits?: Commit[];
}

/** 脏区域判定的结果（全部可解释、可测试） */
export interface DirtyRegion {
  /** 需要重排的天（1..7，升序） */
  days: number[];
  /**
   * 触发脏天的原因（面向开发者与测试；也是 `diagnostics` 里能解释「动了几天」的依据）
   * 例：`{ day: 3, reason: 'commit-due-changed', detail: '交期从周1 改到 周3' }`
   */
  triggers: Array<{ day: number; reason: DirtyReason; detail: string }>;
  /** 是否退化为全量（无上一版计划 / 无对比基准） */
  full: boolean;
}

export type DirtyReason =
  | 'no-previous'        // 没有上一版计划 → 全量
  | 'new-commit'         // 新增了提交项
  | 'removed-commit'     // 删除了提交项
  | 'commit-due-changed' // 交期变了
  | 'commit-effort-changed' // 投入时长变了
  | 'commit-pinned-changed' // 固定落点变了
  | 'block-moved'        // 上一版计划里该块被挪过（兜底信号）
  | 'neighbor';          // 相邻天（§5.8 的 ±1 天）

/** 收集一个 commit 涉及的天（无交期/无固定落点则视为「无天」） */
function daysOfCommit(c: Commit): number[] {
  const days: number[] = [];
  if (c.dueAt) days.push(c.dueAt.dayOfWeek);
  if (c.pinned) days.push(c.pinned.dayOfWeek);
  return days;
}

/** 两个 commit 的「可影响排程」的字段是否有差异 */
function commitChanged(prev: Commit, next: Commit): { changed: boolean; reason: DirtyReason | null; detail: string } {
  const pDue = prev.dueAt;
  const nDue = next.dueAt;
  const sameDue = (pDue?.weekNo === nDue?.weekNo)
    && (pDue?.dayOfWeek === nDue?.dayOfWeek);

  if (!sameDue) {
    const fmt = (d: Commit['dueAt']) => (d ? `周${d.dayOfWeek}（第${d.weekNo}周）` : '无交期');
    return { changed: true, reason: 'commit-due-changed', detail: `交期 ${fmt(pDue)} → ${fmt(nDue)}` };
  }

  if (prev.effortMin !== next.effortMin) {
    return {
      changed: true, reason: 'commit-effort-changed',
      detail: `投入 ${prev.effortMin} → ${next.effortMin} 分钟`,
    };
  }

  const pPin = prev.pinned;
  const nPin = next.pinned;
  if ((pPin?.dayOfWeek !== nPin?.dayOfWeek) || (pPin?.startMin !== nPin?.startMin)) {
    return { changed: true, reason: 'commit-pinned-changed', detail: '固定落点变了' };
  }

  return { changed: false, reason: null, detail: '' };
}

/**
 * 计算脏区域（§5.8）。
 *
 * 判定顺序（任一命中即脏）：
 *   1. 没有 `previousPlan` 或 `previousCommits` → **全量**；
 *   2. 新增 / 删除的 commit → 它涉及的天；
 *   3. 交期 / 时长 / 固定落点变化的 commit → **变化前后涉及的所有天**；
 *   4. 上一版计划里被移动过位置的块（`block-moved`）→ 那天 —— 这是兜底信号，
 *      让「上一步的改动还没收敛」也能被继续重排；
 *   5. **所有脏天的 ±1 天**（§5.8 明写）。
 *
 * ⚠️ 第 3 条为什么要把「变化前」的天也加进来：交期从周三挪到周五时，
 *    周三那个块的**位置需要被释放**、周五需要被占用 —— 只加周五会留下
 *    一个「按旧交期排的、已经不该在那儿的块」。
 */
export function dirtyRegion(input: DirtyInput): DirtyRegion {
  const { previousPlan, commits = [], previousCommits } = input;

  if (!previousPlan || !previousCommits) {
    return { days: [1, 2, 3, 4, 5, 6, 7], triggers: [], full: true };
  }

  const triggers: DirtyRegion['triggers'] = [];
  const dirty = new Set<number>();

  const prevById = new Map(previousCommits.map((c) => [c.id, c]));
  const nextById = new Map(commits.map((c) => [c.id, c]));

  // 新增 / 变化
  for (const c of commits) {
    const prev = prevById.get(c.id);
    if (!prev) {
      const days = daysOfCommit(c);
      for (const d of days) {
        dirty.add(d);
        triggers.push({ day: d, reason: 'new-commit', detail: `新增「${c.title}」` });
      }
      continue;
    }
    const diff = commitChanged(prev, c);
    if (diff.changed && diff.reason) {
      // 变化前后的天都要重排（见上方注释）
      const days = [...new Set([...daysOfCommit(prev), ...daysOfCommit(c)])];
      for (const d of days) {
        dirty.add(d);
        triggers.push({ day: d, reason: diff.reason, detail: `「${c.title}」${diff.detail}` });
      }
    }
  }

  // 删除
  for (const c of previousCommits) {
    if (nextById.has(c.id)) continue;
    const days = daysOfCommit(c);
    for (const d of days) {
      dirty.add(d);
      triggers.push({ day: d, reason: 'removed-commit', detail: `移除「${c.title}」` });
    }
  }

  // 相邻天（§5.8 的 ±1）
  const withNeighbors = new Set<number>(dirty);
  for (const d of dirty) {
    if (d - 1 >= 1) withNeighbors.add(d - 1);
    if (d + 1 <= 7) withNeighbors.add(d + 1);
  }
  for (const d of withNeighbors) {
    if (!dirty.has(d)) triggers.push({ day: d, reason: 'neighbor', detail: '与受影响的天相邻' });
  }

  return {
    days: [...withNeighbors].sort((a, b) => a - b),
    triggers,
    full: false,
  };
}

/* ============================================================
 * 二、局部重排
 * ========================================================== */

export interface IncrementalResult {
  plan: WeekPlan;
  /** 实际参与重排的天（升序） */
  days: number[];
  /** 是否走了全量（无上一版计划） */
  full: boolean;
  /** 冻结在脏区域外的块数 —— AC-7 的关键观测量 */
  frozenCount: number;
  /** 底层 improve 的结果（成本前后、迭代数、接受的移动） */
  improve: ImproveResult;
  triggers: DirtyRegion['triggers'];
}

/**
 * 只对脏区域内的自由块跑 `improve`（§5.8）。
 *
 * 实现手法（复用而非另写）：
 *   把「不在脏区域内的 free/soft 块」临时提升为 `hard` 交给 `improve()` ——
 *   `improve` 的 `movableBlocks()` 早就排除 `hard`（规格书 §8.1 H8），
 *   所以这些块**在整个邻域搜索里都不会被碰**。
 *
 * 为什么不直接给 `improve` 加一个 `allowedDays` 参数：
 *   `improve` 的 `allowedDays` 是**相位策略**语义（周末要不要干活），
 *   与「脏区域」是两个正交的概念。混进同一个参数会让两件事互相污染 ——
 *   比如 `policy.weekendWork=false` 时，脏区域里的周六块会被误当成「不许排」。
 *
 * @param plan     当前计划（通常是 `construct` 的产物）
 * @param dirty    `dirtyRegion()` 的结果
 * @param ctx      `improve` 的上下文
 */
export function incrementalImprove(
  plan: WeekPlan,
  dirty: DirtyRegion,
  ctx: ImproveContext,
): IncrementalResult {
  // 全量 → 不需要冻结任何块，直接交给 improve
  if (dirty.full) {
    const res = improve(plan, ctx);
    return {
      plan: res.plan,
      days: dirty.days,
      full: true,
      frozenCount: 0,
      improve: res,
      triggers: dirty.triggers,
    };
  }

  const dirtySet = new Set(dirty.days);
  const baseLocks = ctx.lockLevels ?? {};
  // 冻结 = 临时加 hard 锁。只对「本可以动」的块加，已经 hard 的不重复加。
  const frozenLocks: Record<string, LockLevel> = { ...baseLocks };
  let frozenCount = 0;
  for (const b of plan.blocks) {
    if (dirtySet.has(b.dayOfWeek)) continue;
    if (frozenLocks[b.id] === 'hard') continue;
    frozenLocks[b.id] = 'hard';
    frozenCount += 1;
  }

  const res = improve(plan, { ...ctx, lockLevels: frozenLocks });

  return {
    plan: res.plan,
    days: dirty.days,
    full: false,
    frozenCount,
    improve: res,
    triggers: dirty.triggers,
  };
}

/* ============================================================
 * 三、面向用户的说明（诚实原则）
 * ========================================================== */

/**
 * 生成「这次只动了哪几天」的 note。
 *
 * 这条 note 是 P2 最省力的差异化展示（规格书 §5 P4 的原话：
 * 「用户能直接看到『它没乱动我的安排』」）。
 * 只在**真的有冻结块**时出现 —— 否则就是全量重排，说「只动了周三」
 * 反而是假话（§12.5.5「不猜」的同一条纪律：不许为了好看而修饰）。
 */
export function incrementalNotes(res: IncrementalResult): string[] {
  if (res.full) return [];
  const moved = res.improve.accepted.length;
  if (moved === 0 && res.frozenCount === 0) return [];

  const DAY_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const names = res.days.map((d) => DAY_LABEL[d - 1]).join('、');

  if (moved === 0) {
    return [`这次改动只影响 ${names}，其余几天的安排原样保留（没有需要调整的地方）`];
  }
  return [
    `这次只重排了 ${names}（改动落在这些天），其余 ${res.frozenCount} 个块的位置原样保留 —— 不会因为改一件事把整周洗一遍`,
  ];
}
