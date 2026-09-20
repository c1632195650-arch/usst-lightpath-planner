/**
 * P1 解释层验收（T1.5 / QL-2）
 * ============================================================
 * 依据：规格书 §9-T1.5、§10.3 QL-2（**100% 软块有 `reason`**）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TimeBlock, WeekPlan } from '@/types';
import {
  ensureReasons, reasonCoverage, reasonFallback, reasonForMeal, softBlocksOf,
} from '@/lib/planner/explain.ts';
import { planWeekV2 } from '@/lib/planner/index.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

function ledger(blocks: TimeBlock[]): WeekPlan {
  return {
    weekNo: 1,
    blocks,
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length },
    issues: [],
  };
}
function block(over: Partial<TimeBlock>): TimeBlock {
  return {
    id: 'w1-d1-study-x-1', kind: 'study', dayOfWeek: 1, startMin: 540, endMin: 600,
    title: '自习', source: 'template', ...over,
  };
}

/* ============================================================
 * QL-2
 * ========================================================== */

test('QL-2：全部 golden 输入上，软块 100% 有非空 reason', () => {
  for (const g of GOLDEN_INPUTS) {
    const res = planWeekV2(toPlanRequest(buildGoldenInput(g)));
    const cov = reasonCoverage(res.plan);
    assert.ok(cov.total > 0, `${g.name} 一个软块都没有？可疑`);
    assert.equal(
      cov.withReason, cov.total,
      `${g.name}：${cov.total - cov.withReason}/${cov.total} 个软块没有 reason\n`
      + softBlocksOf(res.plan)
        .filter((b) => !b.reason)
        .map((b) => `  - ${b.id} ${b.title}`).join('\n'),
    );
  }
});

test('ensureReasons：缺理由的软块被补上兜底文案（返回补了几条）', () => {
  const p = ledger([
    block({ id: 'w1-d1-study-a-1', reason: undefined }),
    block({ id: 'w1-d1-activity-b', kind: 'activity', reason: '   ' }), // 空白也算缺
    block({ id: 'w1-d1-study-c-1', reason: '已有理由' }),
  ]);
  const patched = ensureReasons(p);
  assert.equal(patched, 2);
  assert.ok(p.blocks.every((b) => (b.reason ?? '').trim().length > 0));
  assert.equal(p.blocks[2].reason, '已有理由', '已有理由不该被覆盖');
});

test('硬块不需要理由（课程/用户钉死的不算「软块」）', () => {
  const p = ledger([
    block({ id: 'w1-d1-course-c1p1', kind: 'course', source: 'course' }),
    block({ id: 'w1-d1-user-t1', kind: 'activity', source: 'user', locked: true }),
  ]);
  assert.equal(softBlocksOf(p).length, 0, '硬块不该进软块集合');
  assert.equal(ensureReasons(p), 0, '硬块不该被补理由');
});

test('兜底理由含地点（可解释性不为空话）', () => {
  assert.equal(reasonFallback(block({ place: '图书馆' })), '按空档自动排入（图书馆）');
  assert.equal(reasonFallback(block({ place: undefined })), '按空档自动排入');
});

/* ============================================================
 * 文案（旧问题 #18：不能与晚课自相矛盾）
 * ========================================================== */

test('晚间文案是「不主动占用」而不是「不占用」', () => {
  const g = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
  assert.ok(g);
  const res = planWeekV2(toPlanRequest(buildGoldenInput(g)));
  const evening = res.notes.find((n) => n.includes('晚间'));
  assert.ok(evening, '应有一条晚间说明');
  assert.match(evening, /不主动占用晚间/, `文案会与晚课矛盾：${evening}`);
});

test('三餐理由会说明「从哪来 / 走到哪去」（转场口径）', () => {
  const s = reasonForMeal({
    why: '按常去的食堂排的', note: '（估）', need: 6, anchorPlace: '第三教学楼',
    tail: 4, nextPlace: '第一教学楼',
  });
  assert.match(s, /按常去的食堂排的/);
  assert.match(s, /（估）/);
  assert.match(s, /从第三教学楼走过去约 6 分钟/);
  assert.match(s, /吃完走到第一教学楼约 4 分钟/);
});

/* ============================================================
 * issues 分级
 * ========================================================== */

test('缺地点课程出的是 info（不能按 0 分钟通勤糊过去，也不能升级成 warn/error）', () => {
  const g = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
  assert.ok(g);
  const res = planWeekV2(toPlanRequest(buildGoldenInput(g)));
  const placeIssues = res.plan.issues.filter((i) => i.message.includes('地点'));
  assert.ok(placeIssues.length > 0, '周二篮球没有地点，应给出提示');
  assert.ok(placeIssues.every((i) => i.level === 'info'),
    `地点缺失应是 info：${JSON.stringify(placeIssues)}`);
});

test('求解说明进 notes（跑了多少轮改进）', () => {
  const g = GOLDEN_INPUTS[0];
  const res = planWeekV2(toPlanRequest(buildGoldenInput(g)));
  assert.ok(res.notes.length >= 3, 'notes 至少含课数/目标/取值说明');
  assert.ok(res.plan.issues.every((i) => ['error', 'warn', 'info'].includes(i.level)));
});
