/**
 * 加一件事（阶段 A）
 * ============================================================
 * 让用户能往周计划里加自己的事 —— 这是「排程可二次修改」的第一块拼图。
 *
 * ── 为什么这件事成本很低 ─────────────────────────────────────
 * 引擎侧早就有一条成熟的 `UserTask` 通道（`lib/planner/templates.ts`）：
 * 支持指定星期、开始时间、时长、地点、生效周次、优先级、`essential` 独立预算。
 * 缺的只是**界面上没有入口** —— 周程页此前只往 `tasks` 里塞校历事件和天气，
 * 用户自己输入的东西从来进不去。
 *
 * ── 一个刻意的选择：指定了「星期 + 时间」= 固定块 ──────────────
 * `construct` 的判定是：`dayOfWeek != null && startMin != null` → **固定块**
 * （重排时不动，属 hard）；只给时长不给时间 → 浮动块，交给引擎找空档。
 * 这与「用户说几点就是几点」的直觉一致，所以表单里两者都给了。
 */
import { useState } from 'react';
import type { BlockKind, DayOfWeek } from '@/types';
import type { UserTask } from '@/lib/planner/templates';
import { makeTaskId } from './planEditsStore';
import { TimeWheelPicker } from './TimeWheelPicker';
import { toMinutes } from '@/constants/time';

const DAY_OPTIONS: Array<{ d: DayOfWeek; label: string }> = [
  { d: 1, label: '周一' }, { d: 2, label: '周二' }, { d: 3, label: '周三' },
  { d: 4, label: '周四' }, { d: 5, label: '周五' }, { d: 6, label: '周六' }, { d: 7, label: '周日' },
];

const KIND_OPTIONS: Array<{ k: BlockKind; label: string }> = [
  { k: 'activity', label: '活动' },
  { k: 'study', label: '自习' },
  { k: 'meal', label: '用餐' },
];

interface Props {
  onAdd: (task: UserTask) => void;
  /** 当前周次（写进 `weeks`，让这件事只在本周生效） */
  weekNo: number;
}

export function AddTaskPanel({ onAdd, weekNo }: Props) {
  const [title, setTitle] = useState('');
  const [day, setDay] = useState<DayOfWeek | ''>('');
  const [start, setStart] = useState('19:00');
  const [duration, setDuration] = useState(60);
  const [kind, setKind] = useState<BlockKind>('activity');
  const [place, setPlace] = useState('');
  const [thisWeekOnly, setThisWeekOnly] = useState(true);

  const canSubmit = title.trim().length > 0 && (day === '' || !!start);

  function submit() {
    if (!canSubmit) return;
    const task: UserTask = {
      id: makeTaskId(),
      title: title.trim(),
      kind,
      // 给了星期就顺带给时间 → 固定块；只给星期不给时间也没意义，故二者绑定
      ...(day !== '' ? { dayOfWeek: day, startMin: toMinutes(start) } : {}),
      durationMin: duration,
      ...(place.trim() ? { place: place.trim() } : {}),
      ...(thisWeekOnly ? { weeks: [weekNo] } : {}),
      // 用户自己加的事，优先级高于系统建议（与校历事件同档）
      priority: 80,
      note: '你自己加的一件事',
    };
    onAdd(task);
    setTitle(''); setPlace(''); setDay(''); 
  }

  return (
    <div className="panel px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-[13.5px] font-semibold text-ink">加一件事</h3>
        <span className="text-[11.5px] text-ink-faint">
          自己安排的事，引擎会照办；不选星期就交给它找空档
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="做什么？（例：做实验报告）"
          className="min-w-[10rem] flex-1 rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand"
        />
        <select
          value={day}
          onChange={(e) => setDay(e.target.value === '' ? '' : (Number(e.target.value) as DayOfWeek))}
          className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-[12.5px] text-ink"
        >
          <option value="">交给引擎找空档</option>
          {DAY_OPTIONS.map(({ d, label }) => <option key={d} value={d}>{label}</option>)}
        </select>

        {day !== '' && (
          <>
            {/* T7：滚轮选时间（旁边仍保留手动输入框） */}
            <TimeWheelPicker value={start} onChange={setStart} />
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
              className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-[12.5px] text-ink">
              {[15, 30, 45, 60, 90, 120, 150, 180].map((m) => (
                <option key={m} value={m}>{m} 分钟</option>
              ))}
            </select>
          </>
        )}

        <select value={kind} onChange={(e) => setKind(e.target.value as BlockKind)}
          className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-[12.5px] text-ink">
          {KIND_OPTIONS.map(({ k, label }) => <option key={k} value={k}>{label}</option>)}
        </select>

        <input
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="地点（可选）"
          className="w-32 rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand"
        />

        <label className="flex items-center gap-1 text-[11.5px] text-ink-soft">
          <input type="checkbox" checked={thisWeekOnly} onChange={(e) => setThisWeekOnly(e.target.checked)} />
          只本周
        </label>

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
        >
          加进去
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-ink-faint">
        选了星期和时间 → 它会被**钉住**，之后重排也不会挪；只填标题 → 引擎自己找空档塞进去。
      </p>
    </div>
  );
}
