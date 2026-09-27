/**
 * WP5 —— 六模式重做：三参数（sportSessions/extraMeals/blankBlocks）+ 改名迁移
 * ============================================================
 * 设计铁律：**opt-in** —— `PlanRequest.lifeModeExtras` 缺省时 construct 输出
 * 与旧版逐位一致（golden 语料不带 lifeMode → 默认路径零改动，与 WP10 同纪律）。
 *
 * ⚠️ 反向验证纪律（记录见 docs/wp-ledger-v2.md §WP5）：
 *   RV-1 ← construct 里把 extras 置 null → 三个功能用例全红
 *   RV-2 ← 删 forceSport 绕过 → 运动配额用例红（无画像触发时运动为 0）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construct } from '@/lib/planner/construct';
import { toPlanRequest } from '@/lib/planner/schedule';
import type { PlanRequest } from '@/lib/planner/model';
import {
  applyLifeMode,
  lifeModeExtrasOf,
  lifeModeFactorOf,
  normalizeLifeModeId,
} from '@/lib/planner/lifeModePolicy';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
if (!G) throw new Error('找不到 week-04-typical 语料');

function baseReq(): PlanRequest {
  return toPlanRequest(buildGoldenInput(G));
}

/* ---------------- 一、opt-in 零改动保证（golden 安全） ---------------- */

test('WP5: 不传 lifeModeExtras → 与旧版输出逐位一致（golden 免拍的前提）', () => {
  const a = construct(baseReq());
  const b = construct({ ...baseReq(), lifeModeExtras: undefined });
  assert.deepEqual(a.plan.blocks, b.plan.blocks);
});

/* ---------------- 二、运动配额（sportSessions） ---------------- */

function sportCount(req: PlanRequest): number {
  return construct(req).plan.blocks.filter((b) => b.id.includes('-activity-sport')).length;
}

test('WP5: sportSessions=4 → 本周恰好 4 次运动（绕过画像触发，隔天分布）', () => {
  // 反向：construct 里 extras 置 null / 删 forceSport 绕过 → 本用例红
  const req = { ...baseReq(), lifeModeExtras: { sportSessions: 4 } };
  const n = sportCount(req);
  assert.equal(n, 4, `应当恰好 4 次运动，实际 ${n}`);
  // 隔天分布：同一天不超过 1 次（CATEGORY_PER_DAY.sport=1 天然保证）
  const days = new Set(
    construct(req).plan.blocks.filter((b) => b.id.includes('-activity-sport')).map((b) => b.dayOfWeek),
  );
  assert.equal(days.size, 4, '4 次运动应分布在 4 个不同的天');
});

test('WP5: sportSessions=1 → 配额封顶恰好 1 次（语料自带触发，自然数被压到配额）', () => {
  const n = sportCount({ ...baseReq(), lifeModeExtras: { sportSessions: 1 } });
  assert.equal(n, 1, `应当恰好 1 次，实际 ${n}`);
});

test('WP5: forceSport 绕过画像触发 —— 无触发画像也能排运动（运动模式的立身之本）', () => {
  // 反向：删掉 construct 里的 forceSport 绕过 → 本用例红（无触发 → 0 次）
  const noTrigger = { ...baseReq(), scenarios: null };
  const without = sportCount(noTrigger);
  const withQuota = sportCount({ ...noTrigger, lifeModeExtras: { sportSessions: 2 } });
  assert.equal(without, 0, '无触发画像且无配额 → 不该擅自排运动');
  assert.equal(withQuota, 2, '有配额 → 绕过触发照样排（模式是显式表达）');
});

/* ---------------- 三、加餐窗口（extraMeals，小馋猫） ---------------- */

test('WP5: extraMeals=2 → 下午茶与夜宵都排入（避开课程找最近空档）', () => {
  // 反向：extras 置 null → 本用例红
  const req = { ...baseReq(), lifeModeExtras: { extraMeals: 2 } };
  const { plan } = construct(req);
  const tea = plan.blocks.filter((b) => b.id.includes('-meal-tea'));
  const night = plan.blocks.filter((b) => b.id.includes('-meal-night-snack'));
  assert.ok(tea.length >= 1, '至少有一天排了下午茶');
  assert.ok(night.length >= 1, '至少有一天排了夜宵');
  for (const b of [...tea, ...night]) {
    assert.equal(b.kind, 'meal');
  }
});

/* ---------------- 四、自由格（blankBlocks，远方） ---------------- */

test('WP5: blankBlocks=2 → 排出 kind=blank 的「自由格」，且不破坏零重叠', () => {
  // 反向：extras 置 null → 本用例红
  const req = { ...baseReq(), lifeModeExtras: { blankBlocks: 2 } };
  const { plan } = construct(req);
  const blanks = plan.blocks.filter((b) => b.kind === 'blank');
  assert.ok(blanks.length >= 1 && blanks.length <= 2, `自由格应 1~2 个，实际 ${blanks.length}`);
  for (const b of blanks) {
    assert.equal(b.title, '自由格');
    assert.ok(b.endMin - b.startMin >= 60, '自由格至少 60 分钟（不够大的空档不塞）');
  }
  // 硬约束不破：自由格与任何块不重叠
  for (const a of plan.blocks) {
    for (const c of plan.blocks) {
      if (a.id >= c.id) continue;
      const noOverlap = a.endMin <= c.startMin || c.endMin <= a.startMin || a.dayOfWeek !== c.dayOfWeek;
      assert.ok(noOverlap || a.dayOfWeek !== c.dayOfWeek, `重叠：${a.id} × ${c.id}`);
    }
  }
});

/* ---------------- 五、改名迁移（旧 id 归一） ---------------- */

test('WP5: 旧模式 id 归一 —— slack→faraway / food→snack / health→sport / social→balance', () => {
  assert.equal(normalizeLifeModeId('slack'), 'faraway');
  assert.equal(normalizeLifeModeId('food'), 'snack');
  assert.equal(normalizeLifeModeId('health'), 'sport');
  assert.equal(normalizeLifeModeId('social'), 'balance');
  assert.equal(normalizeLifeModeId('grind'), 'grind');
  // 数值：旧 slack 的 0.6/0.15 在 faraway 上原样保留
  assert.equal(lifeModeFactorOf('slack')?.studyMul, 0.6);
  assert.equal(lifeModeFactorOf('slack')?.blankDelta, 0.15);
  // 未知 id 原样返回（lifeModeFactorOf 仍按「不猜」处理）
  assert.equal(normalizeLifeModeId('不存在的'), '不存在的');
  assert.equal(lifeModeFactorOf('不存在的'), null);
});

test('WP5: lifeModeExtrasOf —— 各模式给出正确的引擎附加参数', () => {
  assert.deepEqual(lifeModeExtrasOf('sport'), { sportSessions: 4 });
  assert.deepEqual(lifeModeExtrasOf('snack'), { extraMeals: 2 });
  assert.deepEqual(lifeModeExtrasOf('faraway'), { blankBlocks: 2 });
  assert.deepEqual(lifeModeExtrasOf('grind'), { sportSessions: 1 });
  assert.equal(lifeModeExtrasOf('mine'), undefined, '我的模式不加戏（画像与校正已足够）');
  assert.equal(lifeModeExtrasOf(null), undefined);
});

test('WP5: applyLifeMode 对新 id 正常调强度（内卷 1.3）', () => {
  const base = { dailyStudyMin: 120, maxBlockMin: 90, blankRatio: 0.25, eveningAllowed: false, weekendWork: false, studyPlaces: ['图书馆'] };
  const r = applyLifeMode(base, 'grind');
  assert.equal(r.policy.dailyStudyMin, 156);
  assert.ok(r.note?.includes('内卷'));
});
