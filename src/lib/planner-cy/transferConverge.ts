/**
 * 转场收敛的**纯逻辑**（§5.9 方法 A + B）—— 可在 Node 里直载
 * ============================================================
 * 为什么要把它从 `transfer.ts` 里拆出来（这是 §7.3 那条硬约束的直接后果）：
 *
 *   `transfer.ts` 静态 import 了 `lib/api.ts`，而后者在模块顶层读
 *   `import.meta.env`（Vite 专有）→ **Node 里一行都加载不了**。
 *   于是写在 `transfer.ts` 里的收敛循环在单测里根本碰不到，
 *   只有浏览器能跑 —— 而浏览器里后端一旦不通，收敛与否**表现不出差别**
 *   （永远是「全兜底估算」）。等于这段最需要验证的逻辑没有任何自动化保护。
 *
 * 拆法（按「依赖方向」切，不是按「功能」切）：
 *   · 本文件：只依赖 `@/types` 与 `campusLookup` —— 纯函数 + 一个
 *     `FetchRoutes` 回调。**能在 Node 里加载，能被单测完整覆盖**。
 *   · `transfer.ts`：只负责「把 `FetchRoutes` 接到真实后端」这一件事。
 *
 * 分工判据：本文件里**不许出现**任何 `fetch` / `import.meta` / 网络类型；
 * `transfer.ts` 里**不许出现**任何循环控制、指纹比对、缓存淘汰逻辑。
 */

/** 一次问路的返回：`key(a,b) → { minutes, reliable }`；查不到的对**不出现**在返回值里 */
export interface FetchRoutes {
  (pairs: Array<[string, string]>): Promise<Record<string, { minutes: number; reliable?: boolean } | null>>;
}

/** 最小块形状 —— 只要算转场所需的字段，不要求完整的 `TimeBlock` */
export interface PlacedBlock {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  place?: string;
  room?: string;
}

export function pairKey(a: string, b: string): string {
  return `${a}→${b}`;
}

/**
 * 一轮布局里**真实相邻**且地点不同的点对（去重）。
 * 「相邻」= 同一天按 `startMin` 排序后前后相接的两个块。
 */
export function collectTransferPairs(blocks: PlacedBlock[]): Array<[string, string]> {
  const byDay = new Map<number, PlacedBlock[]>();
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
      const k = pairKey(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * 【方法 B】预取候选点对：按天收集块上出现过的所有地点，两两组合（含双向）。
 *
 * 为什么不用 `collectTransferPairs`：那个只看「当前布局里真实相邻的两块」，
 * 是跟着本轮结果走的 —— 引擎挪一个块就会带出一对从没问过的路。
 * 这里改成「同一天里出现过的地方，任意两个都为它备好路」，覆盖面更大、更抗抖动。
 *
 * 有意的取舍：
 *   · **含双向**：`a→b` 与 `b→a` 在真实路网上不等价（单行线、天桥、绕路），
 *     引擎回填是按方向查的，所以两个方向都要备。
 *   · **不按校区预筛**：同校区相邻也可能要走 6 分钟，引擎要用它算可用余量；
 *     少问一条就可能把「赶不上」误判成「来得及」。
 *   · **不跨天**：跨天的地点对没有任何意义（没人从周一的教室走回周二的宿舍）。
 *   · 一个地点**不与自身配对**（走路 0 分钟，没有信息量）。
 */
export function collectCandidatePairs(blocks: PlacedBlock[]): Array<[string, string]> {
  const placesByDay = new Map<number, Set<string>>();
  for (const b of blocks) {
    if (!b.place) continue;
    const set = placesByDay.get(b.dayOfWeek) ?? new Set<string>();
    set.add(b.place);
    placesByDay.set(b.dayOfWeek, set);
  }
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const set of placesByDay.values()) {
    const places = [...set];
    for (const a of places) {
      for (const b of places) {
        if (a === b) continue;
        const k = pairKey(a, b);
        if (seen.has(k)) continue;
        seen.add(k);
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

/**
 * 布局指纹 —— 方法 A 的收敛判据（「这一轮和上一轮是不是同一个计划」）。
 *
 * 只收录**会改变转场需求**的字段：天、起止、地点、房间。
 * 有意**不含标题 / kind** —— 文案改了不影响「要走几分钟」，算进去会让
 * 一个纯文案变化被误判成「未收敛」，白白多跑一轮。
 * 有意**含 room** —— 同楼不同楼层的出入口不同，实际步行分钟数会差。
 */
export function layoutSignature(blocks: PlacedBlock[]): string {
  return blocks
    .map((b) => `${b.dayOfWeek}:${b.startMin}-${b.endMin}:${b.place ?? ''}:${b.room ?? ''}`)
    .sort()
    .join('|');
}

/** 转场缓存：命中则返回实测，未命中交给调用方兜底 */
export class TransferCache {
  private map = new Map<string, { minutes: number; source: string; reliable: boolean }>();

  /** 用后端批量结果填充。`null` / 缺 `minutes` 的一律跳过（= 后端没有这条，保持未命中） */
  fill(routes: Record<string, { minutes: number; reliable?: boolean } | null>): void {
    for (const [k, v] of Object.entries(routes)) {
      if (v && typeof v.minutes === 'number') {
        this.map.set(k, { minutes: v.minutes, source: 'osm', reliable: v.reliable !== false });
      }
    }
  }

  has(a: string, b: string): boolean {
    return this.map.has(pairKey(a, b));
  }

  get(a: string, b: string): { minutes: number; source: string; reliable: boolean } | undefined {
    return this.map.get(pairKey(a, b));
  }

  size(): number {
    return this.map.size;
  }

  /** 清空（换周重算时丢弃过期路网；测试也用它） */
  clear(): void {
    this.map.clear();
  }

  /** 只读快照 —— 供 UI 复用，避免再问一次后端 */
  entries(): Array<[string, { minutes: number; source: string; reliable: boolean }]> {
    return [...this.map.entries()];
  }
}

/** 还欠着的路对：最终布局需要的相邻跨点对 − 缓存里已有的 */
export function uncoveredPairs(blocks: PlacedBlock[], cache: TransferCache): Array<[string, string]> {
  return collectTransferPairs(blocks).filter(([a, b]) => !cache.has(a, b));
}

/**
 * 轮数上限。定 3 的依据（§5.9）：真实周程几乎总在第 2 轮稳定
 * （第 1 轮拿兜底值排、第 2 轮用实测值重排后通常不再变）。
 * 给到 3 是留一次「微抖动再修正」的余量；再多也不会有新信息 ——
 * 候选对（方法 B）在第一轮就已经问全了。
 */
export const MAX_TRANSFER_ROUNDS = 3;

export interface ConvergeResult<B extends PlacedBlock, R> {
  /** 终版求解结果（泛型是为了让调用方拿回完整的 `PlanResult`，而不是只剩 blocks） */
  last: R;
  /** 终版布局 */
  blocks: B[];
  cache: TransferCache;
  /** 实际求解次数（首轮 + 每轮重算各算 1） */
  rounds: number;
  /** 是否达成「所有相邻跨点对都已命中缓存」（AC-10 的判据，true = 达标） */
  converged: boolean;
  /** 最终布局里仍缺实测值的相邻跨点对。空数组 = 达标；非空 = 这些只能靠兜底估算 */
  uncovered: Array<[string, string]>;
  /** 停止原因，便于 UI / 日志如实说明「问了几轮、为什么停」 */
  reason: 'covered' | 'converged' | 'max-rounds' | 'no-progress';
}

export interface ConvergeOptions {
  maxRounds?: number;
  /** 每轮结束的回调（诊断用：打印「第 N 轮问了 M 条」）。不要在这里做业务判断。 */
  onRound?: (info: { round: number; asked: number; uncovered: number }) => void;
}

/**
 * 迭代到不动点（§5.9 方法 A）＋ 预取候选对（方法 B）。
 *
 * @param solve 单趟求解：给一个「转场缓存」，吐出一版完整结果。
 *              ⚠️ 必须把 `cache.provider` 交给引擎 —— 引擎是同步的、不 fetch。
 *              泛型 `R` 让调用方拿回自己的 `PlanResult`（而不是只剩 blocks）。
 * @param fetchRoutes 批量问路（应用层 = `POST /api/route/batch`；测试 = 桩）
 * @param providerOf  把缓存变成引擎要的同步查询函数（`transfer.ts` 里附带兜底估算）
 *
 * 三条正常出口（见 `reason`）：
 *   1. `covered`    —— 本轮布局需要的相邻跨点对**全部命中缓存** ⇒ 没有新信息可拉；
 *   2. `converged`  —— 本轮布局与上轮完全一致 ⇒ 再用同一缓存重算也还是它（不动点）；
 *   3. `max-rounds` —— 到轮数上限。**这不算失败**：说明布局仍在轻微抖动，
 *      返回最后一轮结果并如实标出 `reason`，UI 可提示「转场时间可能有小幅误差」。
 *
 * 另有 `no-progress`：该问的都问过了（本轮没有新路可问），但布局里还有未覆盖对 ——
 * 说明**后端没有这些路**，不属于震荡，也不该假装收敛。
 */
export async function convergeTransfers<B extends PlacedBlock, R>(
  solve: (cache: TransferCache) => { result: R; blocks: B[] },
  fetchRoutes: FetchRoutes,
  providerOf: (cache: TransferCache) => (a: string, b: string) => unknown,
  opts: ConvergeOptions = {},
): Promise<ConvergeResult<B, R>> {
  void providerOf; // 由 `solve` 内部通过闭包使用；保留参数是为了签名自解释
  const maxRounds = Math.max(1, opts.maxRounds ?? MAX_TRANSFER_ROUNDS);
  const cache = new TransferCache();

  let last: { result: R; blocks: B[] } | null = null;
  let prevSignature = '';
  let rounds = 0;
  let reason: ConvergeResult<B, R>['reason'] = 'max-rounds';

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    last = solve(cache);

    // 停止条件①：这一版布局需要的路全在缓存里 → 再算一遍必然得到同一计划
    const uncovered = uncoveredPairs(last.blocks, cache);
    if (uncovered.length === 0) { reason = 'covered'; break; }

    // 停止条件②：布局与上一轮一致 ⇒ 已到不动点
    const signature = layoutSignature(last.blocks);
    if (round > 0 && signature === prevSignature) {
      reason = 'converged';
      break;
    }

    // 本轮要问的路 = 候选对（方法 B）∪ 本轮真实相邻对（方法 A），再减去已缓存
    const want = [...collectCandidatePairs(last.blocks), ...collectTransferPairs(last.blocks)];
    const fresh: Array<[string, string]> = [];
    const queued = new Set<string>();
    for (const [a, b] of want) {
      const k = pairKey(a, b);
      if (cache.has(a, b) || queued.has(k)) continue;
      queued.add(k);
      fresh.push([a, b]);
    }
    if (fresh.length === 0) {
      // 该问的都问过了，但布局里还有未覆盖对 → 后端确实没有这些路，不是震荡
      reason = 'no-progress';
      break;
    }

    const isLast = round === maxRounds - 1;
    if (isLast) {
      // 最后一轮：补完缓存后用同一缓存再算一次终版，然后停。
      // 为什么还要多算这一次：否则返回的布局是**用旧缓存**算的，
      // 和紧接着问到的实测值不一致 —— 用户看到的分钟数会跟指纹对不上。
      const routes = await fetchRoutes(fresh);
      cache.fill(routes);
      opts.onRound?.({ round: rounds, asked: fresh.length, uncovered: uncovered.length });
      last = solve(cache);
      rounds += 1;
      reason = 'max-rounds';
      break;
    }

    const routes = await fetchRoutes(fresh);
    cache.fill(routes);
    opts.onRound?.({ round: rounds, asked: fresh.length, uncovered: uncovered.length });
    prevSignature = signature;
  }

  // 理论不可达（maxRounds ≥ 1 保证循环至少跑一次），兜一下让类型收窄
  if (!last) {
    last = solve(cache);
    rounds = 1;
  }

  const uncovered = uncoveredPairs(last.blocks, cache);
  return {
    last: last.result,
    blocks: last.blocks,
    cache,
    rounds,
    converged: uncovered.length === 0,
    uncovered,
    reason: uncovered.length === 0 ? 'covered' : reason,
  };
}
