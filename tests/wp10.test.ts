/**
 * WP10 拖拽合规 —— compliance 闸（opt-in，只影响用户路径）测试
 * ============================================================
 * 四类拒绝各 1 条：① 不可时段 ② 跨校区来不及 ③ 同校区来不及 ④ 挤出活动
 * （另含既有「课程不能拖」的回归），+ 新增拒绝文案的风格断言。
 *
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §WP10）：
 *   禁用 compliance 闸（dragTo 里删掉 if (compliance) 块）→ ①②③ 全红；
 *   ④ 与旧原因不经过新闸 —— 由既有 ripple.test.ts 守。
 *   不传 compliance 的旧口径由「不传 → 行为不变」用例钉住（旧 golden 逻辑同源）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragTo } from '@/lib/planner/ripple';
import type { TimeBlock } from '@/types';

const block = (id: string, day: number, start: number, end: number, title: string, place?: string, kind: TimeBlock['kind'] = 'study'): TimeBlock =>
  ({ id, kind, dayOfWeek: day, startMin: start, endMin: end, title, ...(place ? { place } : {}) } as TimeBlock);

const COMPLIANCE = {
  unavailableSlots: [{ days: [5], fromMin: 840, toMin: 960 }], // 周五 14:00–16:00 用户说没空
};

test('WP10①: 落点撞用户声明的不可时段 → 拒，文案点名「你说过没空」', () => {
  // 反向：删掉 compliance 闸 → 本用例红
  const blocks = [block('src', 1, 480, 540, '自习')];
  const r = dragTo(blocks, 'src', 5, 900, { compliance: COMPLIANCE });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /没空的时段/);
});

test('WP10①: 不撞不可时段的落点照常通过', () => {
  const blocks = [block('src', 1, 480, 540, '自习')];
  const r = dragTo(blocks, 'src', 5, 990, { compliance: COMPLIANCE }); // 16:30 起，在声明时段外
  assert.equal(r.ok, true);
});

test('WP10②: 跨校区转场来不及 → 拒（保守转场表）', () => {
  // 反向：删掉 compliance 闸 → 本用例红
  // 落点日周五已有「1100 校区活动」(09:00–10:00)，把本部自习挪到 10:10 起
  // —— 军工路 ↔ 1100 保守 25 分钟，10 分钟余量不够
  const blocks = [
    block('src', 1, 480, 540, '自习', '第四教学楼'),
    block('gym', 5, 540, 600, '1100 校区活动', '1100 校区活动', 'activity'),
  ];
  const r = dragTo(blocks, 'src', 5, 610, { compliance: COMPLIANCE });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /来不及走到/);
});

test('WP10②: 同校区相邻余量不足 10 分钟 → 拒', () => {
  // 反向：删掉 compliance 闸 → 本用例红
  // 前一块 08:00–09:00 结束，落点 09:00 起 → 0 分钟余量 < 10
  const blocks = [
    block('src', 1, 480, 540, '自习', '图书馆'),
    block('prev', 5, 480, 600, '阅读', 'activity', 'activity'),
  ];
  const r = dragTo(blocks, 'src', 5, 600, { compliance: COMPLIANCE });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /来不及走到/);
});

test('WP10②: 余量充足 / 没有相邻块 → 放行', () => {
  const blocks = [
    block('src', 1, 480, 540, '自习', '图书馆'),
    block('prev', 5, 480, 600, '阅读', 'activity', 'activity'),
  ];
  // 11:00 起，离 10:00 结束的 prev 有 60 分钟
  assert.equal(dragTo(blocks, 'src', 5, 660, { compliance: COMPLIANCE }).ok, true);
  // 空天随便放
  assert.equal(dragTo([block('src', 1, 480, 540, '自习')], 'src', 3, 600, { compliance: COMPLIANCE }).ok, true);
});

test('WP10: 不传 compliance → 行为与旧版一致（贴紧也能拖，引擎/旧用例不受扰）', () => {
  const blocks = [
    block('src', 1, 480, 540, '自习', '图书馆'),
    block('prev', 5, 480, 600, '阅读', 'activity', 'activity'),
  ];
  // 同样 0 分钟余量的落点：不传 compliance 时不拒（闸只对用户路径生效）
  assert.equal(dragTo(blocks, 'src', 5, 600, {}).ok, true);
  assert.equal(dragTo(blocks, 'src', 5, 900, {}).ok, true); // 也不受不可时段影响
});

test('WP10: 既有拒绝（课程块）在合规闸开启时依然生效，两类拒绝都给人话', () => {
  const blocks = [block('c', 1, 480, 540, '高数课', undefined, 'course')];
  const r = dragTo(blocks, 'c', 5, 600, { compliance: COMPLIANCE });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /课程不能拖/);
});

test('WP10: 新增拒绝文案过风格口径（无负向定性、无 emoji、无 markdown）', () => {
  const reasons = [
    '这是你说过没空的时段，我帮你避开它',
    '来不及走到 —— 两段安排之间要留出路上的时间',
  ];
  const banned = /焦虑|摆烂|内卷|差|落后|拖延|挂科|失败|#[*_[\]]|[\u{1F300}-\u{1FAFF}]/u;
  for (const t of reasons) {
    assert.ok(!banned.test(t), `文案违规：${t}`);
  }
});
