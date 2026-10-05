/**
 * 光溯移动端 · 接下来（新任务三 §3.1 区③ —— 次级视觉，要小、不喧宾夺主）
 * 字号 ≤14px（text-xs=12px），只给时间 + 标题（地点可省）。
 * 没有下一块且没有当前块 → 收工横幅（沿用 `m-now-banner` testid，e2e 契约不变）。
 * 🔴 `m-next-banner` testid 是既有 e2e 契约，不得改名。
 */
import type { TimeBlock } from '@/types';
import { fmtMin } from './lib/sync.ts';

export default function NextList({ next, nowMin }: { next: TimeBlock | null; nowMin: number }) {
  if (!next) {
    return (
      <div data-testid="m-now-banner" className="rounded-card bg-ok-light px-4 py-3 shadow-sm">
        <p className="text-sm text-ink">今天的块都结束了 —— 收工，好好休息。</p>
      </div>
    );
  }
  return (
    <div data-testid="m-next-banner" className="rounded-card bg-paper-card px-4 py-2.5 shadow-sm">
      <p className="text-xs text-ink-soft">
        接下来 {fmtMin(next.startMin)}（还有 {Math.max(0, next.startMin - nowMin)} 分钟）
      </p>
      <p className="text-xs font-medium text-ink">
        {next.emoji ?? ''}{next.title}{next.place ? ` · ${next.place}` : ''}
      </p>
    </div>
  );
}
