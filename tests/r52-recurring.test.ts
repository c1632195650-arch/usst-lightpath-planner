/**
 * R 批 P1-1 · R5.2 重复块（recurring slot）—— CY 裁决路线 A 落地
 * ============================================================
 * 裁决（2026-10-03，BLOCKERS R5.2 结项）：走路线 A —— `UserTask.weeks` 本就能
 * 表达「每周重复」（空/未给 = 全学期、[5,6,7,8] = 只这四周，construct::taskActive
 * 逐周消费），B 的「独立表」在 localStorage KV 下没有额外语义收益，却要动
 * schema 版本 + 全部消费方；A 只需加可选 recurring 字段，展开复用 weeks 通道，
 * 旧数据零迁移。**涟漪语义 = 每周独立可挪**。
 *
 * ⚠️ 反向验证（RV，红线 4）：
 *   RV-R52a ← 删 goalToTasks 的 recurring 生成分支 → 「生成形态」用例红
 *   RV-R52b ← 删 checkGoalFeasibility 的 weeks 展开干跑 → 「展开干跑」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseIntentSlots } from '@/features/libao/libaoIntent';
import { checkGoalFeasibility, goalToTasks } from '@/features/libao/weekPlanForChat';
import { planWeekV2 } from '@/lib/planner/index';
import { toPlanRequest } from '@/lib/planner/schedule';
import { buildPhasesFromCalendar, phaseOfWeek } from '@/lib/planner/buildPhases';
import { TERM_CALENDAR } from '@/constants/term';
import { emptyUserPlan, loadUserPlan, saveUserPlan } from '@/features/week/userPlanStore';
import type { Schedule, TimeBlock } from '@/types';
import type { UserTask } from '@/lib/planner/templates';

const TODAY = '2026-10-02';
const TERM_START = '2026-08-31';

const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: TERM_START,
  totalWeeks: 20,
  source: 'demo',
  courses: [],
} as unknown as Schedule;

/** 真实相位 policy（与 checkGoalFeasibility 同源 —— policy:{} 会让 construct 的
 *  studyCandidates 读 undefined，生产路径从不这么传）。 */
const SEMESTER = buildPhasesFromCalendar(SCHEDULE, null, TERM_CALENDAR['2026-2027-1']);
const policyOf = (w: number) => phaseOfWeek(SEMESTER.plan, w)!.policy;

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

/* ---------------- 生成形态（路线 A 的核心承诺） ---------------- */

test('R5.2: goalToTasks 长期+频率 → 每「每周名额」一个重复任务，weeks 覆盖整段（RV-R52a 锚）', () => {
  const s = parseIntentSlots('这学期想养成晨跑的习惯；从下周开始；每周3次，每次30分钟', TODAY);
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  assert.equal(tasks.length, 3, '每周 3 次 = 3 个任务（不是 ~50 个一次性块）');
  assert.ok(tasks.every((t) => t.recurring === true), '全部带 recurring 标记');
  const weeks0 = tasks[0].weeks ?? [];
  assert.ok(weeks0.length > 1, `weeks 覆盖多周：${weeks0.length}`);
  assert.equal(weeks0[0], 6, '起点 = 下周（10-05 那周）');
  assert.equal(weeks0[weeks0.length - 1], 20, '终点 = 学期末（封顶 MAX_GOAL_DAYS 后 ≤20）');
  assert.ok(tasks.every((t) => t.id.startsWith('goal-') && /-rec\d$/.test(t.id)), `id 稳定无周次：${tasks.map((t) => t.id).join(',')}`);
  assert.ok(tasks.every((t) => t.budgetExempt === true), '重复任务同样豁免活动预算');
});

test('R5.2: 每周三（点名星期）→ 第一个名额带 dayOfWeek 钉，其余浮动', () => {
  const s = parseIntentSlots('这学期想养成健身的习惯；每周三；每周2次，每次45分钟', TODAY);
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].dayOfWeek, 3, '第一名额钉在周三');
  assert.equal(tasks[1].dayOfWeek, undefined, '第二名额交给引擎找空档');
  assert.ok(tasks.every((t) => t.recurring === true));
});

test('R5.2: 非长期路径零漂移 —— 普通单次/截止目标仍是一次性任务（无 recurring 标记）', () => {
  const single = goalToTasks(parseIntentSlots('明天要打球；每次60分钟', TODAY), SCHEDULE, TODAY);
  assert.ok(single.length >= 1);
  assert.ok(single.every((t) => t.recurring === undefined), '单次任务不带 recurring');
  const deadline = goalToTasks(parseIntentSlots('11月30号之前把数模论文写完；一共20小时', TODAY), SCHEDULE, TODAY);
  assert.ok(deadline.every((t) => t.recurring === undefined), '截止目标（有明说结束点）不进重复通道');
});

/* ---------------- 展开干跑与 construct 逐周消费 ---------------- */

test('R5.2: construct 逐周消费 weeks 通道 —— 同一重复任务每周各落一块', () => {
  const s = parseIntentSlots('这学期想养成晨跑的习惯；从下周开始；每周3次，每次30分钟', TODAY);
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  const blocks: TimeBlock[] = [];
  for (const w of [7, 12, 20]) {
    const req = toPlanRequest({ schedule: SCHEDULE, weekNo: w, policy: policyOf(w), scenarios: null, tasks });
    const plan = planWeekV2(req).plan;
    blocks.push(...plan.blocks.filter((b) => b.id.endsWith('goal-晨跑-rec0') || b.id.endsWith('goal-晨跑-rec1') || b.id.endsWith('goal-晨跑-rec2')));
  }
  assert.ok(blocks.length >= 9, `3 个任务 × 3 周 ≥ 9 块，实际 ${blocks.length}`);
  const byWeek = new Set(blocks.map((b) => b.id.slice(0, b.id.indexOf('-d'))));
  assert.ok(byWeek.size >= 3, `跨多周都有落点：${[...byWeek].join(',')}`);
});

test('R5.2: checkGoalFeasibility 按 weeks 展开干跑（RV-R52b 锚）——placedCount=展开块数', () => {
  const s = parseIntentSlots('这学期想养成晨跑的习惯；从下周开始；每周3次，每次30分钟', TODAY);
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  const weeksSpan = (tasks[0].weeks ?? []).length;
  const v = checkGoalFeasibility({ slots: s, schedule: SCHEDULE, profile: null, today: TODAY });
  assert.equal(v.candidateCount, tasks.length * weeksSpan, `展开块数 = 3×${weeksSpan}`);
  // 干跑逐周展开的**产物**口径：每一周都干跑 → 每周 3 块全部计入 placedCount
  //（RV-R52b：把展开砍成 slice(0,1) → 只有首周被干跑 → placedCount=3 ≠ 45 → 红）
  assert.equal(v.placedCount, v.candidateCount, `全部展开周都落位：${v.placedCount}/${v.candidateCount}`);
  const joined = v.caveats.join('；');
  assert.match(joined, /每周 3 次，铺到第 \d+ 周/, '草稿卡口径带每周次数（R5.4×R5.2）');
});

test('R5.2: 修复双放 —— 用户任务每周恰好一块（construct 周级预放去重，RV-R52c 锚）', () => {
  // 2026-10-02 白天批引入的 6.2c 预放与 6.5 活动循环此前各放一次：
  // 一次性任务「明天要打球」在周计划里出现两块（探针实录 540+1100）。
  const s = parseIntentSlots('明天要打球；每次60分钟', TODAY);
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  const w = (tasks[0].weeks ?? [])[0];
  const req = toPlanRequest({ schedule: SCHEDULE, weekNo: w, policy: policyOf(w), scenarios: null, tasks });
  const plan = planWeekV2(req).plan;
  const hits = plan.blocks.filter((b) => tasks.some((t) => b.id.endsWith(t.id)));
  assert.equal(hits.length, 1, `一次性任务恰好一块，实际 ${hits.length}（双放缺陷回归 → 红）`);
});

test('R5.2: 容量口径按展开块数 —— totalHours 与重复通道互斥，容量检查不误伤', () => {
  // 长期 + 频率通道不带 totalHours（判据要求频率）；这里验证一次性路径 candidateCount 不变
  const oneoff = parseIntentSlots('11月30号之前把数模论文写完；一共20小时', TODAY);
  const v = checkGoalFeasibility({ slots: oneoff, schedule: SCHEDULE, profile: null, today: TODAY });
  const tasks = goalToTasks(oneoff, SCHEDULE, TODAY);
  const expected = tasks.reduce((n, t) => n + (t.weeks?.length || 1), 0);
  assert.equal(v.candidateCount, expected, '一次性任务的展开块数 = 任务数（旧口径逐位一致）');
});

/* ---------------- 每周独立可挪（CY 裁决的涟漪语义） ---------------- */

test('R5.2: 每周独立可挪 —— 第 7 周的锁写回第 7 周，第 8 周布局与它无关', () => {
  const s = parseIntentSlots('这学期想养成晨跑的习惯；从下周开始；每周2次，每次30分钟', TODAY);
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  const mk = (w: number, locks: Record<string, unknown>, levels: Record<string, string>) =>
    // 锁字段不在 toPlanRequest 里 —— 真实链路在 planWeek 调用点叠加
    // （WeekPlanView: `lockedPlacements: effectivePlacements`），测试同构。
    ({ ...toPlanRequest({ schedule: SCHEDULE, weekNo: w, policy: policyOf(w), scenarios: null, tasks }), lockedPlacements: locks, lockLevels: levels });

  // 第一步：无锁排第 7 周，拿到 rec0 的真实块 id（真实链路里锁键正是从已渲染的块上取的）
  const plan7a = planWeekV2(mk(7, {}, {})).plan;
  const b7a = plan7a.blocks.find((b) => b.id.endsWith('goal-晨跑-rec0'));
  assert.ok(b7a, '第 7 周有 rec0 块');
  const lockId = b7a!.id;
  assert.match(lockId, /^w7-d\d-/, `块 id 自带 w{week} 前缀：${lockId}`);

  // 第二步：第 7 周锁（hard + 同日改时间 —— 与 solver::applyLockedPlacements 的
  // 写回口径一致：换天是冲突不是写回）。目标时刻取**该天真实空闲档**（撞上
  // 占用块会被判 lock-conflict 拒写回 —— 那是另一条语义，不在本用例范围）。
  const day = b7a!.dayOfWeek;
  const occupied = plan7a.blocks
    .filter((b) => b.dayOfWeek === day && b.id !== lockId)
    .map((b) => [b.startMin, b.endMin] as const)
    .sort((a, b) => a[0] - b[0]);
  let target = 7 * 60;
  for (const [s0, e0] of occupied) {
    if (target + 30 <= s0) break;
    target = Math.max(target, e0);
  }
  const plan7b = planWeekV2(mk(7, { [lockId]: { dayOfWeek: day, startMin: target, endMin: target + 30, title: '晨跑' } }, { [lockId]: 'hard' })).plan;
  const b7b = plan7b.blocks.find((b) => b.id === lockId);
  assert.ok(b7b, '锁后第 7 周仍有 rec0 块');
  assert.equal(b7b!.startMin, target, `第 7 周的挪动被尊重（写回 ${target} 分钟处）`);

  // 第三步（每周独立的核心）：把第 7 周的锁原样传给第 8 周 —— 键是 w7-…，
  // 第 8 周的块 id 全是 w8-…，锁找不到目标也**改不动任何块**：布局逐块相同。
  const plan8a = planWeekV2(mk(8, {}, {})).plan;
  const plan8b = planWeekV2(mk(8, { [lockId]: { dayOfWeek: day, startMin: target, endMin: target + 30, title: '晨跑' } }, { [lockId]: 'hard' })).plan;
  const strip = (p: typeof plan8a) => p.blocks.map((b) => `${b.id}@${b.startMin}-${b.endMin}`).join('|');
  assert.equal(strip(plan8a), strip(plan8b), '第 8 周布局不受第 7 周锁影响（每周独立可挪）');
});

/* ---------------- 存储往返（旧数据零迁移） ---------------- */

test('R5.2: userPlanStore 读写往返保留 recurring 字段（isTask 白名单不剥未知字段）', () => {
  const KEY = 'usst-user-plan-v1';
  const seed = {
    schemaVersion: 2,
    tasks: [{
      id: 'goal-晨跑-rec0', title: '晨跑', kind: 'activity', category: 'custom',
      dayOfWeek: 3, durationMin: 30, weeks: [6, 7, 8], recurring: true,
    }],
    excluded: [], moves: [], slots: [], courseOverrides: [], mealPlaces: {}, assignments: [],
  };
  try {
    globalThis.localStorage = {
      getItem: (k: string) => (k === KEY ? JSON.stringify(seed) : null),
      setItem: () => {}, removeItem: () => {}, clear: () => {},
    } as unknown as Storage;
    const layer = loadUserPlan();
    const t = layer.tasks.find((x) => x.id === 'goal-晨跑-rec0');
    assert.ok(t, '任务读回');
    assert.equal(t!.recurring, true, 'recurring 字段往返保留（零迁移）');
    assert.deepEqual(t!.weeks, [6, 7, 8]);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
  void emptyUserPlan; void saveUserPlan;
});

/* ---------------- 源码锁 ---------------- */

test('R5.2 源码锁: templates 的 recurring 字段与 goalToTasks 生成分支在位', () => {
  const tpl = src('/src/lib/planner/templates.ts');
  assert.match(tpl, /recurring\?: boolean/, 'UserTask.recurring 可选字段（RV-R52a：删字段 → 红）');
  const wpc = src('/src/features/libao/weekPlanForChat.ts');
  assert.match(wpc, /goal-\$\{slug\}-rec\$\{i\}/, '重复任务 id 形态');
  assert.match(wpc, /byWeek.get\(w as number\) \?\? \[\]/, '干跑逐周展开在位');
  assert.match(wpc, /const expectedBlocks = candidates\.reduce/, '展开块数口径');
});

test('R5.2 源码锁: 块认领用 endsWith 而非 includes（MOSS 验收补，2026-10-03）', () => {
  // 背景：rec 序号会互为前缀（rec1 是 rec10 的子串），slug 也可能互为前缀。
  //   块 id 形如 `w6-d1-morning-custom-goal-打球-rec10`：
  //     includes('goal-打球-rec1') → true  ← 误认：rec10 的块被 rec1 认走
  //     endsWith('goal-打球-rec1') → false ← 精确：只有完整 id 尾部才算命中
  // 现状实测：placed 用 `some()` 且**不记录归属**，故两种写法计数等价 →
  //   这条锁是**意图锁**而非行为锁：防止未来 placed 改为记录归属时，
  //   误认领悄悄回来（那时才会真正影响「哪个任务的块没落位」的判断）。
  const wpc = src('/src/features/libao/weekPlanForChat.ts');
  const claim = wpc.match(/candidates\.some\(\(t\) => b\.id\.(endsWith|includes)\(t\.id\)\)/);
  assert.ok(claim, '块认领写法在位');
  assert.equal(
    claim![1],
    'endsWith',
    `块认领必须用 endsWith（当前是 ${claim![1]}）—— includes 会让 rec1 认领 rec10 的块`,
  );
  // 顺带把「不记录归属」这一事实钉住：它是当前两种写法等价的原因，
  // 一旦改成记录归属，上面那条锁就从意图锁升级为行为锁。
  assert.match(
    wpc,
    /for \(const b of after\.blocks\) \{\s*\n\s*if \(b\.id && candidates\.some\(/,
    'placed 仍按 some() 布尔认领（未记录归属）',
  );
});
