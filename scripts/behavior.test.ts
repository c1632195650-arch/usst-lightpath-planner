/**
 * 行为记录的纯函数测试
 * ============================================================
 * 只测不碰 localStorage 的那部分（`loadRecords` 等是薄壳）。
 * 重点覆盖三种**真的会算错**的情形：重复标记、跨周串味、把「跳过」也算进负荷。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualLoadByDate, findStatus, makeId, prune, summarizeWeek, upsert,
} from '@/features/behavior/behaviorLog';
import type { BehaviorRecord } from '@/features/behavior/behaviorLog';

const AT = '2026-09-15T10:00:00.000Z';

function rec(over: Partial<BehaviorRecord> & { blockId: string; date: string }): BehaviorRecord {
  return {
    id: makeId(over.blockId, over.date),
    weekNo: 3,
    kind: 'study',
    title: '自习',
    plannedMin: 60,
    status: 'done',
    at: AT,
    ...over,
  };
}

/* ---------------- 幂等 ---------------- */

test('同一个块同一天标记两次 → 覆盖，不产生两条记录', () => {
  const a = rec({ blockId: 'w3-d2-study-1', date: '2026-09-15', status: 'done' });
  const b = rec({ blockId: 'w3-d2-study-1', date: '2026-09-15', status: 'skipped' });

  const once = upsert([], a);
  const twice = upsert(once, b);

  assert.equal(twice.length, 1);
  assert.equal(twice[0].status, 'skipped');   // 用户改主意 → 以最后一次为准
});

test('不同日期 / 不同块各自独立', () => {
  let list: BehaviorRecord[] = [];
  list = upsert(list, rec({ blockId: 'b1', date: '2026-09-15' }));
  list = upsert(list, rec({ blockId: 'b1', date: '2026-09-16' }));
  list = upsert(list, rec({ blockId: 'b2', date: '2026-09-15' }));
  assert.equal(list.length, 3);
});

/* ---------------- 上限裁剪 ---------------- */

test('超过上限时丢掉最旧的，保留最近的行为', () => {
  const many: BehaviorRecord[] = [];
  for (let i = 0; i < 810; i++) {
    many.push(rec({ blockId: `b${i}`, date: '2026-09-15' }));
  }
  const out = prune(many);
  assert.equal(out.length, 800);
  assert.equal(out[out.length - 1].blockId, 'b809');   // 最新的在
  assert.equal(out[0].blockId, 'b10');                 // 最旧的 10 条被裁掉
});

test('未超上限时原样返回（不复制）', () => {
  const few = [rec({ blockId: 'b1', date: '2026-09-15' })];
  assert.equal(prune(few), few);
});

/* ---------------- 完成度统计 ---------------- */

test('没有记录时完成率是 null，不是 0', () => {
  const p = summarizeWeek([], 3);
  assert.equal(p.rate, null);      // 0 会被误读成「一个都没做」，含义完全不同
  assert.equal(p.marked, 0);
  assert.equal(p.doneMin, 0);
});

test('完成度按周统计，跨周不串', () => {
  const list = [
    rec({ blockId: 'a', date: '2026-09-15', weekNo: 3, plannedMin: 90, status: 'done' }),
    rec({ blockId: 'b', date: '2026-09-16', weekNo: 3, plannedMin: 30, status: 'skipped' }),
    rec({ blockId: 'c', date: '2026-09-22', weekNo: 4, plannedMin: 60, status: 'done' }),
  ];
  const p = summarizeWeek(list, 3);
  assert.equal(p.marked, 2);
  assert.equal(p.done, 1);
  assert.equal(p.skipped, 1);
  assert.equal(p.doneMin, 90);        // 只算 done；skipped 的 30 分不算
  assert.equal(p.markedMin, 120);
  assert.equal(p.rate, 0.5);
});

/* ---------------- 实际负荷聚合 ---------------- */

test('实际负荷只统计「做了」的块，跳过的不算', () => {
  const list = [
    rec({ blockId: 'a', date: '2026-09-15', plannedMin: 60, status: 'done' }),
    rec({ blockId: 'b', date: '2026-09-15', plannedMin: 45, status: 'skipped' }),
  ];
  const out = actualLoadByDate(list, ['2026-09-15']);
  // 把 skipped 算进去会让「跨周疲劳」的输入虚高 —— 引擎以为你很累，而你其实什么都没做
  assert.deepEqual(out, [60]);
});

test('同一天多个块累加；缺的日期补 0（不跳过）', () => {
  const list = [
    rec({ blockId: 'a', date: '2026-09-15', plannedMin: 60 }),
    rec({ blockId: 'b', date: '2026-09-15', plannedMin: 90 }),
    rec({ blockId: 'c', date: '2026-09-17', plannedMin: 30 }),
  ];
  const out = actualLoadByDate(list, ['2026-09-15', '2026-09-16', '2026-09-17']);
  assert.deepEqual(out, [150, 0, 30]);
});

test('空日期序列返回空数组', () => {
  assert.deepEqual(actualLoadByDate([rec({ blockId: 'a', date: '2026-09-15' })], []), []);
});

/* ---------------- 查询 ---------------- */

test('findStatus 按「块 + 日期」精确命中', () => {
  const list = [rec({ blockId: 'b1', date: '2026-09-15', status: 'skipped' })];
  assert.equal(findStatus(list, 'b1', '2026-09-15'), 'skipped');
  assert.equal(findStatus(list, 'b1', '2026-09-16'), undefined);   // 别的日期
  assert.equal(findStatus(list, 'b2', '2026-09-15'), undefined);   // 别的块
});

/* ---------------- 确定性 ---------------- */

test('同输入两次结果完全一致', () => {
  const list = [rec({ blockId: 'a', date: '2026-09-15' })];
  const next = rec({ blockId: 'b', date: '2026-09-16', status: 'skipped' });
  assert.deepEqual(upsert(list, next), upsert(list, next));
  assert.deepEqual(summarizeWeek(list, 3), summarizeWeek(list, 3));
});
