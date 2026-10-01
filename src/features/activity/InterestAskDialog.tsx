/**
 * InterestAskDialog —— 兴趣追问弹窗（总览页改版 批次 5 · 量化一期）
 * ============================================================
 * 画像完成时，若问卷命中「比赛 / 长期学习目标」兴趣（goalTemplates.interestAskHit），
 * 弹窗追问：哪类 → 哪个比赛/目标 → 截止日期 → 总投入 → 节奏，
 * 展示文字版阶段计划后生成 `Goal(source:'auto')` —— 走现有 goalTasksOf 通道排程。
 *
 * 三条纪律（与 ActivityCapture 同源）：
 *   1. **可跳过、不阻塞**：跳过写 dismissed 标记，永不再弹；
 *   2. **模板只是预填建议**：所有字段可改；
 *   3. **不双写**：只往 goalStore 写一条 Goal，后续改/删走 GoalEditor。
 */
import { useState } from 'react';
import {
  GOAL_PACE_LABEL, makeGoalId,
  type Goal, type GoalPace,
} from './goalStore';
import { GOAL_TEMPLATES, templateToGoal, type GoalTemplate } from './goalTemplates';

/** 跳过后不再纠缠的标记 key */
export const INTEREST_ASK_DISMISSED_KEY = 'usst-interest-ask-dismissed-v1';

interface Props {
  onConfirm: (goal: Goal) => void;
  onSkip: () => void;
}

const PACES: GoalPace[] = ['steady', 'sprint', 'both'];

export function InterestAskDialog({ onConfirm, onSkip }: Props) {
  /** 'custom' = 不用模板，全手填 */
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [hours, setHours] = useState(40);
  const [pace, setPace] = useState<GoalPace>('steady');

  const template: GoalTemplate | null =
    GOAL_TEMPLATES.find((t) => t.id === templateId) ?? null;

  const pick = (t: GoalTemplate | null) => {
    setTemplateId(t?.id ?? 'custom');
    if (t) {
      setTitle(t.title);
      setDueAt(t.suggestedDueAt ?? '');
      setHours(t.suggestedHours);
      setPace(t.pace);
    } else {
      setTitle('');
      setDueAt('');
      setHours(40);
      setPace('steady');
    }
  };

  const canSubmit = title.trim().length > 0 && dueAt !== '' && hours > 0;

  const submit = () => {
    if (!canSubmit || !templateId) return;
    const t: GoalTemplate = template ?? {
      id: 'custom', title: '', kind: 'contest', emoji: '🏆',
      suggestedHours: hours, pace, planText: '',
    };
    onConfirm(templateToGoal(t, { title: title.trim(), dueAt, totalHours: hours, pace }, makeGoalId()));
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/45 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="兴趣追问">
      <div className="panel w-full max-w-md p-5 sm:p-6">
        <p className="section-label">GOAL</p>
        <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink">把它变成一个可以排进日程的目标</h2>
        <p className="mt-1.5 text-sm leading-6 text-ink-soft">
          你的问卷显示你可能对比赛或长期学习目标有兴趣。填一个截止日期，
          我们会把它拆成每周的投入块排进周程 —— 不想排就跳过，随时可以在目标面板建。
        </p>

        {templateId === null ? (
          <div className="mt-4 grid grid-cols-1 gap-2">
            {GOAL_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t)}
                className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-brand-light/50"
              >
                <span className="text-xl">{t.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{t.title}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                    建议投入约 {t.suggestedHours} 小时{t.suggestedDueAt ? ` · 常见截止 ${t.suggestedDueAt}` : ''}
                  </span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => pick(null)}
              className="rounded-xl border border-dashed border-ink/15 px-3 py-2.5 text-left text-sm text-ink-soft transition-colors hover:border-brand/40 hover:bg-brand-light/40"
            >
              ＋ 其它目标（自己填）
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">叫什么</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-brand/40 focus:outline-none"
                placeholder="如：数学建模国赛备赛"
              />
            </label>
            <div className="flex gap-3">
              <label className="block min-w-0 flex-1">
                <span className="text-xs font-medium text-ink-soft">截止日期</span>
                <input
                  type="date"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-brand/40 focus:outline-none"
                />
              </label>
              <label className="block w-28">
                <span className="text-xs font-medium text-ink-soft">总投入（小时）</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={hours}
                  onChange={(e) => setHours(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-2.5 py-2 text-sm text-ink tabular-nums focus:border-brand/40 focus:outline-none"
                />
              </label>
            </div>
            <div>
              <span className="text-xs font-medium text-ink-soft">投入节奏</span>
              <div className="mt-1 flex gap-1.5">
                {PACES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPace(p)}
                    className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
                      pace === p ? 'bg-brand text-white' : 'bg-white text-ink-soft ring-1 ring-ink/10 hover:bg-brand-light'
                    }`}
                  >
                    {GOAL_PACE_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            {template?.planText && (
              <div className="rounded-xl border border-ink/10 bg-paper px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">初步计划参考：</span>{template.planText}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setTemplateId(null)}
                className="text-xs text-ink-faint hover:text-ink-soft"
              >
                ← 换一个
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={onSkip} className="rounded-xl px-3 py-2 text-sm text-ink-soft hover:text-ink">
                  跳过
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="button-primary px-4 py-2 text-sm disabled:opacity-40"
                >
                  建为目标并排进日程
                </button>
              </div>
            </div>
          </div>
        )}

        {templateId === null && (
          <div className="mt-4 border-t border-ink/10 pt-3 text-right">
            <button type="button" onClick={onSkip} className="text-xs text-ink-faint hover:text-ink-soft">
              跳过，以后再说
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
