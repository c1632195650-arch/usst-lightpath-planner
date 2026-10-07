import { useEffect, useState } from 'react';
import { pushToast, sweepToasts, visibleToast, TOAST_AUTO_MS, type ToastItem, type ToastTone } from './toastModel';

export { pushToast, sweepToasts, visibleToast, TOAST_AUTO_MS };
export type { ToastItem, ToastTone };

/**
 * Toast 渲染层（UI v2 §10.4.1）：
 *   ② 右下角，不遮住正在操作的位置；
 *   aria-live=polite 对读屏播报。
 * 时序纯逻辑在 ./toastModel.ts（零依赖可测）。
 */

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
          className={`overlay-in-panel pointer-events-auto relative flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm shadow-card ${TONE_CLASS[t.tone ?? 'info']}`}
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
