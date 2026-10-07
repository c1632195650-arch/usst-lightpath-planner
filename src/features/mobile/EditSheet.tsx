import type { TimeBlock } from '@/types';
import { Icon } from '@/components/icons/Icon';
import { fmtMin } from './lib/sync.ts';
/**
 * 光溯移动端 · 轻编辑底部抽屉（F4：完成勾选 / 顺延 ±15·30·60 = 换时段快捷片）
 * 映射见方案 §7.3：全部落在 userPlanStore 覆盖层（唯一写法），不直改计划。
 */

export type EditAction = { type: 'toggleDone' } | { type: 'shift'; deltaMin: number };

const SHIFTS = [-60, -30, -15, 15, 30, 60] as const;

export default function EditSheet({
  block,
  done,
  onClose,
  onAction,
}: {
  block: TimeBlock | null;
  done: boolean;
  onClose: () => void;
  onAction: (b: TimeBlock, a: EditAction) => void;
}) {
  if (!block) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-end bg-ink/40"
      data-testid="m-edit-sheet"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl bg-paper-card p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/10" />
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm text-ink-soft">
            {fmtMin(block.startMin)}–{fmtMin(block.endMin)}
          </span>
          <span className="text-base font-semibold text-ink">{block.title}</span>
        </div>

        <button
          type="button"
          data-testid="m-edit-done"
          onClick={() => onAction(block, { type: 'toggleDone' })}
          className={
            'mt-4 w-full rounded-xl px-4 py-3 text-base font-semibold '
            + (done ? 'bg-ok text-white' : 'bg-paper-sunken text-ink')
          }
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            <Icon name="check" size="sm" className="shrink-0" />
            {done ? '已完成（点这里取消）' : '标记完成'}
          </span>
        </button>

        <p className="mt-4 text-xs text-ink-soft">顺延 / 提前（换时段）</p>
        <div className="mt-2 grid grid-cols-6 gap-1.5">
          {SHIFTS.map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`m-shift-${d}`}
              onClick={() => onAction(block, { type: 'shift', deltaMin: d })}
              className="rounded-lg border border-ink/10 bg-paper px-0 py-2.5 text-sm font-semibold text-ink"
            >
              {d > 0 ? `+${d}` : d}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          单位：分钟。改动会保存在覆盖层里，下次重排也认账。
        </p>
      </div>
    </div>
  );
}
