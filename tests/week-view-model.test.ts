/**
 * E 批 E4 · 周视图渲染模型验收（2026-09-28）
 * ============================================================
 * 判据：① L0 只留 `emoji+时刻+地点+通勤徽章`；② **估算转场必须带 ≈**（不把估算说成实测）；
 *       ③ 标题里已点名的地点不重复；④ issue 明细收成一句话 + 计数；⑤ L0 文本长度可量化。
 * 反向验证锚点（RV，删实现必红）：
 *   E4-RV1 ← transferChip 不再判估算 → 「估算带 ≈」用例红
 *   E4-RV2 ← placeLabel 不做「标题含地点则省略」→ 「不重复点名」用例红
 *   E4-RV3 ← summarizeIssues 不按 error 优先 → 「顶部取最严重」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TimeBlock } from '@/types';
import {
  blockChip, hhmm, l0Length, placeLabel, summarizeIssues, timeLabel, transferChip,
} from '@/features/week/weekViewModel';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

function block(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'w4-d1-study-1', kind: 'study', dayOfWeek: 1,
    startMin: 9 * 60, endMin: 10 * 60, title: '自习 · 图书馆',
    place: '图书馆（图文信息中心）', emoji: '📚', source: 'template',
    ...over,
  };
}

/* ---------------- ① 时间 ---------------- */

test('E4 时间: 时刻格式化（补零、四舍五入到分钟）', () => {
  assert.equal(hhmm(9 * 60 + 5), '09:05');
  assert.equal(hhmm(13 * 60), '13:00');
  assert.equal(timeLabel({ startMin: 8 * 60, endMin: 9 * 60 + 30 }), '08:00–09:30');
});

/* ---------------- ③ 地点不重复点名 ---------------- */

test('E4 地点: 标题里已点名的地点不重复显示；L0 用简写、全名留给 L1/L2', () => {
  assert.equal(placeLabel(block({ title: '图书馆（图文信息中心）自习' })), null, '标题已含地点全名 → 不重复');
  assert.equal(placeLabel(block({ title: '自习' })), '图书馆', '括号补充说明不进 L0（简写）');
  assert.equal(placeLabel(block({ title: '自习', room: '305' })), '图书馆 305');
  assert.equal(placeLabel(block({ place: undefined })), null);
  const c = blockChip(block({ title: '自习', room: '305' }));
  assert.equal(c.place, '图书馆 305', 'L0 简写');
  assert.equal(c.placeFull, '图书馆（图文信息中心） 305', '全名留给 L1/L2');
});

/* ---------------- ② 通勤徽章（含估算诚实标记） ---------------- */

test('E4 通勤: 实测不带 ≈，估算带 ≈ 且标 estimate', () => {
  const measured = transferChip(block({
    transfer: { fromPlace: '一食堂', toPlace: '图书馆（图文信息中心）', minutes: 8, slackMin: 12, tight: false, reliable: true, source: 'osm' },
  }));
  assert.equal(measured?.label, '🚶 8′');
  assert.equal(measured?.estimate, false);

  const estimated = transferChip(block({
    transfer: { fromPlace: '一食堂', toPlace: '图书馆（图文信息中心）', minutes: 17, slackMin: 2, tight: true, reliable: false, source: 'campus-estimate' },
  }));
  assert.equal(estimated?.label, '🚶 ≈17′', '估算必须带 ≈');
  assert.equal(estimated?.estimate, true);
  assert.equal(estimated?.tight, true);
  assert.match(estimated?.detail ?? '', /估算值/, '详情里也要说明是估算');

  // source 含 estimate 也要判成估算（不只认 reliable 字段）
  const bySource = transferChip(block({
    transfer: { fromPlace: 'a', toPlace: 'b', minutes: 6, slackMin: 30, tight: false, source: 'transfer-estimate' },
  }));
  assert.equal(bySource?.estimate, true);
  assert.equal(transferChip(block()), null, '没有转场信息就没有徽章');
});

/* ---------------- ① L0 模型 ---------------- */

test('E4 L0: 来源三态与校历事件标注；有内情才给「可点开」', () => {
  assert.equal(blockChip(block({ source: 'course', kind: 'course' })).sourceLabel, '课表');
  assert.equal(blockChip(block({ source: 'user' })).sourceLabel, '你自己加的');
  assert.equal(blockChip(block()).sourceLabel, '引擎自动安排');
  assert.match(blockChip(block({ source: 'template', fromEventId: 'ev-1' })).sourceLabel, /校历事件/);

  assert.equal(blockChip(block()).hasDetail, false, '没有 reason/转场/锁定 → 不给「点我」的错觉');
  assert.equal(blockChip(block({ reason: '为什么' })).hasDetail, true);
  assert.equal(blockChip(block({ locked: true })).hasDetail, true);
});

test('E4 L0: 文本长度可量化（典型块 ≤14 字宽，简写后达标）', () => {
  const withFullName = block({
    title: '自习',
    transfer: { fromPlace: '图书馆（图文信息中心）', toPlace: '第一食堂', minutes: 8, slackMin: 20, tight: false },
  });
  assert.ok(l0Length(withFullName) <= 14,
    `L0 应 ≤14 字宽（简写后），实际 ${l0Length(withFullName)}`);
  // 简写是达标的前提：去掉括号补充说明
  assert.equal(placeLabel(withFullName), '图书馆');
});

/* ---------------- ④ issue 聚合 ---------------- */

test('E4 issue: 顶部取最严重一条 + 计数，明细按 严重→警告→提示 排序', () => {
  const s = summarizeIssues([
    { level: 'info', message: '换地点会更顺' },
    { level: 'warn', message: '转场偏紧' },
    { level: 'error', message: '两门课时间重叠' },
  ]);
  assert.match(s.headline ?? '', /两门课时间重叠/);
  assert.match(s.headline ?? '', /另有 2 条/);
  assert.equal(s.errorCount, 1);
  assert.equal(s.warnCount, 1);
  assert.deepEqual(s.details, ['两门课时间重叠', '转场偏紧', '换地点会更顺']);
  assert.equal(summarizeIssues([]).headline, null);
});

/* ---------------- ⑤ 源码锁 ---------------- */

test('E4 源码锁: BlockCard 走渲染模型，散文式转场行已下线；时间轴有视觉重心与量测锚', () => {
  const wv = src('/src/features/week/WeekPlanView.tsx');
  assert.match(wv, /import \{ blockChip \} from '@\/features\/week\/weekViewModel'/, '模型已接线');
  assert.match(wv, /const chip = blockChip\(block\)/, '卡片用 chip');
  assert.ok(!wv.includes('🚶 {t.fromPlace}'), '旧的散文式转场行必须下线');
  assert.match(wv, /data-testid="week-timeline"/, '时间轴量测锚在位');
  assert.match(wv, /style=\{\{ minHeight: 'calc\(100vh - 280px\)' \}\}/, '浏览态时间轴撑满主体高度（视觉重心，内联 style 不碰既有类名断言）');
});
