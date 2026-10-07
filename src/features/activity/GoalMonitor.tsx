/**
 * 长目标监测面板（长计划增强计划书 · RAY：「长目标怎么安排的我要能看到」）
 * ============================================================
 * 引擎侧的长目标能力今天已经齐全：临近度预算增益（1.1）、注水公平分配（1.3）、
 * 里程碑切段（S5.5 v2）、adherence 校准（S5.5）、欠账顺延（2.1）、估时自学（2.2）
 * —— 但用户可见的只有周计划里几块卡。本组件把**同一份数据源**显式摆出来：
 *
 *   · 截止/剩余周数/临近度（`deadlineProximity` —— 与引擎同一函数，单一真相源）
 *   · 本周需求 vs 本周完成（`weeklyDemandMin` —— 注水法吃的就是这个数）
 *   · 总进度条（累计 done 计划时长 / 总时长）+ 真实用时（actualMin 口径）
 *   · 欠账（`goalDebtByGoal` 同口径）与连续欠账提示
 *   · 里程碑时间线（`MilestoneTimeline`，监测面板里只读；打勾走目标卡）
 *
 * 数据源 = `behaviorLog`（执行标记 T2.0 的产出）—— 不另设存储、不造第二份口径。
 */
import {
  goalDebtByGoal, goalDoneStats, loadRecords,
  type BehaviorRecord,
} from '@/lib/behaviorLog';
import { deadlineProximity, weeklyDemandMin } from './goalDecompose';
import { loadGoalPrefs } from './goalPrefs';
import { MilestoneTimeline } from './MilestoneTimeline';
import type { Goal } from './goalStore';

const Bar = ({ ratio, className }: { ratio: number; className: string }) => (
  <div className="h-1.5 w-full rounded bg-ink/10">
    <div className={`h-1.5 rounded ${className}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }} />
  </div>
);

/** ISO 日期 → 学期第几周（1-based）；与 objective.weekNoOfDate 同口径 */
function weekIndexOf(dateIso: string, termStart: string): number {
  const a = Date.parse(`${termStart}T00:00:00Z`);
  const b = Date.parse(`${dateIso}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.floor((b - a) / (7 * 86_400_000)) + 1;
}

export function GoalMonitor({ goal, records, weekNo, termStart, onToggleMilestone }: {
  goal: Goal;
  /** 行为记录（调用方 loadRecords() 一次传入，避免逐卡读存储） */
  records: readonly BehaviorRecord[];
  weekNo: number;
  termStart: string;
  /** 里程碑打勾（透传给 MilestoneTimeline；不给 = 只读展示） */
  onToggleMilestone?: (milestoneId: string) => void;
}) {
  const proximity = deadlineProximity(goal, weekNo, termStart);
  const demand = weeklyDemandMin(goal, weekNo, termStart, loadGoalPrefs(), null, null);
  const stats = goalDoneStats(records, goal.id, weekNo);
  const debt = weekNo - 1 >= 1 ? goalDebtByGoal(records, weekNo - 1).get(goal.id) ?? 0 : 0;
  const debtPrev = weekNo - 2 >= 1 ? goalDebtByGoal(records, weekNo - 2).get(goal.id) ?? 0 : 0;

  const totalMin = (goal.totalHours ?? 0) * 60;
  const hasBudget = !!goal.dueAt && !!goal.totalHours;
  const weeksLeft = goal.dueAt ? weekIndexOf(goal.dueAt, termStart) - weekNo : null;

  return (
    <div className="space-y-2">
      {/* 截止 / 剩余周数 / 临近度 */}
      {goal.dueAt && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            <span className="font-medium text-ink">截止 {goal.dueAt}</span>
            {weeksLeft != null && (
              <span className={weeksLeft <= 2 ? 'font-medium text-danger-text' : 'text-ink-soft'}>
                {weeksLeft <= 0 ? '本周到期' : `还剩 ${weeksLeft} 周`}
              </span>
            )}
            <span className="text-ink-faint">临近度 {Math.round(proximity * 100)}%</span>
          </div>
          <Bar ratio={proximity} className="bg-warn" />
        </div>
      )}

      {/* 总进度 */}
      {totalMin > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-ink-faint">总进度（共 {goal.totalHours}h）</span>
            <span className="font-medium text-ink">
              已完成 {Math.round((stats.totalDoneMin / 60) * 10) / 10}h
              {stats.totalActualMin > 0 && (
                <span className="ml-1 text-ink-faint">（真实用时 {Math.round((stats.totalActualMin / 60) * 10) / 10}h）</span>
              )}
            </span>
          </div>
          <Bar ratio={stats.totalDoneMin / totalMin} className="bg-brand" />
        </div>
      )}

      {/* 本周需求 vs 本周完成 */}
      {hasBudget && demand != null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
          <span className="text-ink-soft">
            本周计划 <b className="text-ink">{Math.round(demand)}</b> 分钟
            {proximity > 0.3 && <span className="ml-1 text-warn-text">（临近截止，预算已上调）</span>}
          </span>
          <span className={stats.weekDoneMin >= demand - 4 ? 'font-medium text-ok' : 'text-ink-soft'}>
            本周完成 {stats.weekDoneMin} 分钟
          </span>
        </div>
      )}
      {!hasBudget && (
        <div className="rounded bg-warn-light px-2 py-1 text-[10.5px] text-warn-text">
          这个目标还没有截止/总量，周计划里只排最小固定投入（Q4 定向周会引导你想方向）。
        </div>
      )}

      {/* 欠账 */}
      {debt > 0 && (
        <div className="rounded bg-danger-light px-2 py-1 text-[10.5px] text-danger-text">
          上周欠账 {debt} 次
          {debtPrev > 0 && ' · 连续两周欠账：建议调低档（延后截止 / 减少总时长）'}
          {stats.debtWeeks.length > 0 && <span className="ml-1 text-danger-text/70">（历史欠账周：第 {stats.debtWeeks.join('、')} 周）</span>}
        </div>
      )}

      {/* 里程碑（打勾透传给目标卡的状态通道） */}
      {goal.milestones && goal.milestones.length > 0 && (
        <MilestoneTimeline milestones={goal.milestones} onToggle={(mid) => onToggleMilestone?.(mid)} />
      )}
    </div>
  );
}
