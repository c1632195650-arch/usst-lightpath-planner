/**
 * R 批 P0-2 · R2.3 —— AddTaskPanel 时间字段一级化（源码锁，与 wp7 同手法）
 * ============================================================
 * CY 走查实录：此前「选了具体日期才渲染时间轮盘」——时间是日期的附属品。
 * 现在改为两个并列单选：「我来定时间」（星期 + 轮盘 = 固定块）/
 * 「让引擎找空档」（引擎自由落位，可选限天）。
 *
 * ⚠️ 反向验证（RV）：
 *   RV-R2c ← 删任一 radio（或改回旧的 day-select 单形态）→ 本文件用例红
 *   本仓无 jsdom，组件行为锁用源码字面量断言（wp7 E5 类名锁同一先例）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (): string =>
  readFileSync(fileURLToPath(new URL('../src/features/week/AddTaskPanel.tsx', import.meta.url)), 'utf8');

test('R2.3: 两个并列单选在位（我来定时间 / 让引擎找空档）', () => {
  const s = src();
  assert.match(s, /data-testid="addtask-mode-mine"/, '「我来定时间」单选');
  assert.match(s, /data-testid="addtask-mode-engine"/, '「让引擎找空档」单选');
  assert.match(s, /我来定时间/);
  assert.match(s, /让引擎找空档/);
  assert.match(s, /useState<'mine' \| 'engine'>\('engine'\)/, 'timeMode 状态在位（缺省 = 引擎找空档，与旧默认一致）');
});

test('R2.3: 时间轮盘只在「我来定时间」且选了天时渲染；引擎态不产 startMin', () => {
  const s = src();
  // 轮盘渲染被 mine + day 双闸包住（旧实现只有 day 单闸 → 时间成了日期附属品）
  assert.match(s, /timeMode === 'mine' && day !== '' && \(\s*<>\s*\{[\s\S]{0,200}?TimeWheelPicker/s,
    'TimeWheelPicker 必须在 mine+day 双闸内（RV-R2c：删 timeMode 闸 → 红）');
  // 固定块 = mine 模式才给 startMin；引擎模式即使限天也不给（浮动块，引擎可挪）
  assert.match(s, /timeMode === 'mine' && day !== '' \? \{ startMin: toMinutes\(start\) \} : \{\}/,
    'startMin 只在「我来定时间」写入（引擎找空档 = 浮动块）');
});

test('R2.3: 引擎模式可选「不限哪天」，交出自由落位语义', () => {
  const s = src();
  assert.match(s, /<option value="">不限哪天<\/option>/, '引擎模式的天下拉带「不限哪天」');
  assert.match(s, /你自己加的一件事（交给引擎找空档）/, 'note 如实记录时间来源');
});
