/**
 * 转场时间：把后端 route() 的实测值接进排程引擎
 * ============================================================
 * 排程引擎是**纯函数**（不 fetch），转场时间必须由调用方注入。
 * 这里就是那个「调用方」：
 *
 *   ① 先用兜底估算跑一遍 → 得到某个（不完整的）周程
 *   ② 从周程里收集所有「相邻且不同地点」的点对 → 批量问后端
 *   ③ 把实测值填进缓存 → 用缓存做 provider 重算 → 转场提示就带上真实分钟数
 *
 * 为什么要两遍：引擎是同步的，而网络是异步的。与其把引擎改成 async
 * （那会污染整条纯函数链、也没法 node --test），不如让它跑两遍 —— 第一遍
 * 只为收集「需要问哪些路」，第二遍才是给用户看的结果。
 *
 * ────────────────────────────────────────────────────────────
 * 【本文件的职责边界 —— 只有一个】
 * 「把 `FetchRoutes` 接到真实后端」。循环、指纹、缓存策略全在
 * `transferConverge.ts` 里，因为**那个文件能在 Node 里加载**，而本文件不能
 * （静态 import `lib/api.ts` → 顶层读 `import.meta.env`）。
 *
 * ⚠️ 所以：**不要在本文件里写任何需要测试的逻辑**。写了就等于没有测试 ——
 *    单测加载不了这个模块。需要逻辑 → 加到 `transferConverge.ts`。
 * ────────────────────────────────────────────────────────────
 *
 * 【§5.9 / T2.4 / AC-10】具体算法（迭代到不动点 + 预取候选对）写在
 * `transferConverge.ts::convergeTransfers` 的注释里，那里解释得比这里细。
 */
import type { TimeBlock, TimeBlock as Block } from '@/types';
import { routeBatch } from '../api';
import { campusFallbackTransfer, type TransferInfo, type TransferProvider } from './campusLookup.ts';
import {
  convergeTransfers,
  TransferCache,
  type ConvergeOptions,
  type ConvergeResult,
  type FetchRoutes,
} from './transferConverge.ts';

/* ── 纯逻辑的 re-export：调用方只需 import 本文件 ── */
export {
  collectTransferPairs,
  collectCandidatePairs,
  layoutSignature,
  uncoveredPairs,
  pairKey,
  TransferCache,
  MAX_TRANSFER_ROUNDS,
} from './transferConverge.ts';
export type {
  FetchRoutes,
  PlacedBlock,
  ConvergeOptions,
  ConvergeResult,
} from './transferConverge.ts';

import { collectTransferPairs as collectTransferPairsLocal } from './transferConverge.ts';

/**
 * 真实后端的批量问路。
 *
 * 失败**不抛错**，只是拿不到实测值（返回 `{}`）—— 转场时间会退回兜底估算，
 * 计划本身照常给出。这是刻意的：一个路网接口挂掉不该让用户看不到日程。
 */
export const fetchRouteBatch: FetchRoutes = async (pairs) => {
  if (pairs.length === 0) return {};
  try {
    const res = await routeBatch(pairs);
    return res.routes ?? {};
  } catch {
    return {};
  }
};

/** 语义别名 —— 同一个函数，两处语境各顺一个叫法 */
export const backendFetchRoutes = fetchRouteBatch;

/** 把缓存包成引擎要的同步 `TransferProvider`（未命中退回跨校区估算） */
export function providerFromCache(cache: TransferCache): TransferProvider {
  return (a: string, b: string): TransferInfo => {
    const hit = cache.get(a, b);
    if (hit) return hit as TransferInfo;
    // `campusFallbackTransfer` 认不出校区时会返回 null（它拒绝猜）——
    // 而 `TransferProvider` 的契约允许 null，所以原样透传即可。
    return campusFallbackTransfer(a, b) as TransferInfo;
  };
}

/**
 * 收敛编排（应用层入口）：接真实后端，跑 §5.9 的两条方法。
 *
 * @param solve 单趟求解。给一个缓存，吐出一版结果 —— 调用方（`planWeek`）
 *              负责把 `providerFromCache(cache)` 塞进 `PlanRequest.transfer`。
 */
export function convergeWithBackend<B extends Block, R>(
  solve: (cache: TransferCache) => { result: R; blocks: B[] },
  opts: ConvergeOptions = {},
): Promise<ConvergeResult<B, R>> {
  return convergeTransfers(solve, backendFetchRoutes, providerFromCache as never, opts);
}

/** 一次性封装：收集 → 拉取 → 得到可用的 provider（**单遍**用；收敛场景请用 `convergeWithBackend`） */
export async function buildTransferProvider(blocks: TimeBlock[]): Promise<TransferCache> {
  const cache = new TransferCache();
  const pairs = collectTransferPairsLocal(blocks).filter(([a, b]) => !cache.has(a, b));
  cache.fill(await fetchRouteBatch(pairs));
  return cache;
}
