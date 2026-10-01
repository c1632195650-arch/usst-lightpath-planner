/**
 * 目标偏好采集（2026-09-20，G1）
 * ============================================================
 * 问卷末尾的「目标偏好」附加组（4 题）—— 用户拍板放画像完成前收集。
 *
 * 数据走独立 `goalPrefs` 存储（**不进 PersonaProfile**，types.ts 零改动）：
 *   ①每周哪几天有空  ②单次专注时长（覆盖 40min 块长基准）
 *   ③早晚偏好        ④同时推进几个目标（并行折扣）
 * 「跳过」用默认值（不纠缠，弹窗纪律同 D6）。
 */
import { useState } from 'react';
import { DEFAULT_GOAL_PREFS, saveGoalPrefs, type GoalPrefs } from './goalPrefs';

const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const FOCUS_OPTIONS = [45, 60, 90, 120] as const;

export function GoalPrefsAsk({ onDone }: { onDone: (skipped: boolean) => void }) {
  const [freeDays, setFreeDays] = useState<number[]>(DEFAULT_GOAL_PREFS.freeDays);
  const [focusMinutes, setFocusMinutes] = useState<number>(DEFAULT_GOAL_PREFS.focusMinutes);
  const [timeOfDay, setTimeOfDay] = useState<GoalPrefs['timeOfDay']>(DEFAULT_GOAL_PREFS.timeOfDay);
  const [parallelCount, setParallelCount] = useState<GoalPrefs['parallelCount']>(1);

  const toggleDay = (d: number) => {
    setFreeDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const save = () => {
    saveGoalPrefs({
      freeDays: freeDays.length > 0 ? freeDays : [...DEFAULT_GOAL_PREFS.freeDays],
      focusMinutes,
      timeOfDay,
      parallelCount,
      // G3 精力预算表：默认上限（study 10h / activity 5h 每周），后续在设置中可调
      weeklyCaps: { ...DEFAULT_GOAL_PREFS.weeklyCaps },
    });
    onDone(false);
  };

  const optionBtn = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors ${
      active ? 'border-brand bg-brand text-white' : 'border-ink/10 bg-paper text-ink hover:border-brand/40'
    }`;

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-ink/10 bg-white/90 backdrop-blur-md">
        <div className="page-shell flex min-h-16 items-center gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">最后一组：目标偏好</p>
            <p className="mt-0.5 text-[11px] text-ink-faint">只用于把你的长目标安排得更贴合节奏，随时可在目标设置里改</p>
          </div>
        </div>
      </header>

      <main className="page-shell max-w-2xl space-y-4 px-4 py-8">
        <section className="rounded-2xl border border-ink/10 bg-white p-4">
          <h3 className="text-[13.5px] font-semibold text-ink">① 一周里哪些天你有大块自主时间？</h3>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {DAYS.map((label, i) => {
              const d = i + 1;
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)} className={optionBtn(freeDays.includes(d))}>
                  周{label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-ink/10 bg-white p-4">
          <h3 className="text-[13.5px] font-semibold text-ink">② 自主学习时，一次能坐住多久？</h3>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {FOCUS_OPTIONS.map((m) => (
              <button key={m} type="button" onClick={() => setFocusMinutes(m)} className={optionBtn(focusMinutes === m)}>
                {m} 分钟
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-ink/10 bg-white p-4">
          <h3 className="text-[13.5px] font-semibold text-ink">③ 自主安排的事，你更习惯放在？</h3>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {([['morning', '清晨'], ['day', '白天'], ['evening', '晚上']] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setTimeOfDay(v)} className={optionBtn(timeOfDay === v)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-ink/10 bg-white p-4">
          <h3 className="text-[13.5px] font-semibold text-ink">④ 你习惯同时推进几个目标？</h3>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {([1, 2, 3] as const).map((n) => (
              <button key={n} type="button" onClick={() => setParallelCount(n)} className={optionBtn(parallelCount === n)}>
                {n === 3 ? '3 个及以上' : `${n} 个`}
              </button>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-2 pb-10">
          <button type="button" onClick={save} className="button-primary px-5 py-2.5 text-[13px]">
            保存并完成测评
          </button>
          <button type="button" onClick={() => onDone(true)} className="px-3 py-2.5 text-[12.5px] text-ink-faint hover:text-ink">
            跳过（之后可在目标设置里补）
          </button>
        </div>
      </main>
    </div>
  );
}
