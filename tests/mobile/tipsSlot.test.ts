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

test('适配层：study 块（任务一真接口）→ 必须给出 tip', () => {
  const t = nowTipForBlock({ kind: 'study', startMin: 600, endMin: 720 });
  // 🔴 2026-10-06 自验收修正：本断言原先写成
  //   `t === null || (...)` —— 「有匹配」与「无匹配」都算通过。
  //   结果 BlockKind 与 MethodBlockKind 枚举零重叠、tips 恒为 NULL 时，
  //   这个测试照样绿 —— **典型的假覆盖**（测自己、不测接线）。
  // 现在锁死：study 是最常见的块，必须能出 tip。
  assert.ok(t !== null, 'study 块必须给出 tip；若为 null 说明 BlockKind→MethodBlockKind 映射断了');
  assert.equal(typeof t!.slug, 'string');
  assert.ok(t!.slug.length > 0);
  assert.ok(t!.title.length > 0);
  assert.ok(t!.text.length > 0);
});

test('适配层：activity 块 → 必须给出 tip（第二个可映射的真实块类型）', () => {
  const t = nowTipForBlock({ kind: 'activity', startMin: 600, endMin: 660 });
  assert.ok(t !== null, 'activity 块应映射到 exercise 类目并给出 tip');
  assert.ok(t!.text.length > 0);
});

test('适配层：不该映射的块类型一律 null（宁缺毋滥，不硬凑）', () => {
  // course/meal/commute/blank 不是「怎么学习」类问题，
  // 硬给 tips 就是给方法论找错主顾 —— 这是设计决定，不是缺陷。
  for (const kind of ['course', 'meal', 'commute', 'blank'] as const) {
    assert.equal(nowTipForBlock({ kind, startMin: 600, endMin: 660 }), null, `${kind} 应为 null`);
  }
});

test('适配层：坏块（零/负时长）→ null（插槽整块不渲染）', () => {
  assert.equal(nowTipForBlock({ kind: 'study', startMin: 600, endMin: 600 }), null);
  assert.equal(nowTipForBlock({ kind: 'study', startMin: 700, endMin: 600 }), null);
});

test('适配层：形状契约 —— 任务一 MethodTip.tip 映射为 BlockTip.text', () => {
  const t = nowTipForBlock({ kind: 'study', startMin: 600, endMin: 720 });
  assert.ok(t);
  assert.ok(!('tier' in t!) && !('status' in t!), '适配后不携带任务一内部字段');
  assert.ok(t!.text.length > 0 || t!.title.length > 0);
});

test('适配层：未知块类型 → null（不崩、不猜）', () => {
  // 枚举未来扩展时，未登记的类型应安全降级为 null
  assert.equal(nowTipForBlock({ kind: 'future-unknown' as never, startMin: 600, endMin: 720 }), null);
});
