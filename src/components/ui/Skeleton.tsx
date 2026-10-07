/**
 * 骨架屏（UI v2 §10.3.3）：行高、行数、宽度比例要与真实内容一致——
 * 否则加载完会跳版，比不显示骨架还难受。预设三档：单行文本行 / 卡片 / 消息气泡。
 */
import type { ReactNode } from 'react';

const BONE = 'animate-none rounded-md bg-ink/[0.08]';

export function SkeletonLine({ w = 'w-2/3', h = 'h-4', className = '' }: { w?: string; h?: string; className?: string }) {
  return <span className={`block ${BONE} ${h} ${w} ${className}`} aria-hidden="true" />;
}

/** 文本行骨架：标题行 100%·h-4 + 副文行 2/3·h-3，行距对齐 ListRow 的两行结构。 */
export function SkeletonRow({ className = '' }: { className?: string }) {
  return (
    <span className={`flex flex-col gap-1.5 px-3.5 py-3 ${className}`} aria-hidden="true">
      <SkeletonLine w="w-1/2" h="h-4" />
      <SkeletonLine w="w-2/3" h="h-3" />
    </span>
  );
}

/** 卡片骨架：标题 + 三行正文 + 底部动作条，比例对齐 panel（标题行 h-5）。 */
export function SkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <span className={`flex flex-col gap-2.5 rounded-2xl border border-ink/[0.07] bg-white p-5 ${className}`} aria-hidden="true">
      <SkeletonLine w="w-1/3" h="h-5" />
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} w={i === lines - 1 ? 'w-2/5' : i % 2 ? 'w-5/6' : 'w-full'} h="h-3.5" />
      ))}
      <SkeletonLine w="w-1/4" h="h-8" className="mt-1" />
    </span>
  );
}

/** 聊天气泡骨架：左头像圆 + 右两行（比例对齐 LbaoChat 消息行）。 */
export function SkeletonBubble({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-start gap-2 ${className}`} aria-hidden="true">
      <span className={`h-6 w-6 shrink-0 rounded-md ${BONE}`} />
      <span className="flex flex-col gap-1.5">
        <SkeletonLine w="w-40" h="h-3.5" />
        <SkeletonLine w="w-28" h="h-3.5" />
      </span>
    </span>
  );
}

/** 容器约定：骨架区要挂 aria-busy，真实内容到了再摘。 */
export function SkeletonBlock({ children, busy, label = '加载中' }: { children: ReactNode; busy: boolean; label?: string }) {
  return (
    <div aria-busy={busy || undefined} aria-label={busy ? label : undefined}>
      {busy ? children : null}
    </div>
  );
}
