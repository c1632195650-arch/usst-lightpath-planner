/**
 * 每周复盘卡（设计书 §14.1）
 * ============================================================
 * 宽泛 / 路径未知目标的**具体化引擎**。
 * 不是"输入框"，而是「建议 + 确认」的循环。
 *
 * 建议来自方法库的元方法（implementation-intentions 等，与内容无关）。
 * 缺席降级：3 周未复盘 → 自动填一条建议；5 周 → 建议归档。
 */
import { useState } from 'react';
import type { Goal, WeekTheme } from './goalStore';

const SCAFFOLDS = [
  '写下 3 个你想用这个技能解决的小问题',
  '想想最近一次「要是有个工具帮我就好了」是什么场景',
  '找 3 个你羡慕别人做出来的东西，看看它们是用什么做的',
];

export function WeeklyReviewCard({
  goal, weekNo, lastDone, lastTotal, onSave, onSkip,
}: {
  goal: Goal;
  weekNo: number;
  /** 上周实际完成分钟数（来自 behaviorLog） */
  lastDone: number | null;
  lastTotal: number;
  onSave: (theme: { text: string; source: 'user' | 'suggested'; at: string }) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState('');
  const hasTheme = goal.weekThemes?.[weekNo] != null;
  if (hasTheme) return null; // 本周已复盘

  const pct = lastTotal > 0 && lastDone != null ? Math.round((lastDone / lastTotal) * 100) : null;
  const missed = goal.reviewMissed?.length ?? 0;

  const save = () => {
    if (!text.trim()) return;
    onSave({ text: text.trim(), source: 'user', at: new Date().toISOString() });
  };
  const skip = () => onSkip();

  return (
    <div className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-ink/10">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-medium text-ink">本周复盘 · {goal.title}</span>
        {pct != null && (
          <span className={`text-[10.5px] ${pct >= 70 ? 'text-green-700' : 'text-amber-700'}`}>
            上周完成率 {pct}%
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input type="text" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="下周想做什么？（可不填）"
          className="flex-1 rounded border border-ink/10 px-2 py-1 text-[11.5px] text-ink placeholder:text-ink-faint focus:border-ink/25 focus:outline-none" />
        <button type="button" onClick={save} disabled={!text.trim()}
          className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-30">
          ↵
        </button>
        <button type="button" onClick={skip}
          className="rounded px-2 py-1 text-[11px] text-ink-faint hover:text-ink">跳过</button>
      </div>
      {missed >= 2 && (
        <p className="mt-1 text-[10.5px] text-amber-700">
          已连续 {missed} 周未复盘 —— 建议暂停或调整这个目标。
        </p>
      )}
    </div>
  );
}
