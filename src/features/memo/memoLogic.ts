/**
 * 网页端待办工作区 · 纯逻辑（任务四 W1/W2/W3）
 * ============================================================
 * 只放**纯函数**：筛选/搜索（P1-3 网页端专属）、待办 → 排程映射（W3-P3-2）、
 * scheduledBlockId 回填匹配与回显文案（W2-P2-3）。存储 / fetch / 时钟都在
 * `webMemo.ts` 与组件层，本文件可被 Node 单测直跑（scripts/memo-web-workspace.test.ts）。
 *
 * 契约纪律：Todo/Goal 形状以 `mobile/lib/memoTypes.ts` 为准（已定型，不改字段）；
 * 排程侧 `TodoLike` 来自 `lib/planner/schedule.ts`（BLOCKERS P3-1 申报的桥接形状）。
 */
import type { DayOfWeek, TimeBlock, WeekPlan } from '@/types';
import { parseDate, weekNoFromTermStart, fmtMin } from '@/features/mobile/lib/sync.ts';
import type { Todo } from '@/features/mobile/lib/memoTypes.ts';
import type { MemoData } from '@/features/mobile/lib/memoStore.ts';
import type { TodoLike } from '@/lib/planner/schedule.ts';

/* ============================================================
 * 一、筛选 / 搜索（P1-3 网页端专属：长文本 + 标签）
 * ========================================================== */

export interface TodoFilter {
  /** 关键字：命中 title 或 note（不区分大小写） */
  q?: string;
  /** 标签精确匹配；null = 不按标签筛 */
  tag?: string | null;
  /** 完成态；'all' = 不按完成态筛 */
  state?: 'all' | 'open' | 'done';
}

export function filterTodos(todos: readonly Todo[], f: TodoFilter): Todo[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return todos.filter((t) => {
    if (f.tag != null && !(t.tags ?? []).includes(f.tag)) return false;
    if (f.state === 'open' && t.completion === 'done') return false;
    if (f.state === 'done' && t.completion !== 'done') return false;
    if (q) {
      const hay = `${t.title}\n${t.note ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** 全部标签（去重，按首次出现顺序）—— 筛选条 chips 用 */
export function tagsOf(todos: readonly Todo[]): string[] {
  const seen = new Set<string>();
  for (const t of todos) for (const tag of t.tags ?? []) seen.add(tag);
  return [...seen];
}

/* ============================================================
 * 二、待办 → 排程映射（W3-P3-2，规则确定且有测试）
 * ========================================================== */

/** 最近待办未填时长时的档位（CY：由用户填或用档位；契约无 effort 字段 → 固定档位） */
export const RECENT_TODO_EFFORT_MIN = 30;
/** 中长期待办的每周投入档位（"本周累计读完"量级；BLOCKERS 已申报契约缺口） */
export const LONGTERM_TODO_EFFORT_MIN = 60;
/** 粗粒度完成时段 → 交期时刻：该旬最后一天的 21:00（确定规则，不看着办） */
export const TODO_DUE_MIN = 21 * 60;

const PERIOD_END_DAY: Record<string, number> = { 上旬: 10, 中旬: 20, 下旬: 31 };

/**
 * '2026-09-中旬' → dueAt。
 * 确定规则：**该旬最后一天 21:00**（下旬在 30 天月取当月最后一天，不跨月）；
 * 解析失败 / 学期开始前 → null（调用方不传 dueAt，引擎按无硬交期处理）。
 */
export function plannedDoneToDueAt(pd: string, termStart: string): TodoLike['dueAt'] | null {
  const m = /^(\d{4})-(\d{2})-(上旬|中旬|下旬)$/.exec(pd ?? '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // 当月天数
  const day = Math.min(PERIOD_END_DAY[m[3]] ?? 31, dim);
  const ms = parseDate(`${m[1]}-${m[2]}-${String(day).padStart(2, '0')}`);
  if (ms == null) return null;
  const d = new Date(ms);
  const weekNo = weekNoFromTermStart(termStart, d);
  if (weekNo == null) return null;
  const dayOfWeek = (((d.getUTCDay() + 6) % 7) + 1) as DayOfWeek;
  return { weekNo, dayOfWeek, min: TODO_DUE_MIN };
}

/**
 * 未完成待办 → `BuildWeekPlanInput.pendingTodos`（W3-P3-2 映射，唯一入口）。
 * 规则：
 *   · done / archived 的待办**不参与**排程；
 *   · recent → { kind:'recent', effortMin: RECENT_TODO_EFFORT_MIN }（引擎侧落成 UserTask）；
 *   · longterm → { kind:'longterm', splittable:true }（引擎侧落成可拆 Commit）；
 *     有 plannedDone 且其交期周 == 目标周才带 dueAt —— 交期周不同的（已过期/未到周）
 *     不进本周计划，避免跨周交期被引擎误用（确定规则）。
 */
export function todosToPendingTodos(todos: readonly Todo[], termStart: string, weekNo: number): TodoLike[] {
  const out: TodoLike[] = [];
  for (const t of todos) {
    if (t.archived || t.completion === 'done') continue;
    if (t.kind === 'recent') {
      out.push({ id: t.id, title: t.title, kind: 'recent', effortMin: RECENT_TODO_EFFORT_MIN });
      continue;
    }
    const dueAt = plannedDoneToDueAt(t.plannedDone ?? '', termStart);
    if (dueAt && dueAt.weekNo !== weekNo) continue;
    out.push({
      id: t.id,
      title: t.title,
      kind: 'longterm',
      effortMin: LONGTERM_TODO_EFFORT_MIN,
      splittable: true,
      ...(dueAt ? { dueAt } : {}),
    });
  }
  return out;
}

/* ============================================================
 * 二.5、看板分组（UI v2 批次 D4：今天 / 本周 / 逾期 / 未排 / 已完成）
 * ------------------------------------------------------------
 * 全部由既有字段推导（Todo 契约定型不改）：
 *   排程天 ← scheduledBlockId 内的 `-d{1-7}-`（dayFromBlockId，同源）；
 *   旬粒度目标 ← longterm 的 plannedDone（'YYYY-MM-上旬|中旬|下旬'）。
 * 纯函数；时钟由调用方传入（todayDow / todayIso），与 lib/today 同一纪律。
 * ========================================================== */

export type TodoBoardGroup = 'overdue' | 'today' | 'week' | 'unscheduled' | 'done';

/** '2026-09-上旬' → 可比较序数（年*36 + 月*3 + 旬序）；解析不了 → NaN */
export function xunRank(plannedDone: string): number {
  const m = /^(\d{4})-(\d{2})-(上旬|中旬|下旬)$/.exec(plannedDone ?? '');
  if (!m) return NaN;
  const xunIdx = { 上旬: 0, 中旬: 1, 下旬: 2 }[m[3]] ?? 0;
  return Number(m[1]) * 36 + Number(m[2]) * 3 + xunIdx;
}

/** 今天 ISO → 所在旬的 plannedDone 记法 */
export function currentXun(iso: string): string {
  const d = parseDate(iso) ?? new Date(`${iso}T00:00:00`).getTime() / 86400000;
  const dt = new Date(d as number);
  const day = dt.getDate();
  const xun = day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${xun}`;
}

/**
 * 单条待办的看板归属（确定性规则，不看着办）：
 *   done                                          → done
 *   longterm 未完成 且 plannedDone 旬 < 今天所在旬   → overdue（旬已整体过去）
 *   已排进块 且 块天 === 今天                        → today
 *   longterm 未完成 且 plannedDone === 今天所在旬    → week（本旬要办，非精确天）
 *   已排进块（本周期别的天）                        → week
 *   其余                                          → unscheduled
 */
export function todoGroupOf(
  todo: Pick<Todo, 'completion' | 'kind' | 'plannedDone' | 'scheduledBlockId'>,
  todayDow: number,
  todayIso: string,
): TodoBoardGroup {
  if (todo.completion === 'done') return 'done';
  const schedDay = todo.scheduledBlockId ? dayFromBlockId(todo.scheduledBlockId) : null;
  if (todo.kind === 'longterm' && todo.plannedDone) {
    const want = xunRank(todo.plannedDone);
    const now = xunRank(currentXun(todayIso));
    if (Number.isFinite(want) && Number.isFinite(now) && want < now) return 'overdue';
    if (want === now) return 'week';
  }
  if (schedDay === todayDow) return 'today';
  if (schedDay != null) return 'week';
  return 'unscheduled';
}

/** 看板分组：入参顺序不敏感，出组内保持原排序（sortTodosForView 已定序） */
export function groupTodosForBoard<T extends Pick<Todo, 'id' | 'completion' | 'kind' | 'plannedDone' | 'scheduledBlockId'>>(
  todos: readonly T[],
  todayDow: number,
  todayIso: string,
): Record<TodoBoardGroup, T[]> {
  const out: Record<TodoBoardGroup, T[]> = { overdue: [], today: [], week: [], unscheduled: [], done: [] };
  for (const t of todos) out[todoGroupOf(t, todayDow, todayIso)].push(t);
  return out;
}

/* ============================================================
 * 三、scheduledBlockId 回填匹配与回显（W2-P2-3）
 * ========================================================== */

/**
 * 计划里属于该待办的块。引擎 id 规范（model.ts §七）：
 * `w{n}-d{d}-{kind}-{语义键}`，语义键 = todo id；可拆 Commit 的续段是 `{id}-{part}`。
 * 优先整块（endsWith），退回续段（includes）——两者都命不中 = 未被安排。
 */
export function blockIdForTodo(plan: WeekPlan, todoId: string): TimeBlock | null {
  let part: TimeBlock | null = null;
  for (const b of plan.blocks) {
    if (b.id.endsWith(`-${todoId}`)) return b;
    if (part === null && b.id.includes(`-${todoId}-`)) part = b;
  }
  return part;
}

const DAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

/** 从 block id 解析星期几（`-d3-` → 3）；解析不了 → null */
export function dayFromBlockId(blockId: string): number | null {
  const m = /-d(\d)-/.exec(blockId ?? '');
  if (!m) return null;
  const d = Number(m[1]);
  return d >= 1 && d <= 7 ? d : null;
}

/**
 * 待办卡上的排程回显文案（CY 验收：「已排进周三 15:00」）。
 *   · 当前内存里有该块（本轮刚排过）→ 「已排进周三 15:00」（精确到时刻）；
 *   · 只有 block id（刷新后 web 不存整周计划）→ 退回「已排进周三」（id 内含星期）；
 *   · 连 id 都没有 → null（不显示 chip）。
 */
export function scheduledLabel(
  todo: Pick<Todo, 'scheduledBlockId'>,
  resolve?: (blockId: string) => { dayOfWeek: number; startMin: number } | null,
): string | null {
  if (!todo.scheduledBlockId) return null;
  const r = resolve?.(todo.scheduledBlockId) ?? null;
  if (r) return `已排进周${DAY_CN[r.dayOfWeek - 1]} ${fmtMin(r.startMin)}`;
  const d = dayFromBlockId(todo.scheduledBlockId);
  return d ? `已排进周${DAY_CN[d - 1]}` : '已排进本周计划';
}

/** 回填写入（web 端专用：memoStore.patchTodoDetail 清不掉已值，这里支持置空） */
export function setScheduledBlock(data: MemoData, id: string, blockId: string | null, nowIso: string): MemoData {
  return {
    ...data,
    todos: data.todos.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t, updatedAt: nowIso };
      if (blockId) next.scheduledBlockId = blockId;
      else delete next.scheduledBlockId;
      return next;
    }),
  };
}

/* ============================================================
 * 四、网页端编辑补充（memoStore 不含 title 编辑 / 归档外的基本字段）
 * ========================================================== */

/** 编辑标题（note/tags/goalId 走 memoStore.patchTodoDetail；kind 建后不可改——两端同口径） */
export function updateTodoTitle(data: MemoData, id: string, title: string, nowIso: string): MemoData {
  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) return data;
  return {
    ...data,
    todos: data.todos.map((t) => (t.id === id ? { ...t, title: trimmed, updatedAt: nowIso } : t)),
  };
}
