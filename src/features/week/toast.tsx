import { Icon } from '@/components/icons/Icon';
/**
 * Toast 操作反馈（2026-09-19）
 * ============================================================
 * 用户要求：「执行完改动操作后，右上角弹出显示 2-3 秒之后再消失；
 * 删除、移动、添加需要有不同的信息」。
 *
 * ── 设计 ─────────────────────────────────────────────────────
 *   · 四类色调：delete（红 🗑）/ move（蓝 ✏️）/ add（绿 ➕）/ info（灰）
 *   · 默认停留 2.5s；**删除类 5s 且自带「撤销」按钮** ——
 *     删除是最需要反悔窗口的操作，光提示「按 Ctrl+Z」不够直接
 *   · 多条堆叠、最多同时 4 条（更早的让位）
 *   · 状态由父组件持有（本文件只给渲染层与类型），方便与业务 state 同生命周期
 */

export type ToastKind = 'delete' | 'move' | 'add' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** 可选动作（删除类 = 「撤销」） */
  action?: { label: string; run: () => void };
  /** 停留毫秒；不传按 kind 取默认 */
  duration?: number;
}

const STYLE: Record<ToastKind, { bg: string; icon: 'trash' | 'sliders' | 'plus' | 'info' }> = {
  delete: { bg: 'bg-danger-light border-danger/30 text-danger-text', icon: 'trash' },
  move: { bg: 'bg-brand-light border-brand/30 text-brand', icon: 'sliders' },
  add: { bg: 'bg-ok-light border-ok/30 text-ok', icon: 'plus' },
  info: { bg: 'bg-paper border-ink/15 text-ink-soft', icon: 'info' },
};

export const DEFAULT_TOAST_MS: Record<ToastKind, number> = {
  delete: 5000, // 删除给足反悔窗口
  move: 2500,
  add: 2500,
  info: 2500,
};

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" aria-atomic="false" className="fixed right-4 top-4 z-[60] flex w-72 flex-col gap-2">
      {toasts.slice(-4).map((t) => {
        const s = STYLE[t.kind];
        return (
          <div
            key={t.id}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed shadow-md ${s.bg}`}
          >
            <span className="shrink-0"><Icon name={s.icon} size="sm" /></span>
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => { t.action!.run(); onDismiss(t.id); }}
                className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold underline-offset-2 hover:underline"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="shrink-0 text-[11px] opacity-50 hover:opacity-100"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
