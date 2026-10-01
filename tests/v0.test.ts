/**
 * V0 —— 演示通道与动线闭环：重看引导 / 首落点导入 / onboarding checklist
 * ============================================================
 * checklistStatus 纯函数单测 + App/Overview/LbaoChat 源码接线断言（项目既有手法）。
 *
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §V0）：
 *   RV1 ← checklistStatus 的 done 判定翻转 → 档位用例红
 *   RV2 ← App.tsx 删「重看引导」按钮 → 源码断言红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checklistStatus } from '@/features/onboarding/checklist';

const APP_SRC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');

test('V0-3: checklistStatus 三条待办未完成 → 卡显示、allDone=false', () => {
  // 反向：done 判定翻转 → 本用例红
  const r = checklistStatus({ hasSchedule: false, lifeMode: null, userDeadlineCount: 0 });
  assert.equal(r.allDone, false);
  assert.equal(r.doneCount, 0);
  assert.deepEqual(r.items.map((i) => i.key), ['importCourse', 'lifeMode', 'deadline']);
  assert.ok(r.items.every((i) => !i.done));
});

test('V0-3: 部分完成逐项点亮（导入后/选模式后）', () => {
  const r = checklistStatus({ hasSchedule: true, lifeMode: 'faraway', userDeadlineCount: 0 });
  assert.equal(r.doneCount, 2);
  assert.equal(r.items.find((i) => i.key === 'deadline')!.done, false);
});

test('V0-3: 全部完成 → allDone（组件据此整卡隐藏）；空串 lifeMode 不算完成（不猜）', () => {
  assert.equal(checklistStatus({ hasSchedule: true, lifeMode: 'sport', userDeadlineCount: 2 }).allDone, true);
  assert.equal(checklistStatus({ hasSchedule: true, lifeMode: '', userDeadlineCount: 0 }).allDone, false);
  // 确定性
  const a = checklistStatus({ hasSchedule: true, lifeMode: null, userDeadlineCount: 1 });
  assert.deepEqual(a, checklistStatus({ hasSchedule: true, lifeMode: null, userDeadlineCount: 1 }));
});

test('V0-1 源码: 「重看引导」按钮在位（onboarded:false + 回 welcome）', () => {
  // 反向：删掉按钮 → 本用例红
  const src = APP_SRC();
  assert.match(src, /data-testid="replay-onboarding"/);
  assert.match(src, /patchState\(\{ onboarded: false \}\); setView\('welcome'\)/);
});

test('V0-2 源码: 结果页 onEnter 首落点 = 有课表落今天、没课表落导入', () => {
  const src = APP_SRC();
  // 三线融合（2026-10-01）改注：App 改为 hash 路由（navigate），判别收敛进
  // hasRealSchedule() —— 反向验证强度不变：删掉引用判别（state.schedule !==
  // MOCK_SCHEDULE）→ 第一条断言红；删掉导入落点 → 第二条断言红。
  // 原验收修正（2026-09-27）：MOCK 兜底按引用判别，只比真值恒落总览。
  assert.match(src, /state\.schedule && state\.schedule !== MOCK_SCHEDULE/, 'MOCK 兜底必须按引用判别');
  assert.match(src, /navigate\(hasRealSchedule\(state\) \? 'today' : 'import'\)/, '没课表首落导入');
});

test('V0-3 源码: OverviewPage 渲染 onboardingCard；梨宝 seedQuestion 预填链路在位', () => {
  const overview = readFileSync(
    fileURLToPath(new URL('../src/features/overview/OverviewPage.tsx', import.meta.url)), 'utf8');
  assert.match(overview, /\{onboardingCard\}/);
  const app = APP_SRC();
  assert.match(app, /onboardingCard=\{\(/);
  const libao = readFileSync(
    fileURLToPath(new URL('../src/features/libao/LbaoChat.tsx', import.meta.url)), 'utf8');
  assert.match(libao, /useState\(seedQuestion \?\? ''\)/);
});
