import type { PersonaProfile, Schedule } from '@/types';
import { DEADLINES } from '@/data/usst';
import { diffDays, shortCN, weekdayCN } from '@/lib/date';
import { humanizeMinutes } from '@/constants/time';
import { categoryColor } from '@/constants/chartColors';
import { lessonsOn, nextLessonAt, nowMinutes, type Lesson } from '@/lib/today';

interface Props {
  schedule: Schedule;
  todayIso: string;
  weekNo: number;
  persona: PersonaProfile | null;
  onOpenWeek: () => void;
  onStartPersona: () => void;
}

/** 单节课一行：时间、课名、地点，并用左侧色条表达课程类别。 */
function LessonRow({ lesson, state }: { lesson: Lesson; state: 'done' | 'now' | 'next' }) {
  const place = [lesson.course.building, lesson.course.room].filter(Boolean).join(' ');
  return (
    <li
      className={`flex items-center gap-3 py-2.5 transition-opacity ${state === 'done' ? 'opacity-45' : ''}`}
    >
      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ background: categoryColor(lesson.course.category) }}
        aria-hidden="true"
      />
      <span className="w-12 shrink-0 text-xs text-white/55 tabular-nums">{lesson.startTime}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{lesson.course.name}</span>
        {place && <span className="mt-0.5 block truncate text-xs text-white/45">{place}</span>}
      </span>
      {state === 'now' && (
        <span className="shrink-0 rounded-full bg-brand-bright px-2 py-0.5 text-[10px] font-semibold text-white">
          正在上
        </span>
      )}
    </li>
  );
}

/**
 * 总览首屏。回答的是「我现在要干嘛」，而不是「这学期有多少课」——
 * 所以下一节课的时间地点是最大的那行字，统计数字退到次要位置。
 */
export function TodayCard({ schedule, todayIso, weekNo, persona, onOpenWeek, onStartPersona }: Props) {
  /** 只读一次时钟，否则同一次渲染里的判断可能跨分钟不一致。 */
  const now = nowMinutes();
  const lessons = lessonsOn(schedule, todayIso);
  const next = nextLessonAt(lessons, now);

  /** 今天没课时用最近的校园节点补位，避免首屏出现空面。 */
  const nearestDeadline = DEADLINES
    .filter((d) => diffDays(todayIso, d.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const headline = next
    ? next.lesson.course.name
    : lessons.length > 0
      ? '今天的课已经上完了。'
      : '今天没有课。';

  const kicker = next ? (next.status === 'ongoing' ? '正在上' : '下一节') : '今天';

  return (
    <section className="hero-surface overflow-hidden rounded-2xl text-white shadow-[0_18px_44px_rgba(22,35,63,0.16)]">
      <div className="px-5 py-7 sm:px-8 sm:py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
          WEEK {String(Math.max(1, weekNo)).padStart(2, '0')} · {shortCN(todayIso)} {weekdayCN(todayIso)}
        </p>

        <p className="mt-6 text-xs font-semibold tracking-[0.12em] text-brand-bright">{kicker}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{headline}</h1>

        {next ? (
          <p className="mt-4 text-sm leading-6 text-white/70">
            {next.lesson.startTime}–{next.lesson.endTime}
            {next.lesson.course.building ? ` · ${next.lesson.course.building}` : ''}
            {next.lesson.course.room ? ` ${next.lesson.course.room}` : ''}
            {next.status === 'upcoming' && (
              <span className="text-white/50"> · 还有 {humanizeMinutes(next.minutesUntil)}</span>
            )}
          </p>
        ) : (
          <p className="mt-4 max-w-xl text-sm leading-6 text-white/70">
            {nearestDeadline
              ? diffDays(todayIso, nearestDeadline.date) === 0
                ? `「${nearestDeadline.title}」就是今天。`
                : `最近的校园节点是「${nearestDeadline.title}」，还有 ${diffDays(todayIso, nearestDeadline.date)} 天。`
              : '把这段时间留给自己，也是安排的一部分。'}
          </p>
        )}

        {lessons.length > 0 && (
          <ul className="mt-7 divide-y divide-white/10 border-t border-white/10 pt-1">
            {lessons.map((lesson, index) => (
              <LessonRow
                key={`${lesson.course.id}-${index}`}
                lesson={lesson}
                state={
                  next && next.lesson === lesson
                    ? next.status === 'ongoing' ? 'now' : 'next'
                    : lesson.endMin <= now ? 'done' : 'next'
                }
              />
            ))}
          </ul>
        )}

        <div className="mt-7 flex flex-wrap gap-3">
          <button
            onClick={onOpenWeek}
            className="min-h-11 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-brand-light"
          >
            打开本周安排
          </button>
          {!persona && (
            <button
              onClick={onStartPersona}
              className="min-h-11 rounded-xl border border-white/20 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              完成画像测评
            </button>
          )}
        </div>

        {persona && (
          <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-white/45">
            当前建议参考「{persona.archetype.primary?.name ?? '你的画像'}」的节奏。
          </p>
        )}
      </div>
    </section>
  );
}
