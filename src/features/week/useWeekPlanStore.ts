/**
 * 周计划页第③层持久化态的 React 绑定（F2c/A4 · 前端架构规格书 §7）
 * ============================================================
 * 把 `WeekPlanView` 里的 6 个 useState 上提为**组件外的模块级 store**：
 *   ① layer（用户覆盖层）—— 持久化走 `userPlanStore`（`usst-user-plan-v1`），
 *      撤销/重做走其既有栈（`tests/userPlanUndo.test.ts` 守语义）；
 *   ② rules（偏好校正）—— 持久化走 `feedback/store`；
 *   ③ fromNowOn / replanToken —— 会话旗标（不落库，切页不丢即可）。
 *
 * 为什么值放在模块而不是组件：切页（今天 ↔ 周计划）会卸载 `WeekPlanView`，
 * useState 会把 layer/撤销栈深度一起丢掉；store 让「攒着改」的覆盖层在页间存活。
 *
 * 依赖方向：本文件是 **hook 层组合**（userPlanStore / feedback store 之上），
 * 不违反 §7.4「store 之间不互相 import」。零新依赖（React 的
 * `useSyncExternalStore` 是既有依赖的官方 API）。
 *
 * 快照纪律：`getSnapshot` 返回**缓存的不可变对象**，只在发布（publish）时重建 ——
 * 满足 `useSyncExternalStore` 的引用稳定性要求。
 */
import { useSyncExternalStore } from 'react';
import {
  clearRedo, loadUserPlan, popRedo, popUndo, pushRedoSnapshot, pushUndoSnapshot,
  redoDepth, saveUserPlan, undoDepth, type UserPlanLayer,
} from './userPlanStore';
import { loadRules, saveRules } from '@/features/feedback/store';
import type { CorrectionRule } from '@/lib/planner/corrections';

/* ============================================================
 * ① 覆盖层（layer）+ 撤销/重做
 * ========================================================== */

export interface LayerSnapshot {
  layer: UserPlanLayer;
  undoDepth: number;
  redoDepth: number;
}

let layerSnap: LayerSnapshot = {
  layer: loadUserPlan(),
  undoDepth: 0,
  redoDepth: 0,
};
const layerListeners = new Set<() => void>();

function commitLayer(next: UserPlanLayer): void {
  saveUserPlan(next);
  layerSnap = { layer: next, undoDepth: undoDepth(), redoDepth: redoDepth() };
  layerListeners.forEach((l) => l());
}

export function subscribeLayer(cb: () => void): () => void {
  layerListeners.add(cb);
  return () => { layerListeners.delete(cb); };
}

export function getLayerSnapshot(): LayerSnapshot {
  return layerSnap;
}

/** 任何对覆盖层的改动都走它：压撤销栈 → 落库 → 重做历史作废 → 发布（原 updateLayer 语义） */
export function updateLayerStore(fn: (prev: UserPlanLayer) => UserPlanLayer): void {
  pushUndoSnapshot(layerSnap.layer); // 撤销栈：任何改动前先留一份底
  const next = fn(layerSnap.layer);
  clearRedo(); // 🔴 发生新改动 → 重做历史作废（标准撤销/重做语义）
  commitLayer(next);
}

/** 撤销：弹出最近一份快照恢复。返回是否真的撤销了（提示由调用方给）。 */
export function undoLayer(): boolean {
  const snap = popUndo();
  if (!snap) return false;
  pushRedoSnapshot(layerSnap.layer); // 回退前的样子进重做栈
  commitLayer(snap);
  return true;
}

/** 重做：与撤销互为逆操作。返回是否真的重做了。 */
export function redoLayer(): boolean {
  const snap = popRedo();
  if (!snap) return false;
  pushUndoSnapshot(layerSnap.layer);
  commitLayer(snap);
  return true;
}

export function useLayerStore(): LayerSnapshot {
  return useSyncExternalStore(subscribeLayer, getLayerSnapshot);
}

/* ============================================================
 * ② 偏好校正规则（rules）
 * ========================================================== */

let currentRules: CorrectionRule[] | null = null;
const rulesListeners = new Set<() => void>();

function rulesSnapshot(): CorrectionRule[] {
  if (currentRules === null) currentRules = loadRules();
  return currentRules;
}

export function subscribeRules(cb: () => void): () => void {
  rulesListeners.add(cb);
  return () => { rulesListeners.delete(cb); };
}

/** 写操作：函数式或整表替换皆可；落库 + 发布 */
export function writeRules(
  next: CorrectionRule[] | ((prev: readonly CorrectionRule[]) => CorrectionRule[]),
): void {
  const resolved = typeof next === 'function' ? next(rulesSnapshot()) : next;
  saveRules(resolved);
  currentRules = resolved;
  rulesListeners.forEach((l) => l());
}

export function useRulesStore(): CorrectionRule[] {
  return useSyncExternalStore(subscribeRules, rulesSnapshot);
}

/* ============================================================
 * ③ 会话旗标：fromNowOn（从此刻开始排）/ replanToken（手动重排令牌）
 *    不落库 —— 只要求「切页不丢」，会话内有效。
 * ========================================================== */

export interface SessionSnapshot {
  fromNowOn: boolean;
  replanToken: number;
}

let sessionSnap: SessionSnapshot = { fromNowOn: false, replanToken: 0 };
const sessionListeners = new Set<() => void>();

function publishSession(): void {
  sessionListeners.forEach((l) => l());
}

export function subscribeSession(cb: () => void): () => void {
  sessionListeners.add(cb);
  return () => { sessionListeners.delete(cb); };
}

export function getSessionSnapshot(): SessionSnapshot {
  return sessionSnap;
}

export function setFromNowOn(next: boolean | ((v: boolean) => boolean)): void {
  const resolved = typeof next === 'function' ? next(sessionSnap.fromNowOn) : next;
  if (resolved === sessionSnap.fromNowOn) return;
  sessionSnap = { ...sessionSnap, fromNowOn: resolved };
  publishSession();
}

export function setReplanToken(next: number | ((v: number) => number)): void {
  const resolved = typeof next === 'function' ? next(sessionSnap.replanToken) : next;
  sessionSnap = { ...sessionSnap, replanToken: resolved };
  publishSession();
}

export function useSessionFlags(): SessionSnapshot {
  return useSyncExternalStore(subscribeSession, getSessionSnapshot);
}
