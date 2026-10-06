/**
 * 光溯移动端 · 执行力评估区（任务二交付的接线封装，M3-W5 由任务三会话迁入组件）
 * ============================================================
 * 原 TodayPage 内联的评估装配（行为日志 → 五维输入 → profile/series → 每日采集弹窗）
 * 原样迁到这里， TodayPage 只留 3 行状态（behaviorEvents 由 onAction 刷新）。
 * 计算全部走 eval/ 纯函数；三铁律由 compute.ts/EvalPanel 承担（不给总分 /
 * unknown 不降级 gap / 缺项哨兵）。
 * 任务三 todos[] 已落地：中长期待办进 lateTodos（拖延指数）、待办类别进题库选题。
 */
import { useEffect, useMemo, useState } from 'react';
import type { WeekPlan } from '@/types';
import type { SyncStatePayload } from './lib/types.ts';
import type { UserPlanLayer } from '@/features/week/userPlanStore';
import EvalPanel from './EvalPanel.tsx';
import DailyQuizSheet from './DailyQuizSheet.tsx';
import { computeExecutionProfile, dailySeries, offsetDayKey, tipForSlug } from './eval/compute.ts';
import { EMPTY_EVAL_INPUT, type EvalInput } from './eval/model.ts';
import {
  hasOfferedToday, loadShown, recordAnswer, recordShown, slugLastShown,
  toSelfReportAnswers, type ShownRecord,
} from './eval/answerStore.ts';
import { QUESTION_BANK, pickQuestions, fallbackCategory, categoriesFromTodoKinds, type QuizQuestion } from './eval/questionBank.ts';
import { completionUnits, inUseDays } from './eval/units.ts';
import { finalDoneKeys, firstEventDayKey, localDateKey, toCheckRecords, type BehaviorEvent } from './eval/behaviorLog.ts';

/** 粗粒度完成期 '2026-10-中旬' → 该时段最后一天的日历日（拖延指数的比较锚点） */
function periodEndDayKey(pd: string): string {
  const m = /^(\d{4})-(\d{2})-(上旬|中旬|下旬)$/.exec(pd ?? '');
  if (!m) return pd;
  const [, y, mo, part] = m;
  const endDay = part === '上旬' ? 10 : part === '中旬' ? 20 : new Date(Number(y), Number(mo), 0).getDate();
  return `${y}-${mo}-${String(endDay).padStart(2, '0')}`;
}

export default function EvalSection({ plan, serverState, layer, phase, todayKey, behaviorEvents }: {
  plan: WeekPlan | null;
  serverState: SyncStatePayload | null;
  layer: UserPlanLayer;
  phase: 'loading' | 'empty-cloud' | 'ready' | 'error';
  todayKey: string;
  /** TodayPage onAction 里 recordBlockToggle 后刷新（唯一从外部进的副作用信号） */
  behaviorEvents: BehaviorEvent[];
}) {
  const [shownRows, setShownRows] = useState<ShownRecord[]>(() => loadShown(localStorage));
  const [quiz, setQuiz] = useState<{ dayKey: string; questions: QuizQuestion[] } | null>(null);

  const evalDays = useMemo(() => {
    const out: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const k = offsetDayKey(todayKey, -i);
      if (k) out.push(k);
    }
    return out;
  }, [todayKey]);
  const evalInput = useMemo<EvalInput>(() => {
    if (!plan || !serverState) return EMPTY_EVAL_INPUT;
    const lateTodos = (serverState.todos ?? [])
      .filter((t) => t.kind === 'longterm' && t.plannedDone)
      .map((t) => ({
        todoId: t.id,
        horizon: 'long' as const,
        plannedDoneDayKey: periodEndDayKey(t.plannedDone!),
        actualDoneDayKey: t.completion === 'done' && t.actualDoneAt
          ? localDateKey(new Date(t.actualDoneAt))
          : null,
      }));
    return {
      // 铁律 2（2026-10-06 验收缺陷①）：完成率只统计「App 在用」的日子——
      // 首个行为事件前的日子没有可信完成数据，虚构 done=false 会让冷启动恒显 0%。
      units: completionUnits({
        plan, layer, termStart: serverState.termStart,
        days: inUseDays(evalDays, firstEventDayKey(behaviorEvents)),
        doneKeys: finalDoneKeys(behaviorEvents),
      }),
      lateTodos,
      checks: toCheckRecords(behaviorEvents),
      answers: toSelfReportAnswers(shownRows),
    };
  }, [plan, serverState, layer, evalDays, behaviorEvents, shownRows]);
  const profile = useMemo(() => computeExecutionProfile(evalInput, todayKey), [evalInput, todayKey]);
  const series = useMemo(() => dailySeries(evalInput, evalDays), [evalInput, evalDays]);

  /* 每日采集弹窗（每天首次打开；题库空 = BLOCKED 于任务一，静默不弹）；
     待办类别接入：最近/中长期待办决定题库侧重（任务三 todos[] 已可用） */
  useEffect(() => {
    if (phase !== 'ready' || !serverState) return;
    const tk = todayKey;
    if (hasOfferedToday(localStorage, tk)) return;
    const kinds = (serverState.todos ?? [])
      .filter((t) => !t.archived && t.completion !== 'done')
      .map((t) => t.kind);
    const picked = pickQuestions({
      bank: QUESTION_BANK,
      categories: categoriesFromTodoKinds(kinds) ?? fallbackCategory(),
      todayKey: tk,
      slugLastShown: slugLastShown(loadShown(localStorage)),
    });
    if (picked.length === 0) return;
    recordShown(localStorage, { todayKey: tk, questions: picked });
    setShownRows(loadShown(localStorage));
    setQuiz({ dayKey: tk, questions: picked });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, todayKey]);

  return (
    <>
      {/* 任务二 P3-1 · 「我的执行状态」（Today 页底部，不干扰执行） */}
      <EvalPanel profile={profile} series={series} />
      {quiz && (
        <DailyQuizSheet
          questions={quiz.questions}
          tipForSlug={tipForSlug}
          onAnswer={(q, optionIdx) => {
            recordAnswer(localStorage, { todayKey: quiz.dayKey, question: q, optionIdx });
            setShownRows(loadShown(localStorage));
          }}
          onFinished={() => setQuiz(null)}
        />
      )}
    </>
  );
}
