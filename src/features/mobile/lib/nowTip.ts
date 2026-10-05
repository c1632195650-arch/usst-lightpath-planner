/**
 * 光溯移动端 · tips 适配纯函数（新任务三 P1-4 × 任务一 P2-1）
 * 任务一的 `methodTipForBlock(MethodTipContext)` 返回 {slug,title,tip,tier,status}，
 * NowBlock 插槽吃 {slug,title,text} —— 适配层放这里（纯函数，Node 可测；
 * .tsx 组件渲染不被 node 测试加载器支持，两态渲染由 e2e 覆盖）。
 */
import type { TimeBlock } from '@/types';
import { methodTipForBlock } from '@/lib/planner/methods';
import type { BlockTip } from '../NowBlock.tsx';

/** 块 → tip；无匹配（或块时长非法）→ null → 插槽整块不渲染 */
export function nowTipForBlock(b: Pick<TimeBlock, 'kind' | 'startMin' | 'endMin'>): BlockTip | null {
  const durationMin = b.endMin - b.startMin;
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;
  const t = methodTipForBlock({ kind: b.kind as never, durationMin });
  return t ? { slug: t.slug, title: t.title, text: t.tip } : null;
}
