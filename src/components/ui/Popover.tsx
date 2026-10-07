import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * 气泡 Popover / 工具提示 Tooltip（UI v2 §10.4.2）。
 * 打断程度从轻到重：Tooltip → Toast → Popover → 抽屉 → 模态——能用轻的就不用重的。
 *
 * Popover：可承载文字 + 一个动作；不带遮罩，点外部 / Esc 关闭；
 *   触发器悬停**不会**让它消失（悬停消失是 Tooltip 的禁忌——手抖到面板上就没了）。
 * Tooltip：纯文字、只有名称；悬停 400ms 才出（扫过不出），触屏上不出现（无 hover）。
 */

export const TOOLTIP_DELAY_MS = 400;

interface PopoverProps {
  /** 触发器（按钮等）；popover 面板挂在其下方 */
  trigger: (o: { open: boolean; toggle: () => void; ref: (el: HTMLElement | null) => void; ariaId: string }) => ReactNode;
  children: ReactNode;
  /** 初始展开（SSR 测试与文档演示用；交互中仍按 Esc/点外部收起） */
  defaultOpen?: boolean;
  /** 面板内动作点击后自动收起 */
  onAction?: () => void;
  actionLabel?: string;
  className?: string;
}

export function Popover({ trigger, children, defaultOpen = false, onAction, actionLabel, className = '' }: PopoverProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ariaId = useRef(`pop-${Math.random().toString(36).slice(2, 8)}`).current;

  // 点外部关闭 + Esc 关闭；触发器悬停不消失（无 mouseleave 逻辑即天然满足）
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      {trigger({ open, toggle: () => setOpen((v) => !v), ref: () => {}, ariaId })}
      {open && (
        <div
          id={ariaId}
          role="dialog"
          aria-label="详情气泡"
          data-testid="popover-panel"
          className="absolute left-1/2 top-full z-40 mt-2 w-64 -translate-x-1/2 rounded-xl border border-ink/10 bg-white p-3.5 text-sm leading-6 text-ink shadow-card"
        >
          {children}
          {actionLabel && (
            <button
              type="button"
              data-testid="popover-action"
              onClick={() => { onAction?.(); setOpen(false); }}
              className="mt-2 text-sm font-semibold text-brand underline underline-offset-2"
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface TooltipProps {
  /** 纯文字（只有名称） */
  text: string;
  children: ReactNode;
  className?: string;
}

/** 工具提示：悬停 400ms 延迟出（纯 CSS transition-delay，零 JS）；触屏（无 hover 设备）不出现。 */
export function Tooltip({ text, children, className = '' }: TooltipProps) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-white opacity-0 transition-[opacity] duration-fast ease-out group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
        style={{ transitionDelay: `${TOOLTIP_DELAY_MS}ms` }}
      >
        {text}
      </span>
    </span>
  );
}
