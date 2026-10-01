/**
 * 批 3a · 梨宝单日重排 —— 纯函数层回归
 * ============================================================
 * 语义（5A-②）：「只重排周四，其余六天原样」。
 *   · 引擎整周照算（它必须看全局才知道周四是紧还是松）；
 *   · 融合：目标天用新版、其余天沿用上一版（复用 R6.1 localizedPlan）；
 *   · 落盘：非目标天被引擎挪动/消失的块 → hard move（source 'edit'）钉回上一版
 *     位置 —— 「其余天保持原样」是用户确认过的约束，下次重排也不许动。
 *
 * ⚠️ 反向验证：把 dayReplanPins 改成「对所有天 pin」/ 去掉 fused 的 localizedPlan
 *    调用 / pins 丢掉 source，下列用例逐组变红。
 */
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) as string : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayReplanPins, planWeekWithTasks, replanDaysForChat } from '@/features/libao/weekPlanForChat';
import { MOCK_SCHEDULE } from '@/data/usst';
import type { PersonaProfile, TimeBlock, WeekPlan } from '@/types';

const WEEK_NO = 6;

function block(id: string, day: number, start: number, end: number, title = id): TimeBlock {
  return {
    id, kind: 'study', dayOfWeek: day as TimeBlock['dayOfWeek'],
    startMin: start, endMin: end, title,
  };
}

function plan(blocks: TimeBlock[]): WeekPlan {
  return {
    weekNo: WEEK_NO,
    blocks,
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length },
    issues: [],
  };
}

const PREV = plan([
  block('m-study', 1, 540, 630),   // 周一 09:00–10:30
  block('t-study', 2, 540, 630),   // 周二
  block('w-study', 3, 540, 630),   // 周三
  block('f-meal', 5, 720, 750),    // 周五
]);

test('dayReplanPins：他天没动 → 空', () => {
  const next = plan([
    block('m-study', 1, 540, 630),
    block('t-study', 2, 540, 630),
    block('w-study', 3, 540, 630),
    block('f-meal', 5, 720, 750),
  ]);
  assert.deepEqual(dayReplanPins(PREV, next, [2]), []);
});

test('dayReplanPins：他天被引擎挪走/挪位 → hard pin 钉回上一版位置', () => {
  const next = plan([
    block('m-study', 2, 780, 870),   // 周一的块被甩到周二下午
    block('t-study', 2, 660, 750),   // 周二的块被挪了时刻（周二=目标天，不 pin）
    block('w-study', 3, 540, 630),
    block('f-meal', 5, 720, 750),
  ]);
  const pins = dayReplanPins(PREV, next, [2]);
  assert.equal(pins.length, 1, `只应 pin 周一那块，实际 ${JSON.stringify(pins)}`);
  const p = pins[0];
  assert.equal(p.blockId, 'm-study');
  assert.equal(p.dayOfWeek, 1, '钉回上一版的星期');
  assert.equal(p.startMin, 540);
  assert.equal(p.endMin, 630);
  assert.equal(p.weekNo, WEEK_NO);
  assert.equal(p.source, 'edit', '「其余天保持原样」是用户确认过的约束 → hard');
});

test('dayReplanPins：目标天的变化不 pin（那是重排对象本身）', () => {
  const next = plan([
    block('m-study', 1, 540, 630),
    block('w-study', 3, 540, 630),
    block('f-meal', 5, 720, 750),
  ]);
  assert.deepEqual(dayReplanPins(PREV, next, [2]), [], '周二整块消失也不 pin');
});

test('dayReplanPins：next 在他天新增的块不 pin（融合层沿用上一版的天，天然看不见它）', () => {
  const next = plan([
    block('m-study', 1, 540, 630),
    block('t-study', 2, 540, 630),
    block('w-study', 3, 540, 630),
    block('f-meal', 5, 720, 750),
    block('new-thing', 1, 900, 990), // 引擎在周一（保留天）新发明的块
  ]);
  assert.deepEqual(dayReplanPins(PREV, next, [2]), []);
});

test('replanDaysForChat：MOCK 课表干跑 —— 非目标天与上一版逐块相等，changedDays ⊆ 目标天', async () => {
  const prev = await planWeekWithTasks(MOCK_SCHEDULE, null, WEEK_NO, []);
  assert.ok(prev, 'MOCK 课表应能离线出计划');
  // 人造一个「用户的上一版」：把某个非目标天的块推迟一小时，模拟用户此前的手工调整
  const prevMutated: WeekPlan = {
    ...prev!,
    blocks: prev!.blocks.map((b) => (b.dayOfWeek === 1 ? { ...b, startMin: b.startMin + 60, endMin: b.endMin + 60 } : b)),
  };
  const r = await replanDaysForChat({
    schedule: MOCK_SCHEDULE, profile: null, weekNo: WEEK_NO,
    tasks: [], days: [2, 4], previousPlan: prevMutated,
  });
  assert.ok(r);
  for (const d of [1, 3, 5, 6, 7]) {
    const a = prevMutated.blocks.filter((b) => b.dayOfWeek === d).map((b) => `${b.id}@${b.startMin}-${b.endMin}`).sort();
    const c = r.plan.blocks.filter((b) => b.dayOfWeek === d).map((b) => `${b.id}@${b.startMin}-${b.endMin}`).sort();
    assert.deepEqual(c, a, `周${d}（保留天）必须与上一版逐块相等`);
  }
  for (const d of r.changedDays) assert.ok([2, 4].includes(d), `changedDays 出现了目标天之外的天：${d}`);
  // 被人造改动过的周一块 → 引擎会把它挪回去 → 必须产出 pin
  const mondayPin = r.pins.find((p) => p.dayOfWeek === 1);
  assert.ok(mondayPin, '周一被用户改过的块应被钉回上一版位置');
  assert.equal(mondayPin.source, 'edit');
});

test('replanDaysForChat：previousPlan 为 null → 整周用新版、pins 为空（执行层应拒绝此路径）', async () => {
  const r = await replanDaysForChat({
    schedule: MOCK_SCHEDULE, profile: null, weekNo: WEEK_NO,
    tasks: [], days: [4], previousPlan: null,
  });
  assert.ok(r);
  assert.equal(r.pins.length, 0);
});
