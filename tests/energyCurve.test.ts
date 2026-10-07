/**
 * 长计划二期 §2.3：日内精力曲线
 * ------------------------------------------------------------
 * 验收口径（计划书）：
 *   · 推断曲线 24 锚点、值域 [0,1]、峰位 = 缺省「起床+3h」/ 微调档生效；
 *   · 醒前低、峰后回落（形状可断言）；
 *   · RES ≤ 35 → 午后更塌；blockScore 接曲线后评分随峰位移动；
 *   · 纯函数：作息由参数注入。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inferEnergyCurve, curveAt } from '@/lib/planner/energyCurve';
import { scoreFor } from '@/lib/planner/blockScore';
import type { TimeBlock } from '@/types';

const WAKE = 7 * 60;   // 07:00
const SLEEP = 23 * 60; // 23:00

test('缺省推断：峰在起床+3h（10 点档），值域 [0,1]，醒前低', () => {
  const curve = inferEnergyCurve({ wakeMin: WAKE, sleepMin: SLEEP });
  assert.equal(curve.length, 24);
  for (const v of curve) assert.ok(v >= 0 && v <= 1, `越界值 ${v}`);
  const peakIdx = curve.indexOf(Math.max(...curve));
  assert.equal(peakIdx, 10); // h=10 的代表时刻 10:30 最接近 10:00 峰
  assert.ok(curve[5] < 0.5, '醒前（05:30）应为低值');
  assert.ok(curve[22] < 0.8, '入睡前应回落');
});

test('微调档生效：peakHour=21（夜间型）→ 峰位移到晚间（并远高于上午档）', () => {
  const curve = inferEnergyCurve({ wakeMin: WAKE, sleepMin: SLEEP, peakHour: 21 });
  const peakIdx = curve.indexOf(Math.max(...curve));
  // 峰被夹在「入睡−2h」内 → 21:00 → 锚点落在 20/21 档之间；断言「峰移到了晚间」
  assert.ok(peakIdx >= 19, `峰位应 ≥ 19 点档，实际 ${peakIdx}`);
  assert.ok(curve[20] > curve[10], `晚间（${curve[20]}）应高于上午档（${curve[10]}）`);
});

test('RES ≤ 35：午后（13–16 点）比中性更塌', () => {
  const base = inferEnergyCurve({ wakeMin: WAKE, sleepMin: SLEEP });
  const dipped = inferEnergyCurve({ wakeMin: WAKE, sleepMin: SLEEP, axes: { RES: 30, HEA: 50 } });
  const sum = (c: number[]) => c[13] + c[14] + c[15] + c[16];
  assert.ok(sum(dipped) < sum(base), '午后应额外回落');
});

test('curveAt：小时间线性插值；曲线缺省 → null（调用方走缺省）', () => {
  const curve = inferEnergyCurve({ wakeMin: WAKE, sleepMin: SLEEP });
  const v = curveAt(curve, 9 * 60); // 09:00 → 介于锚点 8(=8:30) 与 9(=9:30) 之间
  assert.ok(v != null && v > 0 && v <= 1);
  assert.equal(curveAt(undefined, 600), null);
});

test('blockScore 接曲线：夜间峰曲线下，上午自习分数低于缺省曲线', () => {
  const mk = (): TimeBlock => ({
    id: 's1', kind: 'study', dayOfWeek: 1, startMin: 9 * 60, endMin: 10 * 60,
    title: '自习', source: 'template',
  });
  const defaultScore = scoreFor([mk()])['s1'];
  const nightPeak = scoreFor([mk()], { energyCurve: inferEnergyCurve({ wakeMin: WAKE, sleepMin: SLEEP, peakHour: 21 }) })['s1'];
  assert.ok(
    nightPeak < defaultScore,
    `夜间峰下上午自习（${nightPeak}）应低于缺省曲线（${defaultScore}）`,
  );
});
