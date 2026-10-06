/**
 * 光溯移动端 · tips 适配纯函数（新任务三 P1-4 × 任务一 P2-1）
 *
 * 任务一交付 `methodTipForTimeBlock(blockKind, ctx)` —— 它内部做
 * `BlockKind → MethodBlockKind` 的**显式映射**。本文件只做时长换算。
 *
 * 🔴 2026-10-06 自验收修正（真实缺陷，非风格问题）：
 *   本文件原先调用 `methodTipForBlock({ kind: b.kind as never })`，
 *   而 `BlockKind`（course|meal|study|activity|commute|blank）与
 *   方法库的 `MethodBlockKind`（assignment|review|exam|exercise|rest）
 *   **两套枚举零重叠**。`as never` 让 tsc 放行，但运行时六种真实块类型
 *   全部查不到候选 → **tips 恒为 NULL，插槽整块不渲染**，
 *   而所有单测都绿（它们只用方法库自己造的枚举）。
 *   现在改走 `methodTipForTimeBlock`，映射集中在 methods.ts 一处，
 *   本文件不再碰枚举，从根上消除这类「类型断言掩盖契约断裂」。
 *
 * 纯函数（Node 可测）；.tsx 组件渲染不被 node 测试加载器支持，两态渲染由 e2e 覆盖。
 */
import type { TimeBlock } from '@/types';
import { methodTipForTimeBlock } from '@/lib/planner/methods';
import type { BlockTip } from '../NowBlock.tsx';

/** 块 → tip；无匹配（或块时长非法）→ null → 插槽整块不渲染 */
export function nowTipForBlock(b: Pick<TimeBlock, 'kind' | 'startMin' | 'endMin'>): BlockTip | null {
  const durationMin = b.endMin - b.startMin;
  if (!Number.isFinite(durationMin) || durationMin <= 0) return null;
  const t = methodTipForTimeBlock(b.kind, { durationMin });
  return t ? { slug: t.slug, title: t.title, text: t.tip } : null;
}