import type { WeekPlan } from '@/types';
import { miniWeekViewModel } from './miniWeekPreviewModel';

interface Props {
  /** 草稿或正式排程（同一形状；「草稿 · 未落盘」语义由 caption 承载） */
  draft: WeekPlan | null;
  /** 紧凑模式：每天只显示块数徽标 */
  compact?: boolean;
  caption?: string;
}

/**
 * 周排程预览卡（WP8-mini 纯展示组件，2026-09-27）。
 *
 * 只渲染、不交互：没有任何按钮/拖拽/事件 handler（tests 断言模型层不含交互形态）。
 * 数据 → 形状的转换全部在 ./miniWeekPreviewModel.ts（纯函数，node --test 直测）。
 * 消费方：梨宝排程预览卡（WP9）；ModeSetupDialog（WP5 落地后接入，白天批次）。
 */
export function MiniWeekPreview({ draft, compact = false, caption }: Props) {
  const vm = miniWeekViewModel(draft, compact, caption);
  return (
    <div data-testid="mini-week-preview" data-empty={vm.empty ? 'true' : 'false'} className="rounded-xl border border-ink/10 bg-white p-3">
      {vm.caption && <p className="mb-2 text-[11.5px] font-medium text-ink-soft">{vm.caption}</p>}
      {vm.empty ? (
        <p className="text-[11.5px] text-ink-faint">还没有可预览的排程。</p>
      ) : (
        <>
          <div className={`grid gap-2 ${vm.days.length > 0 ? 'grid-cols-7' : ''}`}>
            {vm.days.map((col) => (
              <div key={col.day} className="min-w-0">
                <p className="mb-1 text-center text-[10.5px] font-semibold text-ink-faint">{col.label}</p>
                {compact ? (
                  <p className="rounded-lg border border-ink/10 bg-paper py-1 text-center text-[10.5px] font-medium text-ink-soft tabular-nums">
                    {col.blocks.length} 块
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {col.blocks.map((b) => (
                      <li key={b.id} className="rounded-lg border border-ink/10 bg-paper px-1.5 py-1">
                        <p className="truncate text-[10px] leading-4 text-ink" title={b.title}>{b.title}</p>
                        <p className="font-mono text-[9.5px] leading-3 text-ink-faint">{b.start}–{b.end}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-right font-mono text-[10px] text-ink-faint">共 {vm.totalBlocks} 块</p>
        </>
      )}
    </div>
  );
}
