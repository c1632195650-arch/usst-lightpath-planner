/**
 * 排程引擎 v2 · P0 验收脚本（断言式，只读仓库、不写任何文件）
 * ============================================================
 * 依据：`排程引擎-v2-技术规格书.md` §9（P0 任务）+ §10（验收标准）。
 *
 * 跑法：
 *   cd usst-lightpath-planner
 *   node --import ./tests/register.mjs tests/p0-check.ts
 *
 * 退出码：全部通过 = 0；有失败 = 1（可直接接 CI）。
 *
 * 迁移历史：原在仓库外 `_devtools/p0-check.ts`（用仓库外钩子 + 写死的工作区绝对路径）。
 * 2026-09-15 按 CY 意见迁入 `tests/`：路径由**本文件位置**推导，任何机器 clone 后可直接跑。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUILTIN_PLACES, campusFromLabel, campusOfPlace, findPlaceConflicts,
  mergePlaces, placesFromCampusMap, resolvePlace,
} from '@/lib/planner/places';
import {
  collectDeadlineBoosts, effectiveEffortMin, sortCommits, sortKey,
  urgency, urgencyBoostForWeek, weekNoOfDate, type DeadlineLike,
} from '@/lib/planner/objective';
import {
  DEFAULT_WEIGHTS, churnCost, churnMinutes, emptyRollingState,
  lockFactorOf, resolveLockLevel, type Commit,
} from '@/lib/planner/model';
import { buildWeekPlan, campusFallbackTransfer, campusOfName } from '@/lib/planner/schedule';
import { DEADLINES, MOCK_SCHEDULE } from '@/data/usst';
import type { PhasePolicy, Schedule, TimeBlock, WeekPlan } from '@/types';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // <repo>/tests
const REPO = path.join(HERE, '..');                        // <repo>

/* ---------------- 迷你测试框架 ---------------- */
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name} — ${msg}`);
    console.log(`  \u2717 ${name}\n      ${msg}`);
  }
}

/* ---------------- 构造工具 ---------------- */
const mkCommit = (over: Partial<Commit>): Commit => ({
  id: 'c1', title: 'T', kind: 'activity', effortMin: 60, ...over,
});

const mkBlock = (over: Partial<TimeBlock>): TimeBlock => ({
  id: 'b1', kind: 'study', dayOfWeek: 1, startMin: 600, endMin: 660,
  title: 'x', source: 'template', ...over,
});

const mkPlan = (blocks: TimeBlock[]): WeekPlan => ({
  weekNo: 1, blocks,
  stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length },
  issues: [],
});

/* ============================================================
 * T0.1 显式地点表
 * ========================================================== */
console.log('\n[T0.1] 显式地点表 places.ts');

check('BUILTIN_PLACES 非空，且每个地点都有确定校区（无 UNKNOWN）', () => {
  assert.ok(BUILTIN_PLACES.length > 0, '地点表为空');
  const bad = BUILTIN_PLACES.filter((p) => p.campus === 'UNKNOWN');
  assert.equal(bad.length, 0, `存在 UNKNOWN 校区：${bad.map((b) => b.name).join('、')}`);
});

check('地点 id 唯一，且索引可按 id 与 name 双向命中', () => {
  const ids = BUILTIN_PLACES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id 有重复');
  for (const p of BUILTIN_PLACES) {
    assert.equal(resolvePlace(p.id)?.name, p.name, `按 id 查不到 ${p.name}`);
    assert.equal(resolvePlace(p.name)?.id, p.id, `按 name 查不到 ${p.name}`);
  }
});

check('未登记地点 → null（不再默认北校，修旧问题 #9）', () => {
  assert.equal(resolvePlace('霍格沃茨城堡'), null);
  assert.equal(campusOfPlace('霍格沃茨城堡'), null);
});

check('campusOfName 命中失败返回 null（关键字仍生效）', () => {
  assert.equal(campusOfName('图书馆（图文信息中心）'), null, '未识别地点应返回 null');
  assert.equal(campusOfName('国合楼'), 'JG334', '关键字命中应保留');
});

check('campusFromLabel 映射正确', () => {
  assert.equal(campusFromLabel('北校'), 'JG516');
  assert.equal(campusFromLabel('南校'), 'JG334');
  assert.equal(campusFromLabel('1100'), 'JG1100');
  assert.equal(campusFromLabel('580'), 'JG516');
  assert.equal(campusFromLabel('连接'), 'UNKNOWN');
});

check('placesFromCampusMap 能解析真实 campus_map.json，且无 UNKNOWN', () => {
  const f = path.join(REPO, 'data', 'campus_map.json');
  if (!existsSync(f)) throw new Error('campus_map.json 不存在，无法验证');
  const map = JSON.parse(readFileSync(f, 'utf8')) as Parameters<typeof placesFromCampusMap>[0];
  const places = placesFromCampusMap(map);
  assert.ok(places.length >= 100, `只解析出 ${places.length} 条 POI（预期 ≥100）`);
  const bad = places.filter((p) => p.campus === 'UNKNOWN');
  assert.equal(bad.length, 0, `存在 UNKNOWN：${bad.map((b) => b.name).join('、')}`);
});

check('mergePlaces 只补缺、不覆盖已有校区', () => {
  const merged = mergePlaces(
    [{ id: 'x', name: 'A', campus: 'JG334', hours: [] }],
    [{ id: 'y', name: 'A', campus: 'JG516', hours: [{ startMin: 0, endMin: 60 }] }],
  );
  const a = merged.find((p) => p.name === 'A');
  assert.ok(a, 'A 丢了');
  assert.equal(a!.campus, 'JG334', 'overlay 不该覆盖 base 的校区');
  assert.equal(a!.hours.length, 1, 'hours 空缺应被补上');
});

/* ============================================================
 * T0.2 交期与紧迫度
 * ========================================================== */
console.log('\n[T0.2] 交期接入与紧迫度 objective.ts');

check('无交期 → urgency = 0', () => {
  assert.equal(urgency(mkCommit({}), 5, 1000), 0);
});

check('交期已过 → urgency = 1.0', () => {
  assert.equal(urgency(mkCommit({ dueAt: { weekNo: 3, dayOfWeek: 1, min: 600 } }), 5, 1000), 1.0);
});

check('剩余产能不足以覆盖 effort → urgency = 0.9', () => {
  const c = mkCommit({ effortMin: 120, dueAt: { weekNo: 6, dayOfWeek: 3, min: 600 } });
  assert.equal(urgency(c, 5, 30), 0.9);
});

check('交期越近，紧迫度越高', () => {
  const near = mkCommit({ id: 'n', dueAt: { weekNo: 5, dayOfWeek: 5, min: 600 } });
  const far = mkCommit({ id: 'f', dueAt: { weekNo: 7, dayOfWeek: 5, min: 600 } });
  assert.ok(urgency(near, 5, 1000) > urgency(far, 5, 1000));
});

check('同优先级下，有交期的排序键更高（构造顺序由它决定）', () => {
  const withDue = mkCommit({ id: 'a', priority: 90, dueAt: { weekNo: 5, dayOfWeek: 4, min: 600 } });
  const noDue = mkCommit({ id: 'b', priority: 90 });
  assert.ok(sortKey(withDue, 5, 1000) > sortKey(noDue, 5, 1000));
  assert.equal(sortCommits([noDue, withDue], 5, 1000)[0].id, 'a');
});

check('effectiveEffortMin 兜底 = effort*0.7 且向下取 5 的倍数', () => {
  assert.equal(effectiveEffortMin(mkCommit({ effortMin: 90 })), 60);
  assert.equal(effectiveEffortMin(mkCommit({ effortMin: 90, minAcceptableMin: 40 })), 40);
});

check('weekNoOfDate 正确换算，非法输入返回 null', () => {
  assert.equal(weekNoOfDate('2026-08-31', '2026-08-31'), 1);
  assert.equal(weekNoOfDate('2026-09-07', '2026-08-31'), 2);
  assert.equal(weekNoOfDate('无法解析', '2026-08-31'), null);
});

check('DEADLINES + Course.examDate → 周次加成；学期外节点被丢弃', () => {
  const boosts = collectDeadlineBoosts({
    termStart: MOCK_SCHEDULE.termStart,
    totalWeeks: MOCK_SCHEDULE.totalWeeks,
    deadlines: DEADLINES as DeadlineLike[],
    courses: MOCK_SCHEDULE.courses,
  });
  assert.ok(boosts.length > 0, '没有解析出任何时间节点');
  for (const b of boosts) {
    assert.ok(b.weekNo >= 1 && b.weekNo <= MOCK_SCHEDULE.totalWeeks,
      `${b.title} 落在学期外（第 ${b.weekNo} 周）`);
    assert.ok(b.weight > 0 && b.weight <= 1);
  }
  assert.ok(boosts.some((b) => b.title.includes('期中')), '期中考试周没进来');
});

check('临近节点的加成更高、过远为 0', () => {
  const synthetic = [{ id: 'x', title: '考试', weekNo: 10, weight: 1.0, source: 'campus' as const }];
  assert.ok(urgencyBoostForWeek(synthetic, 10) > 0);
  assert.ok(urgencyBoostForWeek(synthetic, 9) > 0);
  assert.equal(urgencyBoostForWeek(synthetic, 1), 0, '太远不该加成');
  assert.equal(urgencyBoostForWeek(synthetic, 12), 0, '已过不该加成');
});

/* ============================================================
 * T0.3 三级锁与 churn 预留
 * ========================================================== */
console.log('\n[T0.3] 三级锁与 churn（model.ts）');

check('课程/用户块默认 hard，模板块默认 free', () => {
  assert.equal(resolveLockLevel(mkBlock({ source: 'course' })), 'hard');
  assert.equal(resolveLockLevel(mkBlock({ source: 'user' })), 'hard');
  assert.equal(resolveLockLevel(mkBlock({ source: 'template' })), 'free');
  assert.equal(resolveLockLevel(mkBlock({ source: 'template', locked: true })), 'hard');
});

check('显式 lockLevels 覆盖默认推断', () => {
  assert.equal(resolveLockLevel(mkBlock({ id: 'k', source: 'course' }), { k: 'soft' }), 'soft');
  assert.equal(resolveLockLevel(mkBlock({ id: 'k', source: 'template' }), { k: 'hard' }), 'hard');
});

// ⚠️ 2026-09-19 规格 §5.5 修订：free 由 0 改为 FREE_CHURN_FACTOR(0.08)
//    —— 原值让 churn 代价恒为 0，「最小扰动」失去驱动力。
check('lockFactorOf: hard=100 / soft=1 / free=0.08', () => {
  assert.equal(lockFactorOf('hard'), 100);
  assert.equal(lockFactorOf('soft'), 1);
  assert.equal(lockFactorOf('free'), 0.08);
});

check('同一份计划 churn = 0', () => {
  const plan = mkPlan([mkBlock({})]);
  assert.equal(churnMinutes(plan, plan), 0);
  assert.equal(churnCost(plan, plan, {}, DEFAULT_WEIGHTS), 0);
});

check('移动 free 块不计 churn 代价；移动 hard 块代价极大（≈禁止）', () => {
  const a = mkPlan([mkBlock({ id: 'f', source: 'template', startMin: 600, endMin: 660 })]);
  const b = mkPlan([mkBlock({ id: 'f', source: 'template', startMin: 700, endMin: 760 })]);
  assert.equal(churnCost(a, b, {}, DEFAULT_WEIGHTS), 0, 'free 块移动不该有代价');
  assert.equal(churnMinutes(a, b), 60, 'churnMin 应记为 60');

  const c = mkPlan([mkBlock({ id: 'h', source: 'course', startMin: 600, endMin: 660 })]);
  const d = mkPlan([mkBlock({ id: 'h', source: 'course', startMin: 700, endMin: 760 })]);
  const cost = churnCost(c, d, {}, DEFAULT_WEIGHTS);
  assert.ok(cost >= DEFAULT_WEIGHTS.churn * 100 * 60, `hard 块代价过小：${cost}`);
});

check('soft 块移动代价 = churn 权重 × 时长', () => {
  const a = mkPlan([mkBlock({ id: 's', source: 'template', startMin: 600, endMin: 660 })]);
  const b = mkPlan([mkBlock({ id: 's', source: 'template', startMin: 700, endMin: 760 })]);
  assert.equal(churnCost(a, b, { s: 'soft' }, DEFAULT_WEIGHTS), DEFAULT_WEIGHTS.churn * 60);
});

check('emptyRollingState 结构正确', () => {
  const r = emptyRollingState();
  assert.deepEqual(r.recentLoad, []);
  assert.deepEqual(r.upcoming, []);
  assert.equal(r.loadByDow.length, 8);
});

/* ============================================================
 * T0.4 文案与数据治理
 * ========================================================== */
console.log('\n[T0.4] 文案与数据治理（schedule.ts）');

const eveningSchedule: Schedule = {
  semesterName: 'P0 验收用学期',
  semesterType: 'autumn',
  termStart: '2026-08-31',
  totalWeeks: 20,
  source: 'manual',
  courses: [
    {
      id: 'c-eve', name: '晚间实验', credit: 1, category: '实践环节',
      campus: 'JG516', building: '第三教学楼', room: '101',
      slots: [{ dayOfWeek: 2, startPeriod: 11, endPeriod: 13, weeks: [] }],
    },
    {
      id: 'c-noplace', name: '无地点讲座', credit: 1, category: '通识选修',
      campus: 'JG516', room: '',
      slots: [{ dayOfWeek: 4, startPeriod: 9, endPeriod: 10, weeks: [] }],
    },
  ],
};

const eveningPolicy: PhasePolicy = {
  dailyStudyMin: 90, maxBlockMin: 45, blankRatio: 0.4,
  eveningAllowed: false, weekendWork: false, studyPlaces: [],
};

const res = buildWeekPlan({
  schedule: eveningSchedule, weekNo: 1, policy: eveningPolicy,
  transfer: campusFallbackTransfer,
});

check('有晚课 + eveningAllowed=false → 文案不自相矛盾', () => {
  const all = res.notes.join('\n');
  assert.ok(all.includes('不主动占用晚间'), `缺少新文案，实际：\n${all}`);
  assert.ok(!all.includes('不占用晚间'), `旧文案仍在：\n${all}`);
});

check('晚课照常排进时间轴（既成事实不被 policy 抹掉）', () => {
  const eveBlocks = res.plan.blocks.filter((b) => b.source === 'course');
  assert.equal(eveBlocks.length, 2, `课程块数异常：${eveBlocks.length}`);
  assert.ok(eveBlocks.some((b) => b.startMin >= 18 * 60), '晚间课程块没排上');
});

check('缺地点课程 → 出 info（不按 0 分钟糊过去，修旧问题 #17）', () => {
  const hits = res.plan.issues.filter((i) => i.message.includes('地点'));
  assert.ok(hits.length > 0, `没有任何地点相关提示：${JSON.stringify(res.plan.issues)}`);
  assert.ok(hits.every((i) => i.level === 'info'));
});

/* ============================================================
 * 汇总
 * ========================================================== */
console.log(`\n=== P0 验收结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  console.log('\n失败项：');
  for (const f of failures) console.log(`  \u2717 ${f}`);
  process.exitCode = 1;
}
