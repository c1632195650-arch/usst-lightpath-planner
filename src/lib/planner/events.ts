/**
 * 校历事件 → 可排程任务（expandDeadlines）
 * ============================================================
 * 「倒计时」只解决「知道还有几天」，「准备块」才解决「我什么时候动手」。
 * 本模块把 DEADLINES 里带 prep 的事件**反向展开**成引擎认识的 UserTask：
 *
 *   截止日 − leadDays  →  窗口期  →  按 prepHours/blockMin 算块数
 *                     →  在窗口内均匀取样  →  落到 (周次, 星期)
 *
 * 为什么走 UserTask 这条通道，而不是给引擎加 events 参数：
 *   引擎已经有 UserTask 这条成熟链路（周次过滤 + 优先级高于系统建议 + 自动找空档）。
 *   事件准备块本质就是「带截止窗口的自定义任务」，复用它能少改一处核心、多留一份测试。
 *   唯一需要引擎配合的是一个新能力：**浮动任务也能指定星期几**
 *   （否则「截止前每天一块」会变成「一周里天天都出现」）。
 *
 * 纯函数：不读时钟、不 fetch，同输入必得同输出 —— 与 buildPhases / schedule 一致。
 */
import type { Deadline } from '../../data/usst.ts';
import type { UserTask } from './templates.ts';
import { addDays, currentWeekNo, diffDays, shortCN, weekdayOf } from '../date.ts';
import { toMinutes } from '../../constants/time.ts';

/**
 * 准备块最早开始时刻 —— 总不能让「四六级真题」被排到 07:00。
 * 不设的话引擎按「最大空档优先」选，没课的清晨会成为它的首选，很荒谬。
 */
const EVENT_EARLIEST_MIN = toMinutes('09:00');

/** 展开后的事件任务：比 UserTask 多出「来自哪个事件」的溯源信息 */
export interface ExpandedTask extends UserTask {
  fromEventId?: string;
  fromEventTitle?: string;
  /** 生成时算好的「距截止日还有几天」，供 UI 直接显示，避免前端再算一遍 */
  daysLeft?: number;
}

/** ISO 日期 → DayOfWeek（1=周一 … 7=周日；date.ts 的 weekdayOf 是 0=周日） */
function isoToDayOfWeek(iso: string): number {
  const wd = weekdayOf(iso);
  return wd === 0 ? 7 : wd;
}

/**
 * 把带 prep 的校历事件展开成本周可用的任务列表。
 *
 * @param deadlines  事件库（DEADLINES）
 * @param termStart  学期第一周的周一（与 schedule.termStart 一致，保证周次换算正确）
 * @param totalWeeks 总周数 —— 窗口可能落在学期之外（如寒假前的期末复习），要剔掉
 */
export function expandDeadlines(
  deadlines: Deadline[],
  termStart: string,
  totalWeeks: number,
): ExpandedTask[] {
  const out: ExpandedTask[] = [];
  if (!termStart) return out;

  for (const d of deadlines) {
    if (!d.prep) continue; // 纯提醒类事件（报名开启、校庆）不产生准备块
    const { leadDays, blockMin, prepHours, taskTitle, place, priority } = d.prep;
    if (leadDays <= 0 || blockMin <= 0) continue;

    const nBlocks = Math.max(1, Math.ceil((prepHours * 60) / blockMin));
    const windowStart = addDays(d.date, -leadDays);

    /* 窗口内取样：块数 ≤ 天数时均匀铺开（隔几天一块）；块数 > 天数时天天排。
       用 Set 去重 —— 均匀取样可能取到同一天，同一天只留一个准备块。 */
    const offsets = new Set<number>();
    for (let i = 0; i < nBlocks; i++) {
      const at = nBlocks >= leadDays ? i % leadDays : Math.floor((i * leadDays) / nBlocks);
      offsets.add(Math.min(leadDays - 1, Math.max(0, at)));
    }

    for (const off of offsets) {
      const date = addDays(windowStart, off);
      const wk = currentWeekNo(termStart, date);
      if (wk < 1 || wk > totalWeeks) continue; // 窗口落在学期外，跳过
      const dow = isoToDayOfWeek(date);
      const left = diffDays(date, d.date);
      out.push({
        // id 稳定：只与「事件 + 周次 + 星期」有关，不含时间 —— 锁定/去重要靠它
        id: `ev-${d.id}-w${wk}d${dow}`,
        title: taskTitle,
        emoji: d.emoji,
        kind: 'activity',
        category: 'custom',
        dayOfWeek: dow,
        weeks: [wk],
        durationMin: blockMin,
        place,
        priority: priority ?? 88,
        essential: true, // 有截止日期 → 单独留预算，不被日常活动预算挤掉
        notBeforeMin: EVENT_EARLIEST_MIN,
        note: `「${d.title}」${shortCN(d.date)}截止，还剩 ${left} 天 —— 提前动手，别赶最后一天`,
        fromEventId: d.id,
        fromEventTitle: d.title,
        daysLeft: left,
      });
    }
  }
  return out;
}

/**
 * 本周的「事件提醒」—— 给 UI 用：把本周内（或临近）的事件列出来，
 * 让用户看到「这周为什么多出来一个光电杯的块」。
 */
export function eventsNearWeek(
  deadlines: Deadline[],
  termStart: string,
  weekNo: number,
): Deadline[] {
  return deadlines.filter((d) => {
    const wk = currentWeekNo(termStart, d.date);
    return wk >= weekNo && wk <= weekNo + 1; // 本周与下周（提前让人看见）
  });
}
