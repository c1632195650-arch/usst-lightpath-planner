/**
 * 光溯移动端 · F11 快捷指令条（新任务三 P6-3）
 * 两个固定问法保留为**零延迟本地应答**（不调 LLM）；自由输入统一由梨宝抽屉承担
 * （避免两个输入框 —— P6-3 决议）。
 */
import { useState } from 'react';
import type { TimeBlock } from '@/types';
import { fmtMin } from './lib/sync.ts';
import { nextUpcoming } from './lib/planCompute.ts';

type Displayed = { blocks: TimeBlock[]; doneIds: ReadonlySet<string> } | null;

export default function QuickBar({ displayed, nowMin, onShift }: {
  displayed: Displayed;
  nowMin: number;
  onShift: (b: TimeBlock) => void;
}) {
  const [msg, setMsg] = useState('');
  const quickWhatToday = () => {
    if (!displayed) return;
    const left = displayed.blocks.filter((b) => !displayed.doneIds.has(b.id) && b.endMin > nowMin);
    setMsg(left.length === 0
      ? '今天排的都完成啦，剩下的时间留给你自己。'
      : `今天还剩 ${left.length} 件：${left.slice(0, 3).map((b) => `${b.title} ${fmtMin(b.startMin)}`).join('、')}${left.length > 3 ? ' 等' : ''}`);
  };
  const quickSnoozeNext = () => {
    if (!displayed) return;
    const next = nextUpcoming(displayed.blocks, nowMin, displayed.doneIds);
    if (!next) {
      setMsg('今天没有接下来的块了。');
      return;
    }
    onShift(next);
    setMsg(`已把「${next.title}」顺延 15 分钟。`);
  };
  return (
    <>
      <div className="flex gap-2">
        <button type="button" data-testid="m-quick-today" onClick={quickWhatToday}
          className="flex-1 rounded-xl border border-ink/10 bg-paper-card px-3 py-2.5 text-sm font-semibold text-ink">
          今天还有啥
        </button>
        <button type="button" data-testid="m-quick-snooze" onClick={quickSnoozeNext}
          className="flex-1 rounded-xl border border-ink/10 bg-paper-card px-3 py-2.5 text-sm font-semibold text-ink">
          帮我顺延下一块
        </button>
      </div>
      {msg && (
        <p data-testid="m-quick-msg" className="rounded-xl bg-paper-sunken px-4 py-2.5 text-sm text-ink-soft">{msg}</p>
      )}
    </>
  );
}
