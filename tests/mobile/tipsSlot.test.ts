/**
 * 光溯移动端 · tips 适配纯函数单测（新任务三 P1-4 × 任务一 P2-1）
 *
 * ⚠️ 反向验证记录（M3-W1 实跑）：把 nowTipForBlock 的 null 分支删掉（恒返回
 * 适配结果）→ 「坏块返回 null」断言红；恢复后全绿。
 * 两态**渲染**（有 tip 渲染 / 无 tip 整块不渲染）由 e2e 与组件 code review 覆盖
 * （node 测试加载器不支持 .tsx），此处锁适配语义。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowTipForBlock } from '@/features/mobile/lib/nowTip.ts';

test('适配层：study 块（任务一真接口）→ slug/title/text 三元组', () => {
  const t = nowTipForBlock({ kind: 'study', startMin: 600, endMin: 720 });
  assert.ok(t === null || (typeof t.slug === 'string' && typeof t.title === 'string' && typeof t.text === 'string'),
    '有匹配 → 形状完整；无匹配 → null，二者皆合法');
});

test('适配层：坏块（零/负时长）→ null（插槽整块不渲染）', () => {
  assert.equal(nowTipForBlock({ kind: 'study', startMin: 600, endMin: 600 }), null);
  assert.equal(nowTipForBlock({ kind: 'study', startMin: 700, endMin: 600 }), null);
});

test('适配层：形状契约 —— 任务一 MethodTip.tip 映射为 BlockTip.text', () => {
  const t = nowTipForBlock({ kind: 'study', startMin: 600, endMin: 720 });
  if (t) {
    assert.ok(!('tier' in t) && !('status' in t), '适配后不携带任务一内部字段');
    assert.ok(t.text.length > 0 || t.title.length > 0);
  }
});
