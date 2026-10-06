/**
 * 网页端待办工作区 · 云同步通道（任务四 W2-P2-1）
 * ============================================================
 * **只复用**移动端线已落地的同步契约，不改任何一侧实现：
 *   · GET/PUT `/api/sync/state`（server/sync.py）；
 *   · todos/goals **按 id 逐项 LWW 并集**（MERGED_ARRAY_KEYS）——所以"按 id 粒度
 *     更新单条"不需要新的服务端 API：读-改-写时并发写入由服务端并集保护，
 *     本端只把**自己改的那条**带上新 `updatedAt`，其余条目交给云端合并；
 *   · 契约形状/合并纯函数直接 import `mobile/lib/{memoTypes,memoStore}.ts`（只读）。
 *
 * 单项操作路径：`withCloudMemo(token, mutate)` = GET 最新云端 → 纯函数 mutate →
 * PUT 回写（state 其余字段原样回显，不清空 schedule/planState/userOverrides）。
 * PUT 被拒（LWW 旧）→ 重拉云端真相返回，**不重试刷屏**（与 webSyncTick 同纪律）。
 */
import type { DayOfWeek, WeekPlan } from '@/types';
import { API_BASE } from '@/lib/api';
import {
  EMPTY_MEMO, adoptCloudMemo, loadMemo, saveMemo,
  type MemoData,
} from '@/features/mobile/lib/memoStore.ts';
import { MEMO_CACHE_KEY, type Goal, type Todo } from '@/features/mobile/lib/memoTypes.ts';
import { blockIdForTodo, setScheduledBlock } from './memoLogic.ts';

export interface CloudMemoSnapshot {
  /** 云端 state 原样（PUT 时回显，防清空非待办字段）；云端无记录 = {} */
  baseState: Record<string, unknown>;
  updatedAt: string | null;
  data: MemoData;
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/** 云端数组 → MemoData：只收有 id+title 的条目（毒项不进本地，与 memoStore 同口径） */
function toMemoData(state: Record<string, unknown> | null): MemoData {
  const st = state && typeof state === 'object' ? state : {};
  const okTodo = (t: unknown): t is Todo =>
    !!t && typeof t === 'object' && typeof (t as Todo).id === 'string' && typeof (t as Todo).title === 'string';
  const okGoal = (g: unknown): g is Goal =>
    !!g && typeof g === 'object' && typeof (g as Goal).id === 'string' && typeof (g as Goal).title === 'string';
  return {
    todos: Array.isArray(st.todos) ? (st.todos as unknown[]).filter(okTodo) : [],
    goals: Array.isArray(st.goals) ? (st.goals as unknown[]).filter(okGoal) : [],
  };
}

/** GET /api/sync/state → 云端快照（HTTP 失败抛错，调用方降级本地） */
export async function fetchCloudState(token: string): Promise<CloudMemoSnapshot> {
  const res = await fetch(`${API_BASE}/api/sync/state`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`sync GET HTTP ${res.status}`);
  const body = (await res.json()) as { found: boolean; state: Record<string, unknown> | null; updatedAt: string | null };
  return {
    baseState: body.found && body.state && typeof body.state === 'object' ? body.state : {},
    updatedAt: body.updatedAt ?? null,
    data: toMemoData(body.state),
  };
}

/** GET + 与本地缓存并集合并（离线可看、跨端不丢） */
export async function fetchCloudMemo(token: string): Promise<CloudMemoSnapshot> {
  const snap = await fetchCloudState(token);
  const cached = typeof localStorage !== 'undefined'
    ? loadMemo((k) => localStorage.getItem(k), MEMO_CACHE_KEY)
    : EMPTY_MEMO;
  return { ...snap, data: adoptCloudMemo(cached, snap.data.todos, snap.data.goals) };
}

/** 轻量读：WeekPlanView 排程前取待办用（不碰缓存） */
export async function fetchCloudTodos(token: string): Promise<Todo[]> {
  return (await fetchCloudState(token)).data.todos;
}

/** PUT /api/sync/state：state 其余字段**原样回显** + 覆盖 todos/goals */
export async function pushMemo(
  token: string,
  snap: Pick<CloudMemoSnapshot, 'baseState'>,
  data: MemoData,
): Promise<{ ok: boolean; accepted: boolean }> {
  const clientUpdatedAt = new Date().toISOString();
  try {
    const res = await fetch(`${API_BASE}/api/sync/state`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ state: { ...snap.baseState, todos: data.todos, goals: data.goals }, schemaVer: 2, clientUpdatedAt }),
    });
    if (!res.ok) return { ok: false, accepted: false };
    const body = (await res.json()) as { accepted?: boolean };
    return { ok: true, accepted: body.accepted !== false };
  } catch {
    return { ok: false, accepted: false };
  }
}

/**
 * 单项操作标准路径（P2-1）：GET 最新 → 纯函数 mutate → PUT → 返回权威数据。
 * 返回 null = 网络失败（调用方保持本地态并提示，不静默丢改动）。
 */
export async function withCloudMemo(
  token: string,
  mutate: (data: MemoData) => MemoData,
): Promise<{ data: MemoData; accepted: boolean } | null> {
  let snap: CloudMemoSnapshot;
  try {
    snap = await fetchCloudMemo(token);
  } catch {
    return null;
  }
  const next = mutate(snap.data);
  const pushed = await pushMemo(token, snap, next);
  if (pushed.ok && pushed.accepted) return { data: next, accepted: true };
  // LWW 被拒 / 写失败 → 重拉云端真相（不重试刷屏）
  try {
    return { data: (await fetchCloudMemo(token)).data, accepted: false };
  } catch {
    return null;
  }
}

/* ---------------- 本地缓存（离线可看；键与移动端同口径共用） ---------------- */

export function readCachedMemo(): MemoData {
  if (typeof localStorage === 'undefined') return EMPTY_MEMO;
  return loadMemo((k) => localStorage.getItem(k), MEMO_CACHE_KEY);
}

export function writeCachedMemo(data: MemoData): void {
  if (typeof localStorage === 'undefined') return;
  saveMemo((k, v) => localStorage.setItem(k, v), MEMO_CACHE_KEY, data);
}

/* ---------------- 块位置注册表 + scheduledBlockId 回填（W2-P2-3） ---------------- */

let planBlockPos = new Map<string, { dayOfWeek: DayOfWeek; startMin: number }>();

/** 每次重排后由 WeekPlanView 调：注册当前内存计划里所有块的位置（回显「已排进周三 15:00」用） */
export function registerPlanBlocks(plan: WeekPlan | null): void {
  const next = new Map<string, { dayOfWeek: DayOfWeek; startMin: number }>();
  if (plan) for (const b of plan.blocks) next.set(b.id, { dayOfWeek: b.dayOfWeek, startMin: b.startMin });
  planBlockPos = next;
}

/** MemoPanel 回显用：block id → 位置；内存里没有（刷新后）→ null（退回只显示星期） */
export function resolveBlock(blockId: string): { dayOfWeek: DayOfWeek; startMin: number } | null {
  return planBlockPos.get(blockId) ?? null;
}

/**
 * 排程后回填：命中块写 `scheduledBlockId`，不再被排的清掉（诚实回显，不留过期 chip）。
 * 返回回填条数（0 = 无变化不发起 PUT）。写云失败抛错由调用方兜底，不影响排程主流程。
 */
export async function syncScheduledBlockIds(token: string, todos: readonly Todo[], plan: WeekPlan): Promise<number> {
  const nowIso = new Date().toISOString();
  const hits: Array<{ id: string; blockId: string | null }> = [];
  for (const t of todos) {
    if (t.archived || t.completion === 'done') continue;
    const b = blockIdForTodo(plan, t.id);
    const nextId = b?.id ?? null;
    if ((t.scheduledBlockId ?? null) !== nextId) hits.push({ id: t.id, blockId: nextId });
  }
  if (hits.length === 0) return 0;
  const r = await withCloudMemo(token, (d) =>
    hits.reduce((acc, h) => setScheduledBlock(acc, h.id, h.blockId, nowIso), d));
  if (!r) throw new Error('syncScheduledBlockIds: cloud write failed');
  return hits.length;
}
