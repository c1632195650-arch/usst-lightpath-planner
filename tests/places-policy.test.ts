/**
 * E 批 E2 · 空间库 → 引擎选取策略验收（2026-09-28）
 * ============================================================
 * 判据：① 开关缺省关闭；② 校区确证（跨校区 / UNKNOWN 一律剔除，**不猜**）；
 *       ③ 营业三态（未知 ≠ 关，也不假装开）；④ **估算留余量**（估算走更紧的步行预算）；
 *       ⑤ 排序确定性（同输入同序，不引入随机数）；⑥ 超预算只**挪后**不删除。
 * 反向验证锚点（RV，删实现必红）：
 *   E2-RV1 ← rankPlaces 去掉校区过滤 → 「校区确证」用例红
 *   E2-RV2 ← rankPlaces 估算不收紧预算 → 「估算留余量」用例红
 *   E2-RV3 ← orderByWalkFrom 不把超预算挪后 → 「挪后不删」用例红
 *   E2-RV4 ← construct 去掉 spatialWired() 判断 → 源码锁用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { CampusId } from '@/types';
import type { Place } from '@/lib/planner/model.ts';
import {
  DEFAULT_WALK_BUDGET_MIN, ESTIMATE_SLACK_EXTRA_MIN,
  openStateAt, orderByWalkFrom, rankPlaces, reorderPool, spatialWired,
} from '@/lib/planner/placesPolicy.ts';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

function place(name: string, campus: CampusId, hours: Array<[number, number]> = []): Place {
  return {
    id: `poi-${name}`,
    name,
    campus,
    hours: hours.map(([startMin, endMin]) => ({ startMin, endMin })),
    category: 'study',
  };
}

const LIB = place('图书馆', 'JG516', [[480, 1380]]);   // 8:00–23:00
const OLD_LIB = place('老图书馆', 'JG516', [[360, 1380]]); // 6:00–23:00
const NO_HOURS = place('第三教学楼', 'JG516', []);      // 时段未知
const SOUTH = place('南校自习室', 'JG334', [[480, 1200]]);
const UNKNOWN_CAMPUS = place('某处', 'UNKNOWN', []);

function withSpatial<T>(on: boolean, fn: () => T): T {
  const prev = process.env.SPATIAL_WIRED;
  if (on) process.env.SPATIAL_WIRED = '1'; else delete process.env.SPATIAL_WIRED;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.SPATIAL_WIRED; else process.env.SPATIAL_WIRED = prev;
  }
}

/* ---------------- ① 开关 ---------------- */

test('E2 开关: spatialWired() 缺省 false，置 1 为 true', () => {
  withSpatial(false, () => assert.equal(spatialWired(), false));
  withSpatial(true, () => assert.equal(spatialWired(), true));
});

/* ---------------- ③ 营业三态 ---------------- */

test('E2 营业三态: 未知时段 ≠ 关门（null），明确超窗才是 false', () => {
  assert.equal(openStateAt(LIB, 600), true, '10:00 在 8:00–23:00 内');
  assert.equal(openStateAt(LIB, 300), false, '05:00 未开门');
  assert.equal(openStateAt(NO_HOURS, 600), null, '无时段数据 = 未知（不假装知道）');
  assert.equal(openStateAt(LIB, undefined), null, '没给时刻 = 未知');
});

/* ---------------- ② 校区确证 ---------------- */

test('E2 校区确证: 跨校区与 UNKNOWN 一律剔除（不猜）', () => {
  const ranked = rankPlaces({
    candidates: [LIB, SOUTH, UNKNOWN_CAMPUS, NO_HOURS],
    campus: 'JG516',
    atMin: 600,
  });
  const names = ranked.map((r) => r.name);
  assert.deepEqual(names.sort(), ['图书馆', '第三教学楼'].sort());
  assert.ok(!names.includes('南校自习室'), '跨校区不进候选');
  assert.ok(!names.includes('某处'), 'UNKNOWN 校区不进候选（宁缺不猜）');
});

/* ---------------- ③′ 明确关门剔除 ---------------- */

test('E2 关门剔除: 目标时刻明确不开放的候选被剔除', () => {
  const ranked = rankPlaces({ candidates: [LIB, OLD_LIB], campus: 'JG516', atMin: 400 });
  assert.deepEqual(ranked.map((r) => r.name), ['老图书馆'], '6:00 只有老馆开着');
});

/* ---------------- ④ 估算留余量 ---------------- */

test('E2 估算留余量: 同等分钟下，估算项用更紧预算（超出即剔除）', () => {
  const budget = DEFAULT_WALK_BUDGET_MIN;             // 20
  const cap = budget - ESTIMATE_SLACK_EXTRA_MIN;      // 15
  const walk = (name: string) => ({
    实测十八: { minutes: 18, estimate: false },
    估算十八: { minutes: 18, estimate: true },
    估算十四: { minutes: 14, estimate: true },
  } as Record<string, { minutes: number; estimate: boolean }>)[name] ?? null;

  const ranked = rankPlaces({
    candidates: [place('实测十八', 'JG516'), place('估算十八', 'JG516'), place('估算十四', 'JG516')],
    campus: 'JG516',
    walk,
    walkBudgetMin: budget,
  });
  const names = ranked.map((r) => r.name);
  assert.ok(names.includes('实测十八'), '实测 18 ≤ 20 保留');
  assert.ok(!names.includes('估算十八'), `估算 ${18} > ${cap} 剔除（估算要留余量）`);
  assert.ok(names.includes('估算十四'), `估算 14 ≤ ${cap} 保留`);
});

/* ---------------- ⑤ 排序确定性 ---------------- */

test('E2 排序: 现在开着 > 未知；距离升序、未知垫后；同分按名称（确定性）', () => {
  const ranked = rankPlaces({
    candidates: [
      place('乙未知时候', 'JG516'),
      place('甲开着', 'JG516', [[480, 1380]]),
      place('丙更远', 'JG516', [[480, 1380]]),
    ],
    campus: 'JG516',
    atMin: 600,
    walk: (name: string) => (name === '甲开着'
      ? { minutes: 3, estimate: false }
      : name === '丙更远' ? { minutes: 9, estimate: false } : null),
  });
  assert.deepEqual(ranked.map((r) => r.name), ['甲开着', '丙更远', '乙未知时候']);
  // 同输入再跑一次必须完全一致（无随机数）
  const again = rankPlaces({
    candidates: [
      place('乙未知时候', 'JG516'), place('甲开着', 'JG516', [[480, 1380]]),
      place('丙更远', 'JG516', [[480, 1380]]),
    ],
    campus: 'JG516',
    atMin: 600,
    walk: (name: string) => (name === '甲开着'
      ? { minutes: 3, estimate: false }
      : name === '丙更远' ? { minutes: 9, estimate: false } : null),
  });
  assert.deepEqual(again.map((r) => r.name), ranked.map((r) => r.name));
});

/* ---------------- ⑥ 挪后不删（构造循环用） ---------------- */

test('E2 挪后不删: 超预算/不可达的候选被挪到队尾，一个都不丢', () => {
  const items = [
    { place: '远地方' }, { place: '近地方' }, { place: '没数据' },
  ];
  const out = orderByWalkFrom(items, '起点', (t) => (
    t.place === '近地方' ? { minutes: 4, estimate: false }
      : t.place === '远地方' ? { minutes: 40, estimate: false } : null
  ));
  assert.deepEqual(out.map((t) => t.place), ['近地方', '没数据', '远地方']);
  assert.equal(out.length, items.length, '只挪后、不删除');
  // 无锚点 = 原序（关闭态与既往一致）
  assert.deepEqual(orderByWalkFrom(items, undefined, () => null).map((t) => t.place),
    ['远地方', '近地方', '没数据']);
});

test('E2 池重排: 画像池内的可达项保持原序，不可达项降级', () => {
  const pool = ['图书馆', '老图书馆', '第三教学楼'];
  const ranked = rankPlaces({
    candidates: [place('图书馆', 'JG516'), place('第三教学楼', 'JG516')],
    campus: 'JG516',
  });
  const { preferred, demoted } = reorderPool(pool, ranked);
  assert.deepEqual(preferred, ['图书馆', '第三教学楼'], '仍在候选池内的保持相对原序');
  assert.deepEqual(demoted, ['老图书馆'], '不可达/未确证的降级而不是消失');
});

/* ---------------- ⑦ 源码锁 ---------------- */

test('E2 源码锁: construct 的候选排序受 spatialWired 控制且保留既有兜底链', () => {
  const c = src('/src/lib/planner/construct.ts');
  assert.match(c, /if \(spatialWired\(\) && prev\?\.place\)/, '开关闸在位');
  assert.match(c, /orderByWalkFrom\(pool, prev\.place/, '按步行排序在位');
  assert.match(
    c,
    /cands\.find\(\(t\) => openAt\(t, gap\.endMin - MIN_CHUNK, gap\.endMin\)\)/,
    '既有「末尾仍开门」兜底链必须保留（关闭态逐位等价的前提）',
  );
});
