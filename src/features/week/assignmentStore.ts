/**
 * 作业记录 · 纯函数 + 已退役的存储（T6）
 * ============================================================
 * 🔴 **存储已退役（R2，2026-09-19）**：作业记录本体迁到 `week/userPlanStore.ts`
 * 的 `UserPlanLayer.assignments`（key `usst-user-plan-v1`），旧 key 由那里迁移。
 *
 * **本文件保留的是纯函数**（`assignmentId` / `clampEstimate` / `assignmentsOfWeek` 等）
 * 和类型 `Assignment` —— 它们不碰 localStorage，可以在 Node 里单测，也能继续被 UI 直接用。
 * 要读写列表请通过覆盖层的 `upsertAssignment` / `removeAssignment`。
 *
 * 下面是原始设计说明：
 *
 * ── 为什么需要一张表 ─────────────────────────────────────────
 * 引擎知道「哪节课在哪天」，但**不知道这节课留了作业** —— `Course` 类型里没有这个字段，
 * 而且也不该有：作业是每节课后临时产生的，不是课程的固有属性。
 * 所以这里单独记一笔，再由界面把它转成 `UserTask`（走引擎已有的通道）。
 *
 * ── 为什么时长要用户填，而不是给个默认值 ──────────────────────
 * 「高数作业」和「大物实验报告」的耗时能差三倍。引擎猜一个数字，
 * 排出来的时间要么不够、要么占着茅坑 —— 那还不如让用户说一句。
 * 默认值只作为**输入框的起点**（60 分钟），不替用户决定。
 *
 * 存储独立于 `AppState`（同 `behaviorLog` / `planEditsStore` 的理由：
 * 条数会随学期增长、应可独立清空、零契约改动）。
 * 纯函数与 localStorage 严格分离 —— 前者可在 Node 里单测。
 */
const KEY = 'usst-assignments-v1';

/** 结构版本；改形状时递增，旧数据回落空 */
export const SCHEMA_VERSION = 1;

/** 上限：一学期几十门课 × 十几周，200 条足够 */
const MAX_ITEMS = 200;

/** 用户没填时输入框的起点（**只是起点**，不替用户决定） */
export const DEFAULT_ESTIMATE_MIN = 60;

/** 合理区间：太短没意义，太长一定是填错了 */
export const MIN_ESTIMATE_MIN = 10;
export const MAX_ESTIMATE_MIN = 600;

export interface Assignment {
  /** 稳定 id：`as-{courseId}-w{weekNo}` —— 同一门课同一周只记一条 */
  id: string;
  courseId: string;
  courseTitle: string;
  weekNo: number;
  /** 用户填的预计时长（分钟） */
  estimatedMin: number;
  createdAt: string;
}

export interface AssignmentStore {
  schemaVersion: number;
  items: Assignment[];
}

/* ============================================================
 * 一、纯函数部分（不碰 localStorage，可单测）
 * ========================================================== */

/** 同一门课同一周只有一条 —— 重复标记视为「改时长」 */
export function assignmentId(courseId: string, weekNo: number): string {
  return `as-${courseId}-w${weekNo}`;
}

/** 把时长夹到合理区间（用户手打 9999 也不该把一天占满） */
export function clampEstimate(min: number): number {
  if (!Number.isFinite(min)) return DEFAULT_ESTIMATE_MIN;
  return Math.min(MAX_ESTIMATE_MIN, Math.max(MIN_ESTIMATE_MIN, Math.round(min)));
}

export function upsertAssignment(
  items: readonly Assignment[],
  item: Assignment,
): Assignment[] {
  const i = items.findIndex((x) => x.id === item.id);
  const next = [...items];
  if (i < 0) next.push(item);
  else next[i] = item;
  return next.length <= MAX_ITEMS ? next : next.slice(next.length - MAX_ITEMS);
}

export function removeAssignment(items: readonly Assignment[], id: string): Assignment[] {
  return items.filter((x) => x.id !== id);
}

/** 取某一周的作业 */
export function assignmentsOfWeek(items: readonly Assignment[], weekNo: number): Assignment[] {
  return items.filter((x) => x.weekNo === weekNo);
}

export function isAssignment(v: unknown): v is Assignment {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'string' || !a.id) return false;
  if (typeof a.courseId !== 'string' || !a.courseId) return false;
  if (typeof a.courseTitle !== 'string') return false;
  if (typeof a.weekNo !== 'number' || a.weekNo < 1) return false;
  if (typeof a.estimatedMin !== 'number' || a.estimatedMin <= 0) return false;
  if (typeof a.createdAt !== 'string') return false;
  return true;
}

/* ============================================================
 * 二、存储层（唯一碰 localStorage 的地方）
 * ========================================================== */

export function loadAssignments(): Assignment[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<AssignmentStore> | null;
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return [];
    if (!Array.isArray(parsed.items)) return [];
    // 逐条过滤：坏数据只丢自己，不连累整个列表
    return parsed.items.filter(isAssignment);
  } catch {
    return [];
  }
}

export function saveAssignments(items: readonly Assignment[]): void {
  try {
    const store: AssignmentStore = { schemaVersion: SCHEMA_VERSION, items: [...items] };
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[assignments] 写入失败：', e);
  }
}

export function clearAssignments(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式静默 */
  }
}

/* ---------- 供测试用 ---------- */
export const STORAGE_KEY = KEY;
export const MAX_ITEMS_LIMIT = MAX_ITEMS;
