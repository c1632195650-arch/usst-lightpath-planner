/**
 * 评估接线层单测（2026-10-06 验收缺陷①修复的守护）
 * ============================================================
 * 缺陷①：completionUnits 为「装 App 之前」的日子虚构 done=false 单元 →
 * spanDaysFrom 恒 7 → 冷启动恒得 confident 0%（违反铁律 2：unknown 不降级 gap）。
 * 修法：接线层用 `inUseDays(days, firstEventDayKey(events))` 截断统计窗——
 * 只统计「首个行为事件当天起」的日子。本文件锁三层：
 *   ① 纯函数 inUseDays / firstEventDayKey 的口径；
 *   ② 端到端冷启动场景（plan 覆盖 7 天 + 零事件 → 必须累积中，绝不 0%）；
 *   ③ 修复不破坏合法路径（真用满 7 天 → confident，值正确）。
 * ⚠️ 反向验证（实跑见 overnight-log）：把 inUseDays 改成原样返回 days → ② 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeBlock, WeekPlan } from '@/types';
import type { UserPlanLayer } from '@/features/week/userPlanStore';
import { completionRate } from '@/features/mobile/eval/compute.ts';
import { completionUnits, inUseDays } from '@/features/mobile/eval/units.ts';
import { firstEventDayKey, type BehaviorEvent } from '@/features/mobile/eval/behaviorLog.ts';

const TODAY = '2026-10-06';
const TERM_START = '2026-09-07'; // 周一锚点；2026-10-06 落第 5 周

function windowDays(today: string): string[] {
  const out: string[] = [];
  const t = new Date(`${today}T00:00:00`);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(t);
    d.setDate(d.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

function blk(id: string, dow: number): TimeBlock {
  return { id, kind: 'study', dayOfWeek: dow, startMin: 600, endMin: 660, title: '自习', source: 'template' } as TimeBlock;
}

/** 一周 7 天每天都有块的 plan（缺陷场景的最小复现：分母覆盖全窗口） */
function fullWeekPlan(): WeekPlan {
  return {
    weekNo: 5,
    blocks: Array.from({ length: 7 }, (_, i) => blk(`w5-d${i + 1}-study-x`, i + 1)),
    stats: { courseMin: 0, studyMin: 420, blankMin: 0, blockCount: 7 },
    issues: [],
  };
}

const EMPTY_LAYER = {
  schemaVersion: 2, tasks: [], excluded: [], moves: [], slots: [],
  courseOverrides: [], mealPlaces: {}, assignments: [],
} as unknown as UserPlanLayer;

function ev(dayKey: string, blockId = 'w5-d2-study-x'): BehaviorEvent {
  return { t: `${dayKey}T01:00:00.000Z`, dayKey, type: 'block_done', blockId, kind: 'study', plannedStartMin: 600, checkedMin: 602 };
}

/* ---------- ① firstEventDayKey ---------- */

test('firstEventDayKey：无事件 → null；多事件取最早；脏 dayKey 忽略', () => {
  assert.equal(firstEventDayKey([]), null);
  assert.equal(firstEventDayKey([ev('2026-10-04'), ev('2026-10-02'), ev('2026-10-05')]), '2026-10-02');
  assert.equal(
    firstEventDayKey([{ ...ev('2026-10-04'), dayKey: 'garbage' }, ev('2026-10-03')]),
    '2026-10-03',
    '脏 dayKey 不参与取最小',
  );
  assert.equal(firstEventDayKey([{ ...ev('2026-10-04'), dayKey: 'garbage' }]), null, '全脏 → null');
});

/* ---------- ② inUseDays ---------- */

test('inUseDays：冷启动（无锚点）→ 空数组，一天都不虚构', () => {
  assert.deepEqual(inUseDays(windowDays(TODAY), null), []);
});

test('inUseDays：首事件在窗中间 → 从该日起（含）；首事件=窗首 → 全窗', () => {
  const days = windowDays(TODAY); // 09-30..10-06
  assert.deepEqual(inUseDays(days, '2026-10-04'), ['2026-10-04', '2026-10-05', '2026-10-06']);
  assert.deepEqual(inUseDays(days, days[0]), days);
  assert.deepEqual(inUseDays(days, '2026-09-01'), days, '锚点早于窗 → 全窗');
});

test('inUseDays：脏锚点/脏日子不猜——锚点非法返回空，非法日不进统计', () => {
  assert.deepEqual(inUseDays(windowDays(TODAY), 'yesterday'), []);
  assert.deepEqual(inUseDays(['2026-10-05', 'bad-date', '2026-10-06'], '2026-10-05'), ['2026-10-05', '2026-10-06']);
});

/* ---------- ③ 端到端：缺陷场景必须「累积中」，合法路径不受影响 ---------- */

test('端到端（缺陷①复现）：plan 覆盖 7 天 + 零行为事件 → 累积中，绝不 0%', () => {
  const days = inUseDays(windowDays(TODAY), firstEventDayKey([]));
  const units = completionUnits({
    plan: fullWeekPlan(), layer: EMPTY_LAYER, termStart: TERM_START,
    days, doneKeys: new Set<string>(),
  });
  assert.equal(units.length, 0, '冷启动不虚构任何单元');
  const r = completionRate(units, TODAY);
  assert.equal(r.confident, false, '铁律 2：冷启动必须 unknown/累积中');
  assert.equal(r.value, null, '不给 0 分');
});

test('端到端：首事件在窗中间 → 只统计在用日子，样本跨度 N/7，仍累积中', () => {
  const days = inUseDays(windowDays(TODAY), firstEventDayKey([ev('2026-10-04')]));
  const doneKeys = new Set(['2026-10-04#w5-d2-study-x']);
  const units = completionUnits({
    plan: fullWeekPlan(), layer: EMPTY_LAYER, termStart: TERM_START,
    days, doneKeys,
  });
  assert.equal(units.length, 3, '10-04..10-06 各一块');
  const r = completionRate(units, TODAY);
  assert.equal(r.confident, false, '跨度 3 < 7 → 累积中（3/7 天）');
  assert.equal(r.sampleSize, 3);
});

test('端到端：真用满 7 天（有勾有漏）→ confident，值如实（修复不误伤合法路径）', () => {
  const days = windowDays(TODAY);
  const doneKeys = new Set<string>();
  for (const d of days.slice(0, 6)) {
    const dow = ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    doneKeys.add(`${d}#w5-d${dow}-study-x`); // 每天 block id 随 dow 不同
  }
  const units = completionUnits({
    plan: fullWeekPlan(), layer: EMPTY_LAYER, termStart: TERM_START,
    days, doneKeys,
  });
  const r = completionRate(units, TODAY);
  assert.equal(r.confident, true);
  if (r.confident) assert.equal(r.value, Math.round((100 * 6) / 7));
});
