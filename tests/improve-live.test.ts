/**
 * LNS 改进阶段（`improve`）的活性与安全性
 * 跑法：npm run test:engine
 *
 * 背景：beta 期间一直有个悬而未决的疑问 ——「`improve` 在真实场景下到底有没有发挥？」
 * 早期实测老是 `accepted = 0`，看起来像死代码。用真实课表逐阶段扫一遍后答案是：
 *   · 常规周 / 大部分语料：贪心构造已经局部最优，LNS **接受 0 处**（这是正常的，
 *     不是 bug —— LNS 的职责是「有得改才改」）；
 *   · **期末冲刺周：33 轮迭代、接受 32 处、成本 134 → 56（降 58%）**。
 * 所以它不是死的，只是多数输入不需要它。这组测试把这个结论钉住：
 * 一半保证它**不会把计划改差**，一半保证它**不是永远不动**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { solveWeek } from '@/lib/planner/solver.ts';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { MOCK_SCHEDULE } from '@/data/usst';
import { TERM_CALENDAR } from '@/constants/term';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';

const bp = buildPhasesFromCalendar(
  MOCK_SCHEDULE, null, TERM_CALENDAR['2026-2027-1'],
) as unknown as { plan: Parameters<typeof phaseOfWeek>[0] };

/** 同一份输入分别用 `greedy`（跳过改进）与 `lns`（构造 + 改进）跑 */
function both(over: Record<string, unknown>) {
  return {
    greedy: solveWeek({ ...over, config: { solver: 'greedy' } } as never),
    lns: solveWeek({ ...over, config: { solver: 'lns' } } as never),
  };
}

const cases: Array<{ tag: string; req: Record<string, unknown> }> = [];
for (const weekNo of [1, 4, 10, 17]) {
  const phase = phaseOfWeek(bp.plan, weekNo);
  if (!phase) continue;
  cases.push({
    tag: `MOCK 第 ${weekNo} 周（${phase.name}）`,
    req: { schedule: MOCK_SCHEDULE, weekNo, policy: phase.policy, scenarios: null },
  });
}
for (const g of GOLDEN_INPUTS) {
  cases.push({ tag: `golden ${g.name}`, req: toPlanRequest(buildGoldenInput(g)) as never });
}

/* ============================================================
 * 一、安全性：改进阶段只会让成本不升
 * ========================================================== */

test('LNS 不会让计划变差：全语料 × 全阶段，成本恒 ≤ 贪心', () => {
  for (const c of cases) {
    const { greedy, lns } = both(c.req);
    assert.ok(
      lns.diagnostics.cost.total <= greedy.diagnostics.cost.total + 1e-9,
      `${c.tag}：lns 成本 ${lns.diagnostics.cost.total} > greedy ${greedy.diagnostics.cost.total}`,
    );
    assert.equal(lns.diagnostics.hardViolations, 0, `${c.tag}：改进后出现硬约束违反`);
  }
});

/* ============================================================
 * 二、活性：真紧的输入上必须动起来（防「它其实早就死了却没人发现」）
 * ========================================================== */

test('期末冲刺周：LNS 必须产生实质改进（锁定它不是在空转）', () => {
  const phase = phaseOfWeek(bp.plan, 17);
  assert.ok(phase, '夹具应包含第 17 周');
  const { greedy, lns } = both({
    schedule: MOCK_SCHEDULE, weekNo: 17, policy: phase.policy, scenarios: null,
  });

  assert.ok(
    lns.diagnostics.iterations > 1,
    `第 17 周应多轮迭代，实际 ${lns.diagnostics.iterations} 轮 —— `
    + '若为 1 轮，说明邻域搜索没有产出任何候选移动（可能改坏了候选生成）',
  );
  assert.ok(
    lns.diagnostics.cost.total < greedy.diagnostics.cost.total,
    `第 17 周 lns 应低于 greedy：${lns.diagnostics.cost.total} vs ${greedy.diagnostics.cost.total}`,
  );
  // 改进幅度留足余量（实测 134 → 56）：若哪天掉到几乎没改善，这里会先响
  assert.ok(
    lns.diagnostics.cost.total < greedy.diagnostics.cost.total * 0.8,
    '改进幅度应显著（实测降 58%），而不是象征性地动一两处',
  );
});

test('常规输入上 LNS 不动手 —— 这也是正确行为，不是退化', () => {
  // 贪心构造对这类输入已经局部最优；若这里突然报出大量「改进」，
  // 更可能是成本函数或候选生成被改坏（凭空造出可下降的假象）。
  const { greedy, lns } = both({
    schedule: MOCK_SCHEDULE, weekNo: 4,
    policy: phaseOfWeek(bp.plan, 4)!.policy, scenarios: null,
  });
  assert.equal(
    lns.diagnostics.cost.total, greedy.diagnostics.cost.total,
    '常规周的 lns 与 greedy 应完全一致（没有可接受的移动）',
  );
});
