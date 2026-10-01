import { readRaw, writeRaw, removeRaw } from '@/lib/persistence';
/**
 * 统一日期层 · 重要日期 store（总览页改版 批次 1）
 * ============================================================
 * 总览页此前三处展示同一份静态数据（CAL_EVENTS 与 DEADLINES 双写光电杯、
 * TodayCard 补位又引 DEADLINES），且全部写死、与用户无关。
 * 这里把三个来源合并成一份「重要日期」，作为总览页唯一数据源：
 *
 *   1. 内置种子：`DEADLINES`（只读映射，不改 `data/usst.ts` 的结构 ——
 *      `lib/planner/events.ts::expandDeadlines()` 照旧按原样消费）
 *   2. 用户自定义：localStorage `usst-important-dates-v1`（含「忽略内置项」）
 *   3. 目标截止：`Goal.dueAt`（**动态生成，不存储** —— 防双写，
 *      目标在 GoalEditor 改了截止日期，这里必须跟着变）
 *
 * 纪律：纯函数与 localStorage 严格分离（与 userPlanStore 同一口径）；
 * 不碰 `types.ts`；不碰引擎门禁基线。
 */
import { DEADLINES, type Deadline } from '@/data/usst';
import type { Goal } from '@/features/activity/goalStore';

const KEY = 'usst-important-dates-v1';
export const IMPORTANT_DATES_KEY = KEY;
export const IMPORTANT_DATES_SCHEMA_VERSION = 1;

/** 类别：deadline=报名/竞赛等截止，exam=考试，personal=个人日期 */
export type ImportantKind = 'deadline' | 'exam' | 'personal';

/** 来源：builtin=内置种子，user=手动添加，goal=目标截止（动态） */
export type ImportantSource = 'builtin' | 'user' | 'goal';

export interface ImportantDate {
  id: string;
  /** ISO 日期 */
  date: string;
  title: string;
  kind: ImportantKind;
  source: ImportantSource;
  emoji?: string;
  note?: string;
  /** 色彩标签（内置项沿用 DEADLINES.tag，与 deadlineColor() 的键一致） */
  tag?: string;
}

export interface ImportantDatesState {
  schemaVersion: number;
  /** 用户手动添加的日期 */
  items: ImportantDate[];
  /** 被用户忽略的内置项 id（内置种子不删，忽略即可恢复） */
  ignoredBuiltinIds: string[];
}

export function emptyImportantDates(): ImportantDatesState {
  return { schemaVersion: IMPORTANT_DATES_SCHEMA_VERSION, items: [], ignoredBuiltinIds: [] };
}

/* ============================================================
 * 纯函数 · 来源映射与合并
 * ========================================================== */

/** 内置种子：DEADLINES → ImportantDate（tag 为「考试」的归 exam，其余归 deadline） */
export function builtinImportantDates(deadlines: readonly Deadline[]): ImportantDate[] {
  return deadlines.map((d) => ({
    id: `builtin-${d.id}`,
    date: d.date,
    title: d.title,
    kind: d.tag === '考试' ? ('exam' as const) : ('deadline' as const),
    source: 'builtin' as const,
    emoji: d.emoji,
    note: d.note,
    tag: d.tag,
  }));
}

/** 目标截止：带 dueAt 的 Goal → ImportantDate（动态，不落盘） */
export function goalImportantDates(goals: readonly Goal[]): ImportantDate[] {
  return goals
    .filter((g) => typeof g.dueAt === 'string' && g.dueAt)
    .map((g) => ({
      id: `goal-${g.id}`,
      date: g.dueAt as string,
      title: g.title,
      kind: 'deadline' as const,
      source: 'goal' as const,
      emoji: g.emoji,
      note: '你的目标 · 截止',
      tag: '竞赛',
    }));
}

/**
 * 三源合并。排序：日期升序，同日按 id 稳定排序。
 * 忽略只作用于内置项（用户项直接删，目标项归 GoalEditor 管）。
 */
export function mergeImportantDates(
  state: ImportantDatesState,
  deadlines: readonly Deadline[],
  goals: readonly Goal[],
): ImportantDate[] {
  const ignored = new Set(state.ignoredBuiltinIds);
  const all = [
    ...builtinImportantDates(deadlines).filter((d) => !ignored.has(d.id)),
    ...state.items,
    ...goalImportantDates(goals),
  ];
  return [...all].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** 新建用户日期（纯函数，返回新 state） */
export function withUserDate(
  state: ImportantDatesState,
  input: { title: string; date: string; kind: ImportantKind; emoji?: string; note?: string },
): ImportantDatesState {
  const item: ImportantDate = {
    id: `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    date: input.date,
    title: input.title,
    kind: input.kind,
    source: 'user',
    ...(input.emoji ? { emoji: input.emoji } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  return { ...state, items: [...state.items, item] };
}

/** 删除用户日期（内置/目标项不是它管的，直接原样返回） */
export function withoutUserDate(state: ImportantDatesState, id: string): ImportantDatesState {
  if (!state.items.some((i) => i.id === id)) return state;
  return { ...state, items: state.items.filter((i) => i.id !== id) };
}

/** 忽略内置项（幂等） */
export function withIgnoredBuiltin(state: ImportantDatesState, id: string): ImportantDatesState {
  if (state.ignoredBuiltinIds.includes(id)) return state;
  return { ...state, ignoredBuiltinIds: [...state.ignoredBuiltinIds, id] };
}

/** 恢复被忽略的内置项（幂等） */
export function withoutIgnoredBuiltin(state: ImportantDatesState, id: string): ImportantDatesState {
  if (!state.ignoredBuiltinIds.includes(id)) return state;
  return { ...state, ignoredBuiltinIds: state.ignoredBuiltinIds.filter((x) => x !== id) };
}

/* ============================================================
 * localStorage（UI 层专用；Node 测试用内存垫片）
 * ========================================================== */

function isImportantDate(v: unknown): v is ImportantDate {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === 'string' && !!d.id &&
    typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) &&
    typeof d.title === 'string' && !!d.title &&
    (d.kind === 'deadline' || d.kind === 'exam' || d.kind === 'personal') &&
    (d.source === 'builtin' || d.source === 'user' || d.source === 'goal')
  );
}

/** 坏数据过滤：单条坏不阻塞整体（与 userPlanStore 同口径） */
export function sanitizeImportantDates(raw: unknown): ImportantDatesState {
  if (!raw || typeof raw !== 'object') return emptyImportantDates();
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? (r.items as unknown[]).filter(isImportantDate) : [];
  const ignored = Array.isArray(r.ignoredBuiltinIds)
    ? (r.ignoredBuiltinIds as unknown[]).filter((x): x is string => typeof x === 'string' && !!x)
    : [];
  return {
    schemaVersion: IMPORTANT_DATES_SCHEMA_VERSION,
    items: items.map((i) => ({ ...i, source: 'user' as const })),
    ignoredBuiltinIds: ignored,
  };
}

export function loadImportantDates(): ImportantDatesState {
  try {
    const raw = readRaw(KEY);
    if (!raw) return emptyImportantDates();
    return sanitizeImportantDates(JSON.parse(raw));
  } catch {
    return emptyImportantDates();
  }
}

export function saveImportantDates(state: ImportantDatesState): void {
  try {
    writeRaw(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[importantDates] 写入失败：', e);
  }
}
