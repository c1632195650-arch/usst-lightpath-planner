/**
 * 计划编辑 · 存储（阶段 A：用户的改动要被记住）
 * ============================================================
 * 🔴 **已退役（R2，2026-09-19）—— 别再用它做存储。**
 *
 * 职责已整体迁入 `week/userPlanStore.ts`（key `usst-user-plan-v1`）：
 *   · `userTasks`        → `UserPlanLayer.tasks`
 *   · `excludedBlockIds` → `UserPlanLayer.excluded`
 * 旧数据由 `loadUserPlan()` 自动迁移；本文件保留只为**读兼容**（迁移源 + 旧数据的迁移函数），
 * 新代码请一律走覆盖层 —— 否则同一份「用户加的事」会散在两个 key 里互相覆盖。
 *
 * 下面是它活着时候的设计说明，保留供理解旧数据形状：
 *
 * ── 为什么这两类放一起 ───────────────────────────────────────
 * 它们的生命周期一致：都是「用户对本周期计划的微调」，一起读、一起清。
 * 拆两个 key 只会让读取多一次 JSON.parse，收益为零。
 *
 * 纯函数与 localStorage 严格分离 —— 前者可在 Node 里单测（无 localStorage）。
 *
 * @deprecated 存储请改用 `userPlanStore.ts`；本文件仅供迁移读取。
 */
import type { UserTask } from '@/lib/planner/templates';

const KEY = 'usst-plan-edits-v1';

/** 结构版本；将来改形状时递增，旧数据回落空（用户的自定义可重建，损失可控） */
export const SCHEMA_VERSION = 1;

/** 上限：用户手加的事 + 手删的块，几百条远够，也远离配额 */
const MAX_USER_TASKS = 200;
const MAX_EXCLUDED = 500;

export interface PlanEditsStore {
  schemaVersion: number;
  userTasks: UserTask[];
  excludedBlockIds: string[];
}

/* ============================================================
 * 一、纯函数部分（不碰 localStorage，可单测）
 * ========================================================== */

let seq = 0;

/**
 * 生成用户任务 id。
 *
 * ⚠️ 前缀 `ut-` 是刻意的：这些 id 会进 `blockId()` 组成
 * `w{周}-d{天}-{kind}-{语义键}`（规格书 §6.4），必须稳定且不含时间
 * —— 引擎的 churn / 锁都靠它匹配「同一个块」。
 */
export function makeTaskId(): string {
  seq += 1;
  return `ut-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** 同 id 覆盖、新 id 追加；超上限丢最旧 */
export function addTask(tasks: readonly UserTask[], task: UserTask): UserTask[] {
  const i = tasks.findIndex((t) => t.id === task.id);
  const next = [...tasks];
  if (i < 0) next.push(task);
  else next[i] = task;
  return next.length <= MAX_USER_TASKS ? next : next.slice(next.length - MAX_USER_TASKS);
}

export function removeTask(tasks: readonly UserTask[], id: string): UserTask[] {
  return tasks.filter((t) => t.id !== id);
}

/** 追加一个被排除的块 id（幂等） */
export function excludeBlock(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return [...ids];
  const next = [...ids, id];
  return next.length <= MAX_EXCLUDED ? next : next.slice(next.length - MAX_EXCLUDED);
}

/** 取消排除（「这块我还是做吧」） */
export function includeBlock(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

function isUserTask(v: unknown): v is UserTask {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id) return false;
  if (typeof t.title !== 'string' || !t.title) return false;
  if (t.dayOfWeek != null && (typeof t.dayOfWeek !== 'number' || t.dayOfWeek < 1 || t.dayOfWeek > 7)) return false;
  if (t.startMin != null && (typeof t.startMin !== 'number' || t.startMin < 0 || t.startMin >= 24 * 60)) return false;
  if (t.durationMin != null && (typeof t.durationMin !== 'number' || t.durationMin <= 0)) return false;
  return true;
}

export function isPlanEdits(v: unknown): v is PlanEditsStore {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  if (s.schemaVersion !== SCHEMA_VERSION) return false;
  if (!Array.isArray(s.userTasks) || !Array.isArray(s.excludedBlockIds)) return false;
  return true;
}

/* ============================================================
 * 二、存储层（唯一碰 localStorage 的地方）
 * ========================================================== */

/** 空状态（读不到 / 版本不符时用） */
export function emptyEdits(): PlanEditsStore {
  return { schemaVersion: SCHEMA_VERSION, userTasks: [], excludedBlockIds: [] };
}

/**
 * 读取。任何异常回落空 ——
 * 这是**增强**功能，数据坏掉绝不该让周程页打不开。
 */
export function loadEdits(): PlanEditsStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyEdits();
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlanEdits(parsed)) return emptyEdits();
    return {
      schemaVersion: SCHEMA_VERSION,
      // 逐条过滤：坏数据只丢自己，不连累整个列表
      userTasks: parsed.userTasks.filter(isUserTask),
      excludedBlockIds: parsed.excludedBlockIds.filter((x): x is string => typeof x === 'string'),
    };
  } catch {
    return emptyEdits();
  }
}

export function saveEdits(edits: PlanEditsStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      userTasks: edits.userTasks,
      excludedBlockIds: edits.excludedBlockIds,
    }));
  } catch (e) {
    console.warn('[plan-edits] 写入失败：', e);
  }
}

export function clearEdits(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式静默 */
  }
}

/* ---------- 供测试用 ---------- */

export const STORAGE_KEY = KEY;
export const MAX_USER_TASKS_LIMIT = MAX_USER_TASKS;
export const MAX_EXCLUDED_LIMIT = MAX_EXCLUDED;
