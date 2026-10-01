/**
 * 批 4.2 · 示例课表横幅（源码锁）
 * ============================================================
 * RAY 反馈第 8 项：新用户首启看到的是 demo 课表，但没人告诉他是假的。
 * 本批：schedule.source === 'demo' 时顶部横幅提示 + 一键跳「课表」导入页，
 * 导入成功（source 变更）后自然消失。
 *
 * ⚠️ 反向验证：删掉条件渲染/文案/跳转按钮，对应断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');

test('demo 课表时渲染横幅（条件 + testid + 文案）', () => {
  assert.match(app, /schedule\.source === 'demo'/);
  assert.match(app, /data-testid="demo-schedule-banner"/);
  assert.match(app, /示例数据/);
});

test('横幅有一键跳转导入页的动作', () => {
  assert.match(app, /data-testid="demo-schedule-goto-import"/);
  assert.match(app, /setMainTab\('import'\)/);
});
