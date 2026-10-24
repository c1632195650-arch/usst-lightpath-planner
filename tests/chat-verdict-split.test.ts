/**
 * r9 · chatVerdict 拆分守护（D1-批3，2026-10-24）
 * ============================================================
 * 守三件事：
 *   ① 接缝红线：chatVerdict.ts 的 import 语句**零 planner**（红线 6 的深化——
 *      话术域不触碰引擎；注释里的说明文字不算，只查 import）；
 *   ② re-export 同一性：weekPlanForChat 从 chatVerdict re-export 全部 12 个
 *      搬走符号（导出面零变化——LbaoChat 等既有 import 不动）；
 *   ③ 行为锚：describeVerdict 的 L3/L4 话术边界（conflict 不硬编码编号承诺）。
 * RV：删任一 re-export → ②恰红（r2 同款手法，实测留痕）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

test('r9-① 接缝红线：chatVerdict 的 import 语句零 planner', () => {
  const cv = read('../src/features/libao/chatVerdict.ts');
  const badImports = cv.split('\n').filter((l) => /^import/.test(l.trim()) && /planner/.test(l));
  assert.deepEqual(badImports, [], '话术域不得 import 引擎（红线 6 深化）');
});

test('r9-② re-export 同一性：12 个搬走符号全部经 weekPlanForChat 转出（导出面零变化）', () => {
  const wv = read('../src/features/libao/weekPlanForChat.ts');
  const m = wv.match(/export \{([\s\S]*?)\} from '\.\/chatVerdict';/);
  assert.ok(m, '缺少从 ./chatVerdict 的 re-export 块');
  const names = m[1].split(/[,\s]+/).filter((n) => n && n !== 'type');
  for (const fn of [
    'summarizeWeekPlan', 'variantSummariesForChat', 'tagLine', 'describeVerdict',
    'categoryMinutesOfWeek', 'quickOptionsFor', 'replanOptionButtons',
    'GoalVerdict', 'GoalVerdictKind', 'GoalAddedIssue', 'BlockingBlockInfo', 'QuickOption',
  ]) {
    assert.ok(names.includes(fn), `re-export 缺 ${fn} —— 既有 import 面会断`);
  }
  // 引擎调用族留在原文件（没被误搬）
  assert.match(wv, /export function proposeReplanOptions/, '干跑协商（引擎调用族）应留在 weekPlanForChat');
  assert.match(wv, /export function checkGoalFeasibility/, '干跑把关留在 weekPlanForChat');
});

test('r9-③ 行为锚：conflict 态不硬编码编号承诺（L3/L4 + D 批脱节修复在位）', () => {
  const cv = read('../src/features/libao/chatVerdict.ts');
  assert.match(cv, /不再硬编码「①②③」承诺/, 'D 批修复注记随函数搬走');
  assert.match(cv, /可以说「换个时间」/, 'conflict 话术在位');
  assert.match(cv, /export function replanOptionButtons/, '编号按钮生成器在位');
});
