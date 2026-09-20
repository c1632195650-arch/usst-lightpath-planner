import type { Schedule } from '@/types';
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
 * 本周七天概览。
 *
 * 改版前这里是一张只读柱状图，占了 hero 的整个右栏却只表达 7 个数字。
 * 现在每一列可点击进入那一周，既是信息也是导航 —— 同样的面积多了一个职能。
 */
export function WeekStrip({ schedule, weekNo, weekMonday, todayIso, onSelectDay }: Props) {
  const days = weekDates(weekMonday);
  const counts = dailySlotCounts(schedule, weekNo);
  /** 留出最小柱高，让没有课的日期仍保有可辨认的时间刻度。 */
  const peak = Math.max(1, ...counts);
  const total = counts.reduce((sum, n) => sum + n, 0);

  return (
    <section className="panel p-5 sm:p-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="section-label">THIS WEEK</p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink">第 {weekNo} 周的课程分布</h2>
        </div>
        <span className="shrink-0 text-xs text-ink-faint tabular-nums">共 {total} 节</span>
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((iso, index) => {
          const count = counts[index];
          const isToday = iso === todayIso;
          return (
            <button
              key={iso}
              onClick={() => onSelectDay(iso)}
              aria-label={`${iso}，${count} 节课，点击查看该周安排`}
              className={`flex flex-col items-center gap-2 rounded-xl border px-1 py-3 transition-colors duration-200 ease-out ${
                isToday
                  ? 'border-brand bg-brand-light'
                  : 'border-ink/10 bg-white hover:border-brand/30 hover:bg-brand-light/60'
              }`}
            >
              <span className={`text-xs font-medium ${isToday ? 'text-brand' : 'text-ink-faint'}`}>
                {DAY_LABELS[index]}
              </span>
              <span className={`text-sm font-semibold tabular-nums ${isToday ? 'text-brand' : 'text-ink'}`}>
                {Number(iso.slice(8, 10))}
              </span>

              <span className="flex h-12 w-full items-end justify-center" aria-hidden="true">
                <span
                  className={`w-2 rounded-full transition-[height] duration-300 ease-out ${
                    count === 0 ? 'bg-ink/10' : isToday ? 'bg-brand' : 'bg-chart-indigo/70'
                  }`}
                  style={{ height: count === 0 ? '6px' : `${Math.max(24, (count / peak) * 100)}%` }}
                />
              </span>

              <span className={`text-[11px] tabular-nums ${count === 0 ? 'text-ink-faint/70' : 'text-ink-soft'}`}>
                {count || '–'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
