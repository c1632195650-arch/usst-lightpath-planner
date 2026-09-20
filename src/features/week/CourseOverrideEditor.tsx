/**
 * 调课 / 停课（R3.1 / R3.3）
 * ============================================================
 * 老师说「这周停一次」「换到周五 5-6 节」—— 用户要能改。
 *
 * ── 三条语义（计划书 §二-5）──────────────────────────────────
 *   1. **默认只这周**：临时变动绝大多数只影响一次；长期要用户显式勾。
 *   2. **提交后给确认窗口**：勾了「以后都这样」才算长期，否则写一次性。
 *   3. **永不改导入的 `Schedule`**：这里只写覆盖记录，
 *      真正的变更由纯函数 `applyCourseOverrides()` 在排程时派生出来。
 *
 * ── 界面原则 ─────────────────────────────────────────────────
 * 已有记录列在上面，**每条都能单独撤销** —— 临时一学期调了七八次课，
 * 「哪次还在生效」必须一眼看得见，否则用户会以为自己的改动丢了。
 */
import { useMemo, useState } from 'react';
import type { Schedule } from '@/types';
import { MAX_PERIOD, periodEndMin, periodStartMin, toHHmm } from '@/constants/time';
import { DAY_NAME } from '@/lib/planner/construct';
import {
  addOverride, makeLayerId, removeOverride,
  type CourseOverride,
} from './userPlanStore';

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function CourseOverrideEditor({
  schedule, weekNo, overrides, onChange,
}: {
  schedule: Schedule;
  weekNo: number;
  overrides: readonly CourseOverride[];
  onChange: (next: CourseOverride[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState(schedule.courses[0]?.id ?? '');
  const [startPeriod, setStartPeriod] = useState(1);
  const [action, setAction] = useState<'cancel' | 'move'>('cancel');
  const [longTerm, setLongTerm] = useState(false);
  const [newDay, setNewDay] = useState(1);
  const [newStartPeriod, setNewStartPeriod] = useState(5);
  const [newEndPeriod, setNewEndPeriod] = useState(6);

  const course = useMemo(
    () => schedule.courses.find((c) => c.id === courseId) ?? null,
    [schedule.courses, courseId],
  );
  /** 这门课在这一周实际有哪几节 —— 只让用户改「存在的节」，避免悬空记录 */
  const activeSlots = useMemo(() => {
    if (!course) return [];
    return course.slots.filter(
      (s) => !s.weeks?.length || s.weeks.includes(weekNo),
    );
  }, [course, weekNo]);

  const mine = overrides.filter((o) => o.weekNo === weekNo || o.weekNo === null);

  const submit = () => {
    if (!course) return;
    const base = {
      id: makeLayerId('ov'),
      courseId: course.id,
      startPeriod,
      weekNo: longTerm ? null : weekNo,
      createdAtWeek: weekNo,
    };
    if (action === 'cancel') {
      onChange(addOverride(overrides, { ...base, action: 'cancel' }));
    } else {
      onChange(addOverride(overrides, {
        ...base,
        action: 'move',
        newDay,
        newStartMin: periodStartMin(newStartPeriod),
        newEndMin: periodEndMin(newEndPeriod),
      }));
    }
    setOpen(false);
  };

  const canSubmit = Boolean(course) && activeSlots.some((s) => s.startPeriod === startPeriod);

  return (
    <div className="panel px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[14px] font-semibold text-ink">调课 / 停课</h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-white px-2.5 py-1 text-[11.5px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
        >
          {open ? '收起' : '＋ 记一次'}
        </button>
      </div>

      {!open && mine.length === 0 && (
        <p className="mt-1.5 text-[11.5px] text-ink-faint">
          老师临时停课 / 换教室 / 调课，在这里记一笔 —— 原始课表不会被改，随时可撤销。
        </p>
      )}

      {/* 已生效的记录 —— 每条都能单独撤销（「哪次还在生效」必须一眼看得见） */}
      {mine.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {mine.map((o) => {
            const c = schedule.courses.find((x) => x.id === o.courseId);
            return (
              <li
                key={o.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11.5px] text-ink-soft"
              >
                <span className="font-medium text-ink">{c?.name ?? o.courseId}</span>
                <span>
                  {o.action === 'cancel' ? '停课' : `调到 ${DAY_LABELS[(o.newDay ?? 1) - 1]} ${toHHmm(o.newStartMin ?? 0)}`}
                </span>
                <span className="text-[10.5px] text-ink-faint">第{o.startPeriod}节</span>
                <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${
                  o.weekNo === null ? 'bg-indigo-100 text-indigo-800' : 'bg-white text-ink-faint ring-1 ring-ink/15'
                }`}>
                  {o.weekNo === null ? '长期' : `第 ${o.weekNo} 周`}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(removeOverride(overrides, o.id))}
                  className="rounded bg-white px-1.5 py-0.5 text-[10.5px] text-ink-faint ring-1 ring-ink/15 hover:text-brand"
                >
                  撤销
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-ink/10 bg-white/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="shrink-0">课程</span>
            <select
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                const c = schedule.courses.find((x) => x.id === e.target.value);
                const first = c?.slots.find((s) => !s.weeks?.length || s.weeks.includes(weekNo));
                if (first) {
                  setStartPeriod(first.startPeriod);
                  setNewDay(first.dayOfWeek);
                }
              }}
              className="min-w-0 flex-1 rounded border border-ink/20 bg-white px-1.5 py-0.5"
            >
              {schedule.courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="shrink-0">哪一节</span>
            <select
              value={startPeriod}
              onChange={(e) => setStartPeriod(Number(e.target.value))}
              className="rounded border border-ink/20 bg-white px-1.5 py-0.5"
            >
              {activeSlots.map((s) => (
                <option key={`${s.dayOfWeek}-${s.startPeriod}`} value={s.startPeriod}>
                  {DAY_NAME[s.dayOfWeek] ?? `周${s.dayOfWeek}`} 第{s.startPeriod}–{s.endPeriod}节
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="shrink-0">改法</span>
            <button
              type="button"
              onClick={() => setAction('cancel')}
              className={`rounded px-2 py-0.5 ${action === 'cancel' ? 'bg-slate-800 text-white' : 'bg-white text-ink-soft ring-1 ring-ink/20'}`}
            >
              停课（不排）
            </button>
            <button
              type="button"
              onClick={() => setAction('move')}
              className={`rounded px-2 py-0.5 ${action === 'move' ? 'bg-slate-800 text-white' : 'bg-white text-ink-soft ring-1 ring-ink/20'}`}
            >
              调课（换时间）
            </button>
          </div>

          {action === 'move' && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="shrink-0">调到</span>
              <select
                value={newDay}
                onChange={(e) => setNewDay(Number(e.target.value))}
                className="rounded border border-ink/20 bg-white px-1.5 py-0.5"
              >
                {DAY_LABELS.map((n, i) => (
                  <option key={n} value={i + 1}>{n}</option>
                ))}
              </select>
              <select
                value={newStartPeriod}
                onChange={(e) => setNewStartPeriod(Number(e.target.value))}
                className="rounded border border-ink/20 bg-white px-1.5 py-0.5"
              >
                {Array.from({ length: MAX_PERIOD }, (_, i) => i + 1).map((p) => (
                  <option key={p} value={p}>第{p}节起</option>
                ))}
              </select>
              <select
                value={newEndPeriod}
                onChange={(e) => setNewEndPeriod(Number(e.target.value))}
                className="rounded border border-ink/20 bg-white px-1.5 py-0.5"
              >
                {Array.from({ length: MAX_PERIOD }, (_, i) => i + 1).filter((p) => p >= newStartPeriod).map((p) => (
                  <option key={p} value={p}>到第{p}节</option>
                ))}
              </select>
            </div>
          )}

          {/* R3.3：**默认只这周**，长期要用户显式勾 —— 临时变动绝大多数只影响一次 */}
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
            <input
              type="checkbox"
              checked={longTerm}
              onChange={(e) => setLongTerm(e.target.checked)}
            />
            以后都这样（长期）—— 不勾就只影响第 {weekNo} 周
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded bg-slate-800 px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-40"
            >
              记下（点「重新排一遍」生效）
            </button>
            {!canSubmit && (
              <span className="text-[11px] text-ink-faint">这门课这周没有可选的节次</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
