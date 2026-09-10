import { DEADLINES, type Deadline } from '@/data/usst';
import { diffDays, todayISO, shortCN } from '@/lib/date';

/** Single deadline row keeps the date and urgency scannable in the compact overview rail. */
function DeadlineRow({ d, days }: { d: Deadline; days: number }) {
  const urgent = days <= 7;
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white/60 px-3 py-3 transition-all duration-300 ease-in-out hover:border-ink/20 hover:bg-white"
    >
      <div
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ background: d.color }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{d.title}</span>
          <span
            className="shrink-0 rounded-md bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft"
          >
            {d.tag}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-ink-faint">
          {shortCN(d.date)}{d.note ? ` · ${d.note}` : ''}
        </div>
      </div>

      <div className="shrink-0 text-right pl-1">
        {days === 0 ? (
          <span className="text-xs font-semibold text-brand">今天</span>
        ) : (
          <>
            <div className={`text-lg font-semibold leading-none tabular-nums ${urgent ? 'text-brand' : 'text-ink'}`}>
              {days}<span className="ml-0.5 text-[10px] font-medium text-ink-faint">天</span>
            </div>
            <div className="mt-1 text-[10px] text-ink-faint">{urgent ? '临近' : '剩余'}</div>
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
    <section className="panel p-5 fade-item">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="section-label">UP NEXT</p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">接下来的节点</h3>
        </div>
        <span className="text-xs text-ink-faint">{upcoming.length} 项</span>
      </header>

      <ul className="flex flex-col gap-2">
        {upcoming.map((d) => (
          <li key={d.id}>
            <DeadlineRow d={d} days={diffDays(today, d.date)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
