/**
 * 示例课表横幅（源码锁）—— **2026-10-08 改锚：卡已下线**
 * ============================================================
 * 历史：RAY 反馈第 8 项 —— 新用户首启看到的是 demo 课表，但没人告诉他是假的。
 * 批 4.2 加了顶部横幅（条件渲染 + 文案 + 一键跳「课表」导入页）。
 *
 * ⚠️ 改锚留痕（commit message 同款申报）：CY 2026-10-08 指令「这个也去掉」——
 *   横幅不再占首屏。本文件从**正向锁**改为**负向锁**（同仓既有手法，例见
 *   tests/v1.test.ts 的「周页不再挂 AchievementPanel」），语义从
 *   「横幅在位」变成「横幅不许回流」。
 *
 * 保留的两条语义锚（与横幅无关、仍必须成立）：
 *   ① 数据面判定仍在 —— `schedule.source === 'demo'` 的「真实课表覆盖演示课表」逻辑
 *      写在 App 顶部那个 effect 里，删横幅不许把它一起删掉（那才是真功能）；
 *   ② 「课表」导入页入口仍在 —— 原横幅的跳转按钮没了，但导入页本身与它的导航项
 *      （主导航「课表」）不受影响。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');

test('示例课表横幅已下线（不许回流）', () => {
  assert.equal(app.includes('demo-schedule-banner'), false, '横幅节点已删除');
  assert.equal(app.includes('demo-schedule-goto-import'), false, '横幅的跳转按钮已删除');
  assert.equal(app.includes('不是你的真实课表'), false, '横幅文案已删除');
});

test('删横幅不许带走数据面判定（真实课表仍会覆盖演示课表）', () => {
  // 这条是**正向锁**：反向验证方式 = 把 App 里 `source !== 'demo'` 的短路改回永远 return → 本用例红
  assert.match(app, /state\.schedule\.source !== 'demo'/, '「已是真实课表则不覆盖」的短路仍在');
});

test('「课表」导入页入口与导航不受横幅下线影响', () => {
  // ⚠️ 曾想把「跳转按钮」的锚改成 setMainTab('import') —— 实测那是**唯一的**该字面量
  //    （另一处是引导清单的 onGotoImport，随清单一起下线了）。真实入口是主导航那一项，
  //    故锚点落在导航清单上（反向验证：从 SHOW_IMPORT 的数组里删掉 'import' → 本用例红）。
  assert.match(app, /'calendar', 'libao', 'memo', 'goals', 'profile', 'import'/, '主导航仍含「课表」页');
  assert.match(app, /import: '课表'/, '导航项标签仍在');
});
