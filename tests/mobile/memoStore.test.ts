/**
 * 光溯移动端 · 待办/目标本地仓单测（新任务三 Wave 4）
 *
 * ⚠️ 反向验证记录（M3-W4 实跑）：
 *   ① toggleTodoDone 把 longterm 的「未填 plannedDone 拒绝」守卫删掉 → 「必填」组红；
 *   ② adoptCloudMemo 改成「本地直接覆盖云端」（放弃逐项合并）→ 「云端并发编辑保留」组红；
 *   恢复后全绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addGoal, addGoalMilestone, addTodo, adoptCloudMemo, archiveTodo,
  canAddGoal, isLongtermOverdue, loadMemo, memoNeedsAttention,
  openTodoCount, sortTodosForView, toggleGoalMilestone, toggleTodoDone,
  type MemoData,
} from '@/features/mobile/lib/memoStore.ts';
import { MEMO_CACHE_KEY, plannedDoneLabel, todoScheduleHint, type Todo } from '@/features/mobile/lib/memoTypes.ts';

const NOW = '2026-10-06T10:00:00.000Z';

function store(): { read: (k: string) => string | null; write: (k: string, v: string) => void; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, read: (k) => map.get(k) ?? null, write: (k, v) => void map.set(k, v) };
}

test('① addTodo：recent/longterm 都能建，title 截 120，completion 初始 null', () => {
  const d0: MemoData = { todos: [], goals: [] };
  const d1 = addTodo(d0, { title: '还书', kind: 'recent', nowIso: NOW });
  const d2 = addTodo(d1, { title: '背六级词', kind: 'longterm', nowIso: NOW, note: '目标 6000' });
  assert.equal(d2.todos.length, 2);
  assert.deepEqual(d2.todos.map((t) => t.completion), [null, null]);
  assert.ok(d2.todos[1].note === '目标 6000');
  const long = '长'.repeat(130);
  assert.equal(addTodo(d0, { title: long, kind: 'recent', nowIso: NOW }).todos[0].title.length, 120);
});

/* 反向验证 ① 实跑：删 completeTodo 的 need-planned-done 守卫 → 此组红 */
test('② 完成分流：recent 打勾即完成不填时间；longterm 未填 → 阻止（reason=need-planned-done）', () => {
  const d = addTodo({ todos: [], goals: [] }, { title: '还书', kind: 'recent', nowIso: NOW });
  const r1 = toggleTodoDone(d, d.todos[0].id, { nowIso: NOW });
  assert.ok(r1.ok && r1.todo?.completion === 'done' && r1.todo.plannedDone === undefined, 'recent 不要求时间');

  const d2 = addTodo({ todos: [], goals: [] }, { title: '背六级词', kind: 'longterm', nowIso: NOW });
  const r2 = toggleTodoDone(d2, d2.todos[0].id, { nowIso: NOW });
  assert.equal(r2.ok, false, 'longterm 不填时间必须被阻止');
  assert.equal(r2.reason, 'need-planned-done');
  assert.equal(r2.data.todos[0].completion, null, '阻止后不得悄悄完成');
});

test('③ longterm 填了粗粒度时间 → 完成 + actualDoneAt；精确到日格式 → 拒绝', () => {
  const d = addTodo({ todos: [], goals: [] }, { title: '背六级词', kind: 'longterm', nowIso: NOW });
  const id = d.todos[0].id;
  const bad = toggleTodoDone(d, id, { nowIso: NOW, plannedDone: '2026-10-15' });
  assert.deepEqual(bad.reason, 'bad-planned-done', '「粗糙一点」是硬口径，精确到日拒绝');
  const ok = toggleTodoDone(d, id, { nowIso: NOW, plannedDone: '2026-10-中旬' });
  assert.ok(ok.ok);
  assert.equal(ok.todo?.plannedDone, '2026-10-中旬');
  assert.equal(ok.todo?.actualDoneAt, NOW);
});

test('④ 勾选瞬间文案素材：plannedDoneLabel + 撤销勾选', () => {
  assert.equal(plannedDoneLabel('2026-09-中旬'), '2026 年 9 月中旬');
  const d = addTodo({ todos: [], goals: [] }, { title: '还书', kind: 'recent', nowIso: NOW });
  const id = d.todos[0].id;
  const done = toggleTodoDone(d, id, { nowIso: NOW });
  const undone = toggleTodoDone(done.data, id, { nowIso: NOW, uncomplete: true });
  assert.equal(undone.todo?.completion, null, '撤销回到未完成');
});

/* 反向验证 ② 实跑：adoptCloudMemo 改成 local 覆盖 → 此组红 */
test('⑤ 云端合并：另一端并发加的待办/改的完成态在 GET 采纳后保留（逐项 LWW）', () => {
  const local = addTodo({ todos: [], goals: [] }, { title: '手机上记的', kind: 'recent', nowIso: NOW, id: 'td-local' });
  const cloudTodo: Todo = {
    id: 'td-cloud', kind: 'longterm', title: '网页端补的', createdAt: NOW, updatedAt: NOW, completion: null,
  };
  const merged = adoptCloudMemo(local, [cloudTodo], []);
  assert.equal(merged.todos.length, 2, '并集不丢项');
  assert.ok(merged.todos.some((t) => t.id === 'td-cloud'), '云端新项必须进来');

  // 同一条：云端完成了（updatedAt 更新）→ 采纳后本地也显示完成
  const localStale = addTodo({ todos: [], goals: [] }, { title: '还书', kind: 'recent', nowIso: NOW, id: 'td-x' });
  const cloudDone: Todo = { ...localStale.todos[0], completion: 'done', updatedAt: '2026-10-06T11:00:00.000Z' };
  const merged2 = adoptCloudMemo(localStale, [cloudDone], []);
  assert.equal(merged2.todos[0].completion, 'done', '云端新 → 云端胜');
});

test('⑥ 归档而非删除：archiveTodo 保留数据，openTodoCount/视图过滤归档项', () => {
  let d = addTodo({ todos: [], goals: [] }, { title: '还书', kind: 'recent', nowIso: NOW });
  d = addTodo(d, { title: '别忘带伞', kind: 'recent', nowIso: NOW });
  d = archiveTodo(d, d.todos[0].id, NOW);
  assert.equal(d.todos.length, 2, '归档 ≠ 删除，数据还在');
  assert.equal(openTodoCount(d), 1);
  assert.deepEqual(sortTodosForView(d.todos).map((t) => t.title), ['别忘带伞']);
});

test('⑦ 目标：上限 3 个、挂里程碑、勾里程碑、归档', () => {
  let d: MemoData = { todos: [], goals: [] };
  for (let i = 0; i < 3; i++) d = addGoal(d, { title: `目标${i}`, nowIso: NOW }).data;
  assert.equal(canAddGoal(d), false, '1-3 个是硬口径');
  d = archiveTodo(d, 'never', NOW); // 不存在的 id：无害
  const added = addGoal(d, { title: '第四个', nowIso: NOW });
  // canAddGoal 拦在 UI 层；store 层仍可加（数据层不越权），由 UI 用 canAddGoal 拦
  assert.equal(added.data.goals.length, 4);
  const g1 = d.goals[0].id;
  const withMs = addGoalMilestone(d, g1, { title: '词汇过 6000' }, NOW);
  const msId = withMs.goals[0].milestones![0].id;
  const toggled = toggleGoalMilestone(withMs, g1, msId, '2026-10-06T11:00:00.000Z');
  assert.equal(toggled.goals[0].milestones![0].done, true);
  assert.ok(toggled.goals[0].updatedAt && toggled.goals[0].updatedAt !== d.goals[0].updatedAt, 'updatedAt 刷新（逐项 LWW 依据）');
});

test('⑧ 逾期判定：longterm 的 plannedDone 时段整段过去未完成 → 逾期；recent 永不逾期', () => {
  const mk = (t: Partial<Todo>): Todo => ({
    id: 'x', kind: 'longterm', title: '背词', createdAt: NOW, completion: null, ...t,
  });
  assert.equal(isLongtermOverdue(mk({ plannedDone: '2026-09-中旬' }), '2026-10-06'), true, '9 月中旬早过完了');
  assert.equal(isLongtermOverdue(mk({ plannedDone: '2026-10-下旬' }), '2026-10-06'), false, '10 月下旬还没过完');
  assert.equal(isLongtermOverdue(mk({ plannedDone: '2026-10-中旬' }), '2026-10-20'), false, '边界日：中旬最后一天（20 号）当天还不算逾期（2026-10-06 验收补，原覆盖缺口）');
  assert.equal(isLongtermOverdue(mk({ plannedDone: '2026-10-中旬' }), '2026-10-21'), true, '中旬 20 号止，21 号 = 逾期');
  assert.equal(isLongtermOverdue(mk({ kind: 'recent' }), '2027-01-01'), false);
  assert.equal(isLongtermOverdue(mk({ plannedDone: '2026-09-中旬', completion: 'done' }), '2026-10-06'), false, '完成了不算逾期');
  assert.equal(isLongtermOverdue(mk({ plannedDone: '2026-09-中旬', archived: true }), '2026-10-06'), false, '归档的不打扰');
  assert.equal(isLongtermOverdue(mk({ plannedDone: '垃圾' }), '2026-10-06'), false, '解析不了不误报');
});

test('⑨ 浮现卡常驻判定：有逾期/无里程碑目标 → 常驻；否则可淡出', () => {
  const overdue = addTodo({ todos: [], goals: [] }, { title: '过期词', kind: 'longterm', nowIso: NOW, id: 'td-o' });
  const withPd = { ...overdue, todos: [{ ...overdue.todos[0], plannedDone: '2026-09-中旬' }] };
  assert.equal(memoNeedsAttention(withPd, '2026-10-06'), true);
  assert.equal(memoNeedsAttention({ todos: [], goals: [] }, '2026-10-06'), false);
  const goalNoMs = addGoal({ todos: [], goals: [] }, { title: '没里程碑的目标', nowIso: NOW }).data;
  assert.equal(memoNeedsAttention(goalNoMs, '2026-10-06'), true, '目标还没拆里程碑 → 该被看见');
});

test('⑩ 缓存容错：坏 JSON / 缺键 → 空仓不白屏；键名与 memoTypes 常量一致', () => {
  const s = store();
  s.write(MEMO_CACHE_KEY, '{bad json');
  assert.deepEqual(loadMemo(s.read, MEMO_CACHE_KEY), { todos: [], goals: [] });
  s.write(MEMO_CACHE_KEY, JSON.stringify({ todos: 'not-array' }));
  assert.deepEqual(loadMemo(s.read, MEMO_CACHE_KEY).todos, []);
  s.write(MEMO_CACHE_KEY, JSON.stringify({ todos: [], goals: [] }));
  assert.deepEqual(loadMemo(s.read, MEMO_CACHE_KEY), { todos: [], goals: [] });
});

/* ---------------- M1c（2026-10-07）：待办排程状态回显 todoScheduleHint ---------------- */

test('M1c · todoScheduleHint：有 id → 「已排进周X」；无 id/坏 id → null（不显示，不制造噪音）', () => {
  assert.equal(todoScheduleHint({ scheduledBlockId: 'w5-d3-user-t1' }), '已排进周三');
  assert.equal(todoScheduleHint({ scheduledBlockId: 'w6-d7-study-t2-2' }), '已排进周日');
  // 反向三态
  assert.equal(todoScheduleHint({ scheduledBlockId: undefined }), null, '无 id → null');
  assert.equal(todoScheduleHint({ scheduledBlockId: 'study-policy-0' }), null, '坏 id（无星期段）→ null');
  assert.equal(todoScheduleHint({ scheduledBlockId: 'w5-d9-x' }), null, '星期越界 → null');
});
