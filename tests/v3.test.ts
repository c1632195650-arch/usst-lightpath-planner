/**
 * V3 —— 全旅程动线锁（源码层；机器可跑的纯逻辑已在 v0/v1/v2 进 ui 门禁）
 * ============================================================
 * 把 CY 19 拍旅程的**页面级连线**钉住：任何一环被改断（入口删除、落点改错、
 * 对话框不再挂载），这里红。E2E 真机资产：scripts/e2e-journey.mjs（MOSS 手动复走）。
 * 本文件 ≥15 条断言 + v0(6)+v1(7)+v2(6) 组成旅程锁整体。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

test('V3: 首访旅程 ①→④ 连线（标题→基本信息→问卷→结果）', () => {
  const app = src('/src/App.tsx');
  assert.match(app, /<Welcome/, '① 标题页挂载');                          // 1
  assert.match(app, /view === 'basicinfo'/, '② 基本信息步在流程里');        // 2
  assert.match(app, /<BasicInfoStep/, '② BasicInfoStep 挂载');             // 3
  assert.match(app, /<PersonaFlow/, '③ 问卷挂载');                          // 4
  assert.match(app, /view === 'result' && state\.persona/, '④ 结果页入口'); // 5
  // 验收修正（2026-09-27）：MOCK 兜底按引用判别——真课表才落「总览」，否则首落「导入」
  assert.match(app, /setMainTab\(state\.schedule && state\.schedule !== MOCK_SCHEDULE \? 'calendar' : 'import'\)/, '⑤ 首落点=导入（MOCK 不算已有课表）'); // 6
  // ⚠️ 2026-10-08 改锚（CY 指令「开始使用这个删掉」）：总览引导清单卡下线，其导入项 prop 随之消失。
  //    首落点判定本身仍在（上面 // 6 那条）——本行改为**负向锁**「卡不许回流」。
  assert.equal(app.includes('hasSchedule={'), false, '⑤ 引导清单卡的导入项已随卡下线'); // 6b
});

test('V3: ⑥→⑦ 模式窗入口 + 确认落 lifeMode', () => {
  const app = src('/src/App.tsx');
  assert.match(app, /<ModeSetupDialog/, '⑥ ModeSetupDialog 挂载');          // 7
  assert.match(app, /addTimetableFacts\(s, getUserId\(\)\)/, '⑤ 导入后回写事实'); // 8
  assert.match(app, /setModeSetupOpen\(true\)/, '⑤ 导入完成自动弹窗'); // 8b
  assert.match(app, /onConfirm=\{\(id\) => \{ patchState\(\{ lifeMode: id \}\)/, '⑦ 确认落 lifeMode'); // 9
  // ⚠️ 2026-10-08 改锚（同上）：总览引导清单下线后，模式窗只剩「导入完成自动弹」一个入口 ——
  //    老用户从此打不开（只剩重新导入课表这条离谱路径）。故本批把入口改由**设置页「生活节奏」行**
  //    承接（值直显当前模式名），本行断言同步改指设置页那一处。语义 = 「模式窗有一个老用户够得着的入口」。
  assert.equal(app.includes('<OnboardingChecklist'), false, '总览引导清单已下线（不许回流）');
  assert.match(
    app,
    /<SettingsPanel[\s\S]{0,140}onOpenModeSetup=\{\s*\(\) => setModeSetupOpen\(true\)\s*\}/,
    '设置页「生活节奏」行承接模式窗入口',
  ); // 10
});

test('V3: ⑧⑨⑩ 日程区三件套（满溢度/编辑开关/留白块）', () => {
  // ⚠️ 2026-10-08 改锚（Ray 周页批次接入）：三件套的落点随组件拆分更新 ——
  //    满溢度条进 WeekTimelineGrid 列头；编辑开关进 WeekToolsPanel 操作条；
  //    留白块与 usst:replan 监听仍在 WeekPlanView。语义不变。
  const wv = src('/src/features/week/WeekPlanView.tsx');
  const grid = src('/src/features/week/WeekTimelineGrid.tsx');
  const panel = src('/src/features/week/WeekToolsPanel.tsx');
  assert.match(grid, /<SaturationBar/, '⑧ 满溢度条');                        // 11
  // ⑨ 2026-10-08（CY 截图裁决）：编辑模式整体下线（Ray 设计 = 始终可编辑）；
  //    改锚为操作条「回到今天」在位（收敛后的操作条核心件）。
  assert.match(panel, /data-testid="week-goto-today"/, '⑨→操作条（Ray 设计）'); // 12
  assert.match(wv, /blankTaskFor\(deleteAsk, weekNo\)/, '⑩ 留白块实体');     // 13
  assert.match(wv, /addEventListener\('usst:replan'/, '⑯ hold 确认触发重排'); // 14
});

test('V3: ⑫⑬ 梨宝链路（改期草稿/记忆/预览卡）', () => {
  const chat = src('/src/features/libao/LbaoChat.tsx');
  assert.match(chat, /runRescheduleWithPreview/, '⑫ 改期草稿卡通路');        // 15
  assert.match(chat, /getRecentPlanEvents\(\)/, '⑬ 日程变动注入');           // 16
  assert.match(chat, /<MiniWeekPreview/, '⑫ 排程预览卡');                    // 17
});

test('V3: V0-1 重看引导闭环（onboarded:false → 完整重走）', () => {
  const app = src('/src/App.tsx');
  assert.match(app, /patchState\(\{ onboarded: false \}\); setView\('welcome'\)/, '重看引导'); // 18
});

test('V3: E2E 资产在位（≥15 断言的旅程脚本随仓保留）', () => {
  const e2e = src('/scripts/e2e-journey.mjs');
  assert.match(e2e, /onboarding-checklist/);                                 // 19
  assert.match(e2e, /mode-card-faraway/);                                    // 20
  assert.match(e2e, /saturation-bar/);                                       // 21
});

test('V3: 画像入口统一动线（2026-10-08 修复：新账号不再绕过 基本信息/导入课表）', () => {
  const app = src('/src/App.tsx');
  // 三处入口（总览焦点卡 / 画像页空态 / 梨宝「完成画像」）必须走统一动线 —— 此前直达问卷
  assert.match(app, /onStartPersona=\{startPersonaOrOnboarding\}/, '总览入口走统一动线');   // 22
  assert.match(app, /onClick=\{startPersonaOrOnboarding\}/, '画像页空态入口走统一动线');     // 23
  assert.match(app, /onGoProfile=\{startPersonaOrOnboarding\}/, '梨宝「完成画像」走统一动线'); // 24
  // 判定：真实课表 → 直达问卷（重测）；无真实课表 → 补引导缺步（无基本信息 → basicinfo，否则 import）
  assert.match(
    app,
    /loadBasicInfo\(\)\.nickname \? 'import' : 'basicinfo'/,
    '无基本信息先补基本信息、有基本信息先补导入课表',
  );                                                                          // 25
  // ⚠️ 反向验证（2026-10-08 实测）：把助手体改回「恒 setView('persona')」→ 22/23/24 三条红。
});
