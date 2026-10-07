import { readRaw, writeRaw, removeRaw } from '@/lib/persistence';
/**
 * 目标管理 · 存储（R5.1）
 * ============================================================
 * 成就统计需要一个「往哪算」的维度 —— 光说「花了 30 小时」没有主语，
 * 「在数学建模上花了 30 小时」才是有意义的答案。
 *
 * 目标只存**定义**（名字、类型、目标时长、期限），**不存累计时长** ——
 * 累计值由 `aggregate.ts` 从 `ActivityEntry` 现算。
 * 理由（也是项目的一贯纪律）：**不双写**。存了就有可能与明细不一致，
 * 而不一致的时候没人知道该信哪个。
 */
const KEY = 'usst-goals-v1';
import { currentWeekNo } from '@/lib/date';

export type GoalKind = 'contest' | 'interest' | 'study' | 'habit';

/** 投入节奏（2026-09-19，用户拍板三选一，弹窗询问后可改） */
export type GoalPace = 'sprint' | 'steady' | 'both';

/* ============================================================
 * S4（2026-09-27）：Goal 模型扩展 —— 六类 / 里程碑 / 子领域 / 状态
 * 全部字段可选 → 老数据零迁移；不新建 key（免改 storageRegistry + serve.py）
 * ========================================================== */

/** 六类（设计书 §4）—— 决定排程策略，不只是显示分组 */
export type GoalCategory = 'contest' | 'academic' | 'skill' | 'growth' | 'health' | 'social';

/** 目标状态（设计书 §14.3）—— 只有 `active` 进排程；其余不产出块但**保留成就统计** */
export type GoalStatus = 'active' | 'paused' | 'done' | 'archived';

/** 块型（设计书 §6.9.3）—— 决定这个子领域产出多长的块 */
export type GoalBlockShape = 'deep' | 'fragment' | 'sprint';

export interface GoalMilestone {
  id: string;
  title: string;
  /** 完成时间（ISO）—— **排程据此切阶段** */
  dueAt: string;
  /** 可核对的达成状态（§6.9.5）：「能不看谱弹前奏」 */
  evidence?: string;
  /** 到此刻为止累计应投入的小时；缺省按 `pace` 曲线自动分配 */
  cumulativeHours?: number;
  /** 用户自评达成 —— **只影响展示，不影响排程**（§14.2 硬性决策） */
  done?: boolean;
  /** 勾选时刻 */
  doneAt?: string;
}

/** 子领域（§6.3）：**内容维**的载体 */
export interface GoalSubArea {
  name: string;
  /** 权重 0–1；同一目标内求和 = 1 */
  weight: number;
  /** 块型 */
  shape: GoalBlockShape;
  /** 该子领域在哪个阶段加权：「政治在冲刺期上调」 */
  peakPhase?: string;
}

/** 每周主题（§14.1）—— 宽泛 / 路径未知目标的核心 */
export interface WeekTheme {
  text: string;
  source: 'user' | 'suggested';
  at: string;
}

/** kind → category 映射（老数据推导用） */
const KIND_TO_CATEGORY: Record<GoalKind, GoalCategory> = {
  contest: 'contest', study: 'academic', interest: 'growth', habit: 'health',
};

/** category → kind 映射（排程层消费用；GoalsPage 快速输入也用它取经验时长） */
export const CATEGORY_TO_KIND: Record<GoalCategory, GoalKind> = {
  contest: 'contest', academic: 'study', skill: 'study',
  growth: 'interest', health: 'habit', social: 'interest',
};

export function categoryOf(goal: Goal): GoalCategory {
  if (goal.category) return goal.category;
  return KIND_TO_CATEGORY[goal.kind] ?? 'growth';
}

export const GOAL_PACE_LABEL: Record<GoalPace, string> = {
  sprint: '最后几周强度大',
  steady: '慢慢做起来',
  both: '两者兼顾',
};

export interface Goal {
  id: string;
  title: string;
  emoji: string;
  kind: GoalKind;
  /** 目标时长（分钟）；没有期限/定额时留空 —— 不是每件事都要被量化 */
  targetMinutes?: number;
  /** 截止日期（ISO）；「初赛材料交稿」这类节点 */
  dueAt?: string;
  /** 投入节奏 —— 决定这个目标怎么被排进日程 */
  pace?: GoalPace;
  /** 截止日期来源：手动填 or 将来自动获取（本期只 manual，留口子） */
  source?: 'manual' | 'auto';
  /** 🔴 预计总时长（小时）—— 分解算法的总量来源（手填或联网建议，确认后生效） */
  totalHours?: number;

  /* ── S4 新增（全部可选 → 老数据零迁移） ─────────────────── */

  /** 六类之一。缺省由 `kind` 推导 */
  category?: GoalCategory;
  /** 可验证产出（§6.12.2 / §17.2）—— 二维判据之一 */
  achievement?: string;
  /** 里程碑。空 / 缺省 = 走 v1 平摊逻辑（向后兼容硬不变量） */
  milestones?: GoalMilestone[];
  /** 内容维：子领域 + 权重 + 块型。空 = 走骨架（§6.10） */
  subAreas?: GoalSubArea[];
  /** 专项地点 */
  place?: string;
  /** 轻重缓急 1–5，缺省 3 → 映射到 `UserTask.priority` */
  priority?: 1 | 2 | 3 | 4 | 5;
  /** 目标状态。缺省 = `'active'` */
  status?: GoalStatus;
  /** 暂停到某天 —— 到期判定由**调用方**做（纯函数不读时钟） */
  pausedUntil?: string;
  /** 每周主题：`weekNo` → 一句话（§14.1 每周复盘） */
  weekThemes?: Record<number, WeekTheme>;
  /** 未复盘的周次（缺席降级用） */
  reviewMissed?: number[];
}

export const GOAL_KIND_LABEL: Record<GoalKind, string> = {
  contest: '竞赛',
  interest: '兴趣',
  study: '学习',
  habit: '习惯',
};

export const GOAL_CATEGORY_LABEL: Record<GoalCategory, string> = {
  contest: '竞赛·比赛', academic: '学业', skill: '技能·证书',
  growth: '自我提升', health: '健康', social: '社交·组织',
};

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: '进行中', paused: '已暂停', done: '已达成', archived: '已归档',
};

export const DEFAULT_EMOJI: Record<GoalKind, string> = {
  contest: '🏆', interest: '🎨', study: '📚', habit: '🔁',
};

/** 判断一个目标是否应该参与排程（§14.3：只有 active 进排程） */
export function isSchedulable(goal: Goal, today: string): boolean {
  const st = goal.status ?? 'active';
  if (st === 'active') return true;
  if (st === 'paused' && goal.pausedUntil && today >= goal.pausedUntil) return true;
  return false;
}

let seq = 0;
export function makeGoalId(): string {
  seq += 1;
  return `gl-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function addGoal(list: readonly Goal[], g: Goal): Goal[] {
  const i = list.findIndex((x) => x.id === g.id);
  const next = [...list];
  if (i < 0) return [...next, g];
  next[i] = g;
  return next;
}

export function removeGoal(list: readonly Goal[], id: string): Goal[] {
  return list.filter((g) => g.id !== id);
}

function isGoal(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const g = v as Record<string, unknown>;
  return typeof g.id === 'string' && !!g.id && typeof g.title === 'string';
}

export function loadGoals(): Goal[] {
  try {
    const raw = readRaw(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(isGoal) as Goal[]) : [];
  } catch {
    return [];
  }
}

export function saveGoals(list: readonly Goal[]): void {
  try {
    writeRaw(KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[goals] 写入失败：', e);
  }
}

export const GOALS_KEY = KEY;

/** 设置投入节奏（纯函数，撤销/修改都走它） */
export function withPace(goal: Goal, pace: GoalPace): Goal {
  return { ...goal, pace };
}

/* ============================================================
 * 目标 → 排程任务：实现已迁移到 `goalDecompose.ts`（2026-09-20 分解算法 v1）
 * ============================================================
 * 分解曲线/拆块/分布/容量守卫的全部逻辑与单测都在 `goalDecompose.ts`；
 * `WeekPlanView` 直接从那里导入 `goalTasksOf`。本文件只保留 Goal 的
 * 类型定义与存储职责。
 */
