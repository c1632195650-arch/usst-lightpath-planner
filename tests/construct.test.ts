/**
 * P1 构造阶段验收（T1.1 / AC-2 / AC-6 / AC-9）
 * ============================================================
 * 依据：规格书 §9-T1.1、§6.4（语义键 id）、§10.1 AC-2 / AC-6 / AC-9。
 *
 * 三条硬结论：
 *   ① **构造等价**：`construct` 的块内容 == 冻结的 golden 快照（逐块，id 不参与）
 *   ② **id 已改语义键**：匹配 `w{week}-d{day}-{kind}-{语义键}` 且**不含时间片段**
 *   ③ **确定性**：同一输入连续两次运行，输出逐字节相同
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Course, CourseTimeSlot, PhasePolicy, Schedule } from '@/types';
import { construct } from '@/lib/planner/construct.ts';
import {
  BLOCK_ID_RE, BLOCK_ID_TIME_FRAGMENT_RE, isSemanticBlockId, semanticKeyOf,
} from '@/lib/planner/model.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';
import { diffJson, normalizePlan } from './golden-lib.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { findDepsCycle } from '@/lib/planner/solver.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, 'golden');

/* ============================================================
 * 一、AC-2 构造等价（对照冻结快照）
 * ========================================================== */

test('AC-2：construct 的块内容与冻结快照逐块一致（id 不参与）', () => {
  for (const g of GOLDEN_INPUTS) {
    const file = join(GOLDEN_DIR, `${g.name}.json`);
    if (!existsSync(file)) {
      assert.fail(`缺少快照 ${g.name}.json —— 先跑 golden-snapshot.ts`);
    }
    const snap = JSON.parse(readFileSync(file, 'utf8')) as { blocks: unknown };
    const { plan } = construct(toPlanRequest(buildGoldenInput(g)));
    const drift = diffJson(normalizePlan(plan), snap.blocks);
    assert.equal(drift, null, `${g.name} 构造不等价：\n${drift}`);
  }
});

/* ============================================================
 * 二、id 规则（§6.4）
 * ========================================================== */

test('id 全部为语义键形状，且不含「3-4 位数字被连字符夹住」的时间片段', () => {
  for (const g of GOLDEN_INPUTS) {
    const { plan } = construct(toPlanRequest(buildGoldenInput(g)));
    for (const b of plan.blocks) {
      assert.match(b.id, BLOCK_ID_RE, `${g.name} 的 id 形状不合规：${b.id}`);
      assert.ok(
        !BLOCK_ID_TIME_FRAGMENT_RE.test(b.id),
        `${g.name} 的 id 含时间片段（旧规则残留）：${b.id}`,
      );
      assert.ok(isSemanticBlockId(b.id), `isSemanticBlockId 判否：${b.id}`);
    }
  }
});

test('语义键就是「块的固有身份」：课程 {courseId}p{period} / 三餐 {mealId} / 自习 {tplId}-{n}', () => {
  const g = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
  assert.ok(g);
  const { plan } = construct(toPlanRequest(buildGoldenInput(g)));

  // 周一有 c1（1-2 节）与 c2（3-5 节）
  const c1 = plan.blocks.find((b) => b.courseId === 'c1' && b.dayOfWeek === 1);
  assert.ok(c1, '找不到周一的 c1');
  assert.equal(semanticKeyOf(c1.id), 'c1p1');

  const meal = plan.blocks.find((b) => b.kind === 'meal' && b.dayOfWeek === 1);
  assert.ok(meal, '周一没有排到饭');
  assert.ok(['breakfast', 'lunch', 'dinner'].includes(semanticKeyOf(meal.id) ?? ''),
    `meal 的语义键应是 mealId，实际 ${meal.id}`);

  const study = plan.blocks.find((b) => b.kind === 'study');
  assert.ok(study, '没有自习块');
  assert.match(semanticKeyOf(study.id) ?? '', /^.+-\d+$/, `study 语义键应是 {tplId}-{n}，实际 ${study.id}`);
});

/* ============================================================
 * 三、AC-6 确定性
 * ========================================================== */

test('AC-6：同一输入连续两次 construct，输出逐字节相同', () => {
  for (const g of GOLDEN_INPUTS) {
    const req = toPlanRequest(buildGoldenInput(g));
    const a = JSON.stringify(construct(req));
    const b = JSON.stringify(construct(req));
    assert.equal(a, b, `${g.name} 两次运行结果不同（非确定性）`);
  }
});

/* ============================================================
 * 四、提交项（commits）：固定落点 / 窗口 / 依赖
 * ========================================================== */

function slot(dayOfWeek: CourseTimeSlot['dayOfWeek'], s: number, e: number): CourseTimeSlot {
  return { dayOfWeek, startPeriod: s, endPeriod: e, weeks: [] };
}
function course(id: string, name: string, building: string | undefined, slots: CourseTimeSlot[]): Course {
  return { id, name, credit: 2, category: '公共基础', campus: 'JG516', building, slots };
}
const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 20,
  source: 'demo',
  courses: [course('c1', '大学物理', '第一教学楼', [slot(1, 1, 2)])],
};
const POLICY: PhasePolicy = {
  dailyStudyMin: 0, maxBlockMin: 60, blankRatio: 0.1,
  eveningAllowed: true, weekendWork: false, studyPlaces: [],
};

test('提交项：pinned 的落点被严格尊重', () => {
  const { plan } = construct({
    schedule: SCHEDULE, weekNo: 4, policy: POLICY, commits: [{
      id: 'cm-pin', title: '小组会议', kind: 'activity', effortMin: 60,
      pinned: { dayOfWeek: 3, startMin: 14 * 60 },
    }],
  });
  const b = plan.blocks.find((x) => x.id === 'w4-d3-activity-cm-pin');
  assert.ok(b, `没排上 pinned 提交项：${plan.blocks.map((x) => x.id).join(',')}`);
  assert.equal(b.startMin, 14 * 60);
  assert.equal(b.endMin, 15 * 60);
  assert.equal(b.locked, true);
});

test('AC-9 依赖满足：后驱不早于前驱结束', () => {
  const { plan } = construct({
    schedule: SCHEDULE, weekNo: 4, policy: POLICY, commits: [
      { id: 'A', title: '先写提纲', kind: 'activity', effortMin: 60 },
      { id: 'B', title: '再写正文', kind: 'activity', effortMin: 60, deps: ['A'] },
    ],
  });
  const a = plan.blocks.find((x) => x.id === 'w4-d1-activity-A');
  const b = plan.blocks.find((x) => x.id === 'w4-d1-activity-B');
  assert.ok(a && b, '两个提交项都要排上');
  assert.ok(b.startMin >= a.endMin, `依赖不满足：A 结束 ${a.endMin} > B 开始 ${b.startMin}`);
  assert.match(b.reason ?? '', /要等/, `B 的理由应说明「在等谁」，实际：${b.reason}`);
});

test('提交项 window：只在给定窗口内落点', () => {
  const { plan } = construct({
    schedule: SCHEDULE, weekNo: 4, policy: POLICY, commits: [{
      id: 'cm-night', title: '晚间跑步', kind: 'activity', effortMin: 30,
      window: { fromMin: 20 * 60, toMin: 22 * 60 },
    }],
  });
  const b = plan.blocks.find((x) => x.id === 'w4-d1-activity-cm-night');
  assert.ok(b, '没排上带窗口的提交项');
  assert.ok(b.startMin >= 20 * 60, `落在窗口之前：${b.startMin}`);
});

test('依赖成环能被检出（§5.1「有环报 error 并降级」）', () => {
  const cycle = findDepsCycle([
    { id: 'X', title: 'x', kind: 'activity', effortMin: 30, deps: ['Y'] },
    { id: 'Y', title: 'y', kind: 'activity', effortMin: 30, deps: ['X'] },
  ]);
  assert.ok(cycle && cycle.length >= 2, '环没被检出');
  assert.equal(findDepsCycle([
    { id: 'A', title: 'a', kind: 'activity', effortMin: 30 },
    { id: 'B', title: 'b', kind: 'activity', effortMin: 30, deps: ['A'] },
  ]), null, '无环却报环');
});
