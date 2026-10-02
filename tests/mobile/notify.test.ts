/**
 * M4 子集 · 本地通知调度纯函数单测（F13/F14 的夜间可验证面）
 * ============================================================
 * 方案 §10 验收矩阵：「F13/F14 通知 = APK 真机手动（白天）+ 夜间验证 = 调度代码
 * 单测（时间计算纯函数 tests/mobile/notify.test.ts）」。
 *
 * ⚠️ 反向验证（2026-10-03 夜，实跑两次）：把 planTodayNotifications 的
 * 「开始前 10 分钟预告」条件破坏成恒真 → ②④ 红（pass 2 / fail 2）；恢复 → 全绿。
 * 教训登记：首试注释「已结束不排」守卫——测试仍全绿，因为内层两个时刻条件已
 * 完全覆盖该场景，该守卫属防御性冗余（保留，但反验不能拿它当靶子）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeBlock } from '@/types';
import { planTodayNotifications } from '@/features/mobile/lib/notifyBridge.ts';

function blk(p: Partial<TimeBlock>): TimeBlock {
  return {
    id: 'w4-d6-study-lib-1', kind: 'study', dayOfWeek: 6, startMin: 600, endMin: 660,
    title: '高数作业', source: 'template', ...p,
  };
}

const DATE_KEY = '2026-10-3';

test('① 未来块排两条（前 10 分钟 + 开始时刻），时刻正确且 id 确定', () => {
  const b = blk({ startMin: 600, endMin: 660, title: '高数作业', place: '图书馆' });
  const specs = planTodayNotifications([b], 300, DATE_KEY); // 现在 05:00，块 10:00
  assert.equal(specs.length, 2);
  const before = specs.find((s) => s.extra.action === 'before')!;
  const start = specs.find((s) => s.extra.action === 'start')!;
  assert.equal(before.atMin, 590, '开始前 10 分钟');
  assert.ok(before.title.includes('10:00'), '预告标题带块开始时间 10:00（方案 §8.2 范例口径）');
  assert.equal(start.atMin, 600, '开始时刻');
  assert.ok(start.title.includes('至 11:00'), '开始标题带结束时间 11:00');
  assert.equal(start.body, '高数作业 · 图书馆');
  // 确定性：同输入同 id；不同块/同 offset 的 id 不相撞
  const again = planTodayNotifications([b], 300, DATE_KEY);
  assert.equal(before.id, again[0].id);
  assert.notEqual(before.id, start.id);
  assert.ok(before.id >= 0 && before.id < 100_000_000, 'id 落在 8 位空间');
});

test('② 已结束的块不排；进行中的块只排「现在开始」一条（下一分钟）', () => {
  const ended = blk({ id: 'ended', startMin: 100, endMin: 160 });
  const running = blk({ id: 'running', startMin: 280, endMin: 340 });
  const specs = planTodayNotifications([ended, running], 300, DATE_KEY);
  assert.equal(specs.length, 1, '已结束不排、进行中不排预告');
  assert.equal(specs[0].extra.blockId, 'running');
  assert.equal(specs[0].extra.action, 'start');
  assert.equal(specs[0].atMin, 301, '进行中的开始通知 = 下一分钟');
});

test('③ 临近开始（<10 分钟）的块：预告跳过、开始通知保留', () => {
  const soon = blk({ startMin: 308, endMin: 368 });
  const specs = planTodayNotifications([soon], 300, DATE_KEY);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].extra.action, 'start');
  assert.equal(specs[0].atMin, 308);
});

test('④ 同一天多次调用幂等（覆盖式重排的替换基础）', () => {
  const blocks = [blk({ id: 'a', startMin: 600, endMin: 660 }), blk({ id: 'b', startMin: 700, endMin: 750 })];
  const x = planTodayNotifications(blocks, 300, DATE_KEY).map((s) => s.id).sort((p, q) => p - q);
  const y = planTodayNotifications(blocks, 300, DATE_KEY).map((s) => s.id).sort((p, q) => p - q);
  assert.deepEqual(x, y);
  // dateKey 进 id：换一天 id 必变（不会误删第二天的排程）
  const z = planTodayNotifications(blocks, 300, '2026-10-4').map((s) => s.id).sort((p, q) => p - q);
  assert.notDeepEqual(x, z);
});
