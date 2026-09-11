import { useMemo, useState } from 'react';
import type { Course, CourseTimeSlot, PersonaProfile, Schedule } from '@/types';
import { LIFE_MODES } from '@/data/usst';
import { weekDates, shortCN } from '@/lib/date';
import { PERIOD_START, PERIOD_END } from '@/constants/time';
import { lbaoRecommend, type LbaoPlan } from '@/lib/lbao';
import { LbaoPlanView } from '@/features/libao/LbaoPlanView';
import { categoryColor } from '@/constants/chartColors';

interface Props {
  weekMonday: string;
  weekNo: number;
  schedule: Schedule;
  selectedDays: string[];
  onToggleDay: (iso: string) => void;
  onSelectWholeWeek: () => void;
  onClearDays: () => void;
  lifeMode: string | null;
  onSelectMode: (id: string) => void;
  persona: PersonaProfile | null;
  onBack: () => void;
  onShiftWeek: (delta: number) => void;
}

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// 跟着 PERIOD_START 走：常量里加夜课（第 12、13 节）时这里自动跟着变
const PERIODS = Array.from({ length: PERIOD_START.length - 1 }, (_, i) => i + 1);

export function WeekView(props: Props) {
  const { weekMonday, weekNo, schedule, selectedDays, persona, onBack, onShiftWeek } = props;
  const [lbao, setLbao] = useState<LbaoPlan | null>(null);

  const days = useMemo(() => weekDates(weekMonday), [weekMonday]);
  const selectedSet = useMemo(() => new Set(selectedDays), [selectedDays]);

  // 某节是否在当前周上课：weeks 为空数组 = 全学期（types.ts 约定）
  const activeThisWeek = (slot: CourseTimeSlot, wkNo: number): boolean =>
    slot.weeks.length === 0 || slot.weeks.includes(wkNo);

  // 某天(1=周一)某节课是否「从第 p 节开始」且当前周该上
  const courseStartingAt = (dow: number, p: number) =>
    schedule.courses.find((c) => c.slots.some((s) =>
      s.dayOfWeek === dow && s.startPeriod === p && activeThisWeek(s, weekNo)));

  // 某节是否「被上面跨行课程盖住」且当前周该上
  const isCovered = (dow: number, p: number) =>
    schedule.courses.some((c) => c.slots.some((s) =>
      s.dayOfWeek === dow && s.startPeriod < p && s.endPeriod >= p && activeThisWeek(s, weekNo)));

  const runLbao = () => {
    if (!persona) return;
    const daysForPlan = selectedDays.length > 0 ? selectedDays : days;
    setLbao(lbaoRecommend(persona, schedule, daysForPlan, props.lifeMode));
  };

  const weekRange = `${shortCN(days[0])} – ${shortCN(days[6])}`;

  return (
    <div className="flex flex-col gap-6">
      {/* 周次控制保持在同一视觉层级，切换时不丢失当前日期和课程上下文。 */}
      <header className="hero-surface-flat flex items-center justify-between rounded-2xl px-4 py-4 text-white shadow-[0_12px_32px_rgba(22,35,63,0.14)] sm:px-6">
        <button onClick={onBack} className="min-h-10 text-sm font-medium text-white/60 transition-colors hover:text-white">返回总览</button>
        <div className="text-center">
          <div className="text-lg font-semibold tracking-tight">第 {weekNo} 周</div>
          <div className="mt-0.5 text-xs text-white/55">{weekRange}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onShiftWeek(-1)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 text-white transition-colors hover:bg-white/10" aria-label="上一周">‹</button>
          <button onClick={() => onShiftWeek(1)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 text-white transition-colors hover:bg-white/10" aria-label="下一周">›</button>
        </div>
      </header>

      <section className="panel p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="section-label">FOCUS DAYS</p>
            <h3 className="mt-3 text-lg font-semibold tracking-tight text-ink">选择想安排的日期</h3>
          </div>
          <div className="flex gap-3 text-sm">
            <button onClick={props.onSelectWholeWeek} className="font-semibold text-brand transition-colors hover:text-brand-dark">整周</button>
            <button onClick={props.onClearDays} className="font-medium text-ink-faint transition-colors hover:text-ink">清空</button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {days.map((d, i) => {
            const sel = selectedSet.has(d);
            return (
              <button
                key={d}
                onClick={() => props.onToggleDay(d)}
                className={`flex min-h-16 flex-col items-center justify-center rounded-xl border py-2 transition-all duration-200 ease-out ${
                  sel ? 'border-brand bg-brand text-white shadow-sm' : 'border-ink/10 bg-white text-ink-soft hover:border-brand/30 hover:bg-brand-light/30'
                }`}
              >
                <span className="text-xs font-medium">{DAY_LABELS[i]}</span>
                <span className="mt-1 text-sm font-semibold tabular-nums">{Number(d.slice(8, 10))}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-end justify-between px-4 pb-4 pt-5 sm:px-5">
          <div>
            <p className="section-label">TIMETABLE</p>
            <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">本周课程</h3>
          </div>
          <span className="text-xs text-ink-faint">按当前周次筛选</span>
        </div>
        {/* 7 天 × 13 节的课表天然需要宽度，窄屏仍保留横向滚动；
            min-w 压到 540px 后，常见手机一屏能看到 5 天左右，拖动幅度明显变小。 */}
        <div className="overflow-x-auto border-t border-ink/10 px-4 py-4 sm:px-5">
          <table className="min-w-[540px] w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="w-14 border-b border-ink/10 pb-3 text-left text-[11px] font-medium text-ink-faint">时间</th>
                {DAY_LABELS.map((l) => (
                  <th key={l} className="border-b border-ink/10 px-1 pb-3 text-center text-[11px] font-medium text-ink-soft">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((p) => (
                <tr key={p}>
                  <td className="border-b border-ink/5 py-1.5 pr-2 align-top text-[10px] text-ink-faint tabular-nums">
                    {PERIOD_START[p]}
                  </td>
                  {DAY_LABELS.map((_, dow) => {
                    const start = courseStartingAt(dow + 1, p);
                    if (start) {
                      const slot = start.slots.find(
                        (s) => s.dayOfWeek === dow + 1 && s.startPeriod === p && activeThisWeek(s, weekNo),
                      )!;
                      const span = slot.endPeriod - slot.startPeriod + 1;
                      return (
                        <td key={dow} rowSpan={span} className="border-b border-ink/5 p-1 align-top">
                          <div
                            className="h-full rounded-lg px-2 py-2 text-white shadow-sm"
                            style={{ background: categoryColor(start.category) }}
                          >
                            <div className="text-[11px] font-semibold leading-tight">{start.name}</div>
                            <div className="mt-1 text-[9.5px] leading-tight opacity-85">
                              {start.building}{start.room ? ` ${start.room}` : ''}
                            </div>
                            <div className="mt-1 text-[9px] opacity-70">{PERIOD_START[p]}–{PERIOD_END[slot.endPeriod]}</div>
                          </div>
                        </td>
                      );
                    }
                    if (isCovered(dow + 1, p)) return null;
                    return <td key={dow} className="border-b border-ink/5 p-1" />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <div className="mb-5">
          <p className="section-label">PACE</p>
          <h3 className="mt-3 text-lg font-semibold tracking-tight text-ink">选择这一周的节奏</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {LIFE_MODES.map((m) => {
            const active = props.lifeMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => props.onSelectMode(m.id)}
                className={`flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 ease-out ${
                  active ? 'border-brand bg-brand-light text-brand' : 'border-ink/10 bg-white text-ink-soft hover:border-brand/30 hover:bg-brand-light/30'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: m.color }} aria-hidden="true" />
                {m.name}
              </button>
            );
          })}
        </div>
        {props.lifeMode && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <p className="text-sm font-semibold text-ink">{LIFE_MODES.find((m) => m.id === props.lifeMode)?.tagline}</p>
            <p className="mt-1 text-sm leading-6 text-ink-soft">{LIFE_MODES.find((m) => m.id === props.lifeMode)?.desc}</p>
          </div>
        )}
      </section>

      <section className="pb-10">
        <div className="panel overflow-hidden">
          <div className="hero-surface-flat flex items-center gap-4 px-5 py-5 text-white">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/10 text-lg">梨</div>
            <div className="flex-1">
              <div className="text-sm font-semibold">梨宝建议</div>
              <div className="mt-1 text-xs text-white/55">结合课表与画像，生成可执行的一周安排</div>
            </div>
            <button
              onClick={runLbao}
              disabled={!persona}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-brand-light disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/45"
            >
              生成建议
            </button>
          </div>

          {!persona && (
            <p className="px-5 py-5 text-sm leading-6 text-ink-faint">完成画像后，梨宝才能给出更贴近你习惯的建议。</p>
          )}

          {lbao && (
            <div className="px-5 py-5">
              <LbaoPlanView plan={lbao} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
