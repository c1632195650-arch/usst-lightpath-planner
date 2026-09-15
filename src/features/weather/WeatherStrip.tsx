/**
 * 一周天气条
 * ============================================================
 * 天气的**第一落点**：让「周三下午有雨」在页面上直接看得见。
 *
 * 排程块（`weatherToTasks`）是第二落点，不是唯一落点 —— 因为天气块优先级低，
 * 日程满时本就该被挤掉。**若只有排程块这一条路径，提醒就会因「今天太满」而消失**，
 * 那恰恰是最需要它的时候。所以提醒条必须独立于排程存在。
 */
import { WEEKDAY_CN, currentWeekNo } from '@/lib/date';
import { isoToDayOfWeek, judgeDay } from './weather';
import type { WeatherReport } from './weather';

export function WeatherStrip({ report, weekNo, termStart }: {
  report: WeatherReport | null;
  weekNo: number;
  termStart: string;
}) {
  // 拉不到天气就整条不渲染 —— 这是可选增强，不该在页面上留一块「加载失败」
  if (!report) return null;

  const days = report.days.filter((d) => currentWeekNo(termStart, d.date) === weekNo);

  if (days.length === 0) {
    return (
      <div className="panel px-4 py-2.5 text-[11.5px] text-ink-faint">
        这一周暂无天气预报（只提供未来 7 天）
      </div>
    );
  }

  return (
    <div className="panel px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-[12.5px] font-semibold text-ink">本周天气</span>
        <span className="text-[11px] text-ink-faint">
          {report.place} · 数据 Open-Meteo{report.cached ? ' · 缓存' : ''}
        </span>
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
        {days.map((d) => {
          const advice = judgeDay(d);
          const dow = isoToDayOfWeek(d.date);
          const wet = (d.periods.pm?.rainProb ?? 0) >= (d.periods.am?.rainProb ?? 0)
            && d.rainProb > 0;
          return (
            <div
              key={d.date}
              className={`min-w-[76px] flex-1 rounded-lg border px-2 py-1.5 text-center ${
                advice
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-black/5 bg-black/[0.015]'
              }`}
            >
              <div className="text-[11px] text-ink-soft">周{WEEKDAY_CN[dow % 7]}</div>
              <div className="mt-0.5 text-[12px] font-medium text-ink">{d.text}</div>
              <div className="mt-0.5 font-mono text-[10.5px] text-ink-faint">
                {d.tMin != null && d.tMax != null
                  ? `${Math.round(d.tMin)}~${Math.round(d.tMax)}°`
                  : '—'}
              </div>
              {d.rainProb > 0 && (
                <div className="mt-0.5 text-[10.5px] text-sky-700">
                  💧{d.rainProb}%{wet ? '（下午）' : ''}
                </div>
              )}
              {advice && (
                <div className="mt-1 truncate text-[10.5px] font-medium text-amber-800" title={advice.detail}>
                  {advice.emoji}{advice.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
