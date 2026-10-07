/**
 * 批 4.1 · 周计划页切周按钮（源码锁）
 * ============================================================
 * 实测发现：键盘 ←/→ 切周早已存在（App.tsx 全局 keydown），但周计划子页没有
 * 任何可见按钮与提示 —— RAY 以为功能不存在。本批补可见性：‹ › 按钮 + 快捷键提示。
 * 本仓无 DOM 测试设施，按 wp7 惯例用源码锁断言关键结构与文案存在。
 *
 * ⚠️ 2026-10-08 改锚（Ray 周页批次接入）：操作条（回到今天/撤销/重做/调整…）
 *    整体收进 `WeekToolsPanel.tsx`，‹ › 与快捷键提示随之搬过去 —— 断言改读
 *    该文件；App 传入 onShiftWeek 的接线不变。语义（可见按钮 + 可发现性）不变。
 *
 * ⚠️ 反向验证：删掉 WeekToolsPanel 的按钮/aria-label/提示或 App 的 onShiftWeek
 *    传参，对应断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/features/week/WeekToolsPanel.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('周计划页有 ‹ › 切周按钮（testid + aria-label）', () => {
  assert.match(panel, /data-testid="weekplan-prev-week"/);
  assert.match(panel, /data-testid="weekplan-next-week"/);
  assert.match(panel, /aria-label="上一周"/);
  assert.match(panel, /aria-label="下一周"/);
  assert.match(panel, /onShiftWeek\(-1\)/);
  assert.match(panel, /onShiftWeek\(1\)/);
});

test('Props 可选 + App 传入 shiftWeekBy（老调用点零改动）', () => {
  assert.match(panel, /onShiftWeek\?: \(delta: number\) => void/);
  assert.match(app, /onShiftWeek=\{shiftWeekBy\}/);
});

test('键盘快捷键提示可见（可发现性是本批的真正目标）', () => {
  // 2026-10-08（CY 截图裁决）：操作条按 Ray 设计收敛，提示文案并入按钮 title（不再占版面）。
  assert.match(panel, /title="上一周（键盘 ←）"/);
  assert.match(panel, /title="下一周（键盘 →）"/);
});
