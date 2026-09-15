/**
 * 两遍法的**唯一编排点**（规格书 §4.5.2 · **CY 请求 ②**）
 * ============================================================
 * 问题：两遍法（pass1 构造 → 建 `TransferProvider` → pass2 重构造）原本要在
 *   `features/week/WeekPlanView.tsx`（PR #3）、`features/libao/weekPlanForChat.ts`（PR #4）
 *   和这里各写一遍。同一套编排写三份 → 之后任何一处调整（缓存、超时、失败降级）
 *   都要改三遍，且三份必然漂移。
 *
 * 裁决（采纳 CY 建议）：抽成**一个公共函数**。P1 合入后由 CY 把 UI 侧也切到这里。
 *
 * ⚠️ **可测性硬约束**：`planner/transfer.ts` 依赖 `lib/api.ts`（用了 `import.meta.env`），
 *    **Node 单测里加载不了**。因此：
 *    · 本文件**不静态 import** `transfer.ts`，只在需要时**动态 import** 并捕获失败；
 *    · 支持注入 `transferFactory` 桩 → 两遍法编排可以被 `tests/` 完整覆盖；
 *    · 取不到 provider 时**降级为单遍**（不是报错、也不是假两遍）。
 */
import type { TimeBlock } from '@/types';
import type { PlanRequest, PlanResult } from './model.ts';
import type { TransferProvider } from './campusLookup.ts';
import { solveWeek } from './solver.ts';

/** 由「第一遍计划」构造转场 provider（应用层 = 调后端 route()；测试 = 桩函数） */
export type TransferFactory = (blocks: TimeBlock[]) => Promise<TransferProvider>;

export interface PlanWeekOptions {
  /**
   * 注入转场工厂。
   * · 给了 → 一定走两遍（用它可以完整测两遍法编排）；
   * · 不给且 `req.transfer` 已给 → 单遍（调用方已经拿到真实 provider，不必再取一次）；
   * · 都不给 → 尝试动态 import `./transfer.ts`；失败（如 Node 环境）→ 降级单遍。
   */
  transferFactory?: TransferFactory;
}

/**
 * 排一周的课（两遍法）。
 *
 * 第 1 遍：用请求里现有的 provider（可能只是跨校区兜底估算）构造一版计划；
 * 第 2 遍：用第 1 遍的**块位置**去预取真实路网（只取真正相邻的跨点对），
 *         再用它重构造一遍 —— 于是「三教 → 国合楼要几分钟」不再靠猜。
 */
export async function planWeek(
  req: PlanRequest,
  opts: PlanWeekOptions = {},
): Promise<PlanResult> {
  const first = solveWeek(req);

  let factory = opts.transferFactory;
  if (!factory) {
    // 调用方已经注入了真实 provider → 这一遍就是终版，不必再取一次
    if (req.transfer) return first;
    factory = (await defaultTransferFactory()) ?? undefined;
    if (!factory) return first; // 取不到（常见于 Node 单测）→ 单遍，如实降级
  }

  let transfer: TransferProvider;
  try {
    transfer = await factory(first.plan.blocks);
  } catch {
    return first; // 取数失败不该让整个计划失败：保留第 1 遍的结果
  }
  if (!transfer) return first;

  return solveWeek({ ...req, transfer });
}

/**
 * 默认工厂：动态 import `transfer.ts`。
 * 用动态 import 是为了让「本模块可被 Node 加载」——静态 import 会被
 * `transfer.ts → lib/api.ts → import.meta.env` 拖死（见 §7.3 硬约束）。
 */
async function defaultTransferFactory(): Promise<TransferFactory | null> {
  try {
    const mod = (await import('./transfer.ts')) as {
      buildTransferProvider?: (blocks: TimeBlock[]) => Promise<{ provider: TransferProvider }>;
    };
    if (typeof mod.buildTransferProvider !== 'function') return null;
    const build = mod.buildTransferProvider;
    // ⚠️ `buildTransferProvider` 返回的是 `TransferCache`，引擎要的是 `cache.provider`
    return async (blocks: TimeBlock[]) => (await build(blocks)).provider;
  } catch {
    return null;
  }
}
