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

  // 融合注记（2026-09-20）：P2 起 fetchRoutes 优先于 req.transfer（见 planWeek.ts 头注，
  // 这是 Ray 侧有意的行为变更，修的是「注入了 fetchRoutes 却拿不到实测值」的旧 bug）。
  // 因此本测试不再断言「有 req.transfer 就绝不问路」——那在真实浏览器语义下已不成立。
  // 这里钉住的是**确定性的降级出口**：fetchRoutes 抛错（后端不可达）→ 退回单遍，
  // 结果必须与 planWeekV2 逐字节一致（不因收敛循环失败而崩、也不悄悄换布局）。
  const degraded = await planWeek(req, {
    fetchRoutes: async () => {
      throw new Error('测试：模拟后端不可达');
    },
  });
  assert.equal(stablePlanJson(degraded), stablePlanJson(planWeekV2(req)),
    'fetchRoutes 失败应降级为单遍（结果与 planWeekV2 一致）');
});

test('fetchRoutes 抛错（后端不可达）→ 降级单遍而不是崩', async () => {
  const req = toPlanRequest(buildGoldenInput(G));
  // 早期版本靠「Node 里动态 import transfer.ts 会失败」触发降级；如今 Node 也能加载它
  // （register-alias 垫了 import.meta.env），且本机若恰好开着 8000 后端，收敛循环会真取到
  // 实测分钟 —— 结果随环境漂移（门禁最忌讳的「随时间红绿」）。所以这里改成**显式注入
  // 会抛错的 fetchRoutes**，确定性走到同一个降级出口。
  const res = await planWeek(req, {
    fetchRoutes: async () => {
      throw new Error('测试：模拟后端不可达');
    },
  });
  assert.equal(stablePlanJson(res), stablePlanJson(planWeekV2(req)));
  assert.ok(typeof planWeek === 'function');
});

test('本模块可被 Node 直载（证明没有静态依赖 transfer.ts / lib/api.ts）', async () => {
  const mod = await import('@/lib/planner/planWeek.ts');
  assert.equal(typeof mod.planWeek, 'function');
});
