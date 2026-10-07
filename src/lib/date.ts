/**
 * 日期工具
 * 约定：所有日期用 ISO 字符串 "YYYY-MM-DD"，避免 Date 对象的时区坑。
 * （new Date('2026-09-08') 在东八区会被当成 UTC 午夜，差 8 小时，非常容易出 bug）
 */

/** 今天 */
export function todayISO(): string {
  return toISO(new Date());
}

/** Date → "YYYY-MM-DD"（按本地时区） */
export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" → Date（本地时区，不受 UTC 影响） */
export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 加减天数 */
export function addDays(iso: string, days: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** b - a，相差天数（正整数表示 b 在 a 之后） */
export function diffDays(a: string, b: string): number {
  const ms = fromISO(b).getTime() - fromISO(a).getTime();
  return Math.round(ms / 86400000);
}

/** 0=周日 … 6=周六，与 Date.getDay() 一致 */
export function weekdayOf(iso: string): number {
  return fromISO(iso).getDay();
}

/** 转成「周一/周二/…」 */
export const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayCN(iso: string): string {
  return WEEKDAY_CN[weekdayOf(iso)];
}

/**
 * 「周一 → 周日」七天的中文名 —— **唯一真源**（2026-09-21 P2-5 去重）。
 *
 * ⚠️ 与上面的 `WEEKDAY_CN` **口径不同，别混用**：
 *   · `WEEKDAY_CN`  = `[0]=周日 … [6]=周六` —— 配合 `Date.getDay()` / `weekdayOf(iso)`；
 *   · `DAY_LABELS`  = `[0]=周一 … [6]=周日` —— 配合 `dayOfWeek`（1–7，取值 `[d-1]`）。
 * 两种口径都合法，各服务一类调用方；同名不同序才是陷阱，所以这里刻意用两个名字。
 *
 * ── 为什么真源放在 `lib/` 而不是某个 feature ──────────────────────
 * 这份字面量**两侧都要用**：前端各域（`features/**`）与排程引擎（`lib/planner/**`）。
 * 而 `lib/**` 不得 import `features/**`（前端架构规格书 §4.1 规则 1），
 * 所以共同上游只能落在 `lib/`。放这里也顺便和 `WEEKDAY_CN` 并排，口径差异一眼可见。
 *
 * ── 去重前的事实（2026-09-21 实测）────────────────────────────────
 * 同一份字面量在仓里共 **8 处**副本：周视图 ×5（`weekViewUtils` / `CourseOverrideEditor` /
 * `SlotEditor` / `TimeAskDialog` / `WeekView`）、目标页 ×1、引擎 ×2（`incremental` / `roll`）。
 * 任一处改了文案、另几处没跟，界面就会同时出现「周三」和「礼拜三」这种不一致，
 * 且**不会有任何测试报错**。`tests/arch-guards.test.ts` 已加静态守卫把定义点钉死。
 */
export const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 当前是第几周（1-based）。
 * @param termStart 学期第一周的**周一**日期
 */
export function currentWeekNo(termStart: string, today = todayISO()): number {
  return Math.floor(diffDays(termStart, today) / 7) + 1;
}

/** 给定周次，返回那一周周一的日期 */
export function mondayOfWeekNo(termStart: string, weekNo: number): string {
  return addDays(termStart, (weekNo - 1) * 7);
}

/** 给定日期所在周的周一 */
export function mondayOf(iso: string): string {
  const wd = weekdayOf(iso);
  // 周日算作这一周的第 7 天（往前推 6 天）
  const back = wd === 0 ? 6 : wd - 1;
  return addDays(iso, -back);
}

/** 从某周的周一起，平移 delta 周（delta>0 往后，<0 往前），返回新周一 ISO */
export function shiftWeekMonday(mondayISO: string, delta: number): string {
  return addDays(mondayISO, delta * 7);
}

/** 生成一周七天的 ISO 数组（周一 → 周日） */
export function weekDates(mondayISO: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayISO, i));
}

/** 中文日期短格式「9月8日」 */
export function shortCN(iso: string): string {
  const d = fromISO(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
