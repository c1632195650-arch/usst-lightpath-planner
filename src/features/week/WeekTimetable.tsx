/**
 * WeekTimetable —— 只读课表网格（W3/P1-5b.3 · 2026-10-07）
 * ============================================================
 * 从 WeekView 的 TIMETABLE 段原样抽出（周视图单窗口化后，「日程」页把它作为
 * **默认折叠**的只读块挂在最底部 —— 不再是一个并列窗口；若要彻底删掉，
 * 只需移除 App.tsx 里那一个 <details>（单点可删）。
 * 7 天 × 13 节天然需要宽度，窄屏保留横向滚动（min-w 540px）。
 */
import type { CourseCategory, CourseTimeSlot, Schedule } from '@/types';
import { PERIOD_START, PERIOD_END } from '@/constants/time';
import { CATEGORY_COLOR } from '@/constants/chartColors';

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// 跟着 PERIOD_START 走：常量里加夜课（第 12、13 节）时这里自动跟着变
const PERIODS = Array.from({ length: PERIOD_START.length - 1 }, (_, i) => i + 1);

/**
 * UI v2 D2（设计稿 §4.3）：块从「纯色底 + 白字」改为「浅底 + 左色条 + 微几何符」。
 * 微几何符与类别色双编码（§7.7 色盲二重编码：颜色不再是唯一编码）。
 * 周期表单元格里只保留三维（课名 600 / 教室 / 时间）——格窄，其余进 ⋯ 菜单的
 * 排程块才有（本表是只读课表，无操作）。
 */
const CELL_SKIN: Record<CourseCategory, { tint: string; bar: string; text: string }> = {
  专业核心: { tint: 'bg-[#E5EAF6]', bar: 'bg-[#1F3A78]', text: 'text-[#1F3A78]' },
  实践环节: { tint: 'bg-[#FBF1E3]', bar: 'bg-[#965C18]', text: 'text-[#965C18]' },
  通识选修: { tint: 'bg-[#E6F2EC]', bar: 'bg-[#14563A]', text: 'text-[#14563A]' },
  公共基础: { tint: 'bg-[#E7F3F5]', bar: 'bg-[#0D5560]', text: 'text-[#0D5560]' },
  专业选修: { tint: 'bg-[#F3EEF9]', bar: 'bg-[#4A3374]', text: 'text-[#4A3374]' },
  其他: { tint: 'bg-[#EDEFF5]', bar: 'bg-[#5A6377]', text: 'text-[#5A6377]' },
};

/** 微几何符（§7.7 色盲二重编码，与 KIND_STYLE 同一套形） */
type GeoShape = 'tri' | 'diamond' | 'circle' | 'square' | 'star' | 'hex';
const GEO_PATHS: Record<Exclude<GeoShape, 'circle'>, string> = {
  tri: 'M6 1.6l4.6 8.4H1.4z',
  diamond: 'M6 .8l5.2 5.2L6 11.2.8 6z',
  square: 'M1.4 1.4h9.2v9.2H1.4z',
  star: 'M6 1l1.5 3.2 3.5.4-2.6 2.4.7 3.4L6 8.7 2.9 10.4l.7-3.4L1 4.6l3.5-.4z',
  hex: 'M6 .9l4.4 2.6v5L6 11.1 1.6 8.5v-5z',
};
const CATEGORY_GEO: Record<CourseCategory, GeoShape> = {
  专业核心: 'tri',
  实践环节: 'diamond',
  通识选修: 'circle',
  公共基础: 'square',
  专业选修: 'star',
  其他: 'hex',
};
function GeoMark({ shape, className = '' }: { shape: GeoShape; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true" className={className}>
      {shape === 'circle' ? <circle cx="6" cy="6" r="4.6" /> : <path d={GEO_PATHS[shape]} />}
    </svg>
  );
}

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
                    const skin = CELL_SKIN[start.category] ?? CELL_SKIN.其他;
                    return (
                      <td key={dow} rowSpan={span} className="border-b border-ink/5 p-1 align-top">
                        {/* UI v2 D2：浅底 + 左色条 4px（色条与文字同色双编码）+ 微几何符 */}
                        <div className={`h-full overflow-hidden rounded-lg ${skin.tint}`}>
                          <div className={`h-1 w-full ${skin.bar}`} aria-hidden="true" />
                          <div className={`px-2 py-1.5 ${skin.text}`}>
                            <div className="flex items-start gap-1">
                              <GeoMark shape={CATEGORY_GEO[start.category] ?? 'circle'} className="relative top-[3px] h-2.5 w-2.5 shrink-0" />
                              <div className="min-w-0 text-[11px] font-semibold leading-tight">{start.name}</div>
                            </div>
                            <div className="mt-1 text-[9.5px] leading-tight text-ink-soft">
                              {start.building}{start.room ? ` ${start.room}` : ''}
                            </div>
                            <div className="mt-1 font-mono text-[9px] text-brand/80 tabular-nums">{PERIOD_START[p]}–{PERIOD_END[slot.endPeriod]}</div>
                          </div>
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
