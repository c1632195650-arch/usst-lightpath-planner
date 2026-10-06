/**
 * 网页端待办工作区 · 目标面板（任务四 W1-P1-2）
 * ============================================================
 * 目标（1-3 个）→ 里程碑 → 待办 三级结构：目标可挂里程碑（勾选推进）、
 * 可写 why（价值观锚定）、可看挂在该目标下的待办。归档而非删除。
 */
import { useState } from 'react';
import type { Goal, Todo } from '@/features/mobile/lib/memoTypes.ts';

export interface GoalPanelProps {
  goals: readonly Goal[];
  todos: readonly Todo[];
  canAdd: boolean;
  onAddGoal: (title: string, why?: string) => void;
  onAddMilestone: (goalId: string, title: string) => void;
  onToggleMilestone: (goalId: string, milestoneId: string) => void;
  onArchiveGoal: (goalId: string) => void;
}

export default function GoalPanel({
  goals, todos, canAdd, onAddGoal, onAddMilestone, onToggleMilestone, onArchiveGoal,
}: GoalPanelProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [msTitle, setMsTitle] = useState<Record<string, string>>({});
  const active = goals.filter((g) => !g.archived);

  return (
    <section className="panel p-4" data-testid="goal-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">目标</h3>
        {canAdd && !adding && (
          <button
            type="button"
            data-testid="goal-add"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-ink-soft ring-1 ring-ink/15 hover:bg-paper"
          >
            + 新目标
          </button>
        )}
      </div>
      {!canAdd && (
        <p className="mt-1 text-[11px] text-ink-faint">最多同时推进 3 个目标 —— 先完成或归档一个。</p>
      )}

      {adding && (
        <div className="mt-3 rounded-xl border border-ink/10 bg-paper p-3" data-testid="goal-form">
          <input
            data-testid="goal-form-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="目标（如：这学期把算法基础打牢）"
            maxLength={80}
            className="w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-ink/40"
          />
          <input
            data-testid="goal-form-why"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="为什么重要？（可空 —— 写给未来的自己）"
            maxLength={120}
            className="mt-2 w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-ink/40"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-3 py-1 text-[12px] text-ink-soft ring-1 ring-ink/15 transition-colors hover:bg-paper">取消</button>
            <button
              type="button"
              data-testid="goal-form-submit"
              disabled={!title.trim()}
              onClick={() => { onAddGoal(title.trim(), why.trim() || undefined); setTitle(''); setWhy(''); setAdding(false); }}
              className="button-primary px-3 py-1 text-[12px] disabled:opacity-40"
            >
              添加
            </button>
          </div>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {active.map((g) => {
          const linked = todos.filter((t) => t.goalId === g.id && !t.archived);
          const open = linked.filter((t) => t.completion !== 'done');
          return (
            <li key={g.id} data-testid={`goal-item-${g.id}`} className="rounded-xl border border-ink/[0.07] bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-5 text-ink">{g.title}</p>
                  {g.why && <p className="mt-0.5 text-[11px] leading-4 text-ink-faint">因为：{g.why}</p>}
                </div>
                <button
                  type="button"
                  data-testid={`goal-archive-${g.id}`}
                  onClick={() => onArchiveGoal(g.id)}
                  className="shrink-0 rounded-lg px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-paper"
                >
                  归档
                </button>
              </div>

              <ul className="mt-2 space-y-1">
                {(g.milestones ?? []).map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      data-testid={`goal-ms-check-${g.id}-${m.id}`}
                      checked={m.done}
                      onChange={() => onToggleMilestone(g.id, m.id)}
                      className="h-3.5 w-3.5 accent-slate-800"
                      aria-label={`里程碑：${m.title}`}
                    />
                    <span className={`text-[12px] ${m.done ? 'text-ink-faint line-through' : 'text-ink-soft'}`}>{m.title}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1.5">
                <input
                  data-testid={`goal-ms-input-${g.id}`}
                  value={msTitle[g.id] ?? ''}
                  onChange={(e) => setMsTitle((prev) => ({ ...prev, [g.id]: e.target.value }))}
                  placeholder="加一个里程碑"
                  maxLength={60}
                  className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-paper px-2 py-1 text-[12px] outline-none focus:border-ink/30"
                />
                <button
                  type="button"
                  data-testid={`goal-ms-add-${g.id}`}
                  disabled={!(msTitle[g.id] ?? '').trim()}
                  onClick={() => {
                    const t = (msTitle[g.id] ?? '').trim();
                    if (!t) return;
                    onAddMilestone(g.id, t);
                    setMsTitle((prev) => ({ ...prev, [g.id]: '' }));
                  }}
                  className="rounded-lg bg-paper px-2.5 py-1 text-[11px] font-medium text-ink-soft ring-1 ring-ink/10 disabled:opacity-40"
                >
                  加
                </button>
              </div>
              {linked.length > 0 && (
                <p className="mt-2 text-[11px] text-ink-faint" data-testid={`goal-linked-${g.id}`}>
                  待办 {open.length} 件未完成 / 共 {linked.length} 件挂在这个目标下
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
