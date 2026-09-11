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
 */
import type { TimeBlock } from '@/types';
import { routeBatch } from '../api';
import { campusFallbackTransfer, type TransferInfo, type TransferProvider } from './schedule.ts';

function key(a: string, b: string): string {
  return `${a}→${b}`;
}

/** 从一周的块里收集「相邻两个块在地点上不同」的点对（去重） */
export function collectTransferPairs(blocks: TimeBlock[]): Array<[string, string]> {
  const byDay = new Map<number, TimeBlock[]>();
  for (const b of blocks) {
    const list = byDay.get(b.dayOfWeek) ?? [];
    list.push(b);
    byDay.set(b.dayOfWeek, list);
  }
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].place;
      const b = sorted[i + 1].place;
      if (!a || !b || a === b) continue;
      const k = key(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * 转场缓存。先问后端，问不到就退回「跨校区估算」，并如实标 reliable:false。
 * 不猜同校区的步行分钟 —— 那是真实路网的活儿。
 */
export class TransferCache {
  private map = new Map<string, TransferInfo>();

  /** 用后端批量结果填充 */
  fill(routes: Record<string, { minutes: number; reliable?: boolean } | null>): void {
    for (const [k, v] of Object.entries(routes)) {
      if (v && typeof v.minutes === 'number') {
        this.map.set(k, { minutes: v.minutes, source: 'osm', reliable: v.reliable !== false });
      }
    }
  }

  has(a: string, b: string): boolean {
    return this.map.has(key(a, b));
  }

  size(): number {
    return this.map.size;
  }

  /** 引擎用的同步 provider */
  readonly provider: TransferProvider = (a, b) => {
    const hit = this.map.get(key(a, b));
    if (hit) return hit;
    return campusFallbackTransfer(a, b); // 后端没结果时退回跨校区估算
  };
}

/** 问后端要这批路线的实测步行时间（失败不抛错，只是拿不到实测值） */
export async function prefetchRoutes(pairs: Array<[string, string]>): Promise<Record<string, { minutes: number; reliable?: boolean } | null>> {
  if (pairs.length === 0) return {};
  try {
    const res = await routeBatch(pairs);
    return res.routes ?? {};
  } catch {
    return {};
  }
}

/** 一次性封装：收集 → 拉取 → 得到可用的 provider（供周计划重算） */
export async function buildTransferProvider(blocks: TimeBlock[]): Promise<TransferCache> {
  const cache = new TransferCache();
  const pairs = collectTransferPairs(blocks).filter(([a, b]) => !cache.has(a, b));
  cache.fill(await prefetchRoutes(pairs));
  return cache;
}
