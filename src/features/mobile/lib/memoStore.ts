/**
 * 光溯移动端 · 待办/目标本地仓（新任务三 Wave 4 · D1）
 * ============================================================
 * 「乐观本地 + 云端合并」：GET 采纳云端后落地缓存（离线可看）；编辑先改本地、
 * 随下一次 SyncState PUT（debounce 1s）上行；服务端按 id 逐项 LWW 并集，
 * 两端并发不会互相覆盖（server/sync.py 同语义）。
 * 全部纯函数（storage / 时钟入参），Node 单测可跑。
 */
import {
  completeTodo, mergeGoals, mergeTodos, todoStamp, stampNewer,
  type Goal, type Todo,
} from './memoTypes.ts';

export interface MemoData {
  todos: Todo[];
  goals: Goal[];
}

export const EMPTY_MEMO: MemoData = { todos: [], goals: [] };

/** 容错读取：坏 JSON / 坏形状 → 空仓（不白屏，丢了也能从云端拉回） */
export function loadMemo(read: (k: string) => string | null, key: string): MemoData {
  const raw = read(key);
  if (!raw) return EMPTY_MEMO;
  try {
    const p = JSON.parse(raw) as Partial<MemoData>;
    return {
      todos: Array.isArray(p.todos) ? p.todos : [],
      goals: Array.isArray(p.goals) ? p.goals : [],
    };
  } catch {
    return EMPTY_MEMO;
  }
}

export function saveMemo(write: (k: string, v: string) => void, key: string, data: MemoData): void {
  try {
    write(key, JSON.stringify(data));
  } catch { /* 配额满：下次再存 */ }
}

/** 云端 → 本地合并（按 id 逐项 LWW）：GET 之后、编辑之前调用 */
export function adoptCloudMemo(local: MemoData, cloudTodos: readonly Todo[] | null, cloudGoals: readonly Goal[] | null): MemoData {
  return {
    todos: mergeTodos(local.todos, cloudTodos ?? []),
    goals: mergeGoals(local.goals, cloudGoals ?? []),
  };
}

let _seq = 0;
/** 本地生成 id（无 uuid 依赖的稳定做法：时间戳 + 序列，跨端一致性由服务端并集保证） */
export function newMemoId(prefix: string): string {
  _seq = (_seq + 1) % 1000;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

export function addTodo(data: MemoData, args: {
  title: string; kind: Todo['kind']; nowIso: string; id?: string;
  note?: string; tags?: string[]; goalId?: string;
}): MemoData {
  const t: Todo = {
    id: args.id ?? newMemoId('td'),
    kind: args.kind,
    title: args.title.slice(0, 120),
    ...(args.note ? { note: args.note } : {}),
    ...(args.tags?.length ? { tags: args.tags } : {}),
    ...(args.goalId ? { goalId: args.goalId } : {}),
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
    completion: null,
  };
  return { ...data, todos: [...data.todos, t] };
}

/**
 * 完成分流（CY 核心）：recent 即勾；longterm 必须带 plannedDone。
 * 返回 { ok, data, todo?, reason? } —— UI 据此出正反馈或阻止提示。
 */
export function toggleTodoDone(data: MemoData, id: string, args: {
  nowIso: string; plannedDone?: string; uncomplete?: boolean;
}): { ok: boolean; data: MemoData; todo?: Todo; reason?: string } {
  const t = data.todos.find((x) => x.id === id);
  if (!t) return { ok: false, data };
  // 取消勾选（撤销）：清完成态，保留 plannedDone 历史
  if (args.uncomplete) {
    const undone: Todo = { ...t, completion: null, actualDoneAt: undefined, updatedAt: args.nowIso };
    return { ok: true, data: { ...data, todos: data.todos.map((x) => (x.id === id ? undone : x)) }, todo: undone };
  }
  if (t.completion === 'done') return { ok: false, data, reason: 'already-done' };
  const r = completeTodo(t, { nowIso: args.nowIso, plannedDone: args.plannedDone });
  if (!r.ok) return { ok: false, data, reason: r.reason };
  return { ok: true, data: { ...data, todos: data.todos.map((x) => (x.id === id ? r.todo : x)) }, todo: r.todo };
}

/** 归档而非删除（红线）：数据留着（任务二拖延指数要用历史） */
export function archiveTodo(data: MemoData, id: string, nowIso: string, archived = true): MemoData {
  return {
    ...data,
    todos: data.todos.map((t) => (t.id === id ? { ...t, archived, updatedAt: nowIso } : t)),
  };
}

/** 网页端可补的长文本与标签（手机端只读展示） */
export function patchTodoDetail(data: MemoData, id: string, patch: {
  note?: string; tags?: string[]; scheduledBlockId?: string; goalId?: string;
}, nowIso: string): MemoData {
  return {
    ...data,
    todos: data.todos.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t, updatedAt: nowIso };
      if (patch.note !== undefined) next.note = patch.note;
      if (patch.tags !== undefined) next.tags = patch.tags;
      if (patch.scheduledBlockId !== undefined) next.scheduledBlockId = patch.scheduledBlockId;
      if (patch.goalId !== undefined) next.goalId = patch.goalId;
      return next;
    }),
  };
}

export function addGoal(data: MemoData, args: {
  title: string; nowIso: string; id?: string; why?: string;
}): { data: MemoData; goal: Goal } {
  const g: Goal = {
    id: args.id ?? newMemoId('g'),
    title: args.title,
    ...(args.why ? { why: args.why } : {}),
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
  };
  return { data: { ...data, goals: [...data.goals, g] }, goal: g };
}

/** 目标 1-3 个（CY 口径）：满了拒新增 */
export function canAddGoal(data: MemoData): boolean {
  return data.goals.filter((g) => !g.archived).length < 3;
}

export function addGoalMilestone(data: MemoData, goalId: string, args: {
  title: string; id?: string;
}, nowIso: string): MemoData {
  return {
    ...data,
    goals: data.goals.map((g) => (g.id === goalId
      ? {
          ...g,
          updatedAt: nowIso,
          milestones: [...(g.milestones ?? []), { id: args.id ?? newMemoId('ms'), title: args.title, done: false }],
        }
      : g)),
  };
}

export function toggleGoalMilestone(data: MemoData, goalId: string, msId: string, nowIso: string): MemoData {
  return {
    ...data,
    goals: data.goals.map((g) => (g.id === goalId
      ? {
          ...g,
          updatedAt: nowIso,
          milestones: (g.milestones ?? []).map((m) => (m.id === msId ? { ...m, done: !m.done } : m)),
        }
      : g)),
  };
}

export function archiveGoal(data: MemoData, goalId: string, nowIso: string, archived = true): MemoData {
  return {
    ...data,
    goals: data.goals.map((g) => (g.id === goalId ? { ...g, archived, updatedAt: nowIso } : g)),
  };
}

/* ---------------- 首屏浮现卡的「常驻」判定 ---------------- */

const PERIOD_END_DAY: Record<string, number> = { 上旬: 10, 中旬: 20, 下旬: 31 };

/** '2026-09-中旬' → 该时段最后一天的 (year, month, day)；解析失败 → null */
function periodEndDate(pd: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(上旬|中旬|下旬)$/.exec(pd ?? '');
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), PERIOD_END_DAY[m[3]] ?? 31];
}

/** 中长期待办是否逾期：plannedDone 时段已整段过去还没完成（用于浮现卡转常驻） */
export function isLongtermOverdue(t: Todo, dayKey: string): boolean {
  if (t.kind !== 'longterm' || t.completion === 'done' || t.archived) return false;
  const end = periodEndDate(t.plannedDone ?? '');
  if (!end) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey ?? '');
  if (!m) return false;
  const [y, mo, dd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [ey, emo, edd] = end;
  if (ey !== y) return ey < y;
  if (emo !== mo) return emo < mo;
  return edd < dd;
}

/** 浮现卡有「到期/逾期」内容 → 转常驻（不 4 秒淡出） */
export function memoNeedsAttention(data: MemoData, dayKey: string): boolean {
  return data.todos.some((t) => isLongtermOverdue(t, dayKey))
    || data.goals.some((g) => !g.archived && (g.milestones ?? []).length === 0);
}

/** 卡片角标：未完成待办数（归档的不算） */
export function openTodoCount(data: MemoData): number {
  return data.todos.filter((t) => !t.archived && t.completion !== 'done').length;
}

/** 排序：未完成在前、updatedAt 新在前（两侧看到一致的顺序） */
export function sortTodosForView(todos: readonly Todo[]): Todo[] {
  return [...todos]
    .filter((t) => !t.archived)
    .sort((a, b) => {
      const aDone = a.completion === 'done' ? 1 : 0;
      const bDone = b.completion === 'done' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return stampNewer(todoStamp(b), todoStamp(a)) ? 1 : stampNewer(todoStamp(a), todoStamp(b)) ? -1 : 0;
    });
}
