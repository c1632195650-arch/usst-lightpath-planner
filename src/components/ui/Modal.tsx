import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * 模态 / 抽屉（UI v2 §10.4.2）。
 * 模态会遮住上下文——只有「必须做决定才能继续」时才用（如删除确认）；
 * 偏好调整、改时间这类轻决策用抽屉。
 * 模态职责：焦点归还（关闭时回到打开前的元素）、Esc 关闭、role=dialog + aria-modal。
 */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 危险动作确认时，主按钮由调用方用 danger 语义渲染 */
  actions?: ReactNode;
  testId?: string;
}

export function Modal({ open, onClose, title, children, actions, testId = 'modal' }: ModalProps) {
  const lastActive = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      lastActive.current = document.activeElement;
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('keydown', onKey);
        // 关闭时焦点归还到打开前的元素（模态会打断上下文，还回去是基本礼貌）
        if (lastActive.current instanceof HTMLElement) lastActive.current.focus();
      };
    }
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/45" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="relative w-full max-w-sm rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_24px_72px_rgba(22,35,63,0.24)]"
      >
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-ink-soft">{children}</div>
        {actions && <div className="mt-4 flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** 从哪侧滑出：移动端偏好默认右下 */
  side?: 'right' | 'bottom';
  testId?: string;
}

export function Drawer({ open, onClose, title, children, actions, side = 'right', testId = 'drawer' }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const pos = side === 'right'
    ? 'right-0 top-0 h-full w-80 max-w-[88vw] rounded-l-2xl'
    : 'bottom-0 inset-x-0 rounded-t-2xl';
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className={`absolute ${pos} border border-ink/10 bg-white p-5 shadow-[0_18px_44px_rgba(22,35,63,0.18)]`}
      >
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-ink-soft">{children}</div>
        {actions && <div className="mt-4 flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
