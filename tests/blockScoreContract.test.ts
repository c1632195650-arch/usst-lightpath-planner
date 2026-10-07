/**
 * 长计划增强一期 §1.2 契约：TimeBlock.score 可选字段
 * ------------------------------------------------------------
 * 验收口径（计划书 §6.3，约束松绑后 score 直进 types.ts）：
 *   · construct 产出的每个块都带 score ∈ [0,1]；
 *   · course / meal 块恒 0.5（既成事实不评价）；
 *   · 旧数据（无 score 字段的块 JSON）零迁移可读 —— 可选字段契约。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construct } from '@/lib/planner/construct';
import { toPlanRequest } from '@/lib/planner/schedule';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';
import type { TimeBlock } from '@/types';

test('construct 产出的每个块都带 score ∈ [0,1]', () => {
  for (const g of GOLDEN_INPUTS) {
    const { plan } = construct(toPlanRequest(buildGoldenInput(g)));
    assert.ok(plan.blocks.length > 0, `${g.name} 应有块`);
    for (const b of plan.blocks) {
      assert.equal(typeof b.score, 'number', `${g.name} ${b.id} 缺 score`);
      assert.ok(b.score >= 0 && b.score <= 1, `${g.name} ${b.id} score=${b.score} 越界`);
    }
  }
});

test('course / meal 块恒 0.5（既成事实不评价），软块存在高于 0.5 的分', () => {
  const { plan } = construct(toPlanRequest(buildGoldenInput(GOLDEN_INPUTS[0])));
  let softSeen = 0;
  for (const b of plan.blocks) {
    if (b.kind === 'course' || b.kind === 'meal') {
      assert.equal(b.score, 0.5, `${b.id}（${b.kind}）应为中性 0.5`);
    } else if (b.kind === 'study' || b.kind === 'activity') {
      softSeen += 1;
    }
  }
  assert.ok(softSeen > 0, '语料应有软块');
  assert.ok(
    plan.blocks.some((b) => (b.score ?? 0) > 0.5),
    '应存在分数高于中性的软块（否则评分形同虚设）',
  );
});

test('旧数据兼容：无 score 字段的块 JSON 可解析、score 为 undefined（可选字段契约）', () => {
  const legacy = {
    id: 'd1-study-0900', kind: 'study', dayOfWeek: 1,
    startMin: 540, endMin: 600, title: '旧数据块', source: 'template',
  } as unknown; // 模拟旧版本持久化数据（无 score）
  const parsed = JSON.parse(JSON.stringify(legacy)) as TimeBlock;
  assert.equal(parsed.score, undefined);
  assert.equal(parsed.startMin, 540);
});
