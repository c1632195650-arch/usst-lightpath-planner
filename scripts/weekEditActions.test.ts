/**
 * r5 · 周视图编辑动作下沉的守护测试（D2，2026-10-24）
 * ============================================================
 * weekEditActions.ts 把撤销/重做/键盘绑定从 WeekPlanView 搬出（行为不变）。
 * 这里守三件事：
 *   ① 键盘映射纯函数 weekKeyToAction 的判定表（含输入框不拦截）；
 *   ② Toast 文案口径锁（「已撤销上一步改动」「已重做」——既有口径不许顺手改写）；
 *   ③ 视图接线锁（WeekPlanView 已改为消费 useWeekEditActions，不再内联定义）。
 * RV：摘掉 weekKeyToAction 的 y 分支 → ①恰红；删文案 → ②恰红（实测留痕）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { weekKeyToAction } from '@/features/week/weekEditActions';

const here = dirname(fileURLToPath(import.meta.url));

/** 键盘事件的极简桩（不依赖 DOM）。 */
function key(over: Partial<Parameters<typeof weekKeyToAction>[0]>) {
  return {
    ctrlKey: false, metaKey: false, shiftKey: false, key: '', target: null,
    ...over,
  };
}
const BODY: EventTarget = { tagName: 'BODY' } as unknown as EventTarget;
const INPUT: EventTarget = { tagName: 'INPUT' } as unknown as EventTarget;

test('r5 · 键盘映射：Ctrl+Z=undo、Ctrl+Shift+Z / Ctrl+Y=redo、Cmd 同权（RV：删 y 分支必红）', () => {
  assert.equal(weekKeyToAction(key({ ctrlKey: true, key: 'z', target: BODY })), 'undo');
  assert.equal(weekKeyToAction(key({ ctrlKey: true, shiftKey: true, key: 'Z', target: BODY })), 'redo');
  assert.equal(weekKeyToAction(key({ ctrlKey: true, key: 'y', target: BODY })), 'redo');
  assert.equal(weekKeyToAction(key({ metaKey: true, key: 'z', target: BODY })), 'undo', 'Mac Cmd 同权');
});

test('r5 · 键盘映射：无修饰键 / 其他键 / 输入框聚焦 → null（打字不拦截）', () => {
  assert.equal(weekKeyToAction(key({ key: 'z', target: BODY })), null);
  assert.equal(weekKeyToAction(key({ ctrlKey: true, key: 'a', target: BODY })), null);
  assert.equal(weekKeyToAction(key({ ctrlKey: true, key: 'z', target: INPUT })), null);
  assert.equal(weekKeyToAction(key({ ctrlKey: true, shiftKey: true, key: 'Z', target: INPUT })), null);
});

test('r5 · Toast 文案口径锁：撤销/重做回执不许顺手改写（既有口径）', () => {
  const src = readFileSync(join(here, '../src/features/week/weekEditActions.ts'), 'utf8');
  assert.ok(src.includes(`notify('info', '已撤销上一步改动')`), '撤销回执文案漂移');
  assert.ok(src.includes(`notify('info', '已重做')`), '重做回执文案漂移');
  assert.ok(src.includes(`{ label: '撤销', run: () => handleUndo() }`), '删除类 Toast 的撤销按钮构造漂移');
});

test('r5 · 视图接线锁：WeekPlanView 消费 useWeekEditActions（不再内联编排）', () => {
  const wv = readFileSync(join(here, '../src/features/week/WeekPlanView.tsx'), 'utf8');
  assert.ok(wv.includes('useWeekEditActions({ undoLayer, redoLayer, notify })'), '视图应改为消费下沉后的编排');
  assert.ok(!wv.includes("if (undoLayer()) notify('info', '已撤销上一步改动')"), '编排本体应已搬走（视图内联=回潮）');
});
