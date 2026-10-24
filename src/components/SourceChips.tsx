/**
 * 来源卡片（F2/B1 引用溯源，2026-10-24）
 * ============================================================
 * 梨宝回答下方挂"依据卡片"：默认 ≤3 条，其余折叠进「展开更多」；每条外链可点开原文。
 * 共享组件：web 梨宝（LbaoChat）与移动端抽屉（LbaoDrawer）同一份（章程 §3.1.2 共享层）。
 * 无来源不渲染 —— 模板答会故意置空 sources（避免假来源），这里保持同一诚实口径。
 */
import { useState } from 'react';
import { visibleSources } from '@/components/ui/confidenceModel';
import type { RagSource } from '@/lib/api';

export function SourceChips({ sources, max = 3, testId }: {
  sources?: RagSource[];
  /** 默认展示条数（超出折叠进"展开更多"） */
  max?: number;
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = sources ?? [];
  if (list.length === 0) return null;
  const shown = visibleSources(list, expanded, max);
  const hidden = list.length - shown.length;
  return (
    <div className="w-full divide-y divide-ink/10 border-y border-ink/10 pl-1" data-testid={testId}>
      {shown.map((source, i) => (
        <a
          key={`${source.url}-${i}`}
          href={source.url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="block py-3 transition-colors hover:text-brand"
        >
          <div className="font-display text-sm font-semibold leading-5 text-ink">{source.title}</div>
          <div className="mt-1 text-xs text-ink-faint">{source.account} · {source.pub_time}</div>
        </a>
      ))}
      {!expanded && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="py-2 text-[11px] font-medium text-brand underline underline-offset-2"
        >
          展开更多来源（{hidden}）
        </button>
      )}
    </div>
  );
}
