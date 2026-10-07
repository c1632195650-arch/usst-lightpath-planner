/**
 * 右键空档 → 「加一件事」小弹窗（2026-10-07 RAY 拍板：右键旁小形态）
 * ============================================================
 * 在光标旁弹一张 240px 的小卡：事件名 + 持续时间 + 类型（自动判断、可改）+
 * 起止预览。提交后由调用方（WeekPlanView）落成固定 UserTask 并**立即生效**。
 *
 * 交互纪律（与 BlockCard 右键菜单同一套）：
 * · Esc / 点外部 / 滚动 / 缩放 → 关闭；
 * · fixed 定位在光标处，打开时夹回视口（弹窗按 248×246 估）；
 * · 类型默认走 `guessTaskKind(事件名)` 自动判断 —— 用户手动点过类型后
 *   不再跟随标题变化（用户意图优先于自动猜测）。
 */
import { useEffect, useRef, useState } from 'react';
import type { BlockKind } from '@/types';
import { KIND_PALETTE } from '@/constants/chartColors';
import { toHHmm } from '@/constants/time';
import { DAY_LABELS } from './weekViewUtils';
import { durationChoices, guessTaskKind } from './gapAdd';

export interface GapAddDraft {
  title: string;
  durationMin: number;
  kind: BlockKind;
}

interface Props {
  day: number;
  /** 已含 20 分钟转场缓冲的确定开始时刻 */
  startMin: number;
  /** 空档剩余容量（分钟）——时长选项的封顶 */
  capacityMin: number;
  /** 右键光标的视口坐标 */
  x: number;
  y: number;
  onSubmit: (d: GapAddDraft) => void;
  onClose: () => void;
}

const KIND_OPTIONS: Array<{ k: BlockKind; label: string }> = [
  { k: 'activity', label: '活动' },
  { k: 'study', label: '自习' },
  { k: 'meal', label: '用餐' },
];

export function GapAddPopover({ day, startMin, capacityMin, x, y, onSubmit, onClose }: Props) {
  const [title, setTitle] = useState('');
  const choices = durationChoices(capacityMin);
  const [durationMin, setDurationMin] = useState(() =>
    choices.includes(60) ? 60 : (choices[choices.length - 1] ?? 60));
  const [kind, setKind] = useState<BlockKind>('activity');
  /** 用户手动点过类型后，不再跟随标题的自动判断 */
  const kindTouched = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* 标题变化 → 自动判断类型（未手动干预时） */
  useEffect(() => {
    if (!kindTouched.current) setKind(guessTaskKind(title));
  }, [title]);

  /* Esc / 点外部 / 滚动 / resize 关闭（与 BlockCard 右键菜单同一套） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const canSubmit = title.trim().length > 0 && choices.length > 0;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="在空闲段加一件事"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 248)),
        top: Math.max(8, Math.min(y, window.innerHeight - 246)),
      }}
      className="fixed z-50 w-60 rounded-lg bg-white p-3 shadow-xl ring-1 ring-ink/10"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">
          在 {DAY_LABELS[day - 1]} {toHHmm(startMin)} 加一件事
        </span>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="rounded px-1 text-[12px] leading-none text-ink-faint hover:bg-slate-100 hover:text-ink-soft"
        >
          ✕
        </button>
      </div>
      <p className="mt-0.5 font-mono text-[10.5px] text-ink-faint">
        {toHHmm(startMin)}–{toHHmm(startMin + durationMin)}（固定，重排不挪）
      </p>

      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) onSubmit({ title: title.trim(), durationMin, kind }); }}
        placeholder="做什么？（例：跑步 / 背单词）"
        className="mt-2 w-full rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand"
      />

      <div className="mt-2 flex items-center gap-1.5">
        <select
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-[12px] text-ink"
        >
          {choices.map((m) => (
            <option key={m} value={m}>{m} 分钟</option>
          ))}
        </select>
        {/* 类型（自动判断上色；点一下就改，改后不再跟随标题） */}
        <div className="flex gap-1">
          {KIND_OPTIONS.map(({ k, label }) => {
            const p = KIND_PALETTE[k];
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => { kindTouched.current = true; setKind(k); }}
                className={`rounded-full px-2 py-1 text-[11px] font-medium ring-1 transition-colors ${
                  on ? `${p.wash} ${p.text} ${p.line} ring-current` : 'bg-white text-ink-faint ring-ink/15 hover:text-ink-soft'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {choices.length === 0 && (
        <p className="mt-2 text-[11.5px] text-warn">
          空档在前后各 20 分钟转场缓冲后不足 15 分钟，塞不下事 —— 换个空档右键试试。
        </p>
      )}

      <button
        type="button"
        onClick={() => onSubmit({ title: title.trim(), durationMin, kind })}
        disabled={!canSubmit}
        className="button-primary mt-3 w-full py-1.5 text-[12.5px] disabled:cursor-not-allowed"
      >
        加进去
      </button>
    </div>
  );
}
