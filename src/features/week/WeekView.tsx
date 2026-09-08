import { useMemo, useState } from 'react';
import type { Course, PersonaProfile, Schedule } from '@/types';
import { LIFE_MODES } from '@/data/usst';
import { weekDates, shortCN } from '@/lib/date';
import { PERIOD_START, PERIOD_END } from '@/constants/time';
import { lbaoRecommend, type LbaoPlan } from '@/lib/lbao';
import { LbaoPlanView } from '@/features/libao/LbaoPlanView';

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
const PERIODS = Array.from({ length: 11 }, (_, i) => i + 1);

const CATEGORY_COLOR: Record<string, string> = {
  '公共基础': '#4a9fe0',
  '专业核心': '#d43a45',
  '专业选修': '#9d7bf2',
  '通识选修': '#4db98a',
  '实践环节': '#f5b840',
  '其他': '#9c918a',
};

export function WeekView(props: Props) {
  const { weekMonday, weekNo, schedule, selectedDays, persona, onBack, onShiftWeek } = props;
  const [lbao, setLbao] = useState<LbaoPlan | null>(null);

  const days = useMemo(() => weekDates(weekMonday), [weekMonday]);
  const selectedSet = useMemo(() => new Set(selectedDays), [selectedDays]);

  // 某天(1=周一)某节课是否「从第 p 节开始」
  const courseStartingAt = (dow: number, p: number) =>
    schedule.courses.find((c) => c.slots.some((s) => s.dayOfWeek === dow && s.startPeriod === p));

  const isCovered = (dow: number, p: number) =>
    schedule.courses.some((c) => c.slots.some((s) => s.dayOfWeek === dow && s.startPeriod < p && s.endPeriod >= p));

  const runLbao = () => {
    if (!persona) return;
    const daysForPlan = selectedDays.length > 0 ? selectedDays : days;
    setLbao(lbaoRecommend(persona, schedule, daysForPlan, props.lifeMode));
  };

  const weekRange = `${shortCN(days[0])} – ${shortCN(days[6])}`;

  return (
    <div className="flex flex-col gap-5">
      {/* 周标题 */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-[13px] text-ink-faint hover:text-ink">← 月历</button>
        <div className="text-center">
          <div className="text-[17px] font-bold text-ink">第 {weekNo} 周 · {weekRange}</div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onShiftWeek(-1)} className="w-8 h-8 rounded-full grid place-items-center border-2 border-ink/10 text-ink-soft hover:bg-white shadow-sticker">‹</button>
          <button onClick={() => onShiftWeek(1)} className="w-8 h-8 rounded-full grid place-items-center border-2 border-ink/10 text-ink-soft hover:bg-white shadow-sticker">›</button>
        </div>
      </div>

      {/* 选日（可单选/多选） */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-[14px] text-ink">✋ 选几天（可单选或多选）</h3>
          <div className="flex gap-2 text-[12px]">
            <button onClick={props.onSelectWholeWeek} className="text-brand font-medium hover:underline">整周</button>
            <button onClick={props.onClearDays} className="text-ink-faint hover:text-ink">清空</button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d, i) => {
            const sel = selectedSet.has(d);
            return (
              <button
                key={d}
                onClick={() => props.onToggleDay(d)}
                className={`rounded-xl py-2 flex flex-col items-center border-2 transition-all ${
                  sel ? 'bg-brand text-white border-brand shadow-sticker-brand -translate-y-0.5' : 'bg-white border-ink/10 text-ink-soft hover:border-brand/40'
                }`}
              >
                <span className="text-[11px]">{DAY_LABELS[i]}</span>
                <span className="text-[13px] font-bold tabular-nums">{Number(d.slice(8, 10))}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 课表 */}
      <section>
        <h3 className="font-bold text-[14px] text-ink mb-2">📅 本周课程表</h3>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full border-collapse min-w-[560px]">
            <thead>
              <tr>
                <th className="w-12 text-left text-[11px] font-medium text-ink-faint pb-2 align-bottom">时间</th>
                {DAY_LABELS.map((l) => (
                  <th key={l} className="text-center text-[11px] font-medium text-ink-soft pb-2 px-1">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((p) => (
                <tr key={p} className="border-t border-paper-line">
                  <td className="text-[10px] text-ink-faint pr-1 py-0.5 align-top tabular-nums">
                    {PERIOD_START[p]}
                  </td>
                  {DAY_LABELS.map((_, dow) => {
                    const start = courseStartingAt(dow + 1, p);
                    if (start) {
                      const slot = start.slots.find((s) => s.dayOfWeek === dow + 1 && s.startPeriod === p)!;
                      const span = slot.endPeriod - slot.startPeriod + 1;
                      return (
                        <td key={dow} rowSpan={span} className="p-0.5 align-top">
                          <div
                            className="rounded-xl px-1.5 py-1 text-white h-full shadow-sticker"
                            style={{ background: CATEGORY_COLOR[start.category] ?? '#9c918a' }}
                          >
                            <div className="text-[11px] font-bold leading-tight">{start.name}</div>
                            <div className="text-[9.5px] opacity-90 leading-tight mt-0.5">
                              {start.building}{start.room ? ` ${start.room}` : ''}
                            </div>
                            <div className="text-[9px] opacity-75">{PERIOD_START[p]}–{PERIOD_END[slot.endPeriod]}</div>
                          </div>
                        </td>
                      );
                    }
                    if (isCovered(dow + 1, p)) return null;
                    return <td key={dow} className="p-0.5" />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 生活模式 */}
      <section>
        <h3 className="font-bold text-[14px] text-ink mb-2">🎮 生活模式（mod）</h3>
        <div className="grid grid-cols-3 gap-2">
          {LIFE_MODES.map((m) => {
            const active = props.lifeMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => props.onSelectMode(m.id)}
                className={`rounded-2xl border-2 p-3 text-left transition-all ${
                  active ? 'border-brand bg-brand-light shadow-sticker-brand -translate-y-0.5' : 'border-ink/10 bg-white hover:border-brand/40'
                }`}
              >
                <div className="text-[20px]">{m.emoji}</div>
                <div className={`text-[13px] font-bold mt-1 ${active ? 'text-brand' : 'text-ink'}`}>{m.name}</div>
                <div className="text-[10.5px] text-ink-faint mt-0.5 leading-tight">{m.tagline}</div>
              </button>
            );
          })}
        </div>
        {props.lifeMode && (
          <p className="mt-2 text-[12px] text-ink-soft">
            {LIFE_MODES.find((m) => m.id === props.lifeMode)?.desc}
          </p>
        )}
      </section>

      {/* 梨宝 */}
      <section className="pb-10">
        <div className="rounded-card border-2 border-brand/15 bg-white overflow-hidden shadow-sticker-lg">
          <div className="usst-gradient px-5 py-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-white/25 grid place-items-center text-[22px] shadow-sticker">🍐</div>
            <div className="flex-1">
              <div className="font-bold text-white text-[15px]">梨宝</div>
              <div className="text-white/80 text-[12px]">结合你的课表 + 画像，一键安排生活</div>
            </div>
            <button
              onClick={runLbao}
              disabled={!persona}
              className="px-4 py-2 rounded-full bg-white text-brand font-bold text-[13px] shadow-sticker disabled:opacity-50 active:translate-y-0.5 active:shadow-none transition-all"
            >
              一键推荐 ✨
            </button>
          </div>

          {!persona && (
            <p className="px-5 py-4 text-[13px] text-ink-faint">先完成画像，梨宝才能更懂你。</p>
          )}

          {lbao && (
            <div className="px-5 py-4">
              <LbaoPlanView plan={lbao} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
