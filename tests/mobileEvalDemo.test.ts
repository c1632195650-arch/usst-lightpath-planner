/**
 * 移动端执行力评估 · 样例通道端到端（2026-10-08）
 * ============================================================
 * 背景：生产端（公网 / APK）用户点「我的 → 执行力评估 → 载入 8 天样例」后
 * 角标出现、五维却仍显示「数据累积中（0/7 天）」——根因是 `EvalSection` 的
 * `evalInput` useMemo **依赖数组漏了 `demo`**：现场载入后 evalInput 不重算，
 * profile 仍拿旧的空输入。本文件同时锁住「样例真的能算出五维」与「接线形状」。
 *
 * 判据：
 *   ① `DEMO_EVAL_INPUT` 走真函数 `computeExecutionProfile` → **五维全部可判**（有值）；
 *   ② 源码锁：`evalInput` 的依赖里必须有 `demo`（现场载入才会重算）；
 *   ③ 源码锁：`demoEvalOn()` 不得按 `import.meta.env.DEV` 早退（生产端要能用）；
 *   ④ 源码锁：载入按钮（m-eval-demo-load）与角标接线（demoBadge={demo}）在位。
 *
 * 反向验证锚点（RV，删实现必红）：
 *   ME-RV1 ← 样例输入窗口错位/清空 → 用例①红
 *   ME-RV2 ← 从 useMemo 依赖里删掉 `demo` → 用例②红
 *   ME-RV3 ← 在 demoEvalOn 首行加回 `if (!import.meta.env.DEV) return false;` → 用例③红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEMO_EVAL_INPUT, DEMO_TODAY_KEY, DEMO_EVAL_DAYS } from '@/features/mobile/eval/demoInput.ts';
import { computeExecutionProfile, dailySeries } from '@/features/mobile/eval/compute.ts';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('① 样例输入走真函数：五维全部可判、有值（不是「数据累积中」）', () => {
  const profile = computeExecutionProfile(DEMO_EVAL_INPUT, DEMO_TODAY_KEY);
  const dims = Object.values(profile.dims);
  assert.equal(dims.length, 5);
  for (const d of dims) {
    assert.equal(d.confident, true, `${d.dim} 应有可判值（样例原料齐全）`);
    assert.notEqual(d.value, null, `${d.dim} 不得为 null（铁律：不可判才给 null）`);
  }
  // 样例故事：多数完成 / 拖延两单 / 自评中等偏上 —— 至少锁住「有原料」的规模
  assert.ok((profile.dims.completion.sampleSize ?? 0) >= 7, '完成率样本量应为 8 天级');
  const series = dailySeries(DEMO_EVAL_INPUT, DEMO_EVAL_DAYS);
  assert.equal(series.completion.length, 8, '8 天窗口序列');
  assert.ok(series.completion.some((v) => v !== null), '样例窗口里至少有可判的完成率日');
});

test('② 源码锁：evalInput 的 useMemo 依赖含 demo（现场载入的重算闸）', () => {
  const s = src('/src/features/mobile/EvalSection.tsx');
  // ME-RV2：从这里删掉 demo → 本断言红（正是 2026-10-08 实测到的坏法）
  assert.match(
    s,
    /\}, \[plan, serverState, layer, evalDays, behaviorEvents, shownRows, demo\]\);/,
    'evalInput 依赖必须含 demo —— 否则现场载入样例后五维不重算',
  );
  assert.match(s, /if \(demo\) return DEMO_EVAL_INPUT;/, '样例通道分支在位');
});

test('③ 源码锁：demoEvalOn 不得按 DEV 早退（生产端/APK 要能用）', () => {
  const s = src('/src/features/mobile/EvalSection.tsx');
  const fn = s.slice(s.indexOf('function demoEvalOn'), s.indexOf('function demoEvalOn') + 420);
  // ME-RV3：在首行加回 DEV gate → 本断言红
  assert.ok(!/import\.meta\.env\.DEV\s*\)\s*return false/.test(fn), '不得有 DEV 早退');
  assert.match(fn, /demoEval/, 'URL 显式开关');
  assert.match(fn, /usst\.mobile\.demoEval/, 'localStorage 显式开关');
});

test('④ 源码锁：载入按钮与角标接线在位', () => {
  const s = src('/src/features/mobile/EvalSection.tsx');
  assert.match(s, /data-testid="m-eval-demo-load"/, '一键载入入口');
  assert.match(s, /localStorage\.setItem\('usst\.mobile\.demoEval', '1'\)/, '按钮写入显式开关');
  assert.match(s, /setDemo\(true\)/, '按钮即时生效（不依赖刷新）');
  assert.match(s, /<EvalPanel profile=\{profile\} series=\{series\} demoBadge=\{demo\} \/>/, '角标随 demo');
});
