/**
 * WeekTimetable —— 只读课表网格（W3/P1-5b.3 · 2026-10-07）
 * ============================================================
 * 从 WeekView 的 TIMETABLE 段原样抽出（周视图单窗口化后，「日程」页把它作为
 * **默认折叠**的只读块挂在最底部 —— 不再是一个并列窗口；若要彻底删掉，
 * 只需移除 App.tsx 里那一个 <details>（单点可删）。
 * 7 天 × 13 节天然需要宽度，窄屏保留横向滚动（min-w 540px）。
 */
import type { CourseTimeSlot, Schedule } from '@/types';
import { PERIOD_START, PERIOD_END } from '@/constants/time';
import { categoryColor } from '@/constants/chartColors';

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// 跟着 PERIOD_START 走：常量里加夜课（第 12、13 节）时这里自动跟着变
const PERIODS = Array.from({ length: PERIOD_START.length - 1 }, (_, i) => i + 1);

export function WeekTimetable({ schedule, weekNo }: { schedule: Schedule; weekNo: number }) {
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

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-end justify-between px-4 pb-4 pt-5 sm:px-5">
        <div>
          <p className="section-label">TIMETABLE</p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">本周课程</h3>
        </div>
        <span className="text-xs text-ink-faint">按当前周次筛选</span>
      </div>
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
  );
}
