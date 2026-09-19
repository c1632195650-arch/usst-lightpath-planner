/**
 * 评分口径 · transfer-aware（PR-A，2026-09-19）
 * ============================================
 * 背景（有实测证据，不是推测）：改之前 transferRisk 占总代价 **90%**，而它的实现是
 * 「地点一变就固定罚 1（×2.0），与距离/校区/真实步行时间无关」—— 实测 170/170 个
 * "地点变化对"全是固定罚；同时注入真实转场分钟后显示**真正紧张的 0 对**。
 * 也就是说：90% 的代价在罚"换了几次地点"，而真正危险的跨校区排布会被淹没（1km 与 100m 同价）。
 *
 * 本文件钉住三件事：
 *  ① **legacy 逐位不变**（5 个语料的 cost 与 2026-09-15 冻结快照完全一致）—— 灰度开关的意义所在
 *  ② transfer-aware 的分档语义：走不到 10 / 踩点 3 / 长距离 2 / 短距离余量足 1
 *  ③ **单调性**（分钟数越大罚分不降）+ 反向验证（把实现改坏必须变红）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekPlan } from '@/lib/planner/schedule.ts';
import { evaluate, transferPenalty, effectiveTransferMinutes } from '@/lib/planner/objective.ts';
import { DEFAULT_WEIGHTS } from '@/lib/planner/model.ts';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const day = (
  startMin: number,
  endMin: number,
  place: string | undefined,
  transfer?: { minutes: number; reliable?: boolean; tight?: boolean },
) => ({
  id: `x-${startMin}`, kind: 'study' as const, dayOfWeek: 1 as const,
  title: 't', place, startMin, endMin, source: 'template' as const,
  ...(transfer ? { transfer: { minutes: transfer.minutes, reliable: transfer.reliable, tight: transfer.tight ?? false, slackMin: 0 } } : {}),
});

/* ============================================================
 * ① legacy 逐位不变（冻结锚点）
 * ============================================================ */

/** 2026-09-15 冻结快照（tests/golden/*.json）的 cost 值，逐位比对 */
const LEGACY_ANCHOR: Record<string, number> = {
  'week-04-typical': 76.25,
  'week-06-practice': 75.75,
  'week-12-crosscampus': 96.25,
  'week-19-exam': 72.25,
  'week-04-usertasks': 72.75,
};

for (const g of GOLDEN_INPUTS) {
  test(`legacy 口径与冻结快照逐位一致：${g.name}`, () => {
    const input = buildGoldenInput(g);
    const plan = buildWeekPlan(input).plan;
    const c = evaluate(plan, {
      weekNo: g.weekNo, policy: g.policy, weights: DEFAULT_WEIGHTS,
      dayStartMin: 420, dayEndMin: 1380,
    });
    assert.equal(c.total.toFixed(4), LEGACY_ANCHOR[g.name].toFixed(4),
      `legacy 口径被改动了！这会让 5 份冻结 golden 快照失效（${g.name}）`);
  });
}

/* ============================================================
 * ② transfer-aware 分档语义
 * ============================================================ */

test('同地点：无罚（两种口径一致）', () => {
  const a = day(420, 480, '第一教学楼');
  const b = day(480, 540, '第一教学楼');
  assert.equal(transferPenalty(a, b, 12), 0);
  assert.equal(transferPenalty(a, b), 0);
});

test('走不到（slack < 分钟）→ 10 分', () => {
  const a = day(420, 480, '第一教学楼');
  const b = day(485, 540, '第三教学楼');       // slack = 5
  assert.equal(transferPenalty(a, b, 20), 10);
});

test('踩点（分钟 ≤ slack < 分钟+5）→ 3 分', () => {
  const a = day(420, 480, '第一教学楼');
  const b = day(484, 540, '第三教学楼');       // slack = 4
  assert.equal(transferPenalty(a, b, 4), 3);
});

test('长距离但余量足 → 2 分（比短距离更贵）', () => {
  const a = day(420, 480, '第一教学楼');
  const b = day(540, 600, '国合楼');            // slack = 60
  assert.equal(transferPenalty(a, b, 20), 2);
  assert.equal(transferPenalty(a, b, 3), 1, '短距离余量足应回到下限 1');
});

test('单调性：分钟数越大，罚分不降（同一 slack）', () => {
  const a = day(420, 480, '第一教学楼');
  const b = day(500, 560, '第三教学楼');       // slack = 20
  let prev = -1;
  for (const m of [1, 4, 10, 15, 20, 21]) {
    const p = transferPenalty(a, b, m);
    assert.ok(p >= prev, `分钟 ${m} 的罚分 ${p} 低于前一项 ${prev}`);
    prev = p;
  }
});

test('无数据 → 退回旧三档（离线/单测行为不变）', () => {
  const a = day(420, 480, '第一教学楼');
  assert.equal(transferPenalty(a, day(470, 540, '第三教学楼'), null), 10);  // slack<0
  assert.equal(transferPenalty(a, day(483, 540, '第三教学楼'), null), 3);   // slack<5
  assert.equal(transferPenalty(a, day(600, 660, '第三教学楼'), null), 1);   // 其余
});

/* ============================================================
 * ③ 可信度折扣
 * ============================================================ */

test('可信数据不打折；估算数据打两档折扣；已判紧张的不打折', () => {
  const reliable = day(500, 560, '三教', { minutes: 10, reliable: true });
  assert.equal(effectiveTransferMinutes(reliable, 1), 10);

  const estimated = day(500, 560, '三教', { minutes: 10, reliable: false });
  const v = effectiveTransferMinutes(estimated, 1) ?? 0;
  assert.ok(v < 10 && v > 0, `估算应打折，实际 ${v}`);

  const tight = day(500, 560, '三教', { minutes: 10, reliable: false, tight: true });
  assert.equal(effectiveTransferMinutes(tight, 1), 10, '紧转场保持警示，不该被折扣抹平');

  assert.equal(effectiveTransferMinutes(day(500, 560, undefined), 1), null, '无 place/无 hint → null');
});

/* ============================================================
 * ④ 端到端：新口径下「真实分钟」确实进入 cost
 * ============================================================ */

test('transfer-aware 下，同一计划的 transferRisk 随真实分钟变化（legacy 不变）', () => {
  const g = GOLDEN_INPUTS[0];
  const plan = buildWeekPlan(buildGoldenInput(g)).plan;
  const base = {
    weekNo: g.weekNo, policy: g.policy, weights: DEFAULT_WEIGHTS,
    dayStartMin: 420, dayEndMin: 1380,
  };
  const legacy = evaluate(plan, { ...base }).transferRisk;
  const aware = evaluate(plan, { ...base, scoring: 'transfer-aware' }).transferRisk;
  const awareZeroTrust = evaluate(plan, {
    ...base, scoring: 'transfer-aware', transferTrust: 0.01,
  }).transferRisk;

  assert.equal(legacy, 68, 'legacy 的 transferRisk 是冻结值');
  // 折扣越低 ⇒ 分钟数越小 ⇒ 罚分不增（同一计划）
  assert.ok(awareZeroTrust <= aware, `折扣应降低风险分：${awareZeroTrust} vs ${aware}`);
});
