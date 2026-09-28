/**
 * 目标页 v2（设计书 §5 / §14 / §16 / §21）
 * ============================================================
 * 一句话输入 → 按类别分组的目标卡片 → 成就统计 → 补记 → 偏好。
 * 旧 GoalEditor 收进「详细编辑」折叠区（不删，兼容老字段编辑）。
 */
import { useState } from 'react';
import type { Schedule } from '@/types';
import { currentWeekNo, DAY_LABELS, todayISO, weekdayOf } from '@/lib/date';
import {
  loadGoals, saveGoals, makeGoalId,
  categoryOf, isSchedulable,
  type Goal, type GoalCategory, type GoalStatus,
  GOAL_CATEGORY_LABEL, GOAL_STATUS_LABEL,
} from './goalStore';
import { GoalEditor, AchievementPanel } from './GoalEditor';
import { ActivityCapture } from './ActivityCapture';
import { loadGoalPrefs, saveGoalPrefs, type GoalPrefs } from './goalPrefs';
import { GoalQuickInput } from './GoalQuickInput';
import { MilestoneTimeline } from './MilestoneTimeline';
import { WeeklyReviewCard } from './WeeklyReviewCard';
import { resolveSkeleton } from './resolveSkeleton';

const FOCUS_OPTIONS = [20, 30, 40, 60, 90];
const TIME_OPTIONS: Array<{ id: GoalPrefs['timeOfDay']; label: string }> = [
  { id: 'morning', label: '早上' }, { id: 'day', label: '白天' }, { id: 'evening', label: '晚上' },
];
const CATEGORIES: GoalCategory[] = ['contest', 'academic', 'skill', 'growth', 'health', 'social'];

const STATUS_STYLE: Record<GoalStatus, string> = {
  active: 'bg-green-100 text-green-800', paused: 'bg-amber-100 text-amber-800',
  done: 'bg-slate-100 text-slate-600', archived: 'bg-slate-50 text-slate-400',
};

const WILLINGNESS: Array<{ label: string; value: 4 | 3 | 2 }> = [
  { label: '尽量多排', value: 4 }, { label: '正常', value: 3 }, { label: '有空再说', value: 2 },
];

export function GoalsPage({ schedule }: { schedule: Schedule }) {
  const [goals, setGoals] = useState<Goal[]>(() => loadGoals());
  const [prefs, setPrefs] = useState<GoalPrefs>(() => loadGoalPrefs());
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [captureVersion, setCaptureVersion] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const weekNo = currentWeekNo(schedule.termStart);
  const todayDow = (() => { const d = weekdayOf(todayISO()); return d === 0 ? 7 : d; })();

  const handleGoalsChange = (next: Goal[]) => { saveGoals(next); setGoals(next); setCaptureVersion((v) => v + 1); };
  const patchGoal = (id: string, patch: Partial<Goal>) => {
    handleGoalsChange(goals.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };
  const patchPrefs = (patch: Partial<GoalPrefs>) => {
    const next = { ...prefs, ...patch }; saveGoalPrefs(next); setPrefs(next); setPrefsSaved(true);
  };
  const toggleFreeDay = (day: number) => {
    const has = prefs.freeDays.includes(day);
    patchPrefs({ freeDays: has ? prefs.freeDays.filter((d) => d !== day) : [...prefs.freeDays, day].sort() });
  };

  const active = goals.filter((g) => isSchedulable(g, todayISO()));
  const inactive = goals.filter((g) => !isSchedulable(g, todayISO()));

  return (
    <div className="space-y-4">

      {/* ── 一句话输入 ─────────────────────────────── */}
      <GoalQuickInput onConfirm={({ title, category }) => {
        const g: Goal = { id: makeGoalId(), title, emoji: '🎯', kind: 'study', category, source: 'manual' };
        handleGoalsChange([...goals, g]);
      }} />

      {/* ── 每周复盘 ───────────────────────────────── */}
      {active.map((g) => (
        <WeeklyReviewCard key={`rv-${g.id}`} goal={g} weekNo={weekNo}
          lastDone={null} lastTotal={90}
          onSave={(theme) => {
            patchGoal(g.id, { weekThemes: { ...g.weekThemes, [weekNo]: theme } });
          }}
          onSkip={() => patchGoal(g.id, { reviewMissed: [...(g.reviewMissed ?? []), weekNo] })}
        />
      ))}

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
                  <div key={g.id} className={`rounded-lg px-3 py-2.5 ring-1 ${st === 'active' ? 'bg-white ring-ink/10' : 'bg-slate-50 ring-ink/5'}`}>
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
                    {/* 展开：方向提示 / 里程碑 / 意愿 / 状态 */}
                    {isExp && (
                      <div className="mt-2 space-y-2 border-t border-ink/10 pt-2">
                        {/* 定向提示 */}
                        {!hasDirection && (
                          <div className="rounded bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                            这个目标还没定方向。可以先探索，也可以现在写一个方向或产出。
                            <input type="text" placeholder="比如：先学 Python 基础"
                              className="mt-1 w-full rounded border border-amber-200 px-2 py-1 text-[11px]"
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
                        {/* 里程碑 */}
                        {g.milestones && g.milestones.length > 0 && (
                          <div>
                            <div className="text-[11px] font-medium text-ink-soft">里程碑</div>
                            <MilestoneTimeline milestones={g.milestones}
                              onToggle={(mid) => {
                                const updated = g.milestones!.map((m) =>
                                  m.id === mid ? { ...m, done: !m.done, doneAt: !m.done ? todayISO() : undefined } : m);
                                patchGoal(g.id, { milestones: updated });
                              }} />
                          </div>
                        )}
                        {/* 意愿档位 */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-ink-faint">投入：</span>
                          {WILLINGNESS.map((w) => (
                            <button key={w.value} type="button"
                              onClick={() => patchGoal(g.id, { priority: w.value as 2 | 3 | 4 })}
                              className={`rounded px-2 py-0.5 text-[10.5px] ring-1 transition ${
                                (g.priority ?? 3) === w.value ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-ink-soft ring-ink/10'
                              }`}>{w.label}</button>
                          ))}
                        </div>
                        {/* 状态操作 */}
                        <div className="flex flex-wrap gap-1">
                          {st === 'active' && (
                            <button type="button" onClick={() => patchGoal(g.id, { status: 'paused' as GoalStatus })}
                              className="rounded bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-800">暂停</button>
                          )}
                          {st === 'paused' && (
                            <button type="button" onClick={() => patchGoal(g.id, { status: 'active' as GoalStatus })}
                              className="rounded bg-green-50 px-2 py-0.5 text-[10.5px] text-green-800">恢复</button>
                          )}
                          <button type="button" onClick={() => patchGoal(g.id, { status: 'archived' as GoalStatus })}
                            className="rounded bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600">归档</button>
                          <button type="button" onClick={() => handleGoalsChange(goals.filter((x) => x.id !== g.id))}
                            className="rounded bg-red-50 px-2 py-0.5 text-[10.5px] text-red-700">删除</button>
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
                  className="text-green-600 hover:underline">恢复</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 详细编辑（折叠，兼容老字段） ───────────── */}
      <div className="panel px-4 py-3 sm:px-5">
        <button type="button" onClick={() => setShowDetail(!showDetail)}
          className="text-[12px] text-ink-faint hover:text-ink">
          {showDetail ? '▲ 收起详细编辑' : '▼ 详细编辑（节奏 / 截止 / 总时长）'}
        </button>
        {showDetail && (
          <div className="mt-3">
            <GoalEditor goals={goals} onChange={handleGoalsChange} />
          </div>
        )}
      </div>

      {/* ── 成就统计 ───────────────────────────────── */}
      <div key={captureVersion}>
        <AchievementPanel weekNo={weekNo} termStart={schedule.termStart} />
      </div>

      {/* ── 活动补记 ───────────────────────────────── */}
      <div className="panel px-4 py-3.5 sm:px-5">
        <h3 className="text-[14px] font-semibold text-ink">活动补记</h3>
        <p className="mt-1 text-[12px] leading-5 text-ink-soft">
          事后补记已发生的投入。行为日志（behaviorLog）是只读历史，两者口径并列。
        </p>
        <div className="mt-3" key={captureVersion}>
          <ActivityCapture weekNo={weekNo} date={todayISO()} goals={goals}
            onDone={() => setCaptureVersion((v) => v + 1)}
            onDismiss={() => setCaptureVersion((v) => v + 1)} />
        </div>
      </div>

      {/* ── 目标偏好 ───────────────────────────────── */}
      <div className="panel px-4 py-3.5 sm:px-5">
        <h3 className="text-[14px] font-semibold text-ink">目标偏好</h3>
        <p className="mt-1 text-[12px] leading-5 text-ink-soft">
          改动下次「重新排一遍」生效。{prefsSaved && <span className="ml-1 text-green-700">已保存 ✓</span>}
        </p>
        <dl className="mt-3 space-y-3 text-[12px]">
          <div>
            <dt className="font-medium text-ink">每周有空的大块时间</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {DAY_LABELS.map((name, i) => {
                const day = i + 1; const act = prefs.freeDays.includes(day);
                return (<button key={day} type="button" onClick={() => toggleFreeDay(day)}
                  className={`rounded px-2 py-0.5 text-[11px] ring-1 transition ${act ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'}`}
                  aria-pressed={act}>{name}</button>);
              })}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">单次专注时长</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-1">
              {FOCUS_OPTIONS.map((m) => (
                <button key={m} type="button" onClick={() => patchPrefs({ focusMinutes: m })}
                  className={`rounded px-2 py-0.5 text-[11px] ring-1 transition ${prefs.focusMinutes === m ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'}`}
                  aria-pressed={prefs.focusMinutes === m}>{m} 分钟</button>
              ))}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">自主安排偏好时段</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-1">
              {TIME_OPTIONS.map((t) => (
                <button key={t.id} type="button" onClick={() => patchPrefs({ timeOfDay: t.id })}
                  className={`rounded px-2 py-0.5 text-[11px] ring-1 transition ${prefs.timeOfDay === t.id ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'}`}
                  aria-pressed={prefs.timeOfDay === t.id}>{t.label}</button>
              ))}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">习惯同时推进的目标数</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-1">
              {([1, 2, 3] as const).map((n) => (
                <button key={n} type="button" onClick={() => patchPrefs({ parallelCount: n })}
                  className={`rounded px-2 py-0.5 text-[11px] ring-1 transition ${prefs.parallelCount === n ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-ink-soft ring-ink/15 hover:bg-slate-50'}`}
                  aria-pressed={prefs.parallelCount === n}>{n} 个</button>
              ))}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
