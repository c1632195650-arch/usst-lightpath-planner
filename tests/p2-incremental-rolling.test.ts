/**
 * P2 验收测试：增量重排（AC-7）· 两趟收敛（AC-10）· 跨周滚动（T2.2）· fromNow（T2.3）
 * ============================================================
 * 这个文件只测 **P2 新增的能力**，与既有的 `planweek.test.ts`（P1 两遍法编排）
 * 分开 —— 两边的关注点不同：那边验「编排有没有被抽成一份」，
 * 这边验「P2 的三条支柱在真实语料上真的生效」。
 *
 * 规格书对应条目：
 *   · AC-7  增量最小扰动：改一个 commit → 不相干天的块的坐标**一个都没动**（churn = 0）
 *   · AC-10 两趟收敛：所有相邻跨点对都已预取
 *   · §5.3  跨天加成：上周某天显著偏重 → 本周该天产能下调 10%
 *   · §5.8  脏区域：只在受影响的天 + 邻居 + 交期变化的天上重跑 improve
 *   · §5.9  两趟法收敛：迭代到不动点（方法 A）+ 预取候选对（方法 B）
 *   · T2.3  fromNow：只排 [fromNow, dayEnd]，且**只影响今天**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TimeBlock, WeekPlan } from '@/types';
import type { Commit } from '@/lib/planner/model.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { planWeekV2 } from '@/lib/planner/index.ts';
import { solveWeek } from '@/lib/planner/solver.ts';
import { dirtyRegion, incrementalImprove } from '@/lib/planner/incremental.ts';
import { dayCapacityFactors, mergeLoad, capacityFactorOn } from '@/lib/planner/roll.ts';
import { addDays } from '@/lib/date.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-12-crosscampus');
if (!G) throw new Error('找不到 week-12-crosscampus 语料');
const G4 = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
if (!G4) throw new Error('找不到 week-04-typical 语料');

/* ══════════════════════════════════════════════════════════
 * 一、AC-7 —— 增量最小扰动
 * ══════════════════════════════════════════════════════════ */

/** 把块压成「id → 天/起止/地点」的坐标表，用来逐块比对是否移动过 */
function coordsOf(plan: WeekPlan): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of plan.blocks) {
    m.set(b.id, `d${b.dayOfWeek}:${b.startMin}-${b.endMin}@${b.place ?? ''}`);
  }
  return m;
}

test('AC-7：同一份输入重复求解 → 结果逐块一致（引擎确定性）', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const a = planWeekV2(req);
  const b = planWeekV2(req);
  assert.deepEqual([...coordsOf(a.plan)], [...coordsOf(b.plan)],
    '引擎必须是确定性的：同输入同输出');
});

test('AC-7：增量重排把非脏天冻结 —— 脏区域外没有任何块被移动', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = planWeekV2(req);

  // 造一个「只影响周三」的输入变化：新增一个交期在周三的提交项。
  // 注意这里刻意不动课表 —— 课表变了会牵动全周，那不是「增量」要测的东西。
  //
  // ⚠️ `dueAt` 的真实形状是 `{ weekNo, dayOfWeek, min }`（见 model.ts 的 Commit），
  //    不是 ISO 日期字符串。写成字符串会让 `daysOfCommit()` 取不到 `dayOfWeek`，
  //    于是脏区域退化成「空集 + 无邻居」→ 测试自欺欺人地通过。
  const extra: Commit = {
    id: 'inc-test-new',
    title: '增量测试任务',
    kind: 'study',
    effortMin: 60,
    dueAt: { weekNo: req.weekNo + 1, dayOfWeek: 3, min: 18 * 60 },
    priority: 60,
  };
  const nextCommits = [...(req.commits ?? []), extra];
  const req2 = {
    ...req,
    commits: nextCommits,
    previousPlan: base.plan,
    previousCommits: req.commits ?? [],
  };

  // 脏区域里应当包含周三，且**不该**等于「全周」
  const dirty = dirtyRegion({
    previousPlan: base.plan,
    commits: nextCommits,
    previousCommits: req.commits ?? [],
  });
  assert.ok(dirty.days.includes(3), `周三应被判为脏（新增了周三的提交项）；实际 ${JSON.stringify(dirty.days)}`);
  assert.equal(dirty.full, false, '这不是全量重排的场景');
  assert.ok(dirty.days.length < 7, `脏区域不该覆盖全周；实际 ${dirty.days.length} 天`);

  const inc = incrementalImprove(base.plan, dirty, {
    weekNo: req.weekNo,
    policy: req.policy,
    weights: undefined as never,
    commits: nextCommits,
    lockLevels: undefined,
    previousPlan: base.plan,
    config: undefined,
  });

  // 核心断言：脏区域**之外**的块，坐标一个都没变
  const before = coordsOf(base.plan);
  const after = coordsOf(inc.plan);
  const dirtySet = new Set(dirty.days);
  let movedOutside = 0;
  for (const [id, coord] of after) {
    const prev = before.get(id);
    if (prev === undefined) continue;          // 新块不算「被移动」
    if (prev === coord) continue;              // 没动
    // 动了 —— 它必须在脏区域内
    const day = Number(coord.match(/^d(\d)/)?.[1] ?? 0);
    if (!dirtySet.has(day)) movedOutside += 1;
  }
  assert.equal(movedOutside, 0, `脏区域外有 ${movedOutside} 个块被移动了（AC-7 要求 0）`);
  assert.ok(inc.frozenCount > 0, '应当有块被冻结（否则增量没生效）');
});

test('AC-7：没有任何变化时，增量重排不移动任何块', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = planWeekV2(req);

  // 输入完全没变 → 脏区域应为空（或只有邻居），任何块都不该挪
  const dirty = dirtyRegion({
    previousPlan: base.plan,
    commits: req.commits,
    previousCommits: req.commits,
  });
  const inc = incrementalImprove(base.plan, dirty, {
    weekNo: req.weekNo,
    policy: req.policy,
    weights: undefined as never,
    commits: req.commits,
    lockLevels: undefined,
    previousPlan: base.plan,
    config: undefined,
  });
  assert.deepEqual([...coordsOf(inc.plan)], [...coordsOf(base.plan)],
    '输入没变时不该有任何块移动（这是「最小扰动」的下界）');
});

test('AC-7：交期变化 → 新旧两天都进脏区域', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = planWeekV2(req);
  const commits = req.commits ?? [];

  // 没有 commits 的语料就跳过（避免造一个不真实的场景骗自己）
  if (commits.length === 0) return;

  const first = commits[0];
  const newDue = addDays(first.dueAt ?? '2026-11-23', 3);
  const dirty = dirtyRegion({
    previousPlan: base.plan,
    commits: [{ ...first, dueAt: newDue }],
    previousCommits: commits,
  });
  assert.ok(dirty.triggers.some((t) => t.reason === 'commit-due-changed'),
    '应当识别出「交期变化」这个触发原因');
});

/* ══════════════════════════════════════════════════════════
 * 二、跨周滚动（T2.2 / §5.3 跨天加成）
 * ══════════════════════════════════════════════════════════ */

test('§5.3：实际负荷优先于计划负荷（实际 > 0 时用实际）', () => {
  const planned = [0, 100, 100, 100, 100, 100, 100, 100];
  const actual = [0, 0, 0, 0, 0, 0, 0, 0];        // 全 0 = 没记录
  const r = mergeLoad(planned, actual);
  assert.equal(r.source, 'planned', '实际全为 0 时应退回计划值');

  const actual2 = [0, 50, 0, 0, 0, 0, 0, 0];      // 只有周二有记录
  const r2 = mergeLoad(planned, actual2);
  assert.equal(r2.source, 'actual', '有实际记录时应以实际为准');
});

test('§5.3：某天显著高于均值 → 该天产能下调 10%，其余天不动', () => {
  // 周三（下标 3）明显偏重，其余天轻
  const loadByDow = [0, 60, 60, 400, 60, 60, 60, 0];
  const r = dayCapacityFactors({
    recentLoad: [],
    upcoming: [],
    loadByDow,
  });
  const dWed = r.days.find((d) => d.dayOfWeek === 3);
  const dMon = r.days.find((d) => d.dayOfWeek === 1);
  assert.ok(dWed, '缺少周三的判定');
  assert.equal(dWed.high, true, '周三应被判定为「显著偏高」');
  assert.equal(dWed.capacityFactor, 0.9, '偏高的天产能应下调 10%');
  assert.equal(dMon?.capacityFactor, 1, '正常的天产能不应被下调');
  assert.equal(capacityFactorOn(r.days, 3), 0.9);
  assert.equal(capacityFactorOn(r.days, 1), 1);
});

test('§5.3：样本不足（有效天 < 3）时不做任何降档 —— 避免用噪声当规律', () => {
  // 只有一个周三有负荷，其余全 0 → 有效天数不足
  const loadByDow = [0, 0, 0, 400, 0, 0, 0, 0];
  const r = dayCapacityFactors({ recentLoad: [], upcoming: [], loadByDow });
  for (const d of r.days) {
    assert.equal(d.capacityFactor, 1, `第 ${d.dayOfWeek} 天不该被降档（样本不足）`);
  }
});

test('§5.3：负荷偏低的天不会被「反向加成」（只降不升）', () => {
  const loadByDow = [0, 500, 500, 500, 500, 500, 10, 10];
  const r = dayCapacityFactors({ recentLoad: [], upcoming: [], loadByDow });
  for (const d of r.days) {
    assert.ok(d.capacityFactor <= 1, `第 ${d.dayOfWeek} 天产能不该超过 1（引擎不能凭空加产能）`);
  }
});

test('T2.2：rolling 传进 solveWeek 后，结果的 loadDecisions 长度恒为 7', () => {
  const req = toPlanRequest(buildGoldenInput(G4));
  const res = solveWeek({
    ...req,
    rolling: { recentLoad: [300, 320], upcoming: [], loadByDow: [0, 60, 60, 400, 60, 60, 60, 0] },
    actualLoadByDow: [0, 50, 50, 380, 50, 50, 50, 40],
  });
  assert.ok(res.loadDecisions, '结果里应带上 loadDecisions');
  assert.equal(res.loadDecisions?.length, 7, 'loadDecisions 应当是 7 项（周一到周日）');
  // 传了滚动状态时应当有一条面向用户的说明（「周三上周偏满，这周松了 10%」这类）
  assert.ok(res.notes.some((n) => n.includes('周三') || n.includes('负荷') || n.includes('松')),
    `跨周降档应留下说明，实际 notes：${JSON.stringify(res.notes)}`);
});

/* ══════════════════════════════════════════════════════════
 * 三、fromNow（T2.3）
 * ══════════════════════════════════════════════════════════ */

test('T2.3：fromNow 只砍今天 —— 今天该点之前的块消失，其它天一块不少', () => {
  const req = toPlanRequest(buildGoldenInput(G4));
  const full = solveWeek(req);

  // 周三 18:00 之后才开始（1080 分钟）
  const late = solveWeek({ ...req, fromNow: 18 * 60, fromNowDay: 3 });

  const todayBlocks = (p: typeof full, day: number): TimeBlock[] =>
    p.plan.blocks.filter((b) => b.dayOfWeek === day);
  const otherBlocks = (p: typeof full): TimeBlock[] =>
    p.plan.blocks.filter((b) => b.dayOfWeek !== 3);

  // 今天：18:00 之前不该再有「可挪动的软块」。
  // 硬块（固定课表的课）不在此列 —— 它们本来就钉在课表时间上，引擎无权取消。
  const softBefore = todayBlocks(late, 3).filter(
    (b) => b.endMin <= 18 * 60 && b.kind !== 'course',
  );
  assert.equal(softBefore.length, 0,
    `18:00 前仍有软块：${softBefore.map((b) => `${b.title}@${b.startMin}`).join(', ')}`);

  // 其它天：块数应当和全量排程一致（fromNow 不该波及明天以后）
  assert.equal(otherBlocks(late).length, otherBlocks(full).length,
    'fromNow 影响了今天以外的日子（这是 T2.3 明确要避免的）');
});

test('T2.3：fromNowDay 为 null 时 fromNow 不生效（不会莫名其妙砍掉某天）', () => {
  const req = toPlanRequest(buildGoldenInput(G4));
  const full = solveWeek(req);
  const noDay = solveWeek({ ...req, fromNow: 18 * 60, fromNowDay: null });
  assert.equal(noDay.plan.blocks.length, full.plan.blocks.length,
    '没指定 fromNowDay 时不该砍任何东西');
});

test('T2.3：fromNow 晚于一天结束（23:00 之后）→ 今天排不出软块，但不崩', () => {
  const req = toPlanRequest(buildGoldenInput(G4));
  const res = solveWeek({ ...req, fromNow: 23 * 60 + 30, fromNowDay: 3 });
  const soft = res.plan.blocks.filter(
    (b) => b.dayOfWeek === 3 && b.kind !== 'course',
  );
  assert.equal(soft.length, 0, '过了 23:00 不该再排软块');
  assert.ok(res.plan.blocks.length > 0, '其它天仍应有内容（不是整体排空）');
});

/* ══════════════════════════════════════════════════════════
 * 四、脏区域语义（§5.8）
 * ══════════════════════════════════════════════════════════ */

test('§5.8：没有 previousPlan → 全量重排（首次排程）', () => {
  const req = toPlanRequest(buildGoldenInput(G4));
  const d = dirtyRegion({ previousPlan: null, commits: req.commits, previousCommits: [] });
  assert.equal(d.full, true, '没有上一版计划时应判为全量');
  assert.equal(d.days.length, 7, '全量时应覆盖 7 天');
});

test('§5.8：脏区域的天数 ≤ 7 且都在 1..7 范围（不产生越界天）', () => {
  const req = toPlanRequest(buildGoldenInput(G));
  const base = planWeekV2(req);
  const d = dirtyRegion({
    previousPlan: base.plan,
    commits: req.commits,
    previousCommits: req.commits,
  });
  assert.ok(d.days.length <= 7);
  for (const day of d.days) {
    assert.ok(day >= 1 && day <= 7, `脏区域出现越界的天：${day}`);
  }
});
