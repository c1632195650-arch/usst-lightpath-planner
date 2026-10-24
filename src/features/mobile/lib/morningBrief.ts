/**
 * morningBrief —— 今日晨报纯函数（F5·C1，2026-10-24）
 * ============================================================
 * 设计（技术方案 F5 行，路线锁定：本地拼装骨架、零 LLM、离线可用）：
 *   · **纯函数**：数据全由调用方注入（blocksToday/todos/goals/nowMin/dateKey），
 *     Node 单测直跑，不碰通知、不碰存储；
 *   · **诚实纪律**：没有安排就说没有；warnings 宁缺毋滥（≤3 条）；
 *   · **deadline 信号源申报**（kickoff）：goal/todo 契约**无 dueAt 字段**（recon 实证），
 *     v1 走可选 `deadlines` 输入（调用侧接 deadlineStore 重要日），契约扩展留后续批。
 */
import type { TimeBlock } from '@/types';
import type { Goal, Todo } from './memoTypes';
import { fmtMin } from './sync.ts';
import { diffDays } from '@/lib/date';

/** 截止类信号（调用侧组装：今天=deadlineStore 重要日 / 目标里程碑等） */
export interface BriefDeadline {
  id: string;
  title: string;
  /** ISO 日期（yyyy-mm-dd） */
  dueISO: string;
  /** 已办结的不再提醒 */
  done?: boolean;
}

export interface MorningBrief {
  title: string;
  lines: string[];
  /** 临近/逾期提醒（≤3 条，宁缺毋滥） */
  warnings: string[];
}

/** 临近窗口：3 天内（含今天）提醒，逾期也如实说（不静默） */
export const WARN_WINDOW_DAYS = 3;

export function morningBrief(input: {
  blocksToday: readonly TimeBlock[];
  todos: readonly Todo[];
  goals: readonly Goal[];
  nowMin: number;
  dateKey: string;
  deadlines?: readonly BriefDeadline[];
}): MorningBrief {
  const { blocksToday, todos, goals, dateKey, deadlines } = input;
  const sorted = [...blocksToday].sort((a, b) => a.startMin - b.startMin);

  // 标题：今天 N 个安排 + 第一件（一眼知道节奏）
  const first = sorted[0];
  const title = sorted.length === 0
    ? '今天没有排好的安排'
    : `今天 ${sorted.length} 个安排${first ? `，第一件 ${fmtMin(first.startMin)} ${(first.emoji ?? '') + first.title}` : ''}`;

  // 正文：前 3 块的时刻表 + 余量 + 目标概况（todos 的今日视图由块回显承担，不重复）
  const lines: string[] = [];
  for (const b of sorted.slice(0, 3)) {
    lines.push(`${fmtMin(b.startMin)}–${fmtMin(b.endMin)} ${(b.emoji ?? '') + b.title}${b.place ? ` · ${b.place}` : ''}`);
  }
  if (sorted.length > 3) lines.push(`还有 ${sorted.length - 3} 件（周计划页看全）`);
  const activeGoals = goals.filter((g) => !g.archived);
  const activeTodos = todos.filter((t) => !t.archived);
  if (activeGoals.length > 0) lines.push(`${activeGoals.length} 个目标进行中 · 待办 ${activeTodos.length} 条`);

  // 提醒：72h 内且未办结的 deadline（逾期也报），按紧迫排序，≤3
  const warnings: string[] = [];
  const due = (deadlines ?? [])
    .filter((d) => !d.done && d.dueISO)
    .map((d) => ({ ...d, days: diffDays(d.dueISO, dateKey) })) // 正数 = 已过期
    .filter((d) => d.days >= -WARN_WINDOW_DAYS)
    .sort((a, b) => b.days - a.days);
  for (const d of due.slice(0, 3)) {
    warnings.push(d.days > 0
      ? `「${d.title}」已过截止 ${d.days} 天`
      : d.days === 0
        ? `「${d.title}」今天截止`
        : `「${d.title}」还剩 ${-d.days} 天截止`);
  }

  return { title, lines, warnings };
}
