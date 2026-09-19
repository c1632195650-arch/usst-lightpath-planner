/**
 * 活动登记 · 存储（R4.2 / R5）
 * ============================================================
 * 用户的需求：「这学期在竞赛上花了多少时间？」
 *
 * ── 为什么单独一张表 ─────────────────────────────────────────
 * `behaviorLog` 记的是「计划内的块做了没有」—— 它的主语是**计划**。
 * 而这里记的是「**人**把时间花在哪了」，不论事先有没有排。
 * 两者合并会让「执行率」这个概念失去意义（把计划外的投入算进分子，
 * 分子会大于分母）。
 *
 * ── 采集摩擦要极低（编号 9）─────────────────────────────────
 * 引用 `behaviorLog.ts` 的话：「记不住的原因通常不是字段不够，是**记起来太麻烦**」。
 * 所以：一次点击就要能记下，所有字段都可跳过，且**追问绝不阻塞**主流程。
 *
 * ── 与 `behaviorLog` 不双写 ──────────────────────────────────
 * 这里**不**记录计划内块的执行情况（那是 behaviorLog 的活）。
 * `source` 字段就是这条界限的可机读形式：
 *   · `occupied` 用户声明某段时间不可用 / 去做某事了
 *   · `manual`   用户事后补记一笔
 */
const KEY = 'usst-activity-log-v1';

/** 上限：一学期几百条足够，也远离 localStorage 配额 */
const MAX_ENTRIES = 500;

export type ActivityTag = 'interest' | 'goal' | 'other';
export type ActivitySource = 'occupied' | 'manual';

export interface ActivityEntry {
  id: string;
  /** ISO 日期（哪一天的投入） */
  date: string;
  weekNo: number;
  fromMin?: number;
  toMin?: number;
  minutes: number;
  title: string;
  tag: ActivityTag;
  /** 关联目标（`tag === 'goal'` 时才有意义） */
  goalId?: string;
  source: ActivitySource;
  at: string;
}


/* ---------- 纯函数（不碰 localStorage，可单测） ---------- */

let seq = 0;
export function makeEntryId(): string {
  seq += 1;
  return `ac-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function addEntry(list: readonly ActivityEntry[], e: ActivityEntry): ActivityEntry[] {
  const next = [...list, e];
  return next.length <= MAX_ENTRIES ? next : next.slice(next.length - MAX_ENTRIES);
}

export function removeEntry(list: readonly ActivityEntry[], id: string): ActivityEntry[] {
  return list.filter((e) => e.id !== id);
}

export function upsertEntry(list: readonly ActivityEntry[], e: ActivityEntry): ActivityEntry[] {
  const i = list.findIndex((x) => x.id === e.id);
  const next = [...list];
  if (i < 0) return addEntry(list, e);
  next[i] = e;
  return next;
}

/** 某周的记录（周次 = 排程口径，跟校历一致） */
export function entriesOfWeek(list: readonly ActivityEntry[], weekNo: number): ActivityEntry[] {
  return list.filter((e) => e.weekNo === weekNo);
}

/** 关联某个目标的记录 */
export function entriesOfGoal(list: readonly ActivityEntry[], goalId: string): ActivityEntry[] {
  return list.filter((e) => e.goalId === goalId);
}

export const TAG_LABEL: Record<ActivityTag, string> = {
  interest: '兴趣',
  goal: '长期目标',
  other: '其它',
};

function isEntry(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string' && !!e.id
    && typeof e.weekNo === 'number' && typeof e.minutes === 'number';
}

function normalize(raw: unknown): ActivityEntry[] {
  return Array.isArray(raw) ? (raw.filter(isEntry) as ActivityEntry[]) : [];
}

/* ---------- 存储层 ---------- */

export function loadActivityLog(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveActivityLog(list: readonly ActivityEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[activity] 写入失败：', e);
  }
}

export const ACTIVITY_KEY = KEY;
