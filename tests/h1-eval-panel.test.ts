/**
 * R批 Wave3（H1.4）· 评估面板的**数据契约**测试
 * ============================================================================
 *
 * 本仓 UI 门禁（`npm run test:ui`）跑的是 `scripts/` 目录下所有 `.test.ts` 的纯逻辑测试，
 * **不渲染 React**。所以这里不测 DOM，而是锁组件真正依赖的东西：
 *
 *   ① 面板消费的字段全部存在且类型可用（改坏了组件会白屏）
 *   ② 关键文案常量与语义一致（`HEALTH_DISCLAIMER` 等不得被替换成编造文本）
 *   ③ **不出现「综合总分」** —— 组件头注释里写明这是设计决定，必须守住
 *
 * 渲染层（是否真的展开、是否显示依据）由 E2E / 真机截图覆盖。
 *
 * ⚠️ 反向验证（RV）—— **实测**过：
 *   RV-H1d ← 把某维度 score 从 null 改成 0  → 1 条红
 *
 * ⚠️ 本文件第一版曾把「检查源码文案」写成直接 `includes()`，结果被组件里
 * 「**不做**的事：不给综合总分」这句**说明性注释**判红 —— 检查自身成了假覆盖。
 * 已改为剥注释后检查（同 arch-guards 的 `stripComments` 思路）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestBlocks, digestThresholds } from '@/lib/planner/planDigest';
import {
  citedSlugs,
  evaluateDigest,
  fmtHours,
  fmtMin,
  HEALTH_DISCLAIMER,
  type EvalDimension,
  type PlanEvaluation,
} from '@/lib/planner/planEval';
import type { BlockKind, DayOfWeek, TimeBlock } from '@/types';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PANEL_SRC = readFileSync(join(ROOT, 'src/features/week/PlanEvalPanel.tsx'), 'utf8');

/**
 * 剥掉注释再检查 —— 与 `tests/arch-guards.test.ts` 同一思路。
 *
 * ⚠️ 不剥的话，「**不做**的事：不给综合总分」这类**说明性注释**会被
 * 判成「组件出现了总分」—— 检查自身成了假覆盖（第一次跑就红在这）。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const PANEL_CODE = stripComments(PANEL_SRC);

let seq = 0;
const blk = (d: DayOfWeek, s: number, e: number, t: string, k: BlockKind = 'activity'): TimeBlock => {
  seq += 1;
  return { id: `b${seq}`, kind: k, dayOfWeek: d, startMin: s, endMin: e, title: t, source: 'user' };
};

/* ============================================================
 * ① 数据契约
 * ========================================================== */

test('H1.3 评估结果满足面板消费的全部字段（改字段会白屏，这里挡住）', () => {
  const e = evaluateDigest(digestBlocks([
    blk(1, 7 * 60, 8 * 60, '慢跑'),
    blk(2, 9 * 60, 12 * 60, '复习高数', 'study'),
    blk(3, 22 * 60, 23 * 60, '开会'),
    blk(4, 12 * 60, 12 * 60 + 30, '午饭', 'meal'),
  ]));
  for (const key of ['weekNo', 'dimensions', 'topAdvice', 'coverage', 'caveats']) {
    assert.ok(key in e, `评估结果缺字段 ${key}`);
  }
  for (const dim of e.dimensions) {
    for (const key of ['key', 'label', 'coverage', 'score', 'findings']) {
      assert.ok(key in dim, `维度缺字段 ${key}`);
    }
    assert.equal(typeof dim.coverage, 'number');
    assert.ok(dim.coverage >= 0 && dim.coverage <= 1, `coverage 越界：${dim.coverage}`);
    for (const f of dim.findings) {
      for (const key of ['id', 'headline', 'status', 'severity', 'basis', 'evidence', 'advice']) {
        assert.ok(key in f, `结论缺字段 ${key}（${f.id}）`);
      }
      assert.ok(['good', 'gap', 'unknown'].includes(f.status));
      assert.ok(['info', 'warn', 'serious'].includes(f.severity));
      assert.ok(Array.isArray(f.evidence));
      assert.ok(Array.isArray(f.advice));
    }
  }
});

test('H1.3 五个维度都在（面板按维度分区渲染，缺一个就少一块）', () => {
  const e = evaluateDigest(digestBlocks([blk(1, 7 * 60, 8 * 60, '慢跑')]));
  const keys = e.dimensions.map((d) => d.key).sort();
  assert.deepEqual(keys, ['exercise', 'load', 'nutrition', 'sleep', 'study']);
});

/* ============================================================
 * ② 文案纪律
 * ========================================================== */

test('H1.3 免责声明直接取自知识库编译产物（不得自行改写）', () => {
  // 必须是知识库原文，含「不能替代医生」这类关键免责语义
  assert.ok(HEALTH_DISCLAIMER.includes('不能替代'), '免责声明必须保留「不能替代医生」语义');
  assert.ok(HEALTH_DISCLAIMER.length > 20);
  // 面板必须真的把它渲染出来（源码里出现该常量）
  assert.ok(PANEL_CODE.includes('HEALTH_DISCLAIMER'), '面板未使用知识库免责声明');
});

test('H1.3 fmtMin / fmtHours 输出不含 NaN / undefined', () => {
  for (const n of [0, 1, 59, 60, 61, 90, 95, 1440, 0.4, -5]) {
    const s = fmtMin(n);
    assert.ok(!/NaN|undefined/.test(s), `fmtMin(${n}) = ${s}`);
    const h = fmtHours(n / 60);
    assert.ok(!/NaN|undefined/.test(h), `fmtHours(${n / 60}) = ${h}`);
  }
});

/* ============================================================
 * ③ 设计决定：不给「综合总分」
 * ========================================================== */

test('H1.3 面板不得出现「综合总分 / 总分」类聚合分数', () => {
  // 各维度可以互相补偿（少运动多学习），压成总分等于替用户做了不该替他做的
  // 价值判断。组件头注释明确写了「不做这件事」，这里用源码守住。
  const bad = ['综合总分', '总分', '总评得分', 'overallScore', 'totalScore'];
  for (const w of bad) {
    assert.ok(!PANEL_CODE.includes(w), `面板出现聚合分数「${w}」——违反「不替用户做价值判断」的设计决定`);
  }
});

test('H1.3 面板必须同时展示覆盖度（单给分数就是骗人）', () => {
  assert.ok(/可判度/.test(PANEL_CODE), '面板需展示每个维度的可判度');
  assert.ok(/看不到/.test(PANEL_CODE), '面板需有「看不到」的显式表达');
  assert.ok(/不等于你没做/.test(PANEL_CODE), '面板需说明「看不到 ≠ 没做」');
});

test('H1.3 面板不得把 unknown 说成 gap 的措辞', () => {
  // 「不足」只能出现在 gap 上；unknown 区的文案必须是「看不到」
  assert.ok(PANEL_CODE.includes('日程里看不到的（不等于你没做）'), 'unknown 应单列成区');
  assert.ok(!/看不到[^\n]{0,12}不足/.test(PANEL_CODE), '「看不到」不得与「不足」同句');
});

/* ============================================================
 * 空态与依据
 * ========================================================== */

test('H1.3 空日程的评估不得给任何 0 分（面板会显示成「—」）', () => {
  const e = evaluateDigest(digestBlocks([]));
  for (const dim of e.dimensions) {
    assert.equal(dim.score, null, `${dim.key} 空日程应为 null 而不是 0`);
  }
  assert.equal(e.coverage, 0);
  // 阈值仍要能读出来（面板不显示分数时也要能说「标准是多少」）
  const th = digestThresholds();
  assert.ok(th.weeklyModerateMin > 0 && th.sleepMinHours > 0);
});

test('H1.3 依据可溯源且去重（面板的「来自知识库的哪几条」区）', () => {
  const e = evaluateDigest(digestBlocks([
    blk(1, 7 * 60, 8 * 60, '慢跑'),
    blk(2, 9 * 60, 12 * 60, '复习高数', 'study'),
    blk(3, 22 * 60, 23 * 60, '开会'),
  ]));
  const slugs = citedSlugs(e);
  assert.ok(slugs.length > 0);
  assert.equal(new Set(slugs.map((s) => s.slug)).size, slugs.length, '依据必须去重');
  for (const s of slugs) {
    assert.ok(s.slug.length > 0 && s.tier.length > 0 && s.quote.length > 0);
  }
});

test('H1.3 分数与覆盖度必须同时非空（保证面板的「/100 · 可判度」能渲染）', () => {
  const e = evaluateDigest(digestBlocks([
    blk(1, 7 * 60, 8 * 60, '慢跑'),
    blk(2, 9 * 60, 12 * 60, '复习高数', 'study'),
  ]));
  const scored: EvalDimension[] = e.dimensions.filter((d) => d.score != null);
  assert.ok(scored.length > 0, '该夹具应至少有一个可判维度');
  for (const d of scored) {
    assert.ok(d.score! >= 0 && d.score! <= 100, `分数越界：${d.score}`);
    assert.ok(d.coverage > 0, `${d.key} 有分数但覆盖度为 0 —— 自相矛盾`);
  }
});

/* ============================================================
 * 稳定性
 * ========================================================== */

test('H1.3 评估结果可 JSON 序列化（面板要把它当纯数据传，不带函数/循环引用）', () => {
  const e: PlanEvaluation = evaluateDigest(digestBlocks([blk(1, 7 * 60, 8 * 60, '慢跑')]));
  const round = JSON.parse(JSON.stringify(e)) as PlanEvaluation;
  assert.deepEqual(round, e);
});
