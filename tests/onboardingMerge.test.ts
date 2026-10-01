/**
 * 首次设置「统一风格并入」验收（RAY 2026-10-01 明确要求）
 * ============================================================
 * 两条要求，各写死一组守卫：
 *   ① 注册 / 登录后**没有基础信息界面** —— 根因是冷启动闸门只看 `onboarded`，
 *      老账号 / 并入的旧快照 `onboarded=true` 却从没填过基础信息，被直接送进 main。
 *      → 守卫：`initialView` 必须把 `hasBasicInfo` 计入判据；App 必须把两个布尔都注入。
 *   ② 把「住处 + 作息」**并入基础信息界面且统一风格，而不是单独的一栏**。
 *      → 守卫：注入项落在 `BasicInfoStep` 的**同一张表单网格内部**；
 *        `OnboardingSetup` 不再自带 `<section>` / `<h2>` / 卡片外框；
 *        welcome 与 week 两域共用中立层 `@/components/ui/field` 的同一套样式。
 *
 * 为什么用源码静态守卫（而不是渲染测试）：本仓无 jsdom，组件渲染测不了；
 * 而这两条恰恰是「改天有人图省事又拆回一栏 / 又只看 onboarded」的回归点 ——
 * 运行时不会报错，只有把结构钉死在源码层才守得住。与 `tests/routineStore.test.ts`
 * 第四节的静态守卫同一套路数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 读源码并剥掉注释 —— 注释里提到关键字不算数（沿用 routineStore.test.ts 的口径） */
const srcOf = (rel: string) =>
  readFileSync(join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');

/* ============================================================
 * 一、冷启动闸门：缺基础信息不许被 onboarded 直接放过
 * ========================================================== */

test('闸门：basicInfo.ts 的 initialView 把 hasBasicInfo 计入判据', () => {
  // 反向：删掉 `if (!gate.hasBasicInfo) return 'basicinfo'` → 本用例红
  const code = srcOf('src/features/welcome/basicInfo.ts');
  assert.match(code, /hasBasicInfo/, 'initialView 不再看 hasBasicInfo —— 缺档账号又会落进 main');
  assert.match(
    code,
    /if\s*\(\s*!gate\.hasBasicInfo\s*\)\s*return\s*'basicinfo'/,
    '缺基础信息必须先落 basicinfo',
  );
});

test('闸门：App 把 onboarded 与 hasBasicInfo 两个布尔都注入 initialView', () => {
  // 反向：把调用改回 `initialView(state.onboarded)` → 本用例红
  const app = srcOf('src/App.tsx');
  assert.match(
    app,
    /initialView\(\s*\{\s*onboarded:[^}]*hasBasicInfo:/,
    'App 必须把 { onboarded, hasBasicInfo } 一起交给 initialView',
  );
  assert.match(app, /function hasBasicInfo\(\)/, 'App 缺少 hasBasicInfo 现算函数');
  assert.ok(
    !/initialView\(\s*state\.onboarded\s*\)/.test(app),
    'App 又退回了「只看 onboarded」的旧闸门',
  );
});

/* ============================================================
 * 二、「住处 / 作息」并入同一张表单网格（不是单独的一栏）
 * ========================================================== */

test('并入：BasicInfoStep 的 {children} 落在字段网格内部', () => {
  const code = srcOf('src/features/welcome/BasicInfoStep.tsx');
  const gridOpen = code.indexOf('grid gap-4 sm:grid-cols-2');
  const childrenAt = code.indexOf('{children}');
  const alertAt = code.indexOf('errorList.length > 0');
  assert.ok(gridOpen >= 0, 'BasicInfoStep 的字段网格丢了');
  assert.ok(childrenAt >= 0, '{children} 插槽被删了 —— 住处/作息再也进不来');
  assert.ok(
    gridOpen < childrenAt,
    '{children} 被挪到网格之外了 —— 那又变成「表单下面另起一栏」',
  );
  assert.ok(
    alertAt > childrenAt,
    '{children} 应在网格内、且在提交错误提示之前 —— 确认它确实是网格子项',
  );
});

test('并入：BasicInfoStep 与两域共用中立层的字段样式（不再各写各的）', () => {
  const step = srcOf('src/features/welcome/BasicInfoStep.tsx');
  assert.match(
    step,
    /from '@\/components\/ui\/field'/,
    'BasicInfoStep 未使用统一样式层 —— 风格会在两域间漂移',
  );
  // 反向：把 fieldCls 换回本地 inputCls 常量 → 本用例红
  assert.match(step, /fieldCls\(/, 'BasicInfoStep 的输入控件应走共享的 fieldCls');
  assert.ok(
    !/const\s+inputCls\s*=/.test(step),
    'BasicInfoStep 又出现了本地 inputCls —— 样式定义点应只有一个',
  );
});

test('并入：OnboardingSetup 输出网格子项，不再自带一栏（section / 标题 / 卡片外框）', () => {
  const setup = srcOf('src/features/week/OnboardingSetup.tsx');
  assert.ok(!/<section\b/.test(setup), 'OnboardingSetup 不得再自己起一个 <section> 区块');
  assert.ok(!/<h2\b/.test(setup), 'OnboardingSetup 不得再自带标题 —— 那正是「单独的一栏」');
  assert.ok(
    !/rounded-xl\s+border/.test(setup),
    'OnboardingSetup 不得再自带卡片外框 —— 样式统一交给字段层',
  );
  // 两项都以 embedded 形态渲染 —— 才会与同表其它字段同款
  assert.match(setup, /HomeBaseSetting[\s\S]*?\bembedded\b/, '住处字段未走 embedded 形态');
  assert.match(setup, /<RoutineSetting\s+embedded/, '作息字段未走 embedded 形态');
});

test('并入：两域设置组件都支持 embedded 且共用字段样式层', () => {
  for (const rel of [
    'src/features/week/HomeBaseSetting.tsx',
    'src/features/week/RoutineSetting.tsx',
  ]) {
    const code = srcOf(rel);
    assert.match(code, /from '@\/components\/ui\/field'/, `${rel} 未使用统一样式层`);
    assert.match(code, /\bembedded\b/, `${rel} 缺少 embedded 形态`);
  }
});
