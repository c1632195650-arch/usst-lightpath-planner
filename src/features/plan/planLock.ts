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
