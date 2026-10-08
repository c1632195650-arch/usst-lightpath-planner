import type { PersonaProfile, Schedule } from '@/types';
import { KindIcon } from '@/components/icons/KindIcon';
import { DEADLINES } from '@/data/usst';
import { diffDays, shortCN, weekdayCN, weekdayOf } from '@/lib/date';
import { humanizeMinutes, toHHmm } from '@/constants/time';
import { categoryColor } from '@/constants/chartColors';
import { lessonsOn, nextLessonAt, nowMinutes, type Lesson } from '@/lib/today';
import { loadUserPlan } from '@/features/week/userPlanStore';
import { Icon } from '@/components/icons/Icon';
import { ongoingUserTask } from './ongoingTask';

/** 总览只预览这么多节今天的课（§11.3：总览不搬完整课表）。 */
const LESSON_PREVIEW_MAX = 3;

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
      className={`flex items-center gap-3 py-2 transition-opacity ${state === 'done' ? 'opacity-45' : ''}`}
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

  /** UI v2 D3 深色焦点卡「Now · 进行中」：用户排程块（梨宝/自建）正在进行 → 顶部压一条。
   *  无进行中事项（课程与任务都没有）→ 模块不渲染（「全页唯一重物」只在真有事时压上去）。 */
  const todayDow = (() => { const wd = weekdayOf(todayIso); return wd === 0 ? 7 : wd; })();
  const ongoingTask = ongoingUserTask(loadUserPlan().tasks, todayDow, now);
  const ongoingCourse = next && next.status === 'ongoing' ? next.lesson : null;

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
    <section className="hero-surface overflow-hidden rounded-2xl text-white shadow-card-dark">
      <div className="px-5 py-4 sm:px-6 sm:py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
          WEEK {String(Math.max(1, weekNo)).padStart(2, '0')} · {shortCN(todayIso)} {weekdayCN(todayIso)}
        </p>

        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] text-brand-bright">
          {/* §9.6 B 组：焦点卡主图标 target（lg 档，装饰件） */}
          <Icon name="target" size="lg" className="opacity-90" />
          {kicker}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{headline}</h1>

        {/* UI v2 D3：「Now · 进行中」焦点条——正在进行的排程任务（有才渲染，不做常驻占位） */}
        {ongoingTask && (
          <div data-testid="focus-now" className="mt-5 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
                <span className="rounded-full bg-school-red px-2 py-0.5 text-[10px] font-bold tracking-wide">NOW</span>
                <span className="flex min-w-0 items-center truncate"><KindIcon kind={ongoingTask.task.kind} /><span className="truncate">{ongoingTask.task.title}</span></span>
              </p>
              <p className="shrink-0 font-mono text-xs text-white/70 tabular-nums">
                {toHHmm(ongoingTask.startMin)}–{toHHmm(ongoingTask.endMin)} · 还有 {humanizeMinutes(ongoingTask.remainMin)}
              </p>
            </div>
            {/* 细进度条：still-in-progress 的体感；纯装饰不承载精确数值 */}
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
              <div
                className="h-full rounded-full bg-school-red transition-[width] duration-base ease-out"
                style={{ width: `${Math.round(ongoingTask.progress * 100)}%` }}
              />
            </div>
          </div>
        )}
        {ongoingCourse && !ongoingTask && (
          <div data-testid="focus-now" className="mt-5 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="rounded-full bg-school-red px-2 py-0.5 text-[10px] font-bold tracking-wide">NOW</span>
              <span className="truncate">{ongoingCourse.course.name}</span>
              <span className="shrink-0 font-mono text-xs font-normal text-white/70 tabular-nums">
                {ongoingCourse.startTime}–{ongoingCourse.endTime}
              </span>
            </p>
          </div>
        )}

        {next ? (
          <p className="mt-3 text-sm leading-6 text-white/70">
            {next.lesson.startTime}–{next.lesson.endTime}
            {next.lesson.course.building ? ` · ${next.lesson.course.building}` : ''}
            {next.lesson.course.room ? ` ${next.lesson.course.room}` : ''}
            {next.status === 'upcoming' && (
              <span className="text-white/50"> · 还有 {humanizeMinutes(next.minutesUntil)}</span>
            )}
          </p>
        ) : (
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">
            {nearestDeadline
              ? diffDays(todayIso, nearestDeadline.date) === 0
                ? `「${nearestDeadline.title}」就是今天。`
                : `最近的校园节点是「${nearestDeadline.title}」，还有 ${diffDays(todayIso, nearestDeadline.date)} 天。`
              : '把这段时间留给自己，也是安排的一部分。'}
          </p>
        )}

        {lessons.length > 0 && (
          <ul className="mt-4 divide-y divide-white/10 border-t border-white/10">
            {lessons.slice(0, LESSON_PREVIEW_MAX).map((lesson, index) => (
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
        {/* §11.3 反例纪律：总览不搬完整课表 —— 只预览前几节，其余给一条计数指引 */}
        {lessons.length > LESSON_PREVIEW_MAX && (
          <button
            type="button"
            onClick={onOpenWeek}
            className="mt-2 w-full rounded-lg py-1.5 text-left text-xs text-white/55 transition-colors hover:text-white/80"
          >
            今天还有 {lessons.length - LESSON_PREVIEW_MAX} 节课 —— 点开本周安排看全部
          </button>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={onOpenWeek}
            className="min-h-11 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-brand-light"
          >
            <span className="inline-flex items-center gap-1.5">
              打开本周安排
              {/* §9.6 G 组：主 CTA 内 arrow-right（只给主按钮） */}
              <Icon name="arrow-right" size="sm" />
            </span>
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

      </div>
    </section>
  );
}
