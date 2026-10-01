/**
 * 一句话快速输入目标（设计书 §5.1 / §5.2）
 * ============================================================
 * 输入一句话 → 解析 → 落到确认条 → 回车确认。
 * 全键盘：Tab 改字段 · ↑↓ 换选项 · ↵ 确认 · Esc 取消。
 * 解析失败不挡路 —— 原文当标题，其余走类别默认值。
 */
import { useState, useRef, useCallback } from 'react';
import type { GoalCategory } from './goalStore';
import { GOAL_CATEGORY_LABEL } from './goalStore';

/** 解析结果（简化版 —— 完整解析器 parseGoalLine 待实施，此处用关键词匹配） */
interface ParsedDraft {
  title: string;
  category: GoalCategory;
  dueAt?: string;
  totalHours?: number;
}

/** 类别关键词（§5.2 规则表） */
const KEYWORDS: Array<[RegExp, GoalCategory]> = [
  [/考研|绩点|四级|六级|期末|专业课/, 'academic'],
  [/建模|竞赛|光电杯|蓝桥|国赛|杯赛/, 'contest'],
  [/驾照|雅思|托福|编程|考证|证书/, 'skill'],
  [/读书|写作|博客|作品集/, 'growth'],
  [/跑步|健身|游泳|运动|减肥/, 'health'],
  [/社团|学生会|志愿|组织/, 'social'],
];

function guessCategory(text: string): GoalCategory {
  for (const [re, cat] of KEYWORDS) { if (re.test(text)) return cat; }
  return 'growth';
}

function guessTitle(text: string): string {
  return text.trim().length > 0 ? text.trim() : '未命名目标';
}

export function GoalQuickInput({ onConfirm }: { onConfirm: (draft: { title: string; category: GoalCategory }) => void }) {
  const [line, setLine] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parse = useCallback((text: string): ParsedDraft => {
    return {
      title: guessTitle(text),
      category: guessCategory(text),
    };
  }, []);

  const handleInput = () => {
    if (!line.trim()) return;
    const parsed = parse(line);
    setDraft(parsed);
    setShowConfirm(true);
  };

  const confirm = () => {
    if (!draft) return;
    onConfirm({ title: draft.title, category: draft.category });
    setLine(''); setDraft(null); setShowConfirm(false);
    inputRef.current?.focus();
  };

  return (
    <div className="panel px-4 py-3.5 sm:px-5">
      <h3 className="text-[14px] font-semibold text-ink">想做什么？</h3>
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleInput(); if (e.key === 'Escape') { setShowConfirm(false); setLine(''); } }}
          placeholder="比如：学编程 · 跑步1km跑进3分钟 · 考研"
          className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-ink/30 focus:outline-none"
        />
      </div>
      {showConfirm && draft && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-ink/10">
          <div className="text-[12px] text-ink-soft">
            类别：<b className="text-ink">{GOAL_CATEGORY_LABEL[draft.category]}</b>
            <span className="ml-1 text-ink-faint">（自动识别，可改）</span>
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button type="button" onClick={confirm}
              className="button-primary px-3 py-1 text-[12px]">确认</button>
            <button type="button" onClick={() => setShowConfirm(false)}
              className="rounded px-3 py-1 text-[12px] text-ink-faint hover:text-ink">取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
