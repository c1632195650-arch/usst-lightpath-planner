/**
 * 不可时段声明（R4.1）
 * ============================================================
 * 「周五下午有课不会发生？实习？」
 *
 * ── 三条设计取舍 ──────────────────────────────────────────────
 *   1. **同一个星期可以有多条**：「周四下午别排」+「周五上午别排」两条并存，
 *      重叠部分取并集（引擎侧 `applyUnavailableSlots` 天然支持）。
 *   2. **默认只这周**，勾了「每周都这样」才长期 ——
 *      长期规则**只影响创建之后的周次**（读法 A，靠 `createdAtWeek`）。
 *   3. **声明完问一句用途**（R4.2），但**跳过不被阻塞**。
 *
 * ⚠️ 长期与否由 `detectScope()` 一处判定属于**语言输入**那条路径；
 *    这里是手动表单，勾选框本身就是明确信号，不需要再判定一次。
 */
import { useState } from 'react';
import { humanizeMinutes } from '@/constants/time';
import { TimeWheelPicker } from './TimeWheelPicker';
import { ActivityCapture } from '../activity/ActivityCapture';
import type { Goal } from '../activity/goalStore';
import { addSlot, makeLayerId, removeSlot, type UnavailableSlot } from './userPlanStore';

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function SlotEditor({
  weekNo, slots, overridesVersion = 0, goals, mondayISO, onChange,
}: {
  weekNo: number;
  slots: readonly UnavailableSlot[];
  overridesVersion?: number;
  goals: readonly Goal[];
  /** 本周周一的 ISO 日期（补记时长要落到具体哪一天） */
  mondayISO: string;
  onChange: (next: UnavailableSlot[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(4);
  const [from, setFrom] = useState('14:00');
  const [to, setTo] = useState('17:00');
  const [title, setTitle] = useState('');
  const [longTerm, setLongTerm] = useState(false);
  /** R4.2：刚声明完的那条 —— 挂用途追问（可跳过） */
  const [justAdded, setJustAdded] = useState<UnavailableSlot | null>(null);

  const minutesOf = (hhmm: string) => {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec((hhmm ?? '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };

  const submit = () => {
    const fromMin = minutesOf(from);
    const toMin = minutesOf(to);
    if (toMin <= fromMin) return;
    const slot: UnavailableSlot = {
      id: makeLayerId('slot'),
      days: [day],
      fromMin,
      toMin,
      weeks: longTerm ? [] : [weekNo],
      scope: longTerm ? 'long' : 'once',
      createdAtWeek: weekNo,
      ...(title.trim() ? { title: title.trim() } : {}),
    };
    onChange(addSlot(slots, slot));
    setJustAdded(slot);
    setTitle('');
  };

  return (
    <div className="panel px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[14px] font-semibold text-ink">这段时间别排</h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-white px-2.5 py-1 text-[11.5px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
        >
          {open ? '收起' : '＋ 声明'}
        </button>
      </div>

      {slots.length === 0 && !open && (
        <p className="mt-1.5 text-[11.5px] text-ink-faint">
          固定开会、实习、选修实验……说了这条时段，引擎就绕开它。
        </p>
      )}

      {/* 多条并存：这就是 R4 的核心 —— 两次声明互不覆盖 */}
      <ul className="mt-2 space-y-1.5">
        {slots.map((s) => (
          <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11.5px] text-ink-soft">
            <span className="font-medium text-ink">
              {s.title || '不排'}
            </span>
            <span>
              {s.days.map((d) => DAY_LABELS[d - 1]).join('、')} {humanizeMinutes(s.fromMin)}–{humanizeMinutes(s.toMin)}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${
              s.scope === 'long' ? 'bg-indigo-100 text-indigo-800' : 'bg-white text-ink-faint ring-1 ring-ink/15'
            }`}>
              {s.scope === 'long'
                ? `第 ${s.createdAtWeek} 周起（长期）`
                : `第 ${(s.weeks[0] ?? weekNo)} 周`}
            </span>
            <button
              type="button"
              onClick={() => onChange(removeSlot(slots, s.id))}
              className="rounded px-1.5 text-[10.5px] text-ink-faint hover:text-red-600"
            >
              撤销
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div className="mt-2 space-y-1.5 rounded-md border border-ink/10 bg-white/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="shrink-0">星期</span>
            <select
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              className="rounded border border-ink/20 bg-white px-1.5 py-0.5"
            >
              {DAY_LABELS.map((n, i) => (
                <option key={n} value={i + 1}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px]">从</span>
            <TimeWheelPicker value={from} onChange={setFrom} step={30} />
            <span className="text-[11.5px]">到</span>
            <TimeWheelPicker value={to} onChange={setTo} step={30} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="shrink-0">备注</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="比如：实习 / 固定开会（可不填）"
              className="min-w-0 flex-1 rounded border border-ink/20 bg-white px-1.5 py-0.5 text-[11.5px]"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
            <input type="checkbox" checked={longTerm} onChange={(e) => setLongTerm(e.target.checked)} />
            每周都这样（长期）—— 不勾就只影响第 {weekNo} 周
          </label>
          <button
            type="button"
            onClick={submit}
            className="rounded bg-slate-800 px-2.5 py-1 text-[11.5px] font-medium text-white"
          >
            记下（点「重新排一遍」生效）
          </button>
        </div>
      )}

      {/* R4.2：用途追问 —— 跳过完全不影响刚才的声明（声明已经生效了） */}
      {justAdded && (
        <div className="mt-2">
          <ActivityCapture
            weekNo={weekNo}
            date={mondayISO}
            goals={goals}
            title={justAdded.title ?? '这段时间别排'}
            minutes={justAdded.toMin - justAdded.fromMin}
            forceOpen
            onDone={() => setJustAdded(null)}
            onDismiss={() => setJustAdded(null)}
          />
        </div>
      )}
    </div>
  );
}
