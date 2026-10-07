/**
 * 目标池（孵化池）单测
 * ============================================================
 * 覆盖三块纯逻辑（存储与 UI 不在此测）：
 *   1. 条目操作：addEntry / patchEntry / archiveEntry 的不可变性与幂等
 *   2. 粗交期解析 plannedDoneToISO：旬末取日（含平月截断）、坏输入拒绝
 *   3. 转正构建 buildGoalFromEntry：category→kind 推导、截止→首个里程碑、
 *      可选字段透传、promotedGoalId 溯源标记
 * 时钟一律 nowIso 入参 —— 纯函数不读时钟（与引擎同纪律）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEntry, patchEntry, archiveEntry, incubatingEntries,
  plannedDoneToISO, buildGoalFromEntry, makeEntryId,
  type PoolEntry,
} from '@/features/activity/goalPoolStore';

const NOW = '2026-10-07T08:00:00.000Z';

function entry(over: Partial<PoolEntry> & Pick<PoolEntry, 'title'>): PoolEntry {
  return {
    id: makeEntryId(), source: 'manual', createdAt: NOW,
    ...over,
  } as PoolEntry;
}

/* ── 1. 条目操作 ─────────────────────────────── */

test('addEntry 追加不改动原列表（不可变）', () => {
  const a = entry({ title: '学吉他' });
  const before: PoolEntry[] = [];
  const list = addEntry(before, a);
  assert.equal(list.length, 1);
  assert.equal(before.length, 0, '原列表不得被改动');
  assert.notEqual(list, before, '必须返回新数组');
});

test('patchEntry 只改目标条目并刷新 updatedAt', () => {
  const a = entry({ title: '学吉他' });
  const b = entry({ title: '考驾照' });
  const list = patchEntry([a, b], a.id, { note: '民谣弹唱', plannedDone: '2026-12-中旬' }, NOW);
  assert.equal(list[0].note, '民谣弹唱');
  assert.equal(list[0].updatedAt, NOW);
  assert.equal(list[1].updatedAt, undefined, '未命中的条目不动');
});

test('archiveEntry 幂等：重复归档不产生新对象', () => {
  const a = entry({ title: '学吉他' });
  const once = archiveEntry([a], a.id, NOW);
  const twice = archiveEntry(once, a.id, NOW);
  assert.equal(once[0].archived, true);
  assert.equal(twice[0], once[0], '第二次归档应原样返回同一对象');
});

test('incubatingEntries 排除已转正与已归档', () => {
  const fresh = entry({ title: 'A' });
  const promoted = entry({ title: 'B', promotedGoalId: 'gl-x' });
  const archived = entry({ title: 'C', archived: true });
  const out = incubatingEntries([fresh, promoted, archived]);
  assert.deepEqual(out.map((e) => e.title), ['A']);
});

/* ── 2. 粗交期解析 ───────────────────────────── */

test('plannedDoneToISO：上旬=10日、中旬=20日、下旬=当月最后一天', () => {
  assert.equal(plannedDoneToISO('2026-09-上旬'), '2026-09-10');
  assert.equal(plannedDoneToISO('2026-09-中旬'), '2026-09-20');
  assert.equal(plannedDoneToISO('2026-09-下旬'), '2026-09-30');
  assert.equal(plannedDoneToISO('2026-02-下旬'), '2026-02-28', '平月截断');
  assert.equal(plannedDoneToISO('2024-02-下旬'), '2024-02-29', '闰月截断');
});

test('plannedDoneToISO：坏输入一律 null，不让脏数据进表单', () => {
  assert.equal(plannedDoneToISO(''), null);
  assert.equal(plannedDoneToISO('2026-9-中旬'), null);
  assert.equal(plannedDoneToISO('2026-13-中旬'), null);
  assert.equal(plannedDoneToISO('随便写写'), null);
});

/* ── 3. 转正构建 ─────────────────────────────── */

test('buildGoalFromEntry：category 推导 kind 与 emoji，dueAt 生成首个里程碑', () => {
  const e = entry({ title: '数学建模省一', plannedDone: '2026-11-中旬' });
  const { goal, entry: patched } = buildGoalFromEntry(e, {
    category: 'contest', dueAt: '2026-11-20', totalHours: 60, pace: 'sprint', nowIso: NOW,
  }, 'gl-test-1');
  assert.equal(goal.kind, 'contest', 'contest 类直接映射 contest');
  assert.equal(goal.category, 'contest');
  assert.equal(goal.title, '数学建模省一');
  assert.equal(goal.totalHours, 60);
  assert.equal(goal.pace, 'sprint');
  assert.equal(goal.status, 'active');
  assert.deepEqual(goal.milestones, [{ id: 'ms-gl-test-1', title: '截止', dueAt: '2026-11-20' }]);
  assert.equal(patched.promotedGoalId, 'gl-test-1');
  assert.equal(patched.promotedAt, NOW);
  assert.equal(patched.updatedAt, NOW);
});

test('buildGoalFromEntry：无截止时不生成里程碑，可选字段缺省不落', () => {
  const e = entry({ title: '学吉他' });
  const { goal } = buildGoalFromEntry(e, { category: 'skill', nowIso: NOW }, 'gl-test-2');
  assert.equal(goal.kind, 'study', 'skill 类按 CATEGORY_TO_KIND 推导为 study（单一真源在 goalStore）');
  assert.equal(goal.category, 'skill');
  assert.equal(goal.milestones, undefined);
  assert.equal(goal.dueAt, undefined);
  assert.equal(goal.totalHours, undefined);
  assert.equal(goal.pace, undefined);
});

test('buildGoalFromEntry：totalHours 非法值（0 / 负数）不落库', () => {
  const e = entry({ title: '学吉他' });
  const { goal } = buildGoalFromEntry(e, { category: 'skill', totalHours: 0, nowIso: NOW }, 'gl-test-3');
  assert.equal(goal.totalHours, undefined);
});
