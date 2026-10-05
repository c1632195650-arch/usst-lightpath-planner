/**
 * 光溯移动端 · 每日采集弹窗（任务书 P3-2）
 * ============================================================
 *   · 每天首次打开弹一次、≤5 道、可跳过（不强制 —— 强制会让人乱答，污染数据）；
 *   · 题目行为锚定，选项带 0..4 分（只喂维度 5）；
 *   · 每题「看方法」→ 就地展开来源习惯库条目的标题与摘要（存 slug 不存副本）；
 *   · 一题一屏、完成即走，不遮挡主界面太久；
 *   · 弹窗是否出现的判定在 TodayPage（hasOfferedToday + pickQuestions），
 *     本组件只负责呈现与收集。
 */
import { useState } from 'react';
import type { MethodTipRef } from './eval/model.ts';
import type { QuizQuestion } from './eval/questionBank.ts';

export default function DailyQuizSheet({ questions, tipForSlug, onAnswer, onFinished }: {
  questions: readonly QuizQuestion[];
  /** slug → 方法卡（找不到则不渲染入口） */
  tipForSlug: (slug: string) => MethodTipRef | null;
  onAnswer: (question: QuizQuestion, optionIdx: number) => void;
  onFinished: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [openTip, setOpenTip] = useState<string | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);

  const done = idx >= questions.length;
  const q = done ? null : questions[idx];
  const tip = q ? tipForSlug(q.sourceSlug) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30" data-testid="m-quiz">
      <div className="w-full max-w-md rounded-t-2xl bg-paper px-4 pb-6 pt-4 shadow-lg">
        {done ? (
          <div className="py-6 text-center">
            <p className="text-base font-semibold text-ink">
              {answeredCount > 0 ? `记下了，答了 ${answeredCount} 道。明天见。` : '没关系，明天再来。'}
            </p>
            <button
              type="button"
              data-testid="m-quiz-close"
              onClick={onFinished}
              className="mt-4 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white"
            >
              好
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-ink-faint">
                每日小问 {idx + 1}/{questions.length} · 可跳过
              </p>
              <button
                type="button"
                data-testid="m-quiz-skip"
                onClick={onFinished}
                className="text-xs text-ink-faint underline"
              >
                跳过，今天不答
              </button>
            </div>
            <p data-testid="m-quiz-question" className="mt-3 text-base font-semibold leading-7 text-ink">{q!.text}</p>

            <div className="mt-3 space-y-2">
              {q!.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  data-testid={`m-quiz-opt-${i}`}
                  onClick={() => {
                    onAnswer(q!, i);
                    setAnsweredCount((c) => c + 1);
                    setIdx((x) => x + 1);
                    setOpenTip(null);
                  }}
                  className="w-full rounded-xl border border-ink/10 bg-paper-card px-3 py-2.5 text-left text-sm text-ink active:bg-brand-light"
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {tip && (
              <div className="mt-3">
                <button type="button" data-testid="m-quiz-tip" className="text-xs text-brand underline" onClick={() => setOpenTip((s) => (s === q!.sourceSlug ? null : q!.sourceSlug))}>
                  看方法
                </button>
                {openTip === q!.sourceSlug && (
                  <div className="mt-1 rounded-xl bg-paper-sunken px-3 py-2">
                    <p className="text-sm font-semibold text-ink">{tip.title}</p>
                    <p className="mt-1 text-xs leading-5 text-ink-soft">{tip.summary}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
