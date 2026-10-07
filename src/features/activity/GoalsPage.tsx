/**
 * 目标页 v2（设计书 §5 / §14 / §16 / §21）
 * ============================================================
 * 一句话输入 → 按类别分组的目标卡片 → 成就统计 → 补记。
 * 🔴 2026-10-07 RAY 拍板精简：「详细编辑」折叠区（GoalEditor）与「目标偏好」面板删除——
 * 截止/总时长由一句话输入自动识别 + 经验值兜底（quickGoalParse），精力偏好走
 * 「我的画像 → ⚡ 精力高峰」，其余走 goalPrefs 缺省值（存储与引擎消费链保留）。
 */
import { useState } from 'react';
import type { Schedule } from '@/types';
import { currentWeekNo, todayISO, weekdayOf } from '@/lib/date';
import { Icon } from '@/components/icons/Icon';
import { AchievementPanel } from './GoalEditor';
import { GoalQuickInput } from './GoalQuickInput';
import { EXPERIENCE_HOURS, deadlineProximity } from './goalDecompose';
import { repairQuickGoal, suggestTotalHours } from './quickGoalParse';
import { DateSegmentInput } from './DateSegmentInput';
import { MilestoneTimeline } from './MilestoneTimeline';
import { GoalMonitor } from './GoalMonitor';
import { PriorityStrip } from './PriorityStrip';
import { orderGoalsByPriority } from './priorityOrder';
import { loadRecords, goalDebtByGoal } from '@/lib/behaviorLog';
import { resolveSkeleton } from './resolveSkeleton';import { EmptyState } from '@/components/ui/EmptyState';
import {
  loadGoals, saveGoals, makeGoalId,
  CATEGORY_TO_KIND,
  categoryOf, isSchedulable,
  type Goal, type GoalCategory, type GoalStatus,
  GOAL_CATEGORY_LABEL, GOAL_STATUS_LABEL,
} from './goalStore';

const CATEGORIES: GoalCategory[] = ['contest', 'academic', 'skill', 'growth', 'health', 'social'];

const STATUS_STYLE: Record<GoalStatus, string> = {
  active: 'bg-ok-light text-ok', paused: 'bg-warn-light text-warn-text',
  done: 'bg-sunken text-ink-soft', archived: 'bg-paper text-ink-faint',
};

export function GoalsPage({ schedule }: { schedule: Schedule }) {
  // 存量修补（2026-10-07）：解析上线前建的目标，标题带截止短语却缺 dueAt → 自动补全。
  // 有补全就落库（周计划的 goalsRef 读存储，不落库监测面板与排程会不同步）。
  const [goals, setGoals] = useState<Goal[]>(() => {
    const loaded = loadGoals();
    const repaired = loaded.map((g) => repairQuickGoal(g, todayISO(), EXPERIENCE_HOURS));
    if (repaired.some((g, i) => g !== loaded[i])) saveGoals(repaired);
    return repaired;
  });
  const [records] = useState(() => loadRecords());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);

  const weekNo = currentWeekNo(schedule.termStart);
  const todayDow = (() => { const d = weekdayOf(todayISO()); return d === 0 ? 7 : d; })();

  // 🔴 唯一落库通道（2026-10-07）：任何路径（快速输入/加一个/卡片操作）写入目标前
  //   都过一遍存量修补 —— 有截止解析器没接到的创建路径，落库时兜住（幂等：已补的
  //   目标原样通过）。否则新路径建的目标会重演「输入了截止日期却不生效」。
  const handleGoalsChange = (next: Goal[]) => {
    const repaired = next.map((g) => repairQuickGoal(g, todayISO(), EXPERIENCE_HOURS));
    saveGoals(repaired);
    setGoals(repaired);
  };
  const patchGoal = (id: string, patch: Partial<Goal>) => {
    handleGoalsChange(goals.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  const active = goals.filter((g) => isSchedulable(g, todayISO()));
  const inactive = goals.filter((g) => !isSchedulable(g, todayISO()));

  return (
    <div className="space-y-4">

      {/* ── 一句话输入 ─────────────────────────────── */}
      <GoalQuickInput onConfirm={({ title, category, dueAt }) => {
        // 2026-10-07：截止短语自动识别（quickGoalParse）—— 有截止才走「节奏分解」路径，
        // 总时长 = min(类型经验值, 剩余周数×3h)（suggestTotalHours，防「天天 2 小时」）
        const kind = CATEGORY_TO_KIND[category] ?? 'study';
        const g: Goal = {
          id: makeGoalId(), title, emoji: '🎯', kind, category, source: 'manual',
          ...(dueAt ? { dueAt, totalHours: suggestTotalHours(kind, dueAt, todayISO(), EXPERIENCE_HOURS) } : {}),
        };
        handleGoalsChange([...goals, g]);
      }} />

      {/* 🔴 「每周复盘」卡已删除（2026-10-07 RAY 拍板）：卡内「上周实际 90 分钟」是写死的
          假数据，收集的 weekThemes 引擎不消费——其客观职能已被周计划页的执行标记
          （✓做了/✗没做 + 实际用时 → adherence/顺延/估时自学）全面替代。
          宽泛目标的「方向输入」保留在下方目标卡展开区（本周主题/达成/子领域）。 */}

      {/* ── 空状态：一个目标都没有时的引导 ────────── */}
      {goals.length === 0 && (
        <div className="panel px-4 py-2 sm:px-5">
          <EmptyState
            icon="target"
            title="还没有目标"
            description="在上面输入一句话就能开始 —— 比如「考研初试」「学编程」「跑步 1km 跑进 3 分钟」。建完之后，分解出的任务会进周程。"
          />
        </div>
      )}

      {/* ── 长目标总览（可展开：点标题条展开全部活跃目标的监测面板，按优先级排序）── */}
      {goals.length > 0 && (
        <div className="panel px-4 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={() => setOverviewOpen(!overviewOpen)}
            aria-expanded={overviewOpen}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left"
          >
            <span className="text-[12px] font-medium text-ink">
              长目标总览：活跃 {active.length} 个
            </span>
            <span className="text-[11.5px] text-warn-text">
              临近截止（≤2 周）{active.filter((g) => g.dueAt && deadlineProximity(g, weekNo, schedule.termStart) >= 0.75).length} 个
            </span>
            <span className={`text-[11.5px] ${(goalDebtByGoal(records, weekNo - 1).size ?? 0) > 0 ? 'text-danger-text' : 'text-ink-faint'}`}>
              上周欠账目标 {goalDebtByGoal(records, weekNo - 1).size} 个
            </span>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-faint">
              {overviewOpen ? '收起' : '展开全部监测'}
              <Icon name="chevron-down" size="xs" className="chev shrink-0" />
            </span>
          </button>
          {overviewOpen && (
            <div className="mt-3 space-y-3 border-t border-ink/10 pt-3">
              {orderGoalsByPriority(active, weekNo, schedule.termStart).map((g, i) => (
                <div key={g.id} className="rounded-lg bg-paper px-3 py-2.5 ring-1 ring-ink/5">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    <span className="text-ink-faint">
                      {i === 0 ? <Icon name="trophy" size="xs" /> : `${i + 1}.`}
                    </span>
                    <span>{g.emoji}</span>
                    <span>{g.title}</span>
                  </div>
                  <div className="mt-1.5">
                    <GoalMonitor goal={g} records={records} weekNo={weekNo} termStart={schedule.termStart} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 长目标优先级（≥2 个活跃目标才出现）────────── */}
      {active.length >= 2 && (
        <div className="panel px-4 py-3.5 sm:px-5">
          <h3 className="text-[14px] font-semibold text-ink">目标优先级</h3>
          <p className="mt-1 text-[12px] leading-5 text-ink-soft">
            拖拽排序：<b className="text-ink">从左到右优先级依次减弱</b>。
            多目标争预算、超限降权排名都吃这个顺序 —— 下次「重新排一遍」生效。
          </p>
          <div className="mt-2">
            <PriorityStrip goals={active} weekNo={weekNo} termStart={schedule.termStart} onChange={handleGoalsChange} />
          </div>
        </div>
      )}

      {/* ── 按类别分组的目标卡片 ──────────────────── */}
      {CATEGORIES.map((cat) => {
        const catGoals = active.filter((g) => categoryOf(g) === cat);
        if (catGoals.length === 0) return null;
        return (
          <div key={cat} className="panel px-4 py-3.5 sm:px-5">
            <h3 className="text-[13px] font-semibold text-ink">{GOAL_CATEGORY_LABEL[cat]}</h3>
            <div className="mt-2 space-y-2">
              {catGoals.map((g) => {
                const st = g.status ?? 'active';
                const slots = resolveSkeleton(g);
                const hasDirection = !!g.achievement || !!g.subAreas?.length || !!g.weekThemes;
                const isExp = expandedId === g.id;
                return (
                  <div key={g.id} className={`rounded-lg px-3 py-2.5 ring-1 ${st === 'active' ? 'bg-white ring-ink/10' : 'bg-paper ring-ink/5'}`}>
                    {/* 行 1 · 标题 */}
                    <div className="flex items-center gap-2">
                      <span>{g.emoji}</span>
                      <span className="text-[13px] font-medium text-ink">{g.title}</span>
                      <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[st]}`}>{GOAL_STATUS_LABEL[st]}</span>
                      <button type="button" onClick={() => setExpandedId(isExp ? null : g.id)}
                        className="text-[12px] text-ink-faint hover:text-ink">{isExp ? '▲' : '▼'}</button>
                    </div>
                    {/* 行 2 · 信息摘要 */}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-faint">
                      {g.dueAt && <span>截止 {g.dueAt}</span>}
                      {g.totalHours && <span>{g.totalHours} h</span>}
                      {g.pace && <span>{g.pace === 'sprint' ? '冲刺' : g.pace === 'steady' ? '匀速' : '兼顾'}</span>}
                      {g.place && <span>@{g.place}</span>}
                    </div>
                    {/* 展开：长目标监测 / 定向提示 / 里程碑 / 意愿 / 状态 */}
                    {isExp && (
                      <div className="mt-2 space-y-2 border-t border-ink/10 pt-2">
                        {/* 长目标监测面板（临近度/总进度/本周需求vs完成/欠账/里程碑） */}
                        <GoalMonitor goal={g} records={records} weekNo={weekNo} termStart={schedule.termStart}
                          onToggleMilestone={(mid) => {
                            const updated = g.milestones!.map((m) =>
                              m.id === mid ? { ...m, done: !m.done, doneAt: !m.done ? todayISO() : undefined } : m);
                            patchGoal(g.id, { milestones: updated });
                          }} />
                        {/* 投入量滑块（2026-10-07 RAY：滑动调节总投入 —— 40h「排满」事故后的手动旋钮）。
                            只给有截止+总量的目标（宽泛目标走 Q4 定向，滑了也没意义）。
                            拖动即存；总进度分母、周需求都随之变化；排程下次「重新排一遍」生效。 */}
                        {g.dueAt && g.totalHours != null && (() => {
                          const dueWeek = currentWeekNo(schedule.termStart, g.dueAt);
                          const weeksLeft = Math.max(1, dueWeek - weekNo + 1);
                          const weeklyMin = Math.round((g.totalHours * 60) / weeksLeft);
                          return (
                            <div className="rounded bg-paper px-2.5 py-2 ring-1 ring-ink/5">
                              <div className="flex items-baseline justify-between text-[11px]">
                                <span className="text-ink-faint">总投入</span>
                                <span className="font-medium text-ink">{g.totalHours} 小时
                                  <span className="ml-1.5 text-[10px] font-normal text-ink-faint">≈ 每周 {weeklyMin} 分钟</span>
                                </span>
                              </div>
                              <input
                                type="range"
                                min={2}
                                max={40}
                                step={1}
                                value={g.totalHours}
                                onChange={(e) => patchGoal(g.id, { totalHours: Number(e.target.value) })}
                                className="mt-1.5 w-full accent-slate-800"
                                aria-label={`调节总投入：当前 ${g.totalHours} 小时`}
                              />
                              <div className="flex justify-between text-[10px] text-ink-faint">
                                <span>2h</span>
                                <span>拖动调节 · 下次「重新排一遍」生效</span>
                                <span>40h</span>
                              </div>
                            </div>
                          );
                        })()}
                        {/* 后补截止日期（2026-10-07 RAY：创建时没写截止的，之后要能补）。
                            分段输入：输完年份自动跳月、月份自动跳日（RAY 体验要求）。
                            补上 → 总量自动按「每周 3h 封顶」建议（suggestTotalHours）→ 走节奏分解。
                            已有截止的也能改/清（清 = 退回每周固定投入兜底）。 */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="text-ink-faint">截止日期：</span>
                          <DateSegmentInput
                            value={g.dueAt ?? ''}
                            ariaLabel="设定或修改截止日期"
                            onChange={(v) => {
                              if (!v) { patchGoal(g.id, { dueAt: undefined, totalHours: undefined }); return; }
                              const patch: Partial<Goal> = { dueAt: v };
                              if (g.totalHours == null) {
                                patch.totalHours = suggestTotalHours(g.kind ?? 'study', v, todayISO(), EXPERIENCE_HOURS);
                              }
                              patchGoal(g.id, patch);
                            }}
                          />
                          {!g.dueAt && (
                            <span className="text-[10px] text-ink-faint">
                              补上后自动按节奏分解进周计划（总时长按类型经验值封顶，可用下方滑块调）
                            </span>
                          )}
                          {g.dueAt && g.totalHours != null && (
                            <span className="text-[10px] text-ink-faint">改日期后总投入不变，用滑块调</span>
                          )}
                        </div>
                        {/* 定向提示 */}
                        {!hasDirection && (
                          <div className="rounded bg-warn-light px-2.5 py-1.5 text-[11px] text-warn-text">
                            这个目标还没定方向。可以先探索，也可以现在写一个方向或产出。
                            <input type="text" placeholder="比如：先学 Python 基础"
                              className="mt-1 w-full rounded border border-warn/25 px-2 py-1 text-[11px]"
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter' || !e.currentTarget.value.trim()) return;
                                const v = e.currentTarget.value.trim();
                                patchGoal(g.id, { weekThemes: { ...g.weekThemes, [weekNo]: { text: v, source: 'user', at: todayISO() } } });
                                e.currentTarget.value = '';
                              }} />
                          </div>
                        )}
                        {/* 周主题 */}
                        {g.weekThemes?.[weekNo] && (
                          <div className="text-[11px] text-ink-soft">
                            本周主题：<b>{g.weekThemes[weekNo].text}</b>
                          </div>
                        )}
                        {/* 🔴 意愿档位三按钮已删（2026-10-07 RAY 拍板）：优先级升级为
                            顶部「目标优先级」模块（拖拽排序，左高右低）—— 同一数据
                            （goal.priority），一处编辑，不再分散在每张卡里。 */}
                        {/* 状态操作 */}
                        <div className="flex flex-wrap gap-1">
                          {st === 'active' && (
                            <button type="button" onClick={() => patchGoal(g.id, { status: 'paused' as GoalStatus })}
                              className="rounded bg-warn-light px-2 py-0.5 text-[10.5px] text-warn-text">暂停</button>
                          )}
                          {st === 'paused' && (
                            <button type="button" onClick={() => patchGoal(g.id, { status: 'active' as GoalStatus })}
                              className="rounded bg-ok-light px-2 py-0.5 text-[10.5px] text-ok">恢复</button>
                          )}
                          <button type="button" onClick={() => patchGoal(g.id, { status: 'archived' as GoalStatus })}
                            className="rounded bg-sunken px-2 py-0.5 text-[10.5px] text-ink-soft">归档</button>
                          <button type="button" onClick={() => handleGoalsChange(goals.filter((x) => x.id !== g.id))}
                            className="rounded bg-danger-light px-2 py-0.5 text-[10.5px] text-danger-text">删除</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ── 非活跃目标（折叠） ─────────────────────── */}
      {inactive.length > 0 && (
        <div className="panel px-4 py-3 sm:px-5">
          <h3 className="text-[12px] font-medium text-ink-faint">已暂停 / 已达成 / 已归档（{inactive.length}）</h3>
          <div className="mt-1.5 space-y-1">
            {inactive.map((g) => (
              <div key={g.id} className="flex items-center gap-2 text-[11px] text-ink-faint">
                <span>{g.emoji}</span>
                <span className={g.status === 'done' ? 'line-through' : ''}>{g.title}</span>
                <span className="ml-auto">{GOAL_STATUS_LABEL[g.status ?? 'active']}</span>
                <button type="button" onClick={() => patchGoal(g.id, { status: 'active' as GoalStatus })}
                  className="text-ok hover:underline">恢复</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 成就统计（数据源 = behaviorLog 执行标记，2026-10-07 切换）── */}
      <AchievementPanel weekNo={weekNo} termStart={schedule.termStart} />

      {/* 🔴 「活动补记」（ActivityCapture）已删（2026-10-07 RAY「投入和成就没用上」）：
          手动补记零使用，真实投入已在周计划用 ✓做了 标记并自动累计到这里。
          周计划 SlotEditor 里的 ActivityCapture 入口保留（场景不同：加一件事）。 */}

      {/* 🔴 两块已删（2026-10-07 RAY 拍板「目标页的详细编辑 / 目标偏好没用了」）：
          · 「详细编辑（节奏/截止/总时长）」折叠区（GoalEditor）—— 截止/总时长现在由
            一句话输入自动识别 + 类型经验值兜底（quickGoalParse）；
          · 「目标偏好」面板（freeDays/专注时长/时段/并行数）—— G1 初步机制，精力偏好
            由「我的画像 → ⚡ 精力高峰」承接，其余走 goalPrefs 缺省值（存储与引擎消费链保留）。
          数据通道未动：dueAt/totalHours/pace 仍可经引擎侧消费（老数据照常读）。 */}
    </div>
  );
}
