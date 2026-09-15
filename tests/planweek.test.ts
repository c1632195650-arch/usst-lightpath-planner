/**
 * 两遍法编排验收（§4.5.2 · CY 请求 ②）
 * ============================================================
 * 验三件事：
 *   ① 注入 `transferFactory` → 真的走两遍，且第 2 遍用的是工厂产出的 provider；
 *   ② 工厂抛错 → **降级为单遍**（不抛、不假两遍）；
 *   ③ 本模块**可被 Node 直载** —— 证明它没有静态拖入 `transfer.ts → lib/api.ts`（§7.3 硬约束）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TimeBlock } from '@/types';
import { planWeek } from '@/lib/planner/planWeek.ts';
import { planWeekV2, stablePlanJson } from '@/lib/planner/index.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-12-crosscampus');
if (!G) throw new Error('找不到 week-12-crosscampus 语料');

function idsOf(blocks: TimeBlock[]): string {
  return blocks.map((b) => `${b.id}@${b.startMin}-${b.endMin}`).sort().join('\n');
}

test('注入 transferFactory → 走两遍：工厂拿到第 1 遍的块，第 2 遍用新 provider', async () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const pass1 = planWeekV2(req);

  let got: TimeBlock[] | null = null;
  let calls = 0;
  const res = await planWeek(req, {
    transferFactory: async (blocks) => {
      calls += 1;
      got = blocks;
      // 用一个「特征值」7 分钟：既不会把固定课表挤迟到，又能一眼认出第 2 遍换了 provider
      return () => ({ minutes: 7, source: 'stub', reliable: true });
    },
  });

  assert.equal(calls, 1, '工厂只应被调用一次');
  assert.ok(got, '工厂没拿到块');
  assert.equal(idsOf(got), idsOf(pass1.plan.blocks), '工厂拿到的应是第 1 遍的块');

  // 第 2 遍确实用了桩 provider：转场提示里出现 7 分钟
  const stubbed = res.plan.blocks.filter((b) => b.transfer?.minutes === 7);
  assert.ok(stubbed.length > 0, '第 2 遍没有用上工厂产出的 provider（找不到 7 分钟的转场）');
  assert.ok(res.notes.length > 0);
});

test('工厂抛错 → 降级为单遍（结果与 planWeekV2 一致，不抛错）', async () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const single = planWeekV2(req);
  const res = await planWeek(req, {
    transferFactory: async () => {
      throw new Error('模拟网络挂了');
    },
  });
  assert.equal(stablePlanJson(res), stablePlanJson(single), '取数失败应原样返回第 1 遍结果');
});

test('调用方已注入 req.transfer → 单遍（不再重复取数）', async () => {
  const req = { ...toPlanRequest(buildGoldenInput(G)), transfer: () => null };
  let called = false;
  const res = await planWeek(req, {
    transferFactory: async () => {
      called = true;
      return () => null;
    },
  });
  // 注意：显式给了 factory 就是「我要两遍」——所以这里断言的是**没有 factory** 的情形
  assert.equal(called, true, '显式给了 factory 就该用它');

  const res2 = await planWeek(req);
  assert.equal(stablePlanJson(res2), stablePlanJson(planWeekV2(req)),
    '已有 provider 时不该再取一次（结果应与单遍一致）');
});

test('无 factory 且无 req.transfer → Node 里取不到 transfer.ts，应降级单遍而不是崩', async () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const res = await planWeek(req); // 动态 import 会因 lib/api 的 import.meta.env 失败 → 降级
  assert.equal(stablePlanJson(res), stablePlanJson(planWeekV2(req)));
  assert.ok(typeof planWeek === 'function');
});

test('本模块可被 Node 直载（证明没有静态依赖 transfer.ts / lib/api.ts）', async () => {
  const mod = await import('@/lib/planner/planWeek.ts');
  assert.equal(typeof mod.planWeek, 'function');
});
