/**
 * 两遍法的**唯一编排点**（规格书 §4.5.2 · **CY 请求 ②**）
 * ============================================================
 * 问题：两遍法（pass1 构造 → 建 `TransferProvider` → pass2 重构造）原本要在
 *   `features/week/WeekPlanView.tsx`（PR #3）、`features/libao/weekPlanForChat.ts`（PR #4）
 *   和这里各写一遍。同一套编排写三份 → 之后任何一处调整（缓存、超时、失败降级）
 *   都要改三遍，且三份必然漂移。
 *
 * 裁决（采纳 CY 建议）：抽成**一个公共函数**。
 *
 * ────────────────────────────────────────────────────────────
 * 【P2 / T2.4 · AC-10】从「固定两遍」升级为「迭代到收敛」
 * ────────────────────────────────────────────────────────────
 * P1 时期这里是硬编码两遍：第 1 遍用兜底值排 → 收集相邻对 → 问后端 →
 * 第 2 遍收工。这在「第 2 遍的布局和第 1 遍一致」时是对的，但第 2 遍一旦
 * 挪了块，就会产生**第 2 遍自己没问过**的新相邻对，用户看到的仍是猜的分钟数。
 *
 * P2 改成调用 `transferConverge.ts::convergeTransfers`（§5.9 方法 A＋B）：
 * 反复算到布局不再变化或所有相邻跨点对都已命中缓存，最多 `MAX_TRANSFER_ROUNDS` 轮。
 * 算法与四条出口的详细解释在那个文件里。
 *
 * ────────────────────────────────────────────────────────────
 * 【为什么收敛核心放在 `transferConverge.ts` 而不是 `transfer.ts`】
 * `transfer.ts` 静态 import `lib/api.ts`，而后者在模块顶层读 `import.meta.env`
 * （Vite 专有）→ **Node 里加载不了**。若收敛循环写在 `transfer.ts`，
 * 单测就永远碰不到它 —— 而浏览器里后端一旦不通，收敛与否表现不出差别。
 * 拆出来之后本文件可以**静态** import 收敛核心（依赖方向是干净的），
 * 只有「真正要 fetch」的那一层才需要动态取。
 *
 * 对外接口（`planWeek(req, opts)` 签名与降级行为）**保持兼容**：
 *   · 给了 `transferFactory` → 走收敛循环，工厂每轮拿当轮布局；
 *   · `req.transfer` 已给      → 单遍（调用方已有真实 provider，没有再取一次的道理）；
 *   · 都没有                   → 动态 import `transfer.ts` 拿真实后端；失败则单遍降级。
 */
import type { TimeBlock } from '@/types';
import type { PlanRequest, PlanResult } from './model.ts';
import type { TransferProvider } from './campusLookup.ts';
import { solveWeek } from './solver.ts';
import {
  convergeTransfers,
  MAX_TRANSFER_ROUNDS,
  TransferCache,
  type ConvergeResult,
  type FetchRoutes,
} from './transferConverge.ts';

/** 由「第一遍计划」构造转场 provider（应用层 = 调后端 route()；测试 = 桩函数） */
export type TransferFactory = (blocks: TimeBlock[]) => Promise<TransferProvider>;

export interface PlanWeekOptions {
  /**
   * 注入「批量问路」。这是 **P2 起收敛循环使用的唯一接口**（推荐）。
   * 应用层 = `transfer.ts::fetchRouteBatch`；测试 = 桩。
   *
   * 为什么是「每次给一批、返回实测分钟」而不是「给整批布局、返回 provider」：
   * 收敛循环要**增量**地问 —— 第 1 轮问候选对，第 2 轮再补上新出现的相邻对。
   * 一次性拿一个 provider 做不到这件事（它只能在开头问一次）。
   */
  fetchRoutes?: FetchRoutes;

  /**
   * 注入转场工厂（**P1 时期的接口，已废弃**）。
   *
   * @deprecated 请改用 `fetchRoutes`。保留它是为了让 P1 时期写的调用方与测试
   *   **不用立刻改** —— 它会被适配成「问一次 + 重算一次」的等价路径
   *   （即 P1 的固定两遍行为），不参与收敛循环。
   *
   * 为什么不适配进收敛循环：工厂的语义是「我按这份布局给你一个 provider」，
   * 拿不到「你问了哪些对、哪些没问到」这个信息，因此无法判断收敛
   * （也就无法遵守 AC-10 的诚实报告）。硬适配只会得到一个「假装收敛」的实现。
   */
  transferFactory?: TransferFactory;

  /** 收敛轮数上限，默认 `MAX_TRANSFER_ROUNDS`（3）。仅测试需要显式指定。 */
  maxTransferRounds?: number;
}

/**
 * 排一周的课（迭代到收敛的两趟法）。
 *
 * 每轮流程：用**当前缓存**算一版计划 → 看这版还缺哪些相邻跨点对 →
 * 增量问后端 → 补进缓存 → 再算。直到布局稳定或路都齐了。
 *
 * 返回的 `PlanResult` 带两项收敛诊断（可选字段，不影响老调用方）：
 *   · `transferRounds`    —— 实际求解了几轮；
 *   · `transferUncovered` —— 仍缺实测值的路对（空 = 达标）。
 */
export async function planWeek(
  req: PlanRequest,
  opts: PlanWeekOptions = {},
): Promise<PlanResult> {
  // ── 0. 废弃路径：P1 的 transferFactory ──────────────────────
  // 它「问一次、重算一次」，不进收敛循环（原因见 `PlanWeekOptions.transferFactory`）。
  // 放在最前面是为了保证：只要调用方给了工厂，行为就和 P1 完全一致 ——
  // 这是「不破坏既有调用方」的全部含义。
  if (opts.transferFactory) {
    const first = solveWeek(req);
    let transfer: TransferProvider;
    try {
      transfer = await opts.transferFactory(first.plan.blocks);
    } catch {
      return first; // 取数失败不该让整个计划失败：保留第 1 遍的结果
    }
    if (!transfer) return first;
    return solveWeek({ ...req, transfer });
  }

  // ── 1. 决定「怎么问路」 ────────────────────────────────────
  // ⚠️ 顺序至关重要：**显式注入的 `fetchRoutes` 优先于 `req.transfer`**。
  //    `req.transfer` 往往是语料 / 调用方带的一个**兜底 provider**（比如
  //    golden 语料就给了一个纯估算的），它不代表「我已经有实测值了」。
  //    早先这里是 `if (req.transfer) return`，导致「注入了 fetchRoutes 却拿不到
  //    实测值」—— 收敛循环根本没跑（这个 bug 是被 `p2-live-transfer.ts` 抓到的）。
  const fetchRoutes = opts.fetchRoutes ?? (await defaultFetchRoutes());

  if (!fetchRoutes) {
    // 没有任何问路能力 → 用请求里带的 provider（可能就是兜底估算）单遍收工。
    // 这是 Node 单测与「后端没起」时的正常路径，不是异常。
    return solveWeek(req);
  }

  // ── 2. 收敛循环 ───────────────────────────────────────────
  // 每轮：用当前缓存求解 → 收集缺的路 → 问 → 补缓存 → 再算。
  // 求解器在这里被包了一层：把缓存变成引擎要的同步 provider 塞进请求。
  let solveError: unknown = null;
  const solve = (cache: TransferCache): { result: PlanResult; blocks: TimeBlock[] } => {
    try {
      const transfer: TransferProvider = (a, b) => {
        const hit = cache.get(a, b);
        if (hit) return hit as never;
        // 未命中 → 兜底估算，并**明确标 reliable:false**。
        // 不能返回 null：引擎拿 null 会当成「无需转场」，而那是错的
        // （同校区相邻也确实要走几分钟）；也不能标 reliable:true，
        // 否则 UI 会把一个猜的数字当实测值显示。
        return { minutes: fallbackMinutes(a, b), source: 'estimate', reliable: false };
      };
      const result = solveWeek({ ...req, transfer });
      return { result, blocks: result.plan.blocks };
    } catch (err) {
      solveError = err;
      throw err;
    }
  };

  let conv: ConvergeResult<TimeBlock, PlanResult> | null = null;
  try {
    conv = await convergeTransfers(solve, fetchRoutes, () => {
      throw new Error('providerOf 不应被调用（solve 已自带 provider 构造）');
    }, {
      ...(opts.maxTransferRounds != null ? { maxRounds: opts.maxTransferRounds } : {}),
    });
  } catch {
    conv = null;
  }

  if (!conv) {
    // 收敛过程中抛错（某轮求解失败 / fetchRoutes 抛出）→ 退回单遍，
    // 并如实说明「转场是估算的」。不静默吞掉原因（§12.5.5 不猜的纪律）。
    const base = solveWeek(req);
    if (solveError) {
      return {
        ...base,
        notes: [...base.notes, '转场时间取数失败，当前显示的是估算值'],
      };
    }
    return base;
  }

  // ── 3. 收敛诊断 + 诚实标注 ────────────────────────────────
  const notes = [...conv.last.notes];
  if (!conv.converged) {
    notes.push(
      conv.uncovered.length > 0
        ? `有 ${conv.uncovered.length} 处转场时间仍是估算值（后端暂无这些路线的实测数据）`
        : '转场时间已尽力取实测，个别路段可能有小幅误差',
    );
  }

  return {
    ...conv.last,
    notes,
    transferRounds: conv.rounds,
    transferUncovered: conv.uncovered.map(([a, b]) => `${a}→${b}`),
  };
}

/**
 * 兜底估算的分钟数 —— 只在缓存未命中时用。
 *
 * ⚠️ 这里刻意**不 import `campusFallbackTransfer`**：本模块要能在 Node 里加载，
 * 而 `campusLookup.ts` 也在 Node 可加载（它不碰 api）—— 但为了让
 * `transferConverge` 的 `solve` 闭包保持自足、不引入额外依赖，
 * 这里用一个明确的最小估算：同地点 0 分钟、不同地点 8 分钟。
 *
 * 为什么不做得更精细：真正的估算逻辑（按校区距离）在 `campusFallbackTransfer`，
 * 它会**通过缓存未命中路径**在浏览器里生效（`WeekPlanView` 注入的 factory 走它）。
 * 本函数只是「连 campusLookup 都还没接上」时的最后一道地板值。
 */
function fallbackMinutes(a: string, b: string): number {
  return a === b ? 0 : 8;
}

/**
 * 默认问路实现：动态 import `transfer.ts`。
 *
 * 用动态 import 是因为 `transfer.ts → lib/api.ts → import.meta.env` 在 Node 里
 * 加载不了（§7.3 硬约束）。拿不到就返回 null，由调用方降级为单遍。
 */
async function defaultFetchRoutes(): Promise<FetchRoutes | null> {
  try {
    const mod = (await import('./transfer.ts')) as { backendFetchRoutes?: FetchRoutes };
    return typeof mod.backendFetchRoutes === 'function' ? mod.backendFetchRoutes : null;
  } catch {
    return null;
  }
}

export { MAX_TRANSFER_ROUNDS };
