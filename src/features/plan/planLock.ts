/**
 * 「锁」的读写 —— 纯函数，UI 只负责调用。
 * ============================================================
 * 为什么要单独一个模块：
 *   锁有两半状态 —— **锁级别**（`locks`）和**位置快照**（`lockedPlacements`）。
 *   两者必须同时写、同时删，写漏一半就会出现「显示已定住但块照样跑」
 *   （只写了级别）或「块被钉死在旧位置但用户没锁它」（只写了快照）。
 *   把这一对操作收拢成纯函数，才有可能被单测覆盖、也才不会被 UI 各处写歪。
 *
 * ⚠️ 为什么需要位置快照：`construct` 每一步都从头排、**不读 `lockLevels`**，
 *    `improve` 只保证「不主动移动 hard 块」。不给快照的话，
 *    块被构造阶段排到别处之后就没人把它带回来 —— 锁会退化成装饰。
 */
import type { LockedPlacement, LockLevel, PlanPersistState, TimeBlock } from '@/types';
import { longLockKey } from '@/lib/planner/longLocks.ts';

/** 一个空的持久化状态（首次使用锁时用） */
export function emptyPlanState(now = ''): PlanPersistState {
  return {
    version: 1,
    lastPlanWeek: null,
    locks: {},
    lockedPlacements: {},
    churnMin: 0,
    updatedAt: now,
    rolling: null,
    rollingBase: null,
  };
}

/** 兜住从存储里读出来的半截状态（缺 keys 的旧数据） */
export function normalizePlanState(
  state: PlanPersistState | null | undefined,
): PlanPersistState | null {
  if (!state || typeof state !== 'object') return null;
  return {
    ...emptyPlanState(),
    ...state,
    locks: state.locks ?? {},
    lockedPlacements: state.lockedPlacements ?? {},
    rolling: state.rolling ?? null,
    rollingBase: state.rollingBase ?? null,
  };
}

/** 把块锁在当前位置。level 只暴露 'hard'（见项目约定：soft 留给引擎内部） */
export function withLock(
  state: PlanPersistState | null,
  block: TimeBlock,
  level: LockLevel = 'hard',
  now = '',
): PlanPersistState {
  const base = normalizePlanState(state) ?? emptyPlanState(now);
  return {
    ...base,
    version: base.version || 1,
    locks: { ...base.locks, [block.id]: level },
    lockedPlacements: {
      ...base.lockedPlacements,
      [block.id]: {
        dayOfWeek: block.dayOfWeek,
        startMin: block.startMin,
        endMin: block.endMin,
        place: block.place,
        room: block.room,
        title: block.title,
      },
    },
    updatedAt: now || base.updatedAt,
  };
}

/** 解锁：**两半一起删**，只删一半会留下脏快照 */
export function withoutLock(
  state: PlanPersistState | null,
  blockId: string,
  now = '',
): PlanPersistState {
  const base = normalizePlanState(state) ?? emptyPlanState(now);
  const locks = { ...base.locks };
  const lockedPlacements = { ...base.lockedPlacements };
  delete locks[blockId];
  delete lockedPlacements[blockId];
  return { ...base, locks, lockedPlacements, updatedAt: now || base.updatedAt };
}

/** 传给引擎的锁级别 */
export function lockLevelsOf(state: PlanPersistState | null): Record<string, LockLevel> {
  return normalizePlanState(state)?.locks ?? {};
}

/** 传给引擎的位置快照 */
export function lockedPlacementsOf(
  state: PlanPersistState | null,
): Record<string, LockedPlacement> {
  return normalizePlanState(state)?.lockedPlacements ?? {};
}

/** 该块是否已被用户锁定 */
export function isLocked(state: PlanPersistState | null, blockId: string): boolean {
  return lockLevelsOf(state)[blockId] === 'hard';
}

/** 被锁块数量 —— 用于「锁定太多会挤掉自由度」的提示 */
export function lockCount(state: PlanPersistState | null): number {
  return Object.keys(lockLevelsOf(state)).length;
}

/* ============================================================
 * 两套锁的键空间（R2.7 / S1）—— 设计在这里定死，实现时不得偏离
 *
 * `locks` 的 key 本来就是 `string`（契约层不动），但它将来要装**两种语义完全不同**的锁：
 *
 * | 语义 | key 形状 | 谁写的 | 生效范围 |
 * |---|---|---|---|
 * | 块锁（R2） | `w{周}-d{天}-{kind}-{语义键}` ← 就是 `blockId` | 自动/编辑 | 只这一周这个块 |
 * | 长期锁（S1） | `{odd|even}-d{天}-{kind}-{start}-{end}` | 用户点「定住」 | 所有同奇偶的周 |
 *
 * 为什么必须分层（而不是共用 blockId）：两者语义正交 ——
 * 「第 3 周把这块挪到晚上」与「每周三 15:00 都留着」是两件事。
 * 共用 key 的后果是长期锁一写就把块锁覆盖掉（或反过来），用户会发现
 * 「我明明说过每周保留，怎么第 4 周没了」。
 *
 * 判据：**前缀区分**（`w` 开头 = 块锁；`odd-` / `even-` 开头 = 长期锁）。
 * 两套互不解析对方的 key —— 这就是「互不污染」的含义。
 * ============================================================ */

export { longLockKey, isLongLockKey, weekParity } from '@/lib/planner/longLocks.ts';

/* ---------- S1：长期锁（跨周，按单双周分开） ---------- */

/**
 * 长期锁的写入。
 *
 * 存进 `locks` / `lockedPlacements` 的 key 是 `longLockKey(weekNo, block)`
 * —— **不含周次、不含序号**，因此在后续所有同奇偶的周里都能认出来。
 * 位置快照同样要写，理由与块锁完全一致（`construct` 不读 `lockLevels`）。
 */
export function withLongLock(
  state: PlanPersistState | null,
  weekNo: number,
  block: TimeBlock,
  now = '',
): PlanPersistState {
  const base = normalizePlanState(state) ?? emptyPlanState(now);
  const key = longLockKey(weekNo, block);
  return {
    ...base,
    version: base.version || 1,
    locks: { ...base.locks, [key]: 'hard' },
    lockedPlacements: {
      ...base.lockedPlacements,
      [key]: {
        dayOfWeek: block.dayOfWeek,
        startMin: block.startMin,
        endMin: block.endMin,
        place: block.place,
        room: block.room,
        title: block.title,
      },
    },
    updatedAt: now || base.updatedAt,
  };
}

/** 解除长期锁（同时也顺手清掉同名块锁，避免留下一半） */
export function withoutLongLock(
  state: PlanPersistState | null,
  key: string,
  now = '',
): PlanPersistState {
  const base = normalizePlanState(state) ?? emptyPlanState(now);
  const locks = { ...base.locks };
  const lockedPlacements = { ...base.lockedPlacements };
  delete locks[key];
  delete lockedPlacements[key];
  return { ...base, locks, lockedPlacements, updatedAt: now || base.updatedAt };
}

/** 这块是否被长期定住（只看长期锁 key，不碰块锁） */
export function isLongLocked(
  state: PlanPersistState | null,
  weekNo: number,
  block: TimeBlock,
): boolean {
  return lockLevelsOf(state)[longLockKey(weekNo, block)] === 'hard';
}

/**
 * 这块在**这一周**算不算「已定住」。
 *
 * 两个来源都要看：块锁（`blockId`）来自 R2 的用户改动，长期锁来自用户的「🔒 定住」。
 * 界面只需要一个二值答案，但底层是两套 key（见本文件顶部的分层说明）。
 */
export function isLockedThisWeek(
  state: PlanPersistState | null,
  weekNo: number,
  block: TimeBlock,
): boolean {
  return isLocked(state, block.id) || isLongLocked(state, weekNo, block);
}

/* ============================================================
 * 跨周滚动状态（P2-T2.2）—— 补上 P1 留下的断链
 *
 * 背景（这是 P1 的半成品）：`solver.nextRollingFrom()` 一直在产出
 * `PlanResult.nextRolling`，但**全仓没有任何地方接收它** →
 * `planState.rolling` 永远是 `null`，跨周疲劳既传不下去也用不上。
 *
 * 这里把「接收」这一半补上：排完一次就该把滚动状态与扰动分钟数写回持久化状态。
 * ========================================================== */

/**
 * 把一次排程的产物写回持久化状态。
 *
 * 三项都是**跨会话必须记住**的东西，缺一不可：
 *   · `rolling`  → 跨周负荷（下一周的降档依据）
 *   · `churnMin` → 累计扰动（「最小扰动」目标与 UI 提示）
 *   · `lastPlanWeek` → 状态新鲜度；也是「本周内重排不该被当成跨周」的判据
 *
 * @param weekNo  本次排的周次
 * @param rolling 引擎产出的 `PlanResult.nextRolling`
 * @param churnMin 引擎产出的 `PlanResult.diagnostics.churnMin`
 */
export function withRolling(
  state: PlanPersistState | null,
  weekNo: number,
  rolling: PlanPersistState['rolling'],
  churnMin: number,
  now = '',
): PlanPersistState {
  const base = normalizePlanState(state) ?? emptyPlanState(now);
  return {
    ...base,
    version: base.version || 1,
    lastPlanWeek: weekNo,
    rolling: rolling ?? null,
    churnMin: Math.max(0, Math.round(churnMin)),
    updatedAt: now || base.updatedAt,
  };
}

/**
 * 该不该把这份滚动状态当作「上一周」来用。
 *
 * 为什么需要这个判断：`planState.rolling` 是**上一周**的产物。
 * 如果用户在同一周内反复重排（改锁、切生活模式都会触发），
 * 把本周自己的负荷当成「上周负荷」喂回去，会形成**自我强化的降档循环** ——
 * 排得越满 → 下周越松 → 用户越觉得排少了 → 手动加满 → 又更松。
 *
 * 规则：
 *   · `lastPlanWeek == null`      → 没排过，无 rolling 可用；
 *   · `lastPlanWeek <  weekNo`    → 正常跨周，可以用；
 *   · `lastPlanWeek >= weekNo`    → 同一周（或回看历史周），**不可用**。
 */
export function rollingForWeek(
  state: PlanPersistState | null,
  weekNo: number,
): PlanPersistState['rolling'] {
  const s = normalizePlanState(state);
  if (!s || s.lastPlanWeek == null) return null;
  return s.lastPlanWeek < weekNo ? s.rolling : null;
}
