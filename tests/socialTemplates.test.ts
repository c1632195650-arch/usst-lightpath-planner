/**
 * 社交类模板：画像里社交维度要有落点
 * ============================================================
 * 来源：原 `tests/lifeModeAndSocial.test.ts` 的后半部分。该文件前半测的是
 * 「生活模式」（PACE）—— 那套已于 2026-09-30 连同卡片一起移除（六个模式最终
 * 只等价于一个 `dailyStudyMin` 乘数），故本文件只保留社交模板这几条。
 *
 * 覆盖：画像里四个社交数据此前全闲置，现在至少要有模板能吃到它们 ——
 * 且必须**受画像触发约束**，不能对所有用户无条件排社交块。
 *
 * 零依赖：node:test + register.mjs 的 `@/` 钩子。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_TEMPLATES } from '@/lib/planner/templates';

test('模板: 已有社交类模板，且不再是一个都不缺', () => {
  const social = DEFAULT_TEMPLATES.filter((t) => t.category === 'social');
  assert.ok(social.length >= 2, `应当有至少 2 个社交类模板，实际 ${social.length}`);
});

test('模板: 社交模板受画像触发约束（不是无条件排）', () => {
  const social = DEFAULT_TEMPLATES.filter((t) => t.category === 'social');
  for (const t of social) {
    assert.ok(t.trigger, `社交模板「${t.name}」应当挂 trigger，否则会对所有用户都排`);
    assert.ok(
      ['social_radius', 'event_breadth'].includes(String(t.trigger.field)),
      `社交模板「${t.name}」的 trigger 应当来自社交相关字段，实际 ${String(t.trigger?.field)}`,
    );
  }
});

test('模板: 社交是独立类别（不与「取快递/夜宵」抢每日名额）', () => {
  const social = DEFAULT_TEMPLATES.filter((t) => t.category === 'social');
  assert.ok(social.every((t) => t.category !== 'life'),
    '若与 life 同类，社交名额会被取快递/夜宵挤掉');
});

test('模板: 社交模板默认参与自动排程（autoPlace 不为 false）', () => {
  const social = DEFAULT_TEMPLATES.filter((t) => t.category === 'social');
  assert.ok(social.every((t) => t.autoPlace !== false),
    '社交块应能被引擎自动排入，否则用户仍然看不到社交时间');
});
