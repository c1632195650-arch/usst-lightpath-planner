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
}

export const GOAL_KIND_LABEL: Record<GoalKind, string> = {
  contest: '竞赛',
  interest: '兴趣',
  study: '学习',
  habit: '习惯',
};

export const DEFAULT_EMOJI: Record<GoalKind, string> = {
  contest: '🏆', interest: '🎨', study: '📚', habit: '🔁',
};

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
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(isGoal) as Goal[]) : [];
  } catch {
    return [];
  }
}

export function saveGoals(list: readonly Goal[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
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
 * 目标 → 排程任务（2026-09-19）
 * ============================================================
 * 用户的反馈：「设立了目标比如数学建模国赛，点击了重排也无法将这一项排到日程里」
 * —— 因为目标此前只是成就统计的归类标签，没进排程通道。
 *
 * 引擎不认识「目标」，只认识 `UserTask`（手动加的事/作业/校历事件同一条通道）。
 * 这里按节奏把目标翻译成任务：
 *   · steady / both → 每周固定投入块（60 分钟，优先级 70：高于普通活动、低于事件准备块）
 *   · sprint / both → 截止前 3/2/1 周生成冲刺块（60/120/180 分钟，越近越多），
 *     优先级随临近递增（80 → 88，与校历事件准备块同档）
 *   · 没填节奏的目标不排（用户没说要怎么练，就不猜 —— 编号 10）
 */

/** 截止日所在周次（基于校历口径，与周计划页同一 `currentWeekNo`） */
function dueWeekOf(termStart: string, dueAt: string): number | null {
  const w = currentWeekNo(termStart, dueAt);
  return Number.isFinite(w) ? w : null;
}

const KIND_TO_BLOCK: Record<GoalKind, 'study' | 'activity'> = {
  contest: 'study', study: 'study', interest: 'activity', habit: 'activity',
};

const SPRINT_MIN_BY_WEEK_LEFT = [180, 120, 60]; // 剩 0/1/2 周时的冲刺时长

export function goalTasksOf(
  goals: readonly Goal[],
  weekNo: number,
  termStart: string,
): import('@/lib/planner/templates').UserTask[] {
  const out: import('@/lib/planner/templates').UserTask[] = [];
  for (const g of goals) {
    const blockKind = KIND_TO_BLOCK[g.kind];
    const weeksLeft = g.dueAt ? dueWeekOf(termStart, g.dueAt) : null;
    const left = weeksLeft == null ? null : weeksLeft - weekNo;

    // steady / both：每周固定投入
    if (g.pace === 'steady' || g.pace === 'both') {
      out.push({
        id: `goal-${g.id}-w${weekNo}`,
        title: g.title,
        emoji: g.emoji,
        kind: blockKind,
        category: 'custom',
        weeks: [weekNo],
        durationMin: 60,
        priority: 70,
        note: '你的目标 · 每周固定投入（在成就面板可改节奏）',
      });
    }

    // sprint / both：截止前冲刺，越临近强度越大
    if ((g.pace === 'sprint' || g.pace === 'both') && left != null && left >= 0 && left <= 2) {
      out.push({
        id: `goal-${g.id}-sprint-w${weekNo}`,
        title: `${g.title} · 冲刺`,
        emoji: '🔥',
        kind: blockKind,
        category: 'custom',
        weeks: [weekNo],
        durationMin: SPRINT_MIN_BY_WEEK_LEFT[left],
        priority: 80 + (2 - left) * 4,
        note: `距截止日还有 ${left === 0 ? '不到' : ''}${left + 1} 周 —— 冲刺投入`,
      });
    }
  }
  return out;
}
