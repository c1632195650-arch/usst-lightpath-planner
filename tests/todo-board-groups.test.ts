/**
 * UI v2 批次 D4 · 待办看板分组断言（memoLogic 纯函数）
 * RV-D4-1 ← xunRank 旬序比较写反 → 「逾期」用例红
 * RV-D4-2 ← dayFromBlockId 解析错位 → 「今天」用例红
 * RV-D4-3 ← groupTodosForBoard 把 done 混进 open 组 → 「完成隔离」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentXun, groupTodosForBoard, todoGroupOf, xunRank } from '@/features/memo/memoLogic';

const T = '2026-10-07'; // 周三；10 月上旬
const todo = (over: Record<string, unknown>) => ({
  id: 'x', kind: 'longterm', title: 'x', createdAt: T, completion: 'open',
  ...over,
}) as Parameters<typeof todoGroupOf>[0];

test('D4 旬序: xunRank 单调（上旬<中旬<下旬，跨月可比）（RV-D4-1）', () => {
  assert.ok(xunRank('2026-09-下旬') < xunRank('2026-10-上旬'), '跨月递增');
  assert.ok(xunRank('2026-10-上旬') < xunRank('2026-10-中旬'), '旬内递增');
  assert.ok(Number.isNaN(xunRank('随便')), '非法输入 NaN 不误判');
});

test('D4 currentXun: 今天所在旬记法与 plannedDone 同形', () => {
  assert.equal(currentXun('2026-10-07'), '2026-10-上旬');
  assert.equal(currentXun('2026-10-15'), '2026-10-中旬');
  assert.equal(currentXun('2026-10-25'), '2026-10-下旬');
});

test('D4 分组: 排程块天解析 → today/week（RV-D4-2）', () => {
  assert.equal(todoGroupOf(todo({ scheduledBlockId: 'w6-d3-study-x' }), 3, T), 'today', '块天=今天');
  assert.equal(todoGroupOf(todo({ scheduledBlockId: 'w6-d3-study-x' }), 4, T), 'week', '同块、今天是周四 → week');
  assert.equal(todoGroupOf(todo({ scheduledBlockId: 'w6-d5-study-x' }), 3, T), 'week');
  assert.equal(todoGroupOf(todo({}), 3, T), 'unscheduled', '无任何信息 → 未排');
});

test('D4 逾期: longterm plannedDone 旬已过且未完成 → overdue；当旬 → week；未来旬 → 未排（RV-D4-1）', () => {
  assert.equal(todoGroupOf(todo({ plannedDone: '2026-09-下旬' }), 3, T), 'overdue');
  assert.equal(todoGroupOf(todo({ plannedDone: '2026-10-上旬' }), 3, T), 'week', '当旬=本周/本旬语境，不算逾期');
  assert.equal(todoGroupOf(todo({ plannedDone: '2026-10-中旬' }), 3, T), 'unscheduled', '未来旬未到执行期 → 未排');
  assert.equal(todoGroupOf(todo({ plannedDone: '2026-09-下旬', completion: 'done' }), 3, T), 'done', '完成了不判逾期');
});

test('D4 看板: 组间隔离、组内保序（RV-D4-3）', () => {
  const list = [
    todo({ id: 'a', plannedDone: '2026-09-下旬' }),
    todo({ id: 'b', scheduledBlockId: 'w6-d3-study-b' }),
    todo({ id: 'c' }),
    todo({ id: 'd', completion: 'done' }),
    todo({ id: 'e', scheduledBlockId: 'w6-d4-study-e' }),
  ];
  const g = groupTodosForBoard(list, 3, T);
  assert.deepEqual(g.overdue.map((t) => t.id), ['a']);
  assert.deepEqual(g.today.map((t) => t.id), ['b']);
  assert.deepEqual(g.week.map((t) => t.id), ['e']);
  assert.deepEqual(g.unscheduled.map((t) => t.id), ['c']);
  assert.deepEqual(g.done.map((t) => t.id), ['d'], 'done 独立成组，不混进 open');
});
