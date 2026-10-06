/**
 * 收官批次 6.3 · `methodTipForTimeBlock` 直测（时间块 → 方法论 tip 映射关键路径）
 * ============================================================
 * 背景：此前该方法只有 tests/mobile/tipsSlot.test.ts 一处**间接**守护（经 nowTip
 * 适配层），eval-tips / method_params_v2 对真实 BlockKind 断链不报警（方法库
 * 验收报告遗留 ④）。本文件直测 `src/lib/planner/methods.ts` 的公开入口。
 *
 * ⚠️ 反向验证（已实测）：
 *   · 把 `study: 'assignment'` 映射改成 null → 「显式映射」测试红；
 *   · 从 `BLOCK_KIND_TO_METHOD` 删掉任一 BlockKind 成员键 → 「映射表完整性」红；
 *   · 给未知 kind 返回 tip（不猜纪律破坏）→ 「未知 kind」测试红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { methodTipForTimeBlock, BLOCK_KIND_TO_METHOD } from '@/lib/planner/methods';
import type { BlockKind } from '@/types';

test('显式映射：study / activity → 有 tip（slug/title/tip/tier 形状完整）', () => {
  for (const kind of ['study', 'activity'] as const) {
    const tip = methodTipForTimeBlock(kind, { durationMin: 45 });
    assert.ok(tip, `${kind} 应有 tip`);
    assert.ok(tip.slug, 'slug 非空');
    assert.ok(tip.title, 'title 非空');
    assert.ok(tip.tip, 'tip 非空');
    assert.ok(tip.tier, 'tier 非空');
    assert.ok(['A', 'B', 'C', 'D'].includes(tip.tier), `tier 合法：${tip.tier}`);
  }
});

test('不映射的 BlockKind 一律 null（course/meal/commute/blank，宁缺毋滥）', () => {
  for (const kind of ['course', 'meal', 'commute', 'blank'] as const) {
    assert.equal(methodTipForTimeBlock(kind, { durationMin: 45 }), null, `${kind} 应为 null`);
  }
});

test('未知 kind → null（不崩、不猜、不硬凑）', () => {
  assert.equal(methodTipForTimeBlock('not-a-kind', { durationMin: 45 }), null);
});

test('映射表完整性：BlockKind 每个成员都在表里有键（新增 kind 漏映射即红）', () => {
  const kinds: BlockKind[] = ['course', 'meal', 'study', 'activity', 'commute', 'blank'];
  for (const k of kinds) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(BLOCK_KIND_TO_METHOD, k),
      `BlockKind「${k}」未在 BLOCK_KIND_TO_METHOD 登记 —— 新增块类型必须显式决定映射与否`,
    );
  }
});

test('时长不归本入口管：durationMin 非法/缺省时直入口仍返回 tip（守卫在 nowTip 适配层）', () => {
  // 直测裁决（2026-10-06 收官批次）：零/负时长 → 不渲染插槽的守卫在
  // `src/features/mobile/lib/nowTip.ts`（tipsSlot.test.ts 已锁）；本入口的
  // 契约是「kind 映射 + 不猜」，对时长只透传（JSDoc：缺省视为未知）。
  assert.ok(methodTipForTimeBlock('study', { durationMin: 0 }), '直入口不因时长为 0 返回 null');
  assert.ok(methodTipForTimeBlock('study', {}), '时长未知时照常给 tip');
});
