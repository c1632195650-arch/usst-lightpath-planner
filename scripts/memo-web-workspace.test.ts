/**
 * 任务四 · 网页端待办工作区（M4-W1/W2/W3）逻辑测试
 * ============================================================
 * 覆盖：
 *   ① 两类待办完成流程**行为不同**（CY 核心要求）：recent 打勾即完成不填时间；
 *      longterm 未填粗粒度时段 → 拒绝（P4 变异体：去掉该规则对应组变红）
 *   ② plannedDone → dueAt 解析规则**确定**（旬末最后一天 21:00、30 天月收敛、
 *      学期前 → null）
 *   ③ todosToPendingTodos 映射（done/archived 不参与；交期周不同不进本周）
 *   ④ toPlanRequest 映射：recent → UserTask / longterm → Commit（splittable、
 *      priority 92、dueAt 直传）；**不传 pendingTodos = 旧行为逐字段一致**（黄金零漂移）
 *   ⑤ blockIdForTodo 匹配（整块 endsWith / 续段 includes / 未安排 → null）
 *   ⑥ scheduledLabel 回显（有位置 → 「已排进周三 15:00」；只有 id → 「已排进周三」）
 *   ⑦ 筛选/搜索/标签（网页端专属）
 *   ⑧ 归档不删除 + 单项操作不影响其他条目（P2-1）
 *   ⑨ milestonePicker 确定性
 *
 * ⚠️ 反向验证（P4-1，四组红绿对照的操作说明见台账 docs/memo-loop-plan.md）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeTodo, type Todo } from '@/features/mobile/lib/memoTypes';
import {
  EMPTY_MEMO, addTodo, archiveTodo, patchTodoDetail, sortTodosForView, toggleTodoDone,
  type MemoData,
} from '@/features/mobile/lib/memoStore';
import {
  blockIdForTodo, dayFromBlockId, filterTodos, plannedDoneToDueAt, scheduledLabel,
  setScheduledBlock, tagsOf, todosToPendingTodos, updateTodoTitle,
  TODO_DUE_MIN,
} from '@/features/memo/memoLogic';
import { monthOptions, periodLabel, periodValues, suggestPeriod } from '@/features/memo/milestonePicker';
import { toPlanRequest } from '@/lib/planner/schedule';
import type { Schedule, WeekPlan } from '@/types';
import { MOCK_SCHEDULE } from '@/data/usst';

/* ---------------- fixtures ---------------- */

const td = (over: Partial<Todo> & { id: string }): Todo => ({
  kind: 'recent',
  title: `待办 ${over.id}`,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  completion: null,
  ...over,
});

const schedule: Schedule = MOCK_SCHEDULE;

const block = (id: string, dayOfWeek: 1 | 3, startMin: number) => ({
  id, kind: 'study' as const, dayOfWeek, startMin, endMin: startMin + 60,
  title: 'x',
});
const plan = (blocks: ReturnType<typeof block>[]): WeekPlan => ({
  weekNo: 5, blocks, stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: blocks.length }, issues: [],
});

/* ---------------- ① 两类待办完成流程不同 ---------------- */

test('recent 打勾即完成：不要求 plannedDone，actualDoneAt 注入', () => {
  const t = td({ id: 'a1', kind: 'recent' });
  const r = completeTodo(t, { nowIso: '2026-10-06T10:00:00.000Z' });
  assert.ok(r.ok);
  assert.equal(r.todo.completion, 'done');
  assert.equal(r.todo.plannedDone, undefined);
  assert.equal(r.todo.actualDoneAt, '2026-10-06T10:00:00.000Z');
});

test('longterm 未填完成时间 → 拒绝完成（阻止，不静默跳过）', () => {
  const t = td({ id: 'a2', kind: 'longterm' });
  const noArg = completeTodo(t, { nowIso: '2026-10-06T10:00:00.000Z' });
  assert.deepEqual(noArg, { ok: false, reason: 'need-planned-done' });
  const blank = completeTodo(t, { nowIso: '2026-10-06T10:00:00.000Z', plannedDone: '  ' });
  assert.deepEqual(blank, { ok: false, reason: 'need-planned-done' });
});

test('longterm 填粗粒度时段 → 完成；格式非法 → 拒绝（bad-planned-done）', () => {
  const t = td({ id: 'a3', kind: 'longterm' });
  const ok = completeTodo(t, { nowIso: '2026-10-06T10:00:00.000Z', plannedDone: '2026-10-中旬' });
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.todo.plannedDone, '2026-10-中旬');
  const bad = completeTodo(t, { nowIso: '2026-10-06T10:00:00.000Z', plannedDone: '2026-10-15' });
  assert.deepEqual(bad, { ok: false, reason: 'bad-planned-done' });
});

test('toggleTodoDone 分流：recent 直勾 / longterm 无时段不动数据', () => {
  let d: MemoData = { ...EMPTY_MEMO, todos: [td({ id: 'b1', kind: 'recent' }), td({ id: 'b2', kind: 'longterm' })] };
  const rRecent = toggleTodoDone(d, 'b1', { nowIso: '2026-10-06T10:00:00.000Z' });
  assert.ok(rRecent.ok);
  d = rRecent.data;
  const rLong = toggleTodoDone(d, 'b2', { nowIso: '2026-10-06T10:00:00.000Z' });
  assert.equal(rLong.ok, false);
  assert.equal(rLong.reason, 'need-planned-done');
  // 拒绝时数据原样（那条还是未完成）
  assert.equal(d.todos.find((x) => x.id === 'b2')?.completion, null);
});

/* ---------------- ② plannedDone → dueAt 确定规则 ---------------- */

test('plannedDoneToDueAt：2026-09-中旬 + termStart 2026-09-07 → 第 2 周周日 21:00', () => {
  // 2026-09-07 是周一 → 中旬末日 09-20 是第 2 周的周日（dayOfWeek 7）
  assert.deepEqual(plannedDoneToDueAt('2026-09-中旬', '2026-09-07'), {
    weekNo: 2, dayOfWeek: 7, min: TODO_DUE_MIN,
  });
  assert.equal(TODO_DUE_MIN, 21 * 60);
});

test('plannedDoneToDueAt：下旬在 30 天月收敛到月末（不跨月）', () => {
  // 2026-09 只有 30 天 → 下旬末日取 30
  const due = plannedDoneToDueAt('2026-09-下旬', '2026-09-07');
  assert.ok(due);
  // 09-30 是周三（09-07 周一 + 23 天 → 23 % 7 = 2 → 周三）
  assert.equal(due?.dayOfWeek, 3);
});

test('plannedDoneToDueAt：解析失败 / 学期开始前 → null（不瞎猜）', () => {
  assert.equal(plannedDoneToDueAt('', '2026-09-07'), null);
  assert.equal(plannedDoneToDueAt('2026-09-底', '2026-09-07'), null);
  assert.equal(plannedDoneToDueAt('2026-06-上旬', '2026-09-07'), null); // 学期前
});

/* ---------------- ③ todosToPendingTodos 映射 ---------------- */

test('todosToPendingTodos：done/archived 不参与；recent 带档位时长；longterm 可拆', () => {
  const todos = [
    td({ id: 'c1', kind: 'recent' }),
    td({ id: 'c2', kind: 'recent', completion: 'done' }),
    td({ id: 'c3', kind: 'longterm', title: '读完《学习之道》' }),
    td({ id: 'c4', kind: 'longterm', archived: true }),
  ];
  const out = todosToPendingTodos(todos, '2026-09-07', 5);
  assert.deepEqual(out.map((x) => x.id), ['c1', 'c3']);
  const recent = out.find((x) => x.id === 'c1');
  const long = out.find((x) => x.id === 'c3');
  assert.equal(recent?.kind, 'recent');
  assert.equal(long?.kind, 'longterm');
  assert.equal(long?.splittable, true);
  assert.equal(long?.effortMin, 60);
  assert.equal(long?.dueAt, undefined); // 未完成无 plannedDone → 无硬交期
});

test('todosToPendingTodos：有 plannedDone 且交期周==目标周 → 带 dueAt；交期周不同 → 不进本周', () => {
  const todos = [
    td({ id: 'd1', kind: 'longterm', plannedDone: '2026-09-中旬' }), // 交期第 2 周
    td({ id: 'd2', kind: 'longterm', plannedDone: '2026-09-中旬' }),
  ];
  const week2 = todosToPendingTodos(todos, '2026-09-07', 2);
  assert.deepEqual(week2.map((x) => x.id), ['d1', 'd2']);
  assert.deepEqual(week2[0]?.dueAt, { weekNo: 2, dayOfWeek: 7, min: TODO_DUE_MIN });
  const week5 = todosToPendingTodos(todos, '2026-09-07', 5);
  assert.deepEqual(week5, []); // 交期周 ≠ 第 5 周 → 都不进
});

/* ---------------- ④ toPlanRequest 映射 ---------------- */

test('toPlanRequest：recent → UserTask（durationMin=档位、weeks=[weekNo]）；longterm → Commit（study/可拆/priority 92）', () => {
  const req = toPlanRequest({
    schedule, weekNo: 5, policy: 'steady',
    pendingTodos: [
      { id: 'e1', title: '取快递', kind: 'recent', effortMin: 30 },
      { id: 'e2', title: '读完《学习之道》', kind: 'longterm', effortMin: 60, splittable: true, dueAt: { weekNo: 5, dayOfWeek: 7, min: 1260 } },
    ],
  });
  const task = req.tasks?.find((t) => t.id === 'e1');
  assert.ok(task);
  assert.equal(task.title, '取快递');
  assert.equal(task.durationMin, 30);
  assert.deepEqual(task.weeks, [5]);
  assert.equal(task.priority, 70);
  const commit = req.commits.find((c) => c.id === 'e2');
  assert.ok(commit);
  assert.equal(commit.kind, 'study');
  assert.equal(commit.effortMin, 60);
  assert.equal(commit.splittable, true);
  assert.equal(commit.priority, 92);
  assert.deepEqual(commit.dueAt, { weekNo: 5, dayOfWeek: 7, min: 1260 });
  // recent 不进 commits、longterm 不进 tasks
  assert.equal(req.commits.find((c) => c.id === 'e1'), undefined);
  assert.equal(req.tasks?.find((t) => t.id === 'e2'), undefined);
});

test('toPlanRequest：不传 / 传空 pendingTodos → commits 为空、tasks 原样（旧行为逐字段一致）', () => {
  const tasks = [{ id: 'u1', title: '手加的', durationMin: 45 }];
  const a = toPlanRequest({ schedule, weekNo: 3, policy: 'steady', tasks });
  const b = toPlanRequest({ schedule, weekNo: 3, policy: 'steady', tasks, pendingTodos: [] });
  for (const req of [a, b]) {
    assert.deepEqual(req.commits, []);
    assert.deepEqual(req.tasks, tasks);
  }
});

/* ---------------- ⑤ blockIdForTodo 匹配 ---------------- */

test('blockIdForTodo：整块 endsWith 优先；可拆续段退回；未安排 → null', () => {
  const p = plan([
    block('w5-d1-course-c1p1', 1, 480),
    block('w5-d3-user-e1', 3, 900),
    block('w5-d2-study-e2', 3, 600),
    block('w5-d2-study-e2-2', 3, 1020),
  ]);
  assert.equal(blockIdForTodo(p, 'e1')?.id, 'w5-d3-user-e1');
  // c1p1 的语义键是 'c1p1'，不是 'c1' —— 不许误命中
  assert.equal(blockIdForTodo(p, 'c1'), null);
  // e2 有两段：优先整块
  assert.equal(blockIdForTodo(p, 'e2')?.id, 'w5-d2-study-e2');
  const p2 = plan([block('w5-d4-study-e3-2', 1, 1200), block('w5-d4-study-e3-3', 1, 1320)]);
  assert.equal(blockIdForTodo(p2, 'e3')?.id, 'w5-d4-study-e3-2');
  assert.equal(blockIdForTodo(plan([]), 'e1'), null);
});

test('dayFromBlockId：-d3- → 3；无星期段 → null', () => {
  assert.equal(dayFromBlockId('w5-d3-user-e1'), 3);
  assert.equal(dayFromBlockId('study-policy-0'), null);
});

/* ---------------- ⑥ scheduledLabel 回显 ---------------- */

test('scheduledLabel：有块位置 → 「已排进周三 15:00」；只有 id → 「已排进周三」；无 id → null', () => {
  const todo = td({ id: 'f1', scheduledBlockId: 'w5-d3-user-f1' });
  assert.equal(scheduledLabel(todo, (id) => (id === 'w5-d3-user-f1' ? { dayOfWeek: 3, startMin: 900 } : null)), '已排进周三 15:00');
  assert.equal(scheduledLabel(todo, () => null), '已排进周三'); // 刷新后内存无计划，退回星期
  assert.equal(scheduledLabel({ ...todo, scheduledBlockId: undefined }), null);
});

/* ---------------- ⑥·S3 待办→日程端到端闭环（CY 反馈③，2026-10-07） ---------------- */

test('S3 闭环：待办 → todosToPendingTodos → 计划块 → blockIdForTodo → 回显「已排进周X」', () => {
  // ① 未完成待办 → 排程输入（与 WeekPlanView 排程前同一入口）
  const todos = [td({ id: 'todo-1', kind: 'recent', title: '买考研英语真题' })];
  const pending = todosToPendingTodos(todos, schedule.termStart, 5);
  assert.equal(pending.length, 1, '未完成 recent 待办必须进 pendingTodos');
  assert.equal(pending[0].id, 'todo-1');

  // ② 引擎产出块（id 规范：语义键 = todo id）→ blockIdForTodo 命中
  const p = plan([block('w5-d3-user-todo-1', 3, 900)]);
  const hit = blockIdForTodo(p, 'todo-1');
  assert.ok(hit, '排进计划的待办必须能反查到块');

  // ③ 回填后回显文案含「已排进周X」（精确到时刻）
  const label = scheduledLabel(
    { ...todos[0], scheduledBlockId: hit.id },
    (id) => {
      const b = p.blocks.find((bb) => bb.id === id);
      return b ? { dayOfWeek: b.dayOfWeek, startMin: b.startMin } : null;
    },
  );
  assert.equal(label, '已排进周三 15:00');
  assert.match(label ?? '', /已排进周[一二三四五六日]/);

  // ④ 反向：没排上的待办 → scheduledLabel null（前端据此给「未排进本周」chip）
  assert.equal(scheduledLabel(td({ id: 'todo-2', kind: 'recent' })), null);
});

/* ---------------- ⑦ 筛选 / 搜索 / 标签 ---------------- */

test('filterTodos + tagsOf：标签精确筛、关键字含 note、完成态分流', () => {
  const todos = [
    td({ id: 'g1', title: '取快递', tags: ['生活'] }),
    td({ id: 'g2', title: '读完《学习之道》', note: '第 4 章最重要', tags: ['读书', '备考'], kind: 'longterm' }),
    td({ id: 'g3', title: '交材料', tags: ['备考'], completion: 'done' as const }),
  ];
  assert.deepEqual(filterTodos(todos, { tag: '备考' }).map((x) => x.id), ['g2', 'g3']);
  assert.deepEqual(filterTodos(todos, { q: '第 4 章' }).map((x) => x.id), ['g2']);
  assert.deepEqual(filterTodos(todos, { state: 'open' }).map((x) => x.id), ['g1', 'g2']);
  assert.deepEqual(filterTodos(todos, { state: 'done' }).map((x) => x.id), ['g3']);
  assert.deepEqual(filterTodos(todos, { q: '快递', tag: '读书' }), []); // 与
  assert.deepEqual(tagsOf(todos), ['生活', '读书', '备考']);
});

/* ---------------- ⑧ 归档不删除 + 单项操作不影响其他条目 ---------------- */

test('归档 = archived 标记保留数据（不删除）；视图排序隐藏归档', () => {
  let d: MemoData = { ...EMPTY_MEMO, todos: [td({ id: 'h1' }), td({ id: 'h2', title: '留下我' })] };
  d = archiveTodo(d, 'h1', '2026-10-06T10:00:00.000Z');
  assert.equal(d.todos.length, 2); // 数据还在
  assert.equal(d.todos.find((x) => x.id === 'h1')?.archived, true);
  assert.deepEqual(sortTodosForView(d.todos).map((x) => x.id), ['h2']);
});

test('单项操作（补 note/标签）不影响其他条目（P2-1 逐项 LWW 的本地半边）', () => {
  const d: MemoData = { ...EMPTY_MEMO, todos: [td({ id: 'i1' }), td({ id: 'i2', title: '别动我' })] };
  const next = patchTodoDetail(d, 'i1', { note: '放前台', tags: ['生活'] }, '2026-10-06T10:00:00.000Z');
  assert.equal(next.todos.find((x) => x.id === 'i1')?.note, '放前台');
  assert.deepEqual(next.todos.find((x) => x.id === 'i2'), d.todos.find((x) => x.id === 'i2'));
  // setScheduledBlock：可写也可清（patchTodoDetail 清不掉，这是 web 端专用口）
  const withBlock = setScheduledBlock(next, 'i1', 'w5-d3-user-i1', '2026-10-06T11:00:00.000Z');
  assert.equal(withBlock.todos.find((x) => x.id === 'i1')?.scheduledBlockId, 'w5-d3-user-i1');
  const cleared = setScheduledBlock(withBlock, 'i1', null, '2026-10-06T12:00:00.000Z');
  assert.equal(cleared.todos.find((x) => x.id === 'i1')?.scheduledBlockId, undefined);
});

test('updateTodoTitle：截断 120 字、空标题拒绝（原样返回）', () => {
  const d: MemoData = { ...EMPTY_MEMO, todos: [td({ id: 'j1' })] };
  assert.equal(updateTodoTitle(d, 'j1', '   ', 'x'), d);
  const long = updateTodoTitle(d, 'j1', '好'.repeat(130), 'x');
  assert.equal(long.todos[0]?.title.length, 120);
});

/* ---------------- ⑨ milestonePicker 确定性 ---------------- */

test('milestonePicker：月份序列跨年进位、三档编码、当下建议、文案', () => {
  const months = monthOptions(new Date(2026, 10, 6), 3); // 2026-11 起
  assert.deepEqual(months.map((m) => m.value), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(periodValues('2026-10'), ['2026-10-上旬', '2026-10-中旬', '2026-10-下旬']);
  assert.equal(suggestPeriod(new Date(2026, 9, 6)), '2026-10-上旬');
  assert.equal(suggestPeriod(new Date(2026, 9, 15)), '2026-10-中旬');
  assert.equal(suggestPeriod(new Date(2026, 9, 28)), '2026-10-下旬');
  assert.equal(periodLabel('2026-09-中旬'), '2026 年 9 月中旬');
});
