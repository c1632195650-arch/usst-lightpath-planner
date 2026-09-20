/**
 * 「今天」的课程推导。
 *
 * 总览页首屏要回答「我现在要干嘛」，所以需要把课表折叠成
 * 「今天有哪几节、下一节是哪节、还有多久」。
 *
 * 这里全部是纯函数，当前时间由调用方传入（不在函数内部读时钟），
 * 否则测试无法稳定复现。对应测试见 scripts/today.test.mjs。
 */

import type { Course, CourseTimeSlot, Schedule } from '@/types';
import { currentWeekNo, weekdayOf } from '@/lib/date';
import { PERIOD_END, PERIOD_START, periodEndMin, periodStartMin } from '@/constants/time';

export interface Lesson {
  course: Course;
  slot: CourseTimeSlot;
  /** 当天分钟数，用于和「现在」比较 */
  startMin: number;
  endMin: number;
  /** "HH:mm"，直接用于展示 */
  startTime: string;
  endTime: string;
}

export interface NextLesson {
  lesson: Lesson;
  /** ongoing = 正在上；upcoming = 还没开始 */
  status: 'ongoing' | 'upcoming';
  /** 距离开始还有多少分钟；ongoing 时为 0 */
  minutesUntil: number;
}

/** ISO 日期 → types.ts 的 DayOfWeek（1=周一 … 7=周日）。 */
export function dayOfWeekOf(iso: string): number {
  const wd = weekdayOf(iso); // 0=周日
  return wd === 0 ? 7 : wd;
}

/** 某节课在给定周次是否开课：weeks 为空数组 = 全学期（types.ts 约定）。 */
export function activeInWeek(slot: CourseTimeSlot, weekNo: number): boolean {
  return slot.weeks.length === 0 || slot.weeks.includes(weekNo);
}

/**
 * 给定日期当天的课程，按开始时间升序。
 * 学期之外的日期（weekNo < 1 或 > totalWeeks）返回空数组，不越界取课。
 */
export function lessonsOn(schedule: Schedule, iso: string): Lesson[] {
  const weekNo = currentWeekNo(schedule.termStart, iso);
  if (weekNo < 1 || weekNo > schedule.totalWeeks) return [];

  const dow = dayOfWeekOf(iso);
  const lessons: Lesson[] = [];

  for (const course of schedule.courses) {
    for (const slot of course.slots) {
      if (slot.dayOfWeek !== dow || !activeInWeek(slot, weekNo)) continue;
      lessons.push({
        course,
        slot,
        startMin: periodStartMin(slot.startPeriod),
        endMin: periodEndMin(slot.endPeriod),
        startTime: PERIOD_START[slot.startPeriod] ?? '',
        endTime: PERIOD_END[slot.endPeriod] ?? '',
      });
    }
  }

  return lessons.sort((a, b) => a.startMin - b.startMin);
}

/**
 * 当前正在上的课，或下一节还没开始的课。
 * 今天的课都上完了就返回 null —— 调用方据此显示「今天的课已经上完」。
 */
export function nextLessonAt(lessons: Lesson[], nowMin: number): NextLesson | null {
  const ongoing = lessons.find((l) => nowMin >= l.startMin && nowMin < l.endMin);
  if (ongoing) return { lesson: ongoing, status: 'ongoing', minutesUntil: 0 };

  const upcoming = lessons.find((l) => l.startMin > nowMin);
  if (upcoming) return { lesson: upcoming, status: 'upcoming', minutesUntil: upcoming.startMin - nowMin };

  return null;
}

/**
 * 一周七天各自的节次数（周一 → 周日），供总览的 7 天概览条使用。
 * 没课的那天是 0，由展示层决定怎么表达，这里不做最小值兜底。
 */
export function dailySlotCounts(schedule: Schedule, weekNo: number): number[] {
  return Array.from({ length: 7 }, (_, index) => schedule.courses.reduce(
    (count, course) => count + course.slots.filter(
      (slot) => slot.dayOfWeek === index + 1 && activeInWeek(slot, weekNo),
    ).length,
    0,
  ));
}

/** 当前分钟数（0–1439）。组件里调用，保持纯函数不读时钟。 */
export function nowMinutes(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}
