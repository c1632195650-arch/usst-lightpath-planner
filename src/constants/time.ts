/**
 * 作息与节次时间常量
 *
 * ✅ 2026-09-11 已用官方《2026-2027 学年校历·课时表》（CY 提供扫描件）逐节核对。
 *    此前版本是按「45分钟课+10分钟休息」外推的，与官方作息不符（第3节应为
 *    09:45 而非 10:00；第5节在上午 11:15 而非下午 13:00），已全部更正。
 * ⚠️ 作息以当年教学日历为准 —— 换学年时请对照新校历的课时表复核本表。
 */

/** 官方课时表（2026-2027 学年）：第 N 节开始时间，索引 0 未使用 */
export const PERIOD_START = [
  '', '08:00', '08:45', '09:45', '10:30', '11:15',
  '13:00', '13:45', '14:45', '15:30', '16:15',
  '18:00', '18:45', '19:30',
];

/** 官方课时表：第 N 节结束时间。注意每节 40 分钟、节间 5 分钟 */
export const PERIOD_END = [
  '', '08:40', '09:25', '10:25', '11:10', '11:55',
  '13:40', '14:25', '15:25', '16:10', '16:55',
  '18:40', '19:25', '20:10',
];

/** 每天最多节次（官方课时表排到第 13 节，晚课到 20:10） */
export const MAX_PERIOD = 13;

/**
 * 官方「大节」划分（课时表原表）：
 *   上午 一=1-2节、二=3-5节 ｜ 下午 三=6-7节、四=8-10节 ｜ 晚上 五=11-13节
 * 教务课表 PDF 的「(3-5节)」写法与之一致。
 */
export const BIG_PERIODS = [
  { name: '一', first: 1, last: 2, half: '上午' },
  { name: '二', first: 3, last: 5, half: '上午' },
  { name: '三', first: 6, last: 7, half: '下午' },
  { name: '四', first: 8, last: 10, half: '下午' },
  { name: '五', first: 11, last: 13, half: '晚上' },
] as const;

/** 三餐占用（分钟）—— 排程时作为固定不可占用块 */
export const MEAL_BLOCKS = {
  breakfast: { start: '07:00', durationMin: 30 },
  lunch: { start: '11:55', durationMin: 50 },
  dinner: { start: '17:00', durationMin: 50 },
} as const;

/* ---------------- 时间工具 ---------------- */

/** "HH:mm" → 当天分钟数（0–1439） */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 分钟数 → "HH:mm"，超出 24h 会回绕（注意跨天场景单独处理） */
export function toHHmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 分钟数 → 「1 小时 30 分」这种人话 */
export function humanizeMinutes(min: number): string {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/** 第 N 节课的开始分钟数 */
export function periodStartMin(period: number): number {
  return toMinutes(PERIOD_START[period] ?? '08:00');
}

/** 第 N 节课的结束分钟数 */
export function periodEndMin(period: number): number {
  return toMinutes(PERIOD_END[period] ?? '08:40');
}
