/**
 * 详情抽屉（E 批 E5 · 2026-09-28）—— **零依赖**渐进式披露
 * ============================================================
 * 为什么用原生 `<dialog>`：
 *   · `showModal()` 自带 **焦点陷阱 / Esc 关闭 / 惰性背景（inert）**，无需引 Radix/Vaul；
 *   · 依赖闸门决议（CY 2026-09-28）：附录 A 候选全部关闭，E5 走零依赖方案
 *     （工作单原建议「先用原生 dialog + CSS，不够再引 vaul」）；
 *   · 动效只做 `opacity/transform`，并在 `motion-reduce` 下关闭
 *     （docs/week-view-design.md §2.3：不弹跳、不超 250ms）。
 *
 * 职责边界：本组件**只渲染**，不做数据装配——详情行由
 * `features/week/weekViewModel.ts::blockDetail()` 组装（纯函数、可单测）。
 */
import { useEffect, useRef } from 'react';

export interface DetailRow { label: string; value: string }

export function DetailDrawer({
  open, title, rows, onClose,
}: {
  open: boolean;
  title: string;
  rows: DetailRow[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      data-testid="block-detail-drawer"
      // 原生关闭（Esc / 点 backdrop 的 close 事件）统一回报给上层，状态只有一处真源
      onClose={onClose}
      className="ml-auto mr-0 h-full max-h-full w-full max-w-md rounded-l-2xl border-l border-paper-sunken bg-paper-card p-0 text-ink shadow-xl backdrop:bg-ink/30 motion-reduce:transition-none"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-paper-sunken px-4 py-3">
          <h2 className="text-sm font-semibold leading-snug">{title}</h2>
          <button
            type="button"
            data-testid="detail-close"
            onClick={() => ref.current?.close()}
            aria-label="关闭详情"
            className="shrink-0 rounded px-2 py-0.5 text-sm text-ink-soft hover:bg-paper-sunken"
          >
            ✕
          </button>
        </header>
        <dl className="flex-1 overflow-y-auto px-4 py-3">
          {rows.map((r) => (
            <div key={r.label} className="mb-2.5 last:mb-0">
              <dt className="text-[11px] text-ink-faint">{r.label}</dt>
              <dd className="text-[13px] leading-snug text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  );
}
