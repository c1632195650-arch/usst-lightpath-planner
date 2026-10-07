/**
 * 一句话目标的截止短语解析（长计划增强计划书 · 「系统提议、用户拍板」）
 * ------------------------------------------------------------
 * 回答 RAY 的实测问题：「在10/31前彻底完成DAAD奖学金申请」输入后排程没变化 ——
 * 因为日期被当标题扔掉，目标走「每周 60 分钟」兜底。解析修好后：
 * dueAt 提取成功 → 目标走「节奏分解」路径（临近度增益 + 注水预算 + 顺势分）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseQuickGoal, repairQuickGoal, suggestTotalHours } from '@/features/activity/quickGoalParse';

const TODAY = '2026-10-07';

test('「在10/31前」→ dueAt=2026-10-31，标题剔除日期短语', () => {
  const r = parseQuickGoal('在10/31前彻底完成DAAD奖学金申请', TODAY);
  assert.equal(r.dueAt, '2026-10-31');
  assert.equal(r.title, '彻底完成DAAD奖学金申请');
});

test('「12月20日前交初稿」→ dueAt=2026-12-20', () => {
  const r = parseQuickGoal('12月20日前交初稿', TODAY);
  assert.equal(r.dueAt, '2026-12-20');
  assert.equal(r.title, '交初稿');
});

test('已过期的月日 → 顺延一年（10 月说「3月1日前」= 明年）', () => {
  const r = parseQuickGoal('在3月1日前跑完半马', TODAY);
  assert.equal(r.dueAt, '2027-03-01');
  assert.equal(r.title, '跑完半马');
});

test('无截止短语 → 原样返回（解析失败不挡路）', () => {
  const r = parseQuickGoal('学编程', TODAY);
  assert.equal(r.dueAt, undefined);
  assert.equal(r.title, '学编程');
});

test('非法日期（13月40日）→ 不猜，原样返回', () => {
  const r = parseQuickGoal('在13月40日前完成', TODAY);
  assert.equal(r.dueAt, undefined);
  assert.equal(r.title, '在13月40日前完成');
});

test('repairQuickGoal：存量老目标（标题带日期、缺字段）→ 自动补全 dueAt + 封顶总时长', () => {
  const legacy = { id: 'x', title: '在10/31前彻底完成DAAD奖学金申请', kind: 'study' };
  const r = repairQuickGoal(legacy, TODAY, { study: 40 });
  assert.equal(r.dueAt, '2026-10-31');
  assert.equal(r.title, '彻底完成DAAD奖学金申请');
  // 4 周截止 → min(经验值 40, 4×3h) = 12h（2026-10-07 RAY：40h 把空闲排满了）
  assert.equal((r as { totalHours?: number }).totalHours, 12);
});

test('repairQuickGoal：二段修补——totalHours 恰好=经验值（自动填的痕迹）→ 按新封顶重算', () => {
  const auto = { id: 'y', title: '彻底完成DAAD奖学金申请', dueAt: '2026-10-31', totalHours: 40, kind: 'study' };
  const r = repairQuickGoal(auto, TODAY, { study: 40 });
  assert.equal((r as { totalHours?: number }).totalHours, 12); // 4 周 × 3h
  // 用户手调过（≠经验值）→ 尊重，不动
  const tuned = { id: 'z', title: '彻底完成DAAD奖学金申请', dueAt: '2026-10-31', totalHours: 25, kind: 'study' };
  assert.equal((repairQuickGoal(tuned, TODAY, { study: 40 }) as { totalHours?: number }).totalHours, 25);
});

test('suggestTotalHours：按截止周数封顶（每周 3h），不让经验值填满日历', () => {
  assert.equal(suggestTotalHours('study', '2026-10-31', '2026-10-07', { study: 40 }), 12); // 4 周
  assert.equal(suggestTotalHours('study', '2026-10-14', '2026-10-07', { study: 40 }), 3); // 1 周 → min(40, 3)
  assert.equal(suggestTotalHours('habit', '2026-11-30', '2026-10-07', { habit: 30 }), 24); // 8 周 → min(30, 24)
});

test('repairQuickGoal：已有 dueAt / 标题无日期 → 一律不动（显式恒胜）', () => {
  const hasDue = { title: '随便', dueAt: '2026-12-01' };
  assert.equal(repairQuickGoal(hasDue, TODAY, { study: 40 }), hasDue);
  const noDate = { title: '学编程', kind: 'study' };
  const r = repairQuickGoal(noDate, TODAY, { study: 40 });
  assert.equal(r.dueAt, undefined);
  assert.equal((r as { totalHours?: number }).totalHours, undefined);
});
