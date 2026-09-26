/**
 * WP9 改排程执行器 —— cancel / reschedule / replace 的纯函数层测试
 * ============================================================
 * 执行器本体在防腐层 weekPlanForChat.ts（libao↔planner 唯一接缝），
 * LbaoChat 只做「说话与确认」—— 这里直接测匹配与落层逻辑。
 *
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §WP9）：
 *   RV-5b ← applyCancel 还原成 no-op / findCancelTargets 丢 plan 块通道 → 用例红
 *   RV-5c ← planReschedule 丢 displaced 清单 → 涟漪用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCancel,
  findCancelTargets,
  findMoveTargets,
  planReschedule,
} from '@/features/libao/weekPlanForChat';
import { emptyUserPlan } from '@/features/week/userPlanStore';
import type { TimeBlock } from '@/types';
import type { UserTask } from '@/lib/planner/templates';

const block = (id: string, day: number, start: number, title: string, kind: TimeBlock['kind'] = 'study'): TimeBlock =>
  ({ id, kind, dayOfWeek: day, startMin: start, endMin: start + 60, title } as TimeBlock);

const task = (id: string, title: string): UserTask =>
  ({ id, title, dayOfWeek: 3, durationMin: 60 });

test('WP9·cancel: 先 user 待办，后 plan 的 activity/study 块；课程块绝不进取消通道', () => {
  const tasks = [task('t1', '光电杯材料')];
  const blocks = [
    block('b-course', 1, 480, '光电杯材料课', 'course'),
    block('b-act', 2, 600, '光电杯讨论', 'activity'),
  ];
  const targets = findCancelTargets('光电杯', tasks, blocks);
  assert.equal(targets[0].origin, 'user', 'user 待办优先');
  assert.equal(targets[1].origin, 'plan');
  assert.equal(targets[1].blockId, 'b-act');
  assert.ok(targets.every((t) => t.blockId !== 'b-course'), '课程不进取消通道（改课走调课）');
  // 模糊匹配：互相包含即可
  assert.equal(findCancelTargets('光电杯材料', [], [block('b', 1, 480, '光电杯材料', 'activity')]).length, 1);
  // 空查询 / 无命中
  assert.equal(findCancelTargets('', tasks, blocks).length, 0);
  assert.equal(findCancelTargets('不存在的事', tasks, blocks).length, 0);
});

test('WP9·cancel: applyCancel 落层正确且不改原层（undo 快照语义的前提）', () => {
  // 反向：applyCancel 还原成 no-op → 本用例红
  const layer = emptyUserPlan();
  layer.tasks = [task('t1', '光电杯材料')] as typeof layer.tasks;
  layer.excluded = [];

  const t1 = applyCancel(layer, { taskId: 't1', title: '光电杯材料', origin: 'user', hint: 'x' });
  assert.equal(t1.tasks.length, 0);
  assert.equal(layer.tasks.length, 1, '原层不可变');

  const t2 = applyCancel(layer, { blockId: 'b1', title: '自习', origin: 'plan', hint: 'x' });
  assert.deepEqual(t2.excluded, ['b1']);
  assert.equal(layer.excluded.length, 0, '原层不可变');
});

test('WP9·reschedule: findMoveTargets 只认非课程块，按天+时刻排序', () => {
  const blocks = [
    block('b2', 5, 600, '高数复习'),
    block('b1', 2, 480, '高数复习'),
    block('bc', 1, 480, '高数课', 'course'),
  ];
  const targets = findMoveTargets('高数复习', blocks);
  assert.deepEqual(targets.map((b) => b.id), ['b1', 'b2']);
  assert.equal(findMoveTargets('高数课', blocks).length, 0, '课程不走拖拽通道');
});

test('WP9·reschedule: planReschedule 走 dragTo 同一条校验，产出 move + 涟漪清单', () => {
  // 反向：planReschedule 丢掉 displaced 清单 → 本用例红
  const blocks = [
    block('src', 2, 480, '自习'),
    block('other', 5, 600, '阅读', 'activity'), // 周五 10:00–11:00
  ];
  const preview = planReschedule(blocks, 'src', 5, 5, 600);
  assert.ok(preview.ok);
  assert.equal(preview.move?.blockId, 'src');
  assert.equal(preview.move?.dayOfWeek, 5);
  assert.equal(preview.move?.source, 'drag', '用户明确表达 → hard');
  // src 挪到周五 10:00，撞上 other（10:00–11:00）→ other 被顺延
  assert.ok(preview.displaced.length > 0, '挪到占用时段必须产生涟漪预览');
  assert.ok(preview.displaced.every((d) => d.title && /^\d{2}:\d{2}$/.test(d.start)));
});

test('WP9·reschedule: 拖不过去时 ok=false 带人话原因；课程块被拒', () => {
  // 目标时段有课 → 课不能让位（dragTo 的合规校验被继承）
  const blocks = [block('src', 2, 480, '自习'), block('c', 5, 600, '高数课', 'course')];
  const blocked = planReschedule(blocks, 'src', 5, 5, 600);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason ?? '', /课/);
  assert.ok(blocked.reason, '拒绝要给人话原因');
});

test('WP9: 五意图 DraftKind 与 detectIntent 一一对应（路由不漂移）', async () => {
  const { detectIntent } = await import('@/features/libao/libaoIntent');
  assert.equal(detectIntent('我要排周四下午打羽毛球'), 'create');
  assert.equal(detectIntent('取消周四的复习'), 'cancel');
  assert.equal(detectIntent('把高数复习挪到周四'), 'reschedule');
  assert.equal(detectIntent('把周三的社团改成备赛'), 'replace');
  assert.equal(detectIntent('这周我忙不忙'), 'query');
});
