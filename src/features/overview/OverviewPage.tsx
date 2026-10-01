/**
 * 总览页 = 「今天」（总览页改版 批次 4）
 * ============================================================
 * RAY 拍板（2026-09-20）：
 *   · 删 WeekStrip（统计节数无决策价值）/ 校历 + MonthCalendar（静态数据没人用）
 *     / TodayCard（「下一节课」只是今天的切片）；
 *   · 总览主体 = **排程后的完整今天**：课程/三餐/目标块/准备块/手动事项 + 空闲块；
 *   · 右栏 = 「截止与重要日期」（统一日期层，批次 2）。
 *
 * 数据源：`useWeekPlan` 共享计算管线（批次 3）—— 与周程页同一份算法口径；
 * 总览是**只读消费者**：不传 `onPlanStateChange`（不回写 planState）、
 * layer/rules 一次性快照、fromNowOn 恒 false（要完整一天，不砍过去时段）。
 * 编辑全部去周程页做 —— 这里点击块就是跳转。
 *
 * 设计约束（UI 评估结论）：深色只做头部条，日程列保持白底
 * （BlockCard 全套配色为浅底调的，总览用只读简化行，不做整套深色重调）。
 */
import { useEffect, useMemo, useState } from 'react';
import type { PersonaProfile, PlanPersistState, Schedule, TimeBlock } from '@/types';
import { DEADLINES } from '@/data/usst';
import { shortCN, weekdayCN, weekdayOf } from '@/lib/date';
import { toHHmm } from '@/constants/time';
import { weatherHints } from '@/features/weather/weather';
import { lessonsOn } from '@/lib/today';
import { DeadlineBoard } from '@/features/calendar/DeadlineBoard';
import type { Goal } from '@/features/activity/goalStore';
import { useWeekPlan } from '@/features/week/useWeekPlan';
import { applyPendingMoves, loadUserPlan, movesOfWeek, type UserPlanLayer } from '@/features/week/userPlanStore';
import { loadRules } from '@/features/feedback/store';
import { freeGapsOf } from '@/features/week/timeScale';

interface Props {
  schedule: Schedule;
  /** 今天所在周次（App 传入） */
  weekNo: number;
  todayIso: string;
  persona: PersonaProfile | null;
  planState: PlanPersistState | null;
  goals: readonly Goal[];
  onOpenWeek: (iso: string) => void;
  onStartPersona: () => void;
  /** V0-3：onboarding checklist 卡（App 组装，全部完成时组件自隐藏） */
  onboardingCard?: React.ReactNode;
}

/** 块类别 → 视觉（与周程页 KIND_STYLE 同色系，只读精简版） */
const KIND_CHIP: Record<string, { bg: string; label: string }> = {
  course: { bg: 'bg-blue-100 text-blue-900', label: '课' },
  meal: { bg: 'bg-amber-100 text-amber-900', label: '饭' },
  study: { bg: 'bg-green-100 text-green-800', label: '学' },
  activity: { bg: 'bg-purple-100 text-purple-900', label: '动' },
  user: { bg: 'bg-pink-100 text-pink-900', label: '我' },
  commute: { bg: 'bg-gray-100 text-gray-700', label: '走' },
  blank: { bg: 'bg-white text-gray-400', label: '空' },
};

function chipOf(b: TimeBlock): { bg: string; label: string } {
  return KIND_CHIP[b.kind] ?? (b.source === 'course' ? KIND_CHIP.course : KIND_CHIP.user);
}

/** 只读块行 —— 点击跳周程编辑 */
function TodayBlockRow({ block, onOpenWeek }: { block: TimeBlock; onOpenWeek: () => void }) {
  const chip = chipOf(block);
  const place = [block.place, block.room].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      onClick={onOpenWeek}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-brand-light/50"
      title="去周程查看/编辑"
    >
      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${chip.bg}`}>
        {chip.label}
      </span>
      <span className="w-24 shrink-0 text-xs text-ink-faint tabular-nums">
        {toHHmm(block.startMin)}–{toHHmm(block.endMin)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{block.title}</span>
        {place && <span className="mt-0.5 block truncate text-xs text-ink-faint">{place}</span>}
      </span>
      <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">
        {block.endMin - block.startMin} 分钟
      </span>
    </button>
  );
}

/** 空闲块 —— 「这半天还剩什么」比「排了什么」更常被问 */
function IdleRow({ startMin, endMin, onOpenWeek }: { startMin: number; endMin: number; onOpenWeek: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenWeek}
      className="flex w-full items-center gap-3 rounded-xl border border-dashed border-ink/15 px-2 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-brand-light/40"
      title="去周程安排这段时间"
    >
      <span className="w-24 shrink-0 text-xs text-ink-faint tabular-nums">
        {toHHmm(startMin)}–{toHHmm(endMin)}
      </span>
      <span className="flex-1 text-sm text-ink-soft">⬜ 空闲 · 可安排</span>
      <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">{endMin - startMin} 分钟</span>
    </button>
  );
}

export function OverviewPage({
  schedule, weekNo, todayIso, persona, planState, goals, onOpenWeek, onStartPersona, onboardingCard,
}: Props) {
  /** 只读快照：总览不改覆盖层 —— 改动去周程页做（状态所有权在周程） */
  const [layer] = useState<UserPlanLayer>(() => loadUserPlan());
  const [rules] = useState(() => loadRules());

  const {
    plan, loading, weather,
  } = useWeekPlan({
    schedule, weekNo, persona, planState,
    // 🔴 只读模式：不传 onPlanStateChange —— 总览绝不写回 planState
    layer, goals, rules,
    fromNowOn: false,
  });

  const todayDow = useMemo(() => {
    const d = weekdayOf(todayIso); // 0 = 周日
    return (d === 0 ? 7 : d) as number;
  }, [todayIso]);

  /** 屏幕口径与周程页一致：应用未生效的移动 + 过滤已删除的块 */
  const todayBlocks = useMemo(() => {
    if (!plan) return [];
    const moveMap = movesOfWeek(layer.moves, weekNo);
    const shown = applyPendingMoves(plan, moveMap);
    const excluded = new Set(layer.excluded);
    return shown.blocks
      .filter((b) => b.dayOfWeek === todayDow && !excluded.has(b.id))
      .sort((a, b) => a.startMin - b.startMin);
  }, [plan, layer, weekNo, todayDow]);

  /** 空闲块：≥30 分钟（与周程页 freeGapsOf 同一口径） */
  const idleGaps = useMemo(
    () => (plan ? freeGapsOf(todayBlocks, todayDow) : []),
    [plan, todayBlocks, todayDow],
  );

  /** 今天有事的日期 id → 右栏标「今日」而非重复倒计时 */
  const todayHighlightedIds = useMemo(() => {
    const ids: string[] = [];
    for (const e of DEADLINES) if (e.date === todayIso) ids.push(`builtin-${e.id}`);
    for (const g of goals) if (g.dueAt === todayIso) ids.push(`goal-${g.id}`);
    return ids;
  }, [todayIso, goals]);

  /** 天气摘要（头部条一行；提醒阈值的日子用 weatherHints 的人话） */
  const weatherLine = useMemo(() => {
    if (!weather) return null;
    const day = weather.days.find((d) => d.date === todayIso);
    if (!day) return null;
    const hint = weatherHints(weather).find((a) => a.date === todayIso);
    if (hint) return `${hint.emoji} ${hint.label} · ${hint.detail}`;
    const temps = day.tMin != null && day.tMax != null ? ` ${day.tMin}–${day.tMax}℃` : '';
    return `${day.text}${temps}`;
  }, [weather, todayIso]);

  /** 排程不可用（学期外/未生成）→ 退回课表当日，不猜 */
  const fallbackLessons = useMemo(
    () => (plan ? [] : lessonsOn(schedule, todayIso)),
    [plan, schedule, todayIso],
  );

  const openWeek = () => onOpenWeek(todayIso);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      {onboardingCard}
      <div className="flex flex-col gap-6">
        <section className="overflow-hidden rounded-2xl border border-ink/[0.07] bg-white shadow-[0_8px_28px_rgba(22,35,63,0.06)]">
          {/* 深色头部条：只放「今天」的元信息，不放块 */}
          <div className="hero-surface-flat px-5 py-6 text-white sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">
              WEEK {String(Math.max(1, weekNo)).padStart(2, '0')} · {shortCN(todayIso)} {weekdayCN(todayIso)}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">今天</h1>
            {weatherLine && (
              <p className="mt-1.5 text-sm text-white/70">{weatherLine}</p>
            )}
            {!persona && (
              <button onClick={onStartPersona} className="button-on-dark mt-4">
                完成画像测评，排程更贴合你的节奏
              </button>
            )}
          </div>

          {/* 白底日程列 */}
          <div className="px-3 py-3 sm:px-5 sm:py-4">
            {loading && (
              <p className="px-2 py-8 text-center text-sm text-ink-soft">正在排这一周……</p>
            )}

            {!loading && plan && todayBlocks.length === 0 && idleGaps.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-ink-soft">
                今天没有安排 —— 把这段时间留给自己，也是安排的一部分。
              </p>
            )}

            {!loading && plan && (todayBlocks.length > 0 || idleGaps.length > 0) && (
              <div className="flex flex-col gap-1">
                {todayBlocks.map((b) => (
                  <TodayBlockRow key={b.id} block={b} onOpenWeek={openWeek} />
                ))}
                {idleGaps.map((g) => (
                  <IdleRow
                    key={`idle-${g.startMin}`}
                    startMin={g.startMin}
                    endMin={g.endMin}
                    onOpenWeek={openWeek}
                  />
                ))}
              </div>
            )}

            {!loading && !plan && (
              fallbackLessons.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="px-2 py-2 text-xs text-ink-faint">
                    还没有本周的排程计划 —— 下面是今天的课表，去周程生成计划后这里会显示完整安排。
                  </p>
                  {fallbackLessons.map((l, i) => (
                    <div key={`${l.course.id}-${i}`} className="flex items-center gap-3 px-2 py-2.5">
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${KIND_CHIP.course.bg}`}>
                        课
                      </span>
                      <span className="w-24 shrink-0 text-xs text-ink-faint tabular-nums">
                        {l.startTime}–{l.endTime}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{l.course.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-faint">
                          {[l.course.building, l.course.room].filter(Boolean).join(' ')}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-8 text-center text-sm text-ink-soft">
                  这个周次不在学期范围内，或还没有生成计划 —— 去周程页生成。
                </p>
              )
            )}
          </div>

          <div className="border-t border-ink/[0.07] px-5 py-4 sm:px-7">
            <button onClick={openWeek} className="button-primary w-full sm:w-auto sm:px-6">
              查看 / 编辑本周安排
            </button>
          </div>
        </section>
      </div>

      <aside className="lg:sticky lg:top-20">
        <DeadlineBoard
          termStart={schedule.termStart}
          totalWeeks={schedule.totalWeeks}
          goals={goals}
          todayHighlightedIds={todayHighlightedIds}
          onOpenWeek={onOpenWeek}
        />
      </aside>
    </div>
  );
}
