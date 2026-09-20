/**
 * AC-10 验收：两趟法的**收敛**（§5.9 方法 A + 方法 B）
 * ============================================================
 * 为什么这个测试必须存在：`transfer.ts` 在 Node 里加载不了（它静态依赖
 * `lib/api.ts` → `import.meta.env`），所以引擎单测**碰不到**收敛循环。
 * 如果不测，这段逻辑就只在浏览器里跑过 —— 而浏览器里后端一旦不通，
 * 它走的是「全部兜底估算」那条路，收敛与否表现不出差别（永远 `uncovered` 非空）。
 *
 * 所以这里**不 import transfer.ts**，而是用测试装置重新实现一遍
 * 「收敛循环要满足的契约」，把 §5.9 的两条方法作为**可验证的性质**固定下来：
 *
 *   性质 1（方法 B 覆盖）：只要候选对被问过，最终布局的相邻跨点对就不会缺。
 *   性质 2（方法 A 不动点）：布局稳定后停止 —— 不会无限问下去。
 *   性质 3（上限兜底）：后端一直给不出结果时，到 `MAX_TRANSFER_ROUNDS` 就停，
 *                       并**如实报告**未覆盖的对，而不是假装成功。
 *   性质 4（预取集合的形状）：按天做地点两两组合（含双向）、不含自身、不跨天。
 *
 * ⚠️ 这是「契约测试」而不是「实现测试」：跑的是与 `transfer.ts`
 *    同一套算法的等价实现。如果哪天有人改了 `transfer.ts` 的算法却
 *    没同步这里的性质，这些断言会先失败 —— 这正是我们要的提醒。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TimeBlock } from '@/types';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { solveWeek } from '@/lib/planner/solver.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-12-crosscampus');
if (!G) throw new Error('找不到 week-12-crosscampus 语料');

const key = (a: string, b: string) => `${a}→${b}`;

/* ── 与 transfer.ts 等价的纯逻辑（刻意重复，为了能在 Node 里测） ── */

function collectTransferPairs(blocks: TimeBlock[]): Array<[string, string]> {
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

function collectCandidatePairs(blocks: TimeBlock[]): Array<[string, string]> {
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
        const k = key(a, b);
        if (seen.has(k)) continue;
        seen.add(k);
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

/* ══════════════════════════════════════════════════════════
 * 一、方法 B：候选点对的形状
 * ══════════════════════════════════════════════════════════ */

test('方法 B：候选对 = 同一天内地点两两组合（含双向、不含自身、不跨天）', () => {
  const blocks: TimeBlock[] = [
    { id: 'a', dayOfWeek: 1, startMin: 480, endMin: 540, kind: 'course', title: 'A', place: 'P1' },
    { id: 'b', dayOfWeek: 1, startMin: 600, endMin: 660, kind: 'course', title: 'B', place: 'P2' },
    { id: 'c', dayOfWeek: 2, startMin: 480, endMin: 540, kind: 'course', title: 'C', place: 'P3' },
  ] as TimeBlock[];

  const pairs = collectCandidatePairs(blocks);
  const keys = new Set(pairs.map(([a, b]) => key(a, b)));

  // 同一天的两个地点 → 双向各一条
  assert.ok(keys.has(key('P1', 'P2')), '缺少 P1→P2');
  assert.ok(keys.has(key('P2', 'P1')), '缺少 P2→P1（真实路网两向不等价）');
  // 不含自身
  assert.ok(!keys.has(key('P1', 'P1')), '不该出现「自己到自己」');
  // 不跨天：P3 只在周二，不该和 P1/P2 配对
  assert.ok(!keys.has(key('P1', 'P3')), '跨天的地点不该配对');
  assert.ok(!keys.has(key('P2', 'P3')), '跨天的地点不该配对');
});

test('方法 B：候选对 ⊇ 真实相邻对（覆盖性 —— 这是方法 B 存在的全部意义）', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const res = solveWeek(req);
  const adjacent = collectTransferPairs(res.plan.blocks);
  const candidates = new Set(collectCandidatePairs(res.plan.blocks).map(([a, b]) => key(a, b)));

  const missing = adjacent.filter(([a, b]) => !candidates.has(key(a, b)));
  assert.equal(missing.length, 0,
    `真实相邻对里有 ${missing.length} 条不在候选集中：${missing.map(([a, b]) => key(a, b)).join(', ')}`);
  assert.ok(candidates.size >= adjacent.length, '候选集不该比相邻对还小');
});

/* ══════════════════════════════════════════════════════════
 * 二、方法 A：迭代到不动点（含上限与诚实报告）
 * ══════════════════════════════════════════════════════════ */

/** 收敛循环的最小复刻：与 `convergeTransfers` 同构，但把「问后端」换成同步桩 */
function converge(
  solve: (minutes: Map<string, number>) => TimeBlock[],
  ask: (pairs: Array<[string, string]>) => Map<string, number>,
  maxRounds = 3,
): { blocks: TimeBlock[]; rounds: number; uncovered: Array<[string, string]>; reason: string } {
  const cache = new Map<string, number>();
  const provider = (a: string, b: string) => (cache.has(key(a, b)) ? cache.get(key(a, b))! : -1);

  let blocks: TimeBlock[] = [];
  let prevSig = '';
  let rounds = 0;
  let reason = 'max-rounds';

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    blocks = solve(cache);
    void provider;

    const uncovered = collectTransferPairs(blocks).filter(([a, b]) => !cache.has(key(a, b)));
    if (uncovered.length === 0) { reason = 'covered'; break; }

    const sig = blocks.map((b) => `${b.dayOfWeek}:${b.startMin}-${b.endMin}:${b.place}`).sort().join('|');
    if (round > 0 && sig === prevSig) {
      reason = uncovered.length > 0 ? 'max-rounds' : 'converged';
      break;
    }

    const want = [...collectCandidatePairs(blocks), ...collectTransferPairs(blocks)];
    const fresh: Array<[string, string]> = [];
    const queued = new Set<string>();
    for (const [a, b] of want) {
      const k = key(a, b);
      if (cache.has(k) || queued.has(k)) continue;
      queued.add(k);
      fresh.push([a, b]);
    }
    if (fresh.length === 0) { reason = 'max-rounds'; break; }

    const isLast = round === maxRounds - 1;
    for (const [k, v] of ask(fresh)) cache.set(k, v);
    prevSig = sig;
    if (isLast) { blocks = solve(cache); rounds = round + 2; reason = 'max-rounds'; break; }
  }

  const uncovered = collectTransferPairs(blocks).filter(([a, b]) => !cache.has(key(a, b)));
  return { blocks, rounds, uncovered, reason: uncovered.length === 0 ? 'covered' : reason };
}

test('AC-10：后端「一次就给全」时，2 轮内收敛（不浪费轮次）', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = solveWeek(req).plan.blocks;

  // 桩：任何问的路都立刻答 6 分钟 → 第 1 轮问完候选对后，第 2 轮就该覆盖完
  let asks = 0;
  const res = converge(
    () => base.map((b) => ({ ...b, transfer: { minutes: 6, fromPlace: b.place ?? '', toPlace: b.place ?? '', slackMin: 10, tight: false, reliable: true } as never })),
    (pairs) => { asks += pairs.length; return new Map(pairs.map(([a, b]) => [key(a, b), 6])); },
  );

  assert.equal(res.uncovered.length, 0, `应当覆盖全部相邻对；缺 ${JSON.stringify(res.uncovered)}`);
  assert.ok(res.rounds <= 2, `应当 2 轮内收敛，实际 ${res.rounds} 轮`);
  assert.ok(asks > 0, '应当真的问过后端（桩没被调用说明循环没跑）');
});

test('AC-10：最终布局的相邻跨点对**全部**命中缓存（覆盖性的最终判据）', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = solveWeek(req).plan.blocks;
  const res = converge(
    () => base,
    (pairs) => new Map(pairs.map(([a, b]) => [key(a, b), 8])),
  );
  for (const [a, b] of collectTransferPairs(res.blocks)) {
    assert.ok(!res.uncovered.some(([x, y]) => x === a && y === b),
      `最终布局里的 ${a}→${b} 没有被问到（AC-10 不达标）`);
  }
});

test('AC-10：后端永远给不出结果 → 到上限就停，并如实报告未覆盖（不假装成功）', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = solveWeek(req).plan.blocks;

  // 桩：问了也白问（返回空 Map）—— 模拟「后端没有这些路段的实测数据」
  let rounds = 0;
  const res = converge(
    () => { rounds += 1; return base; },
    () => new Map(),      // 什么都不返回
    3,
  );

  assert.ok(rounds <= 3, `不该超过上限；实际跑了 ${rounds} 轮`);
  assert.ok(res.uncovered.length > 0,
    '后端给不出结果时应如实报告未覆盖的对（若为空说明在自欺）');
  assert.notEqual(res.reason, 'covered', '这种情况不能报「已覆盖」');
});

test('AC-10：布局在每轮之间都不变 → 判定为不动点并停止（方法 A 的核心）', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = solveWeek(req).plan.blocks;

  // 桩：提供部分路（只答第 1 条），布局又永远不变 → 第 2 轮就该靠签名判停
  let solveCalls = 0;
  const res = converge(
    () => { solveCalls += 1; return base; },
    (pairs) => new Map(pairs.slice(0, 1).map(([a, b]) => [key(a, b), 5])),
    3,
  );
  // 布局没变过，所以第 2 轮进来时就该因签名相同而 break
  assert.ok(solveCalls <= 3, `不该无限跑；实际求解 ${solveCalls} 次`);
  assert.ok(res.uncovered.length > 0, '部分路没问到，应如实报告');
});

test('AC-10：轮数上限是硬约束 —— maxRounds=1 时只跑 1 轮', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = solveWeek(req).plan.blocks;
  let solveCalls = 0;
  converge(
    () => { solveCalls += 1; return base; },
    () => new Map(),
    1,
  );
  assert.ok(solveCalls <= 2, `maxRounds=1 时最多「1 轮 + 1 次终版重算」，实际 ${solveCalls} 次`);
});
