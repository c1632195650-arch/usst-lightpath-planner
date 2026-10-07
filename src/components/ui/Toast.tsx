import { useEffect, useState } from 'react';

/**
 * Toast（UI v2 §10.4.1）三规矩：
 *   ① 自动消失 2.4s，但带操作按钮的必须等用户点（不自动退）；
 *   ② 顶部居中或右下，不遮住正在操作的位置（本实现取右下）；
 *   ③ 一次最多 1 条，第 2 条排队而不是堆叠。
 * 时序逻辑抽成纯函数（pushToast/sweepToasts/visibleToast），可单测；
 * 交互态（弹出/退场动画）由调用方 hook useToastQueue 驱动。
 */

export type ToastTone = 'info' | 'ok' | 'error';

export interface ToastItem {
  id: number;
  text: string;
  tone?: ToastTone;
  /** 带操作按钮：永不自动退场（规矩①） */
  actionLabel?: string;
  onAction?: () => void;
  createdAt: number;
}

/** 规矩①：自动退场 2.4s */
export const TOAST_AUTO_MS = 2400;

/** 规矩③：队列只进不出（渲染时只露队首），硬顶防内存涨 */
export const TOAST_QUEUE_CAP = 8;

let nextId = 1;

/** 入队：一次最多露 1 条，后续排队；带 action 的同样排队。 */
export function pushToast(queue: ToastItem[], t: Omit<ToastItem, 'id' | 'createdAt'>, now: number): ToastItem[] {
  const next = [...queue, { ...t, id: nextId++, createdAt: now }];
  return next.length > TOAST_QUEUE_CAP ? next.slice(next.length - TOAST_QUEUE_CAP) : next;
}

/** 清扫：超 2.4s 且无操作按钮的出队（带按钮的等用户点）。 */
export function sweepToasts(queue: ToastItem[], now: number): ToastItem[] {
  return queue.filter((t) => (t.actionLabel != null) || now - t.createdAt < TOAST_AUTO_MS);
}

/** 规矩③：只露队首一条。 */
export function visibleToast(queue: ToastItem[]): ToastItem | null {
  return queue[0] ?? null;
}

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-ink/10 bg-white text-ink',
  ok: 'border-ok/30 bg-white text-ink',
  error: 'border-danger/40 bg-white text-ink',
};

interface StackProps {
  queue: ToastItem[];
  onDismiss: (id: number) => void;
  /** 测试锚点 */
  testId?: string;
}

/** 右下角 Toast 栈：一次最多 1 条；aria-live=polite 对读屏播报。 */
export function ToastStack({ queue, onDismiss, testId = 'toast-stack' }: StackProps) {
  const t = visibleToast(queue);
  return (
    <div aria-live="polite" aria-atomic="true" data-testid={testId} className="pointer-events-none fixed bottom-5 right-5 z-50">
      {t && (
        <div
          key={t.id}
          data-tone={t.tone ?? 'info'}
          className={`pointer-events-auto relative flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm shadow-card ${TONE_CLASS[t.tone ?? 'info']}`}
        >
          {/* 状态点：ok/error 前置色点，info 无点 */}
          {t.tone === 'ok' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" />}
          {t.tone === 'error' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />}
          <span className="font-medium">{t.text}</span>
          {t.actionLabel && (
            <button
              type="button"
              data-testid="toast-action"
              onClick={() => { t.onAction?.(); onDismiss(t.id); }}
              className="ml-1 text-sm font-semibold text-brand underline underline-offset-2"
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 会话内 Toast 队列 hook：500ms 节拍清扫超时项（规矩①）。
 * 用法：const { queue, push, dismiss } = useToastQueue();
 */
export function useToastQueue() {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  useEffect(() => {
    if (queue.length === 0) return;
    const timer = window.setInterval(() => {
      setQueue((q) => {
        const swept = sweepToasts(q, Date.now());
        return swept.length === q.length ? q : swept;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [queue.length]);
  return {
    queue,
    push: (t: Omit<ToastItem, 'id' | 'createdAt'>) => setQueue((q) => pushToast(q, t, Date.now())),
    dismiss: (id: number) => setQueue((q) => q.filter((x) => x.id !== id)),
  };
}
