import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { GOAL_LABEL } from '@/constants/goals';
import type { GoalType } from '@/types';

/**
 * 画像问卷（演示版）
 *
 * 真实版会做 8–15 题 + 规则映射到 UserProfile，并把结果 patch 进全局状态。
 * 这里为了「看界面/看流程」，做成 5 题 + 即时预览画像。
 */

const QUESTIONS: {
  key: string;
  title: string;
  hint?: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: 'goal',
    title: '你大学阶段的目标是？',
    hint: '决定课程权重的分配方式',
    options: [
      { value: 'postgrad', label: '保研 / 考研' },
      { value: 'job', label: '就业 / 实习' },
      { value: 'abroad', label: '出国留学' },
      { value: 'contest', label: '竞赛 / 科研' },
      { value: 'explore', label: '还没想好' },
    ],
  },
  {
    key: 'chronotype',
    title: '你通常是哪种作息？',
    options: [
      { value: 'morning', label: '早起型' },
      { value: 'neutral', label: '中间型' },
      { value: 'night', label: '夜猫子' },
    ],
  },
  {
    key: 'peak',
    title: '你一天里效率最高是？',
    options: [
      { value: 'morning', label: '上午' },
      { value: 'afternoon', label: '下午' },
      { value: 'evening', label: '晚上' },
      { value: 'any', label: '随时' },
    ],
  },
  {
    key: 'ddl',
    title: '面对作业 DDL，你通常？',
    options: [
      { value: 'early', label: '提前一周开始' },
      { value: 'mid', label: '提前 2–3 天' },
      { value: 'late', label: '截止前一天' },
      { value: 'last', label: '经常赶最后一刻' },
    ],
  },
  {
    key: 'stress',
    title: '你的抗压程度（1 很脆弱 – 5 很抗压）？',
    options: [
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
      { value: '4', label: '4' },
      { value: '5', label: '5' },
    ],
  },
];

const CHRONO_LABEL: Record<string, string> = { morning: '晨型', neutral: '中间型', night: '夜型' };
const DDL_LABEL: Record<string, string> = {
  early: '提前规划', mid: '中等缓冲', late: '偏赶', last: '高压冲刺',
};

export default function QuizPage() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answered = Object.keys(answers).length;

  const goal = (answers.goal as GoalType) ?? 'explore';
  const chrono = CHRONO_LABEL[answers.chronotype] ?? '—';

  return (
    <div className="px-4">
      {/* 进度 */}
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">学习画像</span>
        <span className="text-[12px] text-ink-faint tabular-nums">{answered} / {QUESTIONS.length}</span>
      </div>
      <div className="h-1.5 rounded-full bg-paper-line overflow-hidden mb-5">
        <div
          className="h-full bg-brand transition-all duration-300"
          style={{ width: `${(answered / QUESTIONS.length) * 100}%` }}
        />
      </div>

      {/* 问题列表 */}
      <div className="space-y-5">
        {QUESTIONS.map((q) => (
          <Card key={q.key}>
            <h3 className="font-semibold text-[14.5px] text-ink mb-0.5">{q.title}</h3>
            {q.hint && <p className="text-[12px] text-ink-faint mb-3">{q.hint}</p>}
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => (
                <Chip
                  key={o.value}
                  active={answers[q.key] === o.value}
                  onClick={() => setAnswers((prev) => ({ ...prev, [q.key]: o.value }))}
                >
                  {o.label}
                </Chip>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* 即时画像预览 */}
      {answered > 0 && (
        <Card className="mt-5" title="你的画像预览" subtitle="会随你的选择实时变化">
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-lg bg-paper p-3">
              <div className="text-ink-faint text-[11.5px] mb-0.5">目标</div>
              <div className="font-semibold text-ink">{GOAL_LABEL[goal]}</div>
            </div>
            <div className="rounded-lg bg-paper p-3">
              <div className="text-ink-faint text-[11.5px] mb-0.5">作息</div>
              <div className="font-semibold text-ink">{chrono}</div>
            </div>
            <div className="rounded-lg bg-paper p-3">
              <div className="text-ink-faint text-[11.5px] mb-0.5">DDL 风格</div>
              <div className="font-semibold text-ink">{DDL_LABEL[answers.ddl] ?? '—'}</div>
            </div>
            <div className="rounded-lg bg-paper p-3">
              <div className="text-ink-faint text-[11.5px] mb-0.5">抗压度</div>
              <div className="font-semibold text-ink">{answers.stress ? `${answers.stress} / 5` : '—'}</div>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-ink-faint leading-relaxed">
            「保研」目标会优先保 GPA，核心课程与学分权重更高；「夜猫子」会把深度任务排到晚上——
            这些会直接进入排程引擎。
          </p>
        </Card>
      )}
    </div>
  );
}
