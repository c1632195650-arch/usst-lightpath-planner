/**
 * 光溯移动端 · 当前块（新任务三 §3.1 区② —— 绝对核心）
 * 标题 ≥28px、地点 ≥16px、燃烧条、[完成][顺延15] 两枚 ≥44px 大按钮（拇指可达，
 * 1 层交互不进二级页）。tips 是**插槽**：任务一交付 `methodTipForBlock()` 后
 * 传 prop 即可，无 tip 时整块不渲染（不出现空占位）。
 * 🔴 `m-now-banner` testid 是既有 e2e 契约，不得改名。
 */
import type { TimeBlock } from '@/types';
import { fmtMin } from './lib/sync.ts';
import BurnBar from './BurnBar.tsx';

/** 任务一 P2-1 交付的 tips 形状（契约见任务书 §5.1；本批只留插槽不接实现） */
export interface BlockTip {
  slug: string;
  title: string;
  text: string;
}

export default function NowBlock({
  block, nowMin, done, tip, onToggleDone, onShift15,
}: {
  block: TimeBlock;
  nowMin: number;
  done: boolean;
  /** 无 tip → 插槽整块不渲染 */
  tip?: BlockTip | null;
  onToggleDone: () => void;
  onShift15: () => void;
}) {
  return (
    <section data-testid="m-now-banner" data-block-id={block.id}
      className="rounded-card bg-brand px-5 py-5 text-white shadow-md">
      <p className="text-xs font-medium tracking-wide opacity-80">正在进行</p>
      <p className="mt-1 break-words text-[28px] font-bold leading-snug" data-testid="m-now-title">
        {block.emoji ?? ''}{block.title}
      </p>
      <p className="mt-1 text-base opacity-95" data-testid="m-now-place">
        {fmtMin(block.startMin)}–{fmtMin(block.endMin)}
        {block.place ? ` · 📍${block.place}` : ''}
      </p>
      <BurnBar startMin={block.startMin} endMin={block.endMin} nowMin={nowMin} />
      {tip && (
        <div data-testid="m-now-tip" className="mt-3 rounded-xl bg-white/15 px-3 py-2">
          <p className="text-xs font-semibold">💡 {tip.title}</p>
          <p className="mt-0.5 text-xs leading-5 opacity-90">{tip.text}</p>
        </div>
      )}
      {done ? (
        <p className="mt-4 rounded-xl bg-ok px-4 py-3 text-center text-sm font-semibold">
          ✓ 已完成
        </p>
      ) : (
        <div className="mt-4 flex gap-3">
          <button type="button" data-testid="m-now-done" onClick={onToggleDone}
            className="h-11 flex-1 rounded-xl bg-white text-sm font-bold text-brand shadow-sm active:scale-[0.98]">
            ✓ 完成
          </button>
          <button type="button" data-testid="m-now-shift" onClick={onShift15}
            className="h-11 flex-1 rounded-xl border border-white/60 text-sm font-bold text-white active:scale-[0.98]">
            顺延 15 分
          </button>
        </div>
      )}
    </section>
  );
}
