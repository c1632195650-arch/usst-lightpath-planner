import { DEADLINES, type Deadline } from '@/data/usst';
import { diffDays, todayISO, shortCN } from '@/lib/date';
import { deadlineColor } from '@/constants/chartColors';
import { Icon } from '@/components/icons/Icon';

/** Single deadline row keeps the date and urgency scannable in the compact overview rail. */
function DeadlineRow({ d, days }: { d: Deadline; days: number }) {
  const urgent = days <= 7;
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="relative shrink-0">
        <div
          className="h-9 w-1 rounded-full"
          style={{ background: deadlineColor(d.tag) }}
        />
        {urgent && (
          <Icon name="zap" size="xs" className="absolute -right-1.5 -top-1 text-danger-text" />
        )}
      </div>

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
          <span className="text-xs font-semibold text-danger-text">今天</span>
        ) : (
          <>
            <div className={`text-lg font-semibold leading-none tabular-nums ${urgent ? 'text-danger-text' : 'text-ink'}`}>
              {days}<span className="ml-0.5 text-[10px] font-medium text-ink-faint">天</span>
            </div>
            <div className="mt-1 text-[10px] text-ink-faint">{urgent ? '临近' : '剩余'}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** 时间节点 / 倒计时面板。
 *  2026-10-08（一屏仪表盘批）：卡片改成 `flex flex-col` + 列表内部滚动 —— 总览在 lg+
 *  是不滚动的整屏栅格，本卡与「校历」分掉最后一行的高度，超出部分在自己内部滚。 */
export function DeadlineBoard() {
  const today = todayISO();
  const upcoming = DEADLINES
    .filter((d) => diffDays(today, d.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (upcoming.length === 0) return null;

  return (
    <section className="panel flex h-full min-h-0 flex-col p-5 fade-item">
      <header className="mb-3 flex shrink-0 items-end justify-between gap-3">
        <div>
          <p className="section-label flex items-center gap-1.5">
            <Icon name="milestone" size="sm" className="text-brand" />
            UP NEXT
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">接下来的节点</h3>
        </div>
        <span className="text-xs text-ink-faint">{upcoming.length} 项</span>
      </header>

      <ul className="min-h-0 flex-1 divide-y divide-ink/10 overflow-y-auto">
        {upcoming.map((d) => (
          <li key={d.id}>
            <DeadlineRow d={d} days={diffDays(today, d.date)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
