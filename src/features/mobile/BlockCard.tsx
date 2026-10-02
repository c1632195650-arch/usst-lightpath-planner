/**
 * 光溯移动端 · 单块卡片（F2/F3：时间轴块 + 详情 + 当前块高亮）
 */
import type { TimeBlock } from '@/types';
import { fmtMin } from './lib/sync.ts';

export default function BlockCard({
  block,
  nowMin,
  done,
  isCurrent,
  onOpen,
}: {
  block: TimeBlock;
  nowMin: number;
  done: boolean;
  isCurrent: boolean;
  onOpen: (b: TimeBlock) => void;
}) {
  const kindTone =
    block.kind === 'course'
      ? 'bg-brand-light text-ink'
      : block.kind === 'meal'
        ? 'bg-accent-light text-ink'
        : 'bg-paper-sunken text-ink';
  return (
    <button
      type="button"
      data-testid="m-block"
      data-block-id={block.id}
      onClick={() => onOpen(block)}
      className={
        'w-full rounded-card bg-paper-card px-4 py-3 text-left shadow-sm border transition-colors '
        + (isCurrent ? 'border-brand' : 'border-ink/5')
        + (done ? ' opacity-50' : '')
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm text-ink-soft" data-testid="m-block-time">
          {fmtMin(block.startMin)}–{fmtMin(block.endMin)}
        </span>
        {isCurrent && (
          <span
            data-testid="m-block-current"
            className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white"
          >
            进行中 · 剩 {Math.max(0, block.endMin - nowMin)} 分
          </span>
        )}
        {done && (
          <span data-testid="m-block-done" className="rounded-full bg-ok px-2 py-0.5 text-[11px] font-semibold text-white">
            已完成
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span aria-hidden>{block.emoji ?? ''}</span>
        <span data-testid="m-block-title" className="text-base font-semibold text-ink">
          {block.title}
        </span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${kindTone}`}>{block.kind}</span>
      </div>
      {(block.place || block.room) && (
        <div data-testid="m-block-place" className="mt-1 text-sm text-ink-soft">
          📍{[block.place, block.room].filter(Boolean).join(' · ')}
        </div>
      )}
      {block.reason && (
        <div data-testid="m-block-reason" className="mt-1 text-xs leading-5 text-ink-faint">{block.reason}</div>
      )}
    </button>
  );
}
