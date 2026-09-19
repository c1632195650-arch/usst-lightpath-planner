/**
 * ActivityCapture —— 用途追问 / 手动补记（R4.2 / R5.2）
 * ============================================================
 * 两个场景共用这一个组件：
 *   · **声明之后**：用户说「周四下午别排」→ 问「这段时间干嘛去了？」
 *   · **事后补记**：用户主动说「昨天晚上做了三小时建模」
 *
 * ── 三条纪律 ─────────────────────────────────────────────────
 *   1. **一次点击就能记下**：先选「兴趣 / 长期目标 / 其它」，时长预填，可改可跳过。
 *   2. **绝不阻塞**：跳过就跳过，不影响刚才那次声明已经生效。
 *   3. **不双写**：这里只记「人把时间花在哪」，不碰 `behaviorLog` 的执行记录。
 *
 * 追问的价值在于**把空白变成信息** —— 「周四下午没排」默认是 Substituting
 * 引擎的一无所知；回答一次之后，未来的三四月就知道了。
 */
import { useState } from 'react';
import {
  entriesOfWeek, loadActivityLog, removeEntry, saveActivityLog, TAG_LABEL, upsertEntry,
  type ActivityEntry, type ActivityTag,
} from './activityStore';
import type { Goal } from './goalStore';

const TAGS: ActivityTag[] = ['interest', 'goal', 'other'];

export function ActivityCapture({
  weekNo, date, goals, title, minutes, forceOpen = false, onDone, onDismiss,
}: {
  weekNo: number;
  /** 要落到哪一天（ISO） */
  date: string;
  goals: readonly Goal[];
  /** 这一段的标题（追问场景：被声明的时段；补记场景：空，让用户填） */
  title?: string;
  /** 时长预填值（分钟） */
  minutes?: number;
  forceOpen?: boolean;
  onDone: (entry: ActivityEntry) => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(forceOpen);
  const [name, setName] = useState(title ?? '');
  const [min, setMin] = useState(minutes ?? 60);
  const [tag, setTag] = useState<ActivityTag>('interest');
  const [goalId, setGoalId] = useState(goals[0]?.id ?? '');

  const submit = () => {
    const entry: ActivityEntry = {
      id: `ac-${Date.now().toString(36)}`,
      date, weekNo,
      minutes: Math.max(1, Math.round(min)),
      title: name.trim() || '没说具体做什么',
      tag,
      ...(tag === 'goal' && goalId ? { goalId } : {}),
      source: 'occupied',
      at: new Date().toISOString(),
    };
    saveActivityLog(upsertEntry(loadActivityLog(), entry));
    onDone(entry);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-white px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
      >
        ＋ 记一笔
      </button>
    );
  }

  return (
    <div className="mt-1.5 rounded-md bg-teal-50 px-2.5 py-2 text-[11.5px] text-teal-900 ring-1 ring-teal-600/20">
      <p className="font-medium">这段时间打算干嘛？（答了一句，以后才排得准）</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="做了什么"
          className="min-w-0 flex-1 rounded border border-teal-300 bg-white px-1.5 py-0.5 text-[11.5px]"
        />
        <input
          type="number"
          min={10}
          max={600}
          step={10}
          value={min}
          onChange={(e) => setMin(Number(e.target.value))}
          className="w-16 rounded border border-teal-300 bg-white px-1.5 py-0.5 text-[11.5px]"
        />
        <span className="text-[11px]">分钟</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {TAGS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTag(t)}
            className={`rounded px-2 py-0.5 text-[11px] ${
              tag === t ? 'bg-teal-700 text-white' : 'bg-white text-teal-900 ring-1 ring-teal-300'
            }`}
          >
            {TAG_LABEL[t]}
          </button>
        ))}
        {tag === 'goal' && goals.length > 0 && (
          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            className="rounded border border-teal-300 bg-white px-1.5 py-0.5 text-[11.5px]"
          >
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.emoji} {g.title}</option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="rounded bg-teal-700 px-2.5 py-1 text-[11.5px] font-medium text-white"
        >
          记下
        </button>
        {/* 跳过必须能做得到 —— 追问不是门禁 */}
        <button
          type="button"
          onClick={() => { setOpen(false); onDismiss(); }}
          className="rounded px-2 py-0.5 text-[11px] text-teal-800/70"
        >
          跳过
        </button>
      </div>
    </div>
  );
}

/** 本周已登记的清单（能删 —— 记错了要能改回来） */
export function RecentActivityList({
  weekNo, onChanged,
}: {
  weekNo: number;
  onChanged: (next: ActivityEntry[]) => void;
}) {
  const list = entriesOfWeek(loadActivityLog(), weekNo);
  if (list.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {list.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-ink-soft">
          <span className="font-medium text-ink">{e.title}</span>
          <span>{e.minutes} 分钟</span>
          <span className="text-[10.5px] text-ink-faint">{TAG_LABEL[e.tag]}</span>
          <button
            type="button"
            onClick={() => {
              const next = removeEntry(loadActivityLog(), e.id);
              saveActivityLog(next);
              onChanged(next);
            }}
            className="rounded px-1 text-[10.5px] text-ink-faint hover:text-red-600"
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  );
}
