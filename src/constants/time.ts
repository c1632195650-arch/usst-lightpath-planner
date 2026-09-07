/**
 * 作息与节次时间常量
 *
 * ⚠️ 这些数值是「待核对」的默认值 —— 上理工官方作息以当年教学日历为准。
 *    负责人请在 D3 前用真实课表核对，并把确认后的值更新到此处。
 *    一旦更新，请在群里说一声，因为排程算法依赖它。
 */

/** 第 N 节课的开始时间（24 小时制 HH:mm），索引 0 未使用 */
export const PERIOD_START = [
  '', '08:00', '08:55', '10:00', '10:55', '13:00',
  '13:55', '15:00', '15:55', '18:00', '18:55', '19:50',
];

/** 第 N 节课的结束时间 */
export const PERIOD_END = [
  '', '08:45', '09:40', '10:45', '11:40', '13:45',
  '14:40', '15:45', '16:40', '18:45', '19:40', '20:35',
];

/** 每天最多节次 */
export const MAX_PERIOD = 11;

/** 三餐占用（分钟）—— 排程时作为固定不可占用块 */
export const MEAL_BLOCKS = {
  breakfast: { start: '07:00', durationMin: 30 },
  lunch: { start: '11:45', durationMin: 50 },
  dinner: { start: '17:20', durationMin: 50 },
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
  return toMinutes(PERIOD_END[period] ?? '08:45');
}
