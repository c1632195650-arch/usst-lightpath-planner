/**
 * 光溯移动端 · 燃烧条纯函数单测（新任务三 P1-1 · §3.3 规格）
 *
 * ⚠️ 反向验证记录（M3-W1）：把 burnRatio 的 ratio 硬编码 0.5 →
 *    「比例随时间推进」与「三色相位」两组断言变红；恢复后全绿。
 *    另一组：把 `nowMin >= endMin → null` 改成返回 ratio=1 → 「已结束」断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burnRatio } from '@/features/mobile/lib/burnBar.ts';

test('burnRatio：未开始 → 进度 0、phase=upcoming、remain=距开始分钟', () => {
  const r = burnRatio(600, 660, 570); // 10:00-11:00 的块，现在 09:30
  assert.deepEqual(r, { ratio: 0, remainMin: 30, phase: 'upcoming' });
});

test('burnRatio：刚开始（比例 0）与进行中（比例精确）', () => {
  assert.equal(burnRatio(600, 660, 600)?.ratio, 0, '开始那一刻 = 0');
  const mid = burnRatio(600, 660, 630); // 过了 30/60
  assert.equal(mid?.ratio, 0.5);
  assert.equal(mid?.remainMin, 30);
});

test('burnRatio：三色相位边界 —— <1/3 绿、=1/2 琥珀、>2/3 红', () => {
  assert.equal(burnRatio(0, 300, 50)?.phase, 'green', '1/6 → 绿');
  assert.equal(burnRatio(0, 300, 100)?.phase, 'amber', '恰好 1/3 → 琥珀（不在绿段）');
  assert.equal(burnRatio(0, 300, 150)?.phase, 'amber', '1/2 → 琥珀');
  assert.equal(burnRatio(0, 300, 250)?.phase, 'red', '5/6 → 红');
});

test('burnRatio：钳制 —— nowMin 超出右端点前一刻不超 1', () => {
  assert.equal(burnRatio(0, 300, 299)?.ratio, 299 / 300);
});

test('burnRatio：已结束 → null（UI 不渲染），零/负时长坏块 → null', () => {
  assert.equal(burnRatio(600, 660, 660), null, 'nowMin = endMin 已结束');
  assert.equal(burnRatio(600, 660, 700), null);
  assert.equal(burnRatio(600, 600, 610), null, '零时长');
  assert.equal(burnRatio(660, 600, 610), null, '倒挂块');
});

test('burnRatio：跨午夜（endMin>1440）按线性分钟数处理', () => {
  const r = burnRatio(1430, 1490, 1460); // 23:50-次日 00:50，现在 00:20
  assert.equal(r?.ratio, 0.5);
  assert.equal(r?.remainMin, 30);
  assert.equal(r?.phase, 'amber');
});

test('burnRatio：即将结束（剩 <1 分钟）仍返回 red 相位，文案由 UI 判 remainMin', () => {
  const r = burnRatio(600, 660, 659.5);
  assert.ok(r);
  assert.equal(r.phase, 'red');
  assert.ok(r.remainMin < 1, 'remainMin < 1 → UI 显示「即将结束」');
});
