/**
 * 天气 → 可排程任务（weatherToTasks）
 * ============================================================
 * 与 `lib/planner/events.ts` **同构**：产出 `UserTask[]`，通过 `buildWeekPlan` 的
 * `tasks` 入参喂进引擎。**引擎完全不知道有「天气」这回事** —— 它只看到
 * 「周三有个 30 分钟的活」。
 *
 * 为什么不让引擎感知天气（比如给 PhasePolicy 加 `rainPolicy`）：
 *   那些字段都在 `src/types.ts` 契约层，改动要双方会签；而收益只是「少一层转换」。
 *   走 `tasks` 通道的代价是零（该通道本来就存在，事件准备块已在用），换来的是
 *   ① 引擎零改动 ② 天气规则可单独测试 ③ 拉不到天气时整体自然退化。
 *
 * 纯函数部分（`weatherToTasks` / `weatherHints`）不读时钟、不 fetch —— 同输入必得同输出，
 * 与 buildPhases / schedule / events 保持一致的确定性。
 */
import type { UserTask } from '@/lib/planner/templates';
import { currentWeekNo, weekdayOf } from '@/lib/date';

const API_BASE =
  (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
  ?? 'http://127.0.0.1:8000';

/* ---------------- 数据结构（与后端 /api/weather 对应） ---------------- */

export type PeriodKey = 'am' | 'pm' | 'night';

export interface WeatherPeriod {
  code: number;
  text: string;
  rainProb: number;
  tMax: number | null;
  tMin: number | null;
}

export interface WeatherDay {
  date: string;                 // 'YYYY-MM-DD'
  code: number;                 // WMO 天气码
  text: string;
  tMax: number | null;
  tMin: number | null;
  rainProb: number;             // 全天最高降水概率 %
  rainMm: number | null;
  windMax: number | null;       // km/h
  periods: Partial<Record<PeriodKey, WeatherPeriod>>;
}

export interface WeatherReport {
  ok: boolean;
  place: string;
  lat: number;
  lon: number;
  source: string;
  days: WeatherDay[];
  cached?: boolean;
  error?: string;
}

/** 拉取失败返回 null —— 调用方据此**不显示**天气，而不是显示假的天气。 */
export async function fetchWeather(days = 7): Promise<WeatherReport | null> {
  try {
    const res = await fetch(`${API_BASE}/api/weather?days=${days}`);
    if (!res.ok) return null;
    const data = (await res.json()) as WeatherReport;
    return data.ok ? data : null;
  } catch {
    // 后端没起 / 断网 / 超时 —— 天气是可选增强，静默降级
    return null;
  }
}

/* ---------------- 判定规则 ---------------- */

/**
 * 阈值集中在这里，**测试直接引用这些常量**而不是抄一遍数字 ——
 * 否则调阈值时测试仍会「通过」，等于没测。
 */
export const WEATHER_RULES = {
  /** 降水概率达到这个数就提醒带伞 */
  rainProb: 60,
  /** 高温线 ℃ */
  heatMax: 33,
  /** 低温线 ℃ */
  coldMin: 5,
  /** 大风线 km/h（约 8.3 m/s，骑车会明显吃力） */
  windMax: 30,
} as const;

export type WeatherAdviceKind = 'rain' | 'cold' | 'heat' | 'wind';

export interface WeatherAdvice {
  kind: WeatherAdviceKind;
  date: string;
  dayOfWeek: number;
  emoji: string;
  /** 短标签，用于日程块标题与天气条角标 */
  label: string;
  /** 人话说明：为什么提醒、在哪个时段、数值多少 */
  detail: string;
  severity: 'warn' | 'info';
  /** 建议块的优先级 —— 差异化取值让「带伞」比「防晒」更靠前 */
  priority: number;
}

const PERIOD_CN: Record<PeriodKey, string> = { am: '上午', pm: '下午', night: '晚间' };

/** ISO 日期 → 1=周一 … 7=周日（date.ts 的 weekdayOf 是 0=周日） */
export function isoToDayOfWeek(iso: string): number {
  const wd = weekdayOf(iso);
  return wd === 0 ? 7 : wd;
}

/** 找出降水概率最高的那个时段 —— 提醒要落在具体时段上才有用（「下午有雨」＞「今天有雨」） */
function wettestPeriod(day: WeatherDay): { key: PeriodKey; prob: number } | null {
  let best: { key: PeriodKey; prob: number } | null = null;
  for (const key of ['am', 'pm', 'night'] as PeriodKey[]) {
    const p = day.periods[key];
    if (!p) continue;
    if (!best || p.rainProb > best.prob) best = { key, prob: p.rainProb };
  }
  return best;
}

/**
 * 判定某一天是否需要提醒。**一天最多给一条** —— 天气条已经很密了，
 * 一天刷四条提醒只会让人把整个模块当噪音。
 * 取舍顺序按「对当天计划的破坏力」：下雨 > 严寒 > 高温 > 大风。
 */
export function judgeDay(day: WeatherDay): WeatherAdvice | null {
  const dow = isoToDayOfWeek(day.date);
  const base = { date: day.date, dayOfWeek: dow };

  const wet = wettestPeriod(day);
  if (day.rainProb >= WEATHER_RULES.rainProb && wet && wet.prob >= WEATHER_RULES.rainProb) {
    return {
      ...base,
      kind: 'rain',
      emoji: '🌧️',
      label: '带伞',
      detail: `${PERIOD_CN[wet.key]}降水概率 ${wet.prob}%${day.rainMm ? `，累计约 ${day.rainMm}mm` : ''} —— 户外安排建议挪室内`,
      severity: 'warn',
      priority: 55,
    };
  }

  if (day.tMin != null && day.tMin <= WEATHER_RULES.coldMin) {
    return {
      ...base,
      kind: 'cold',
      emoji: '🥶',
      label: '保暖',
      detail: `最低 ${day.tMin}℃ —— 早出晚归记得加件外套`,
      severity: 'warn',
      priority: 52,
    };
  }

  if (day.tMax != null && day.tMax >= WEATHER_RULES.heatMax) {
    return {
      ...base,
      kind: 'heat',
      emoji: '🥵',
      label: '防暑',
      detail: `最高 ${day.tMax}℃ —— 中午避免长时间户外，注意补水`,
      severity: 'warn',
      priority: 50,
    };
  }

  if (day.windMax != null && day.windMax >= WEATHER_RULES.windMax) {
    return {
      ...base,
      kind: 'wind',
      emoji: '💨',
      label: '防风',
      detail: `阵风 ${day.windMax} km/h —— 骑车会明显吃力，留点余量`,
      severity: 'info',
      priority: 45,
    };
  }

  return null;
}

/** 全量提醒（含 info 级）—— 给天气条用 */
export function weatherHints(report: WeatherReport | null): WeatherAdvice[] {
  if (!report) return [];
  return report.days
    .map(judgeDay)
    .filter((a): a is WeatherAdvice => a !== null);
}

/**
 * 转成本周可用的排程任务。
 *
 * ⚠️ 与事件准备块的**关键差别**：天气块 `essential` 不设、优先级只有 45–55。
 * 它不是「必须完成的事」，而是一条当天提醒 —— 该被更重要的块挤掉，
 * 而不是去挤别人的时间。挤不进去也没关系，天气条上照样看得见。
 *
 * @param termStart 学期第一周的周一（与 `schedule.termStart` 一致，保证周次换算同口径）
 * @param weekNo    目标周次 —— 只有落在这一周的天气才产出任务
 */
export function weatherToTasks(
  report: WeatherReport | null,
  termStart: string,
  weekNo: number,
): UserTask[] {
  if (!report || !termStart) return [];

  const out: UserTask[] = [];
  for (const day of report.days) {
    if (currentWeekNo(termStart, day.date) !== weekNo) continue; // 不是这一周
    const advice = judgeDay(day);
    if (!advice) continue;

    out.push({
      // 稳定 id：只与「日期 + 类型」有关，不含时间 —— 与 blockId 语义键同一原则，
      // 否则块一移动 id 就变，锁定与去重都会失效。
      id: `wx-${advice.date}-${advice.kind}`,
      title: `${advice.label} · ${day.text}`,
      emoji: advice.emoji,
      kind: 'activity',
      category: 'custom',
      dayOfWeek: advice.dayOfWeek,
      weeks: [weekNo],
      durationMin: 30,
      priority: advice.priority,
      note: advice.detail,
    });
  }
  return out;
}
