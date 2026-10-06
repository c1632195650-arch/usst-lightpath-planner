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
import {
  bannerBlock, markPermissionDenied, needsRecoveryPrompt, nextNotifyLabel,
  notifyCountdown, shouldAutoRequestPermission,
  PERM_DENIED_KEY, RECOVERY_SHOWN_KEY,
} from '@/features/mobile/lib/notifyStatus.ts';
import { fmtMin } from '@/features/mobile/lib/sync.ts';

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

/* ---------------- Wave 2 · 通知可见性（新任务三 P2-1/P2-2/P2-3） ---------------- */

test('⑤ notifyCountdown：计数 = 排程数，next 取最早触发的 spec', () => {
  const blocks = [
    blk({ id: 'a', startMin: 600, endMin: 660 }),
    blk({ id: 'b', startMin: 700, endMin: 750 }),
  ];
  const { count, next } = notifyCountdown(blocks, 300, DATE_KEY);
  assert.equal(count, 4, '两块 × 各两条');
  assert.equal(next?.atMin, 590, '最早触发 = 第一块的开始前 10 分钟');
  assert.equal(next?.extra.blockId, 'a');
});

test('⑥ notifyCountdown：没有可排的 → count=0 且 next=null（UI 显示「没有已排提醒」）', () => {
  const { count, next } = notifyCountdown([blk({ startMin: 100, endMin: 160 })], 300, DATE_KEY);
  assert.equal(count, 0);
  assert.equal(next, null);
  assert.equal(notifyCountdown([], 300, DATE_KEY).count, 0);
  assert.equal(nextNotifyLabel(null, fmtMin), null);
});

test('⑦ nextNotifyLabel：给出「HH:MM · 标题」文案', () => {
  const { next } = notifyCountdown([blk({ startMin: 600, endMin: 660 })], 300, DATE_KEY);
  const label = nextNotifyLabel(next, fmtMin);
  assert.ok(label);
  assert.ok(label.startsWith('09:50'), `应含触发时刻 09:50，得到 ${label}`);
  assert.ok(label.includes('高数作业'));
});

/* 反向验证（M3-W2 实跑）：把 shouldAutoRequestPermission 改成恒 true → ⑧ 红 */
test('⑧ 权限前置：拒绝过一次 → 本安装周期不再自动弹', () => {
  assert.equal(shouldAutoRequestPermission(() => null), true, '没拒绝过 → 该弹');
  assert.equal(shouldAutoRequestPermission(() => '0'), true, '其他值不算拒绝档');
  assert.equal(shouldAutoRequestPermission(() => '1'), false, '拒绝档 = 不再自动弹');
  const w: string[] = [];
  markPermissionDenied((k, v) => w.push(`${k}=${v}`));
  assert.deepEqual(w, [`${PERM_DENIED_KEY}=1`], '落档键与值正确');
});

/* 反向验证（M3-W2 实跑）：把 needsRecoveryPrompt 的 pending===0 分支破坏成恒 false → ⑨⑩ 红 */
test('⑨ 重启恢复：有剩余块 + pending 空 + 没提示过 → 提示；提示过 → 永不再提示', () => {
  assert.equal(needsRecoveryPrompt(3, 0, false), true, '疑似丢排程 → 提示一次');
  assert.equal(needsRecoveryPrompt(3, 0, true), false, '只提示一次');
  assert.equal(needsRecoveryPrompt(0, 0, false), false, '没有剩余块 → 无从恢复，不提示');
});

test('⑩ 重启恢复：pending 查不了（null）或非空 → 不提示（不吓用户）', () => {
  assert.equal(needsRecoveryPrompt(3, null, false), false, 'web/桥不可用 → 查不了就别提示');
  assert.equal(needsRecoveryPrompt(3, 2, false), false, '排程还在 → 不提示');
  assert.equal(needsRecoveryPrompt(3, 5, true), false);
});

test('⑪ 恢复提示的诚实口径：RECOVERY_SHOWN_KEY 只作「已提示过」标记，不含「已恢复」语义', () => {
  // 锁文案纪律的机制面：key 名即语义，提示文案在 UI 层断言（e2e）——这里锁「只提示一次」的存储键
  assert.equal(RECOVERY_SHOWN_KEY, 'usst.mobile.recoveryPromptShown');
});

test('⑫ notifyCountdown 与 planTodayNotifications 同源：进行中块计入「现在开始」一条', () => {
  const running = blk({ id: 'running', startMin: 280, endMin: 340 });
  const { count, next } = notifyCountdown([running], 300, DATE_KEY);
  assert.equal(count, 1);
  assert.equal(next?.atMin, 301);
  assert.equal(next?.title.includes('至 05:40'), true, '进行中的开始通知带结束时间');
});

/* ---------------- M5b（2026-10-07）：Web 页内横幅触发时刻（纯函数） ---------------- */

test('M5b · bannerBlock：开始前 ≤10 分钟 → 命中；>10 分钟/已开始/已完成 → null', () => {
  const b1 = blk({ id: 'w4-d6-study-1', startMin: 600, endMin: 660 });
  const b2 = blk({ id: 'w4-d6-study-2', startMin: 700, endMin: 760 });
  // 前 9 分钟 → 命中（Web 横幅触发窗）
  expectBanner([b1], 591, 'w4-d6-study-1');
  // 恰好前 10 分钟 → 命中（与 planTodayNotifications 的预告提前量同口径）
  expectBanner([b1], 590, 'w4-d6-study-1');
  // 前 11 分钟 → 不弹（太早）
  assert.equal(bannerBlock([b1], 589), null);
  // 已开始 → 不弹（横幅只负责「快开始了」）
  assert.equal(bannerBlock([b1], 601), null);
  // 已完成 → 不弹
  assert.equal(bannerBlock([b1], 595, new Set(['w4-d6-study-1'])), null);
  // 多块同窗 → 取最早开始的
  expectBanner([b2, b1, blk({ id: 'w4-d6-study-1b', startMin: 605, endMin: 665 })], 595, 'w4-d6-study-1');
});

function expectBanner(blocks: TimeBlock[], nowMin: number, wantId: string) {
  const b = bannerBlock(blocks, nowMin);
  assert.ok(b, `${nowMin} 分钟处应有横幅`);
  assert.equal(b.id, wantId);
}
