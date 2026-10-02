/**
 * 光溯移动端 · 明日预告（F7：明天块数 + 第一块时间）
 * 明天 = 本周内 → 直接读本周计划；周日 → 下周需要另一份重算，由父组件异步给。
 */
import type { TimeBlock } from '@/types';
import { fmtMin } from './lib/sync.ts';

const DOW_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function TomorrowPreview({
  blocks,
  tomorrowDow,
  loading,
}: {
  blocks: readonly TimeBlock[] | null;
  tomorrowDow: number;
  loading: boolean;
}) {
  return (
    <section data-testid="m-tomorrow" className="rounded-card bg-paper-card p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-ink-soft">明天 · {DOW_CN[tomorrowDow]}</h3>
      {loading && <p className="mt-1 text-sm text-ink-faint">算着呢…</p>}
      {!loading && (!blocks || blocks.length === 0) && (
        <p className="mt-1 text-sm text-ink-faint">明天没有排块，留白也是安排。</p>
      )}
      {!loading && blocks && blocks.length > 0 && (
        <p className="mt-1 text-sm text-ink" data-testid="m-tomorrow-summary">
          共 {blocks.length} 块 · 第一块 {fmtMin(blocks[0].startMin)} {blocks[0].emoji ?? ''}
          {blocks[0].title}
        </p>
      )}
    </section>
  );
}
