/**
 * 长计划增强一期 §1.2：逐块排程置信度（blockScore）
 * ------------------------------------------------------------
 * 验收口径（计划书）：
 *   · 同周软块分数极差 ≥ 0.25（反扁平红利：顺势与凑合要分得开）；
 *   · 全 0.5 恒定分 = 实现失败；
 *   · 既成事实（course/meal/commute）= 0.5 中性、blank = 0.8；
 *   · 纯函数：同输入必同输出。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreFor } from '@/lib/planner/blockScore';
import type { TimeBlock } from '@/types';

function mk(over: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'kind' | 'dayOfWeek' | 'startMin' | 'endMin'>): TimeBlock {
  return { title: over.id, source: 'template', ...over };
}

test('区分度：同一自习块在上午与深夜分差 ≥ 0.25（反扁平验收）', () => {
  const morning = mk({ id: 'a', kind: 'study', dayOfWeek: 1, startMin: 9 * 60, endMin: 10 * 60 });
  const night = mk({ id: 'b', kind: 'study', dayOfWeek: 2, startMin: 22 * 60, endMin: 23 * 60 });
  const s = scoreFor([morning, night]);
  const diff = s['a'] - s['b'];
  assert.ok(diff >= 0.25, `上午(${s['a']}) 与深夜(${s['b']}) 分差 ${diff} 应 ≥ 0.25`);
  for (const v of [s['a'], s['b']]) {
    assert.ok(v > 0 && v < 1, `分数应在 (0,1) 开区间：${v}`);
  }
});

test('既成事实中性：course / meal / commute = 0.5，blank = 0.8', () => {
  const blocks = [
    mk({ id: 'c', kind: 'course', dayOfWeek: 1, startMin: 8 * 60, endMin: 9 * 60 + 35 }),
    mk({ id: 'm', kind: 'meal', dayOfWeek: 1, startMin: 11 * 60 + 55, endMin: 12 * 60 + 45 }),
    mk({ id: 't', kind: 'commute', dayOfWeek: 1, startMin: 9 * 60 + 35, endMin: 9 * 60 + 50 }),
    mk({ id: 'z', kind: 'blank', dayOfWeek: 1, startMin: 21 * 60, endMin: 22 * 60 }),
  ];
  const s = scoreFor(blocks);
  assert.equal(s['c'], 0.5);
  assert.equal(s['m'], 0.5);
  assert.equal(s['t'], 0.5);
  assert.equal(s['z'], 0.8);
});

test('缓冲因子：紧贴邻居的块分数低于独处的同款块', () => {
  const isolated = mk({ id: 'a', kind: 'study', dayOfWeek: 1, startMin: 9 * 60, endMin: 10 * 60 });
  const s1 = scoreFor([isolated]);
  const packedA = mk({ id: 'a2', kind: 'study', dayOfWeek: 1, startMin: 9 * 60, endMin: 10 * 60 });
  const packedB = mk({ id: 'x', kind: 'study', dayOfWeek: 1, startMin: 10 * 60, endMin: 11 * 60 });
  const s2 = scoreFor([packedA, packedB]);
  assert.ok(
    s2['a2'] < s1['a'],
    `紧贴邻居（${s2['a2']}）应低于独处（${s1['a']}）`,
  );
});

test('纯函数：同输入两次打分完全一致', () => {
  const blocks = [
    mk({ id: 'a', kind: 'study', dayOfWeek: 1, startMin: 9 * 60, endMin: 10 * 60 }),
    mk({ id: 'b', kind: 'activity', dayOfWeek: 3, startMin: 18 * 60, endMin: 19 * 60 }),
  ];
  assert.deepEqual(scoreFor(blocks), scoreFor(blocks));
});
