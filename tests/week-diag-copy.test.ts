/**
 * P1-1（2026-10-06 收官批次）· 诊断行「质量分」→「调度代价」文案源码锁
 * ============================================================
 * 任务书 P1-1：诊断行曾渲染 `质量分 229`——它实际是求解器**加权代价**，
 * 越低越好（`improve.ts` 只接受 delta < -EPS 的严格下降），但「质量分」
 * 会被用户/评委误读成百分制评分。改为自解释文案：
 *   `调度代价 229（越低越好）`
 *
 * ⚠️ 反向验证：把 WeekPlanView 渲染处改回「质量分」，第 2/3 条断言即红；
 *    删掉「越低越好」尾注，第 3 条红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wpv = readFileSync('src/features/week/WeekPlanView.tsx', 'utf8');

test('诊断行：调度代价 + 越低越好（自解释文案在渲染处）', () => {
  assert.match(wpv, /调度代价 \{Math\.round\(diag\.cost\.total\)\}（越低越好）/);
});

test('渲染处不得再出现「质量分」（P1-1 验收：grep 渲染零命中）', () => {
  // 「质量分」三个字只允许出现在解释历史的注释里，不允许出现在 JSX 文本中
  const jsxHit = wpv.match(/\}质量分|质量分 \{/);
  assert.equal(jsxHit, null, `渲染处仍有「质量分」：${jsxHit?.[0]}`);
});

test('注释同步纠正：不再宣称「加权质量分」', () => {
  assert.doesNotMatch(wpv, /加权质量分/);
});
