/**
 * 里程碑时间轴（设计书 §14.2）
 * ============================================================
 * 显示 `Goal.milestones` 的时间轴，可勾选 `done`。
 * **勾选不影响排程** —— `done` 是记录，不是控制信号。
 * `evidence` 是可核对的达成状态（"能不看谱弹前奏"）。
 * `milestones` 为空时不渲染任何内容。
 */
import type { GoalMilestone } from './goalStore';

export function MilestoneTimeline({
  milestones, onToggle,
}: {
  milestones: GoalMilestone[];
  onToggle: (milestoneId: string) => void;
}) {
  if (milestones.length === 0) return null;
  const sorted = [...milestones].sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  return (
    <div className="mt-2 space-y-1">
      {sorted.map((m, i) => (
        <button key={m.id} type="button"
          onClick={() => onToggle(m.id)}
          className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[11.5px] transition ${
            m.done ? 'bg-ok-light text-ok' : 'bg-paper text-ink-soft hover:bg-sunken'
          }`}>
          <span className="mr-1.5 font-mono text-[10px] text-ink-faint">{m.dueAt.slice(5)}</span>
          <span className={m.done ? 'line-through opacity-60' : ''}>{m.title}</span>
          {m.evidence && <span className="ml-1 text-[10px] text-ink-faint">· {m.evidence}</span>}
          {m.done && <span className="ml-1 text-ok">✓</span>}
        </button>
      ))}
    </div>
  );
}
