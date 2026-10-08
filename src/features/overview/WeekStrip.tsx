import type { Schedule } from '@/types';
import { Icon } from '@/components/icons/Icon';
import { weekDates } from '@/lib/date';
import { dailySlotCounts } from '@/lib/today';

interface Props {
  schedule: Schedule;
  weekNo: number;
  weekMonday: string;
  todayIso: string;
  onSelectDay: (iso: string) => void;
}

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 本周七天节奏横条（设计总成 §11.3 第 ② 条）
 * ============================================================
 * **2026-10-08 重做（页面模板批）**：此处原是一张七列竖柱状图 + 面积较大的白卡，
 * 与设计总成对总览的硬要求冲突 —— §11.3 写明总览必须有「一张**一周节奏横条**
 * （今天高亮）」，且**绝不能有「把完整课表搬来」**；七列竖柱本质上是在总览里复刻课表。
 * 现改为规范形态：7 格横条，每格 **高 34px / radius 7 / gap 6**，
 * 今天 = 上理红描边 + 红软底（身份色配额位③），周末 = `--sunken` 灰底。
 *
 * 保留的能力：每格仍可点（进那一周并定位到该天）—— 规范第 ④ 条要求每张卡可下钻，
 * 这里只是把「面积」换成了「一条节奏」。
 */
export function WeekStrip({ schedule, weekNo, weekMonday, todayIso, onSelectDay }: Props) {
  const days = weekDates(weekMonday);
  const counts = dailySlotCounts(schedule, weekNo);
  const total = counts.reduce((sum, n) => sum + n, 0);

  return (
    <section className="panel p-3.5 sm:p-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
          <Icon name="trending" size="sm" className="shrink-0 text-brand" />
          一周节奏
        </h2>
        <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">第 {weekNo} 周 · 共 {total} 节</span>
      </div>

      <div className="flex gap-1.5" role="list">
        {days.map((iso, index) => {
          const count = counts[index];
          const isToday = iso === todayIso;
          const weekend = index >= 5;
          return (
            <button
              key={iso}
              type="button"
              role="listitem"
              onClick={() => onSelectDay(iso)}
              aria-label={`${iso}，${count} 节课，点击进入该周并定位到这一天`}
              className={`flex h-[34px] min-w-0 flex-1 items-center justify-center gap-1 rounded-[7px] border-[1.5px] px-1 transition-colors duration-fast ease-out ${
                isToday
                  ? 'border-school-red bg-school-light text-school-red'
                  : weekend
                    ? 'border-transparent bg-paper-sunken text-ink-faint hover:border-brand/25'
                    : 'border-transparent bg-paper text-ink-soft hover:border-brand/25 hover:bg-brand-light/50'
              }`}
            >
              <span className="text-[10.5px] font-medium">{DAY_LABELS[index]}</span>
              <span className={`font-mono text-[12px] font-semibold tabular-nums ${isToday ? '' : 'text-ink'}`}>
                {count > 0 ? count : '–'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
