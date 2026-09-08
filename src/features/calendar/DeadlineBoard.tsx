import { DEADLINES, type Deadline } from '@/data/usst';
import { diffDays, todayISO, shortCN } from '@/lib/date';

/** 单个时间节点行（卡通贴纸风） */
function DeadlineRow({ d, days }: { d: Deadline; days: number }) {
  const urgent = days <= 7;
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 transition-transform hover:-translate-y-0.5"
      style={{ borderColor: `${d.color}40`, background: `${d.color}16` }}
    >
      <div
        className="w-11 h-11 rounded-2xl grid place-items-center text-[22px] shrink-0 shadow-sticker"
        style={{ background: `${d.color}30` }}
      >
        {d.emoji}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-bold text-ink truncate">{d.title}</span>
          <span
            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white"
            style={{ background: d.color }}
          >
            {d.tag}
          </span>
        </div>
        <div className="text-[11.5px] text-ink-faint mt-0.5 truncate">
          {shortCN(d.date)}{d.note ? ` · ${d.note}` : ''}
        </div>
      </div>

      <div className="shrink-0 text-right pl-1">
        {days === 0 ? (
          <span className="text-[13px] font-black text-brand">就是今天！</span>
        ) : (
          <>
            <div className={`text-[17px] font-black leading-none tabular-nums ${urgent ? 'text-brand' : 'text-ink'}`}>
              {days}<span className="text-[10px] font-bold text-ink-faint"> 天</span>
            </div>
            <div className="text-[9.5px] text-ink-faint mt-0.5">{urgent ? '⚠️ 倒计时' : '剩余'}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** 时间节点 / 倒计时面板 */
export function DeadlineBoard() {
  const today = todayISO();
  const upcoming = DEADLINES
    .filter((d) => diffDays(today, d.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (upcoming.length === 0) return null;

  return (
    <section className="sticker p-4 fade-item">
      <header className="flex items-center gap-2 mb-3">
        <span className="text-[20px] animate-bounce-soft">⏰</span>
        <h3 className="font-bold text-[15.5px] text-ink">别错过的日子</h3>
        <span className="ml-auto text-[11px] text-ink-faint">四六级 · 竞赛 · 校历</span>
      </header>

      <ul className="flex flex-col gap-2.5">
        {upcoming.map((d) => (
          <li key={d.id}>
            <DeadlineRow d={d} days={diffDays(today, d.date)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
