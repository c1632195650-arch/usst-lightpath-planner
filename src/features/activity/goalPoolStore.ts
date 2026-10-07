import { readRaw, writeRaw } from '@/lib/persistence';
/**
 * 目标池 · 孵化池存储与纯逻辑（2026-10-07）
 * ============================================================
 * 定位：长目标（goalStore 重模型）的**苗圃**。想法刚冒头时填不了总时长/
 * 节奏/里程碑这些"土壤断面"，先在池子里躺成轻条目；时机成熟后经
 * 「转正」表单补全信息，生成正式 Goal 进 goalStore，原条目标
 * `promotedGoalId` 归档留痕。
 *
 * 字段刻意对齐 CY memo 协议（`mobile/lib/memoTypes.ts`，schemaVer=2）：
 *   · title ≤120 / note / tags / createdAt / updatedAt（逐项 LWW）；
 *   · plannedDone 粗交期 `'YYYY-MM-上旬|中旬|下旬'`（同一解析口径）；
 *   · 归档而非删除 —— 数组级合并永不丢项的前提。
 * memo 云通道合流后，池子条目可由 memo longterm 待办喂入（source:'memo'，
 * 带 goalId 投影），本地结构零迁移。
 *
 * 存储纪律：key 已登记 storageRegistry（localOnly —— 合流前不上云，
 * 免改 serve.py 白名单；接 memo 云通道时摘标记 + 同步 persistence.test）。
 * 纯函数（addEntry / patchEntry / buildGoalFromEntry / plannedDoneToISO）
 * 不读时钟不碰存储（nowIso 一律入参），Node 单测直跑。
 */
import {
  CATEGORY_TO_KIND, DEFAULT_EMOJI,
  type Goal, type GoalCategory, type GoalMilestone, type GoalPace,
} from './goalStore';

const KEY = 'usst-goal-pool-v1';

/** 条目来源：手动新建 / memo 同步（预留字段，memo 合流后启用） */
export type PoolSource = 'manual' | 'memo';

export interface PoolEntry {
  id: string;
  /** ≤120 字（对齐 memo 协议口径） */
  title: string;
  note?: string;
  tags?: string[];
  /** 粗交期，对齐 memo 协议三档：`'2026-09-上旬' | '2026-09-中旬' | '2026-09-下旬'`；可空 */
  plannedDone?: string;
  /** 条目来源 */
  source: PoolSource;
  /** 转正后指向正式 Goal 的 id；有值 = 已转正 */
  promotedGoalId?: string;
  /** 转正时刻（ISO），溯源用 */
  promotedAt?: string;
  /** 归档而非删除（memo 纪律：历史留痕，同步永不丢项） */
  archived?: boolean;
  createdAt: string;
  /** 逐项 LWW 时间戳（ISO）；缺省退回 createdAt */
  updatedAt?: string;
}

/** 粗交期格式（与 CY memo plannedDone 同一口径） */
export const PLANNED_DONE_RE = /^\d{4}-\d{2}-(上旬|中旬|下旬)$/;

const PERIOD_END_DAY: Record<string, number> = { 上旬: 10, 中旬: 20, 下旬: 31 };

/**
 * 粗交期 → 精确 ISO 日期（转正表单的截止日预填值）。
 * 确定规则：该旬最后一天（下旬取当月最后一天，不跨月）——与 CY
 * `memoLogic.plannedDoneToDueAt` 的取日口径一致，只是落到日期而不是周槽。
 * 解析失败 → null（调用方让用户手填）。
 */
export function plannedDoneToISO(pd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(上旬|中旬|下旬)$/.exec(pd ?? '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const day = Math.min(PERIOD_END_DAY[m[3]] ?? 31, dim);
  return `${m[1]}-${m[2]}-${String(day).padStart(2, '0')}`;
}

/* ============================================================
 * 存取（与 goalStore 同款模式：try/catch 兜底，坏数据过滤不抛）
 * ========================================================== */

function isEntry(v: unknown): v is PoolEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string' && !!e.id && typeof e.title === 'string' && !!e.title;
}

export function loadPool(): PoolEntry[] {
  try {
    const raw = readRaw(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(isEntry) as PoolEntry[]) : [];
  } catch {
    return [];
  }
}

export function savePool(list: readonly PoolEntry[]): void {
  try {
    writeRaw(KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[goal-pool] 写入失败：', e);
  }
}

export const GOAL_POOL_KEY = KEY;

let seq = 0;
export function makeEntryId(): string {
  seq += 1;
  return `gp-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/* ============================================================
 * 纯操作（单测直跑）
 * ========================================================== */

export function addEntry(list: readonly PoolEntry[], e: PoolEntry): PoolEntry[] {
  return [...list, e];
}

export function patchEntry(list: readonly PoolEntry[], id: string, patch: Partial<PoolEntry>, nowIso: string): PoolEntry[] {
  return list.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: nowIso } : e));
}

/** 归档而非删除（返回新列表；已归档的重复归档是幂等 no-op） */
export function archiveEntry(list: readonly PoolEntry[], id: string, nowIso: string): PoolEntry[] {
  return list.map((e) => (e.id === id && !e.archived ? { ...e, archived: true, updatedAt: nowIso } : e));
}

/** 孵化中：没归档也没转正 */
export function incubatingEntries(list: readonly PoolEntry[]): PoolEntry[] {
  return list.filter((e) => !e.archived && !e.promotedGoalId);
}

/** 已转正（保留展示与溯源） */
export function promotedEntries(list: readonly PoolEntry[]): PoolEntry[] {
  return list.filter((e) => !e.archived && !!e.promotedGoalId);
}

/* ============================================================
 * 转正：轻条目 + 表单补全 → 正式 Goal（goalStore 重模型）
 * ========================================================== */

export interface PromoteInput {
  /** 六类之一（决定排程策略，不只是显示分组） */
  category: GoalCategory;
  /** 精确截止（ISO 'YYYY-MM-DD'）；可空 —— 不是每件事都有硬截止 */
  dueAt?: string;
  /** 预计总时长（小时）；分解算法的总量来源 */
  totalHours?: number;
  /** 投入节奏；可空（走 goalPrefs 缺省） */
  pace?: GoalPace;
  /** 时钟入参（纯函数纪律） */
  nowIso: string;
}

export interface PromoteResult {
  goal: Goal;
  /** 打完补丁的池子条目（promotedGoalId / promotedAt / updatedAt） */
  entry: PoolEntry;
}

/**
 * 转正构建。kind 由 category 推导（CATEGORY_TO_KIND，单一真源在 goalStore）；
 * 有 dueAt 时生成第一个里程碑（title='截止'），goalDecompose v2 据此切段。
 */
export function buildGoalFromEntry(entry: PoolEntry, input: PromoteInput, goalId: string): PromoteResult {
  const kind = CATEGORY_TO_KIND[input.category];
  const milestone: GoalMilestone | null = input.dueAt
    ? { id: `ms-${goalId}`, title: '截止', dueAt: input.dueAt }
    : null;
  const goal: Goal = {
    id: goalId,
    title: entry.title,
    emoji: DEFAULT_EMOJI[kind],
    kind,
    category: input.category,
    source: 'manual',
    status: 'active',
    ...(input.dueAt ? { dueAt: input.dueAt } : {}),
    ...(input.totalHours != null && input.totalHours > 0 ? { totalHours: input.totalHours } : {}),
    ...(input.pace ? { pace: input.pace } : {}),
    ...(milestone ? { milestones: [milestone] } : {}),
  };
  const patched: PoolEntry = {
    ...entry,
    promotedGoalId: goalId,
    promotedAt: input.nowIso,
    updatedAt: input.nowIso,
  };
  return { goal, entry: patched };
}
