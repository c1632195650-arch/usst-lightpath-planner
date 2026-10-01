/**
 * AC-9 / AC-10 一致性护栏（前端架构规格书 §11）
 * ============================================================
 * ⚠️ **本文件是「静态近似」版，不是真渲染版。**
 * 真渲染版（改 draggingId → 数取数函数被调几次）需要 React 渲染器，而项目红线是
 * **零新增依赖**（`package.json` 无 jsdom / testing-library / playwright）→ 不做。
 * 于是把 AC-9 / AC-10 拆成「零依赖下可证明的不变式」，测试名一律带「静态近似」，
 * 以便日后真做渲染版时能一眼认出哪些是替身。
 *
 * **AC-9（交互态不触发重排）** —— 静态证明「交互态不在取数链路上」：
 *   ① `UseWeekPlanInput` 的字段里没有交互态（结构证明，最强的一种）；
 *   ② `WeekPlanView` 调 `useWeekPlan({...})` 的实参里没有交互态；
 *   ③ 交互态的持有者 `useWeekPlanDrag.ts` 不调用 `useWeekPlan`（两层物理隔离）。
 *
 * **AC-10（今天页与周计划页一致）** —— 拆成两个不变式，合起来即蕴含一致：
 *   ① **确定性**：同一输入 → 同一输出（在 5 份 golden 语料上验两条引擎入口）；
 *   ② **唯一入口**：`OverviewPage` 与 `WeekPlanView` 都只经 `useWeekPlan` 取 plan，
 *      且容器 `WeekPlanPage` **不自已取数**（否则两页会各算一遍，口径就会漂）。
 *
 * 交互态清单取自 `useWeekPlanDrag.ts` 的实际 useState（见该文件 41/42/57/210 行）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planWeekV2, planWeek, stablePlanJson } from '@/lib/planner/index.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', 'src');

const WEEK = (f: string): string => join(SRC_ROOT, 'features/week', f);
const OVERVIEW = join(SRC_ROOT, 'features/overview/OverviewPage.tsx');

/** 剥注释：本文件要断言的标识符大量出现在注释里（如「交互态仍归本组件所有」） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const readCode = (p: string): string => stripComments(readFileSync(p, 'utf8'));

/** 第②层「交互态」的标识符 —— 取自 useWeekPlanDrag.ts 的 useState 名 */
const INTERACTION_STATES = /\b(draggingId|dragNote|deleteHover|preview)\b/;

/* ============================================================
 * AC-9：交互态不触发重排（静态近似）
 * ========================================================== */

test('AC-9①（静态近似）：UseWeekPlanInput 的字段里没有交互态', () => {
  const code = readCode(WEEK('useWeekPlan.ts'));
  const m = code.match(/export interface UseWeekPlanInput\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, '没找到 UseWeekPlanInput —— 接口被改名了？本用例需同步更新');
  const fields = m[1];
  assert.ok(fields.includes('schedule'), '接口块解析异常（没抓到 schedule 字段），断言不可信');
  assert.ok(
    !INTERACTION_STATES.test(fields),
    'UseWeekPlanInput 混入了交互态字段 —— 交互态一变就会触发重排（违反 §6.1 / AC-9）',
  );
});

test('AC-9②（静态近似）：OverviewPage 调 useWeekPlan 时未传交互态', () => {
  // 三线融合（2026-10-01）改注：融合裁决取 beta-v2 的 WeekPlanView（自带引擎容器，
  // 不经 useWeekPlan 取数，见 arch-guards AC-8 登记），「调 useWeekPlan 不传交互态」
  // 的对象随之改为今天页 OverviewPage —— 纪律本身（交互态不进取数链路）不变。
  const code = readCode(OVERVIEW);
  const calls = [...code.matchAll(/useWeekPlan\s*\(\s*\{([\s\S]*?)\}\s*\)/g)];
  assert.ok(calls.length > 0, '没抓到 useWeekPlan 调用点 —— 本用例需同步更新');
  for (const [i, c] of calls.entries()) {
    assert.ok(c[1].includes('schedule'), `第 ${i + 1} 处调用的实参解析异常，断言不可信`);
    assert.ok(
      !INTERACTION_STATES.test(c[1]),
      `第 ${i + 1} 处调用的实参里混入了交互态：\n${c[1].trim()}`,
    );
  }
});

test('AC-9③（静态近似）：交互态持有者 useWeekPlanDrag 不调用 useWeekPlan', () => {
  const code = readCode(WEEK('useWeekPlanDrag.ts'));
  assert.ok(
    !/useWeekPlan\s*\(/.test(code),
    'useWeekPlanDrag 直接调了 useWeekPlan —— 交互态与取数管线耦合，拖拽会触发重排',
  );
});

/* ============================================================
 * AC-10②：唯一入口（静态）
 * ========================================================== */

test('AC-10②（静态近似）：今天页经 useWeekPlan 取 plan；WeekPlanPage 容器不自行取数', () => {
  // 三线融合（2026-10-01）改注：融合裁决取 beta-v2 的 WeekPlanView —— 它是
  // 已登记的引擎容器（arch-guards AC-8 ENGINE_ALLOWED），不经 useWeekPlan 取数；
  // 「两页同一份引擎输出」的一致性由 AC-10①（golden 上 planWeek/planWeekV2
  // 确定性逐字节相同）继续保证。Ray 的薄容器 WeekPlanPage 原断言保留。
  assert.match(readCode(OVERVIEW), /useWeekPlan\s*\(/, '今天页没有经 useWeekPlan 取数');

  const page = readCode(WEEK('WeekPlanPage.tsx'));
  assert.match(page, /from\s*'\.\/WeekPlanView'/, 'WeekPlanPage 不再是 WeekPlanView 的容器？');
  assert.ok(
    !/useWeekPlan\s*\(/.test(page),
    'WeekPlanPage 自己也调了 useWeekPlan —— 容器与视图各算一遍，两页口径会漂',
  );
});

/* ============================================================
 * AC-10①：确定性（在 golden 语料上跑真引擎）
 * ========================================================== */

test('AC-10①（确定性）：同一输入跑两次，两条引擎入口输出逐字节相同', async () => {
  assert.ok(GOLDEN_INPUTS.length > 0, 'golden 语料为空 —— 本用例失去意义');
  for (const g of GOLDEN_INPUTS) {
    const req = toPlanRequest(buildGoldenInput(g));

    // 同步入口：新引擎
    const a = stablePlanJson(planWeekV2(req));
    const b = stablePlanJson(planWeekV2(req));
    assert.equal(a, b, `[${g.name}] planWeekV2 两次结果不一致 —— 引擎出现非确定性`);

    // 异步入口：UI 侧真正走的那条（useWeekPlan 内部调的就是它）
    // golden 语料自带 req.transfer → 走单遍分支，不触网络
    const c = stablePlanJson(await planWeek(req));
    const d = stablePlanJson(await planWeek(req));
    assert.equal(c, d, `[${g.name}] planWeek 两次结果不一致 —— 引擎出现非确定性`);
  }
});
