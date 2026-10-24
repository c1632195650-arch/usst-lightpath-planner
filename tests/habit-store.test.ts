/**
 * F7-1 批 A3 · 习惯块（最小实现，零引擎改动）验收
 * ============================================================
 * 覆盖六块：
 *   · fixed 展开      —— habitToTasks 产出与既有 UserTask 同构的对象（id/时段/时长/周次）
 *   · accumulate 展开 —— splittable Commit 骨架（effortMin = 次数×时长，minAcceptableMin、window）
 *   · 存储层          —— usst.habits-v1 增删改查 + 归档；坏 JSON / 坏条目逐条回落（同 loadRecords 体例）
 *   · habitDebt       —— 全欠 / 部分还 / 还清三态 + skipped 不计 + 跨周不算 + id 相似不串账
 *   · markHabitDone   —— 打勾走既有 markBlock 通路（fixed = habit-{id}；accumulate = habit-{id}-s{n}）
 *   · UI 快照         —— habitRowViews（归档不显示、三态文案判定）+ habitWeekNoNow（termStart 缺失回落 1）
 *
 * Node 里没有 localStorage，用内存垫片（同 pref-learn.test.ts；被测模块只在函数内访问它）。
 * 零依赖：只用 node:test / node:assert，符合项目纪律（禁 tsx / ts-node）。
 *
 * 反向验证锚点（RV，改实现必红）：
 *   F7-RV1 ← habitDebt 的 done 匹配去掉连字符守卫（startsWith('habit-'+id)）→ 「id 相似不串账」红
 *   F7-RV2 ← habitDebt 的 done 匹配改成 === 全等（丢会话前缀匹配）→ 「accumulate 部分/还清」红
 *   F7-RV3 ← habitToTasks 的 accumulate effortMin 少乘 perWeekCount → 「effortMin 推导」红
 *   F7-RV4 ← loadHabits 的坏数据回落改成整列表失效（抛错/全弃）→ 「坏数据回落」红
 *   F7-RV5 ← markHabitDone 的会话号不按 done+1（恒 s1，同天互相覆盖）→ 「第二次打卡」红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- localStorage 内存垫片 ---------- */
class MemStorage {
  _m: Map<string, string> = new Map();
  get length(): number { return this._m.size; }
  clear(): void { this._m.clear(); }
  getItem(k: string): string | null { return this._m.has(k) ? (this._m.get(k) as string) : null; }
  key(i: number): string | null { return [...this._m.keys()][i] ?? null; }
  removeItem(k: string): void { this._m.delete(k); }
  setItem(k: string, v: string): void { this._m.set(k, String(v)); }
}
globalThis.localStorage = new MemStorage();

import {
  HABITS_KEY, addHabit, archiveHabit, clearHabits, habitRowViews, habitToTasks,
  habitWeekNoNow, loadHabits, markHabitDone, removeHabit, updateHabit,
  type HabitDef,
} from '@/lib/habitStore';
import {
  clearRecords, habitBlockId, habitDebt, habitSessionBlockId, loadRecords,
  type BehaviorRecord,
} from '@/lib/behaviorLog';
import { addDays, mondayOf, todayISO } from '@/lib/date';

/** 造一条行为记录（缺省：第 9 周、done、activity） */
let seq = 0;
function rec(over: Partial<BehaviorRecord> = {}): BehaviorRecord {
  seq += 1;
  return {
    id: `blk${seq}@2026-10-21`,
    blockId: `blk${seq}`,
    date: '2026-10-21',
    weekNo: 9,
    kind: 'activity',
    title: '跑步',
    plannedMin: 40,
    status: 'done',
    at: '2026-10-21T21:00:00.000Z',
    ...over,
  };
}

/** 两条常用习惯定义（与工作单示例同款） */
const RUN_FIXED: HabitDef = {
  id: 'run', title: '每周三 20:00 跑步 40min', kind: 'fixed',
  weekday: 3, startMin: 1200, durationMin: 40,
};
const READ_ACC: HabitDef = {
  id: 'read', title: '每周累计 3 次×40min 阅读', kind: 'accumulate',
  perWeekCount: 3, durationMin: 40, minAcceptableMin: 30, window: '晚间',
};

/* ============================================================
 * 一、fixed 展开（UserTask 同构：固定时段块）
 * ========================================================== */

test('fixed 展开: id/星期/开始分钟/时长逐字段正确（引擎既有「指定即固定块」语义）', () => {
  assert.deepEqual(habitToTasks(RUN_FIXED)[0], {
    id: 'habit-run',
    title: '每周三 20:00 跑步 40min',
    emoji: '🔁',
    kind: 'activity',
    dayOfWeek: 3,
    startMin: 1200,
    durationMin: 40,
    priority: 90,
    note: '来自习惯（每周固定打卡）',
  });
});

test('fixed 展开: 传 weekNo → 限定该周（weeks:[n]）；不传 → 无 weeks 键（全学期）', () => {
  const withWeek = habitToTasks(RUN_FIXED, 9)[0];
  assert.deepEqual('weeks' in withWeek && withWeek.weeks, [9]);
  assert.ok(!('weeks' in habitToTasks(RUN_FIXED)[0]), '不传 weekNo 不该出现 weeks 键');
});

test('fixed 展开: weekday 非法（0 或 9）→ 不产出 dayOfWeek（退化为交给引擎找空档，不猜）', () => {
  const bad = { ...RUN_FIXED, weekday: 9 };
  const t = habitToTasks(bad)[0];
  assert.ok(!('dayOfWeek' in t), 'weekday=9 不该产出 dayOfWeek');
  assert.ok(!('dayOfWeek' in habitToTasks({ ...RUN_FIXED, weekday: 0 })[0]), 'weekday=0 不该产出 dayOfWeek');
});

test('fixed 展开: 产物无 effortMin 键（保持 UserTask 形状，与 Commit 可区分）', () => {
  assert.ok(!('effortMin' in habitToTasks(RUN_FIXED)[0]));
  assert.ok(!('splittable' in habitToTasks(RUN_FIXED)[0]));
});

/* ============================================================
 * 二、accumulate 展开（splittable Commit 骨架）
 * ========================================================== */

test('accumulate 展开: effortMin = 次数×时长（3×40=120），minAcceptableMin/window/splittable 透传', () => {
  assert.deepEqual(habitToTasks(READ_ACC, 9)[0], {
    id: 'habit-read',
    title: '每周累计 3 次×40min 阅读',
    emoji: '🔁',
    kind: 'activity',
    effortMin: 120,
    minAcceptableMin: 30,
    splittable: true,
    window: { fromMin: 1080, toMin: 1440 },
    priority: 92,
    weeks: [9],
  });
});

test('accumulate 展开: effortMin 覆盖优先（给了就不按次数×时长推）', () => {
  const t = habitToTasks({ ...READ_ACC, effortMin: 150 })[0];
  assert.equal('effortMin' in t && t.effortMin, 150);
});

test('accumulate 展开: 缺 minAcceptableMin / window → 键缺席（不塞 undefined）', () => {
  const t = habitToTasks({ id: 'x', title: 'X', kind: 'accumulate', perWeekCount: 2, durationMin: 30 })[0];
  assert.ok(!('minAcceptableMin' in t));
  assert.ok(!('window' in t));
});

test('accumulate 展开: window 口径与 prefLearn 分桶逐字一致（morning<720 / afternoon 720–1080 / evening>1080）', () => {
  const w = (name?: string) => {
    const t = habitToTasks({ ...READ_ACC, window: name })[0];
    return 'window' in t ? t.window : undefined;
  };
  assert.deepEqual(w('morning'), { fromMin: 0, toMin: 720 });
  assert.deepEqual(w('afternoon'), { fromMin: 720, toMin: 1080 });
  assert.deepEqual(w('evening'), { fromMin: 1080, toMin: 1440 });
  assert.deepEqual(w('晚间'), { fromMin: 1080, toMin: 1440 }, '中文别名「晚间」= evening');
  assert.deepEqual(w('晚上'), { fromMin: 1080, toMin: 1440 }, '中文别名「晚上」= evening');
  assert.equal(w('深夜放电'), undefined, '认不出的名字 → 不加约束（undefined），不猜');
  assert.equal(w(undefined), undefined);
  assert.equal(w('  '), undefined, '空白串视为没给');
});

test('accumulate 展开: 归档 → 不展开（空数组）', () => {
  assert.deepEqual(habitToTasks({ ...READ_ACC, archived: true }), []);
  assert.deepEqual(habitToTasks({ ...RUN_FIXED, archived: true }), []);
});

test('块 id 口径: habitBlockId / habitSessionBlockId 与工作单命名一致（habit-{id}[-s{n}]）', () => {
  assert.equal(habitBlockId('run'), 'habit-run');
  assert.equal(habitSessionBlockId('run', 2), 'habit-run-s2');
});

/* ============================================================
 * 三、存储层：usst.habits-v1（增删改查 + 归档 + 坏数据回落）
 * ========================================================== */

test('存储: 键名与工作单指定一致；没写过 → 空数组', () => {
  localStorage.clear();
  assert.equal(HABITS_KEY, 'usst.habits-v1');
  assert.deepEqual(loadHabits(), []);
});

test('存储: addHabit 自动生成 h- 前缀 id，往返保留全部字段', () => {
  localStorage.clear();
  const next = addHabit({ title: '跑步', kind: 'fixed', weekday: 3, startMin: 1200, durationMin: 40 });
  assert.equal(next.length, 1);
  assert.ok(next[0].id.startsWith('h-'), `自动 id 应带 h- 前缀：${next[0].id}`);
  const loaded = loadHabits();
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], next[0]);
  assert.equal(loaded[0].weekday, 3);
  assert.equal(loaded[0].startMin, 1200);
});

test('存储: updateHabit 只打目标项（id 不存在 → 原样返回）', () => {
  localStorage.clear();
  const [a] = addHabit({ title: 'A', kind: 'fixed' });
  addHabit({ title: 'B', kind: 'accumulate', perWeekCount: 2, durationMin: 20 });
  const next = updateHabit(a.id, { title: 'A2' });
  assert.deepEqual(next.map((h) => h.title), ['A2', 'B']);
  assert.deepEqual(updateHabit('no-such-id', { title: 'X' }).map((h) => h.title), ['A2', 'B']);
});

test('存储: archiveHabit 归档可逆；removeHabit 真删；clearHabits 清空', () => {
  localStorage.clear();
  const [h] = addHabit({ title: 'C', kind: 'fixed' });
  assert.equal(archiveHabit(h.id)[0].archived, true);
  assert.equal(loadHabits()[0].archived, true, '归档落盘');
  assert.equal('archived' in archiveHabit(h.id, false)[0] && archiveHabit(h.id, false)[0].archived, false, '取消归档');
  assert.equal(loadHabits()[0].archived, false);
  assert.deepEqual(removeHabit(h.id), []);
  assert.deepEqual(loadHabits(), []);
  addHabit({ title: 'D', kind: 'fixed' });
  clearHabits();
  assert.deepEqual(loadHabits(), []);
});

test('存储: 坏 JSON / 非数组 → 回落空数组（不抛错）', () => {
  localStorage.clear();
  localStorage.setItem(HABITS_KEY, '{ 这不是合法 JSON');
  assert.deepEqual(loadHabits(), []);
  localStorage.setItem(HABITS_KEY, JSON.stringify({ version: 1 }));
  assert.deepEqual(loadHabits(), []);
});

test('存储: 坏条目只丢那一条（好条目保留，同 loadRecords 逐条校验口径）', () => {
  localStorage.clear();
  localStorage.setItem(HABITS_KEY, JSON.stringify([
    { id: 'ok1', title: '好的', kind: 'fixed', weekday: 3 },
    { id: 'bad-kind', title: 'kind 不认', kind: 'weekly' },
    { id: 'bad-weekday', title: 'weekday 越界', kind: 'fixed', weekday: 9 },
    { id: 'bad-weekday0', title: 'weekday=0', kind: 'fixed', weekday: 0 },
    { id: 'bad-count', title: '次数不是正整数', kind: 'accumulate', perWeekCount: 0, durationMin: 30 },
    { id: 'bad-archived', title: 'archived 不是布尔', kind: 'fixed', archived: 'yes' },
    { id: 'bad-title', title: '', kind: 'fixed' },
    { id: 'bad-start', title: 'startMin 越界', kind: 'fixed', startMin: 1440 },
    { id: '', title: 'id 空串', kind: 'fixed' },
  ]));
  assert.deepEqual(loadHabits().map((h) => h.id), ['ok1']);
});

/* ============================================================
 * 四、habitDebt：全欠 / 部分还 / 还清 三态 + 口径边界
 * ========================================================== */

test('habitDebt 全欠: 没有任何记录 → done=0, missing=expected（fixed 应做 1）', () => {
  const out = habitDebt([], [RUN_FIXED, READ_ACC], 9);
  assert.deepEqual(out, [
    { habitId: 'run', title: RUN_FIXED.title, expected: 1, done: 0, missing: 1 },
    { habitId: 'read', title: READ_ACC.title, expected: 3, done: 0, missing: 3 },
  ]);
});

test('habitDebt 部分还: 累计型 3 次做了 1 次（habit-read-s1）→ missing=2', () => {
  const records = [rec({ blockId: 'habit-read-s1', weekNo: 9 })];
  const out = habitDebt(records, [READ_ACC], 9);
  assert.deepEqual(out, [{ habitId: 'read', title: READ_ACC.title, expected: 3, done: 1, missing: 2 }]);
});

test('habitDebt 还清: 3 次会话都 done → missing=0（fixed 同理 1/1）', () => {
  const records = [
    rec({ blockId: 'habit-read-s1', weekNo: 9 }),
    rec({ blockId: 'habit-read-s2', weekNo: 9 }),
    rec({ blockId: 'habit-read-s3', weekNo: 9 }),
  ];
  assert.deepEqual(habitDebt(records, [READ_ACC], 9)[0].missing, 0);
  const fixed = [rec({ blockId: 'habit-run', weekNo: 9 })];
  const out = habitDebt(fixed, [RUN_FIXED], 9);
  assert.deepEqual(out[0], { habitId: 'run', title: RUN_FIXED.title, expected: 1, done: 1, missing: 0 });
});

test('habitDebt 口径: skipped 不抵账（欠账=应做−已做，没标记≠做了）；非本周记录不算', () => {
  const records = [
    rec({ blockId: 'habit-read-s1', weekNo: 9, status: 'skipped' }),
    rec({ blockId: 'habit-read-s2', weekNo: 8, status: 'done' }), // 上周
  ];
  const out = habitDebt(records, [READ_ACC], 9);
  assert.equal(out[0].done, 0);
  assert.equal(out[0].missing, 3);
});

test('habitDebt 口径: id 相似不串账（run 不吞 runner 的记录；带连字符守卫）', () => {
  const records = [
    rec({ blockId: 'habit-runner', weekNo: 9, title: 'runner 的' }),
    rec({ blockId: 'habit-runner-s1', weekNo: 9, title: 'runner 的会话' }),
    rec({ blockId: 'habit-run-s1', weekNo: 9, title: 'run 的会话' }),
  ];
  const habits: HabitDef[] = [
    { id: 'run', title: 'run', kind: 'accumulate', perWeekCount: 2, durationMin: 30 },
    { id: 'runner', title: 'runner', kind: 'fixed', weekday: 2 },
  ];
  const out = habitDebt(records, habits, 9);
  assert.deepEqual(out, [
    { habitId: 'run', title: 'run', expected: 2, done: 1, missing: 1 },
    { habitId: 'runner', title: 'runner', expected: 1, done: 2, missing: 0 },
  ]);
});

test('habitDebt 口径: 归档跳过、畸形 kind/id 跳过、accumulate 缺 perWeekCount → expected=0 不欠', () => {
  const habits: HabitDef[] = [
    { id: 'gone', title: '归档', kind: 'fixed', archived: true },
    { id: 'weird', title: 'kind 不认', kind: 'weekly' as unknown as 'fixed' },
    { id: 'nocount', title: '没给次数', kind: 'accumulate' },
  ];
  assert.deepEqual(habitDebt([], habits, 9), [
    { habitId: 'nocount', title: '没给次数', expected: 0, done: 0, missing: 0 },
  ]);
});

/* ============================================================
 * 五、markHabitDone：打勾 = 既有 markBlock 通路
 * ========================================================== */

test('markHabitDone(fixed): 记一条 done 记录，blockId=habit-{id}，startMin 透传（字段本身不动）', () => {
  localStorage.clear();
  const out = markHabitDone(RUN_FIXED, 9, '2026-10-21');
  assert.deepEqual(out, { blockId: 'habit-run', session: 0 });
  const loaded = loadRecords();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].blockId, 'habit-run');
  assert.equal(loaded[0].status, 'done');
  assert.equal(loaded[0].weekNo, 9);
  assert.equal(loaded[0].date, '2026-10-21');
  assert.equal(loaded[0].kind, 'activity');
  assert.equal(loaded[0].plannedMin, 40);
  assert.equal(loaded[0].startMin, 1200, 'fixed 的开始时刻透传进记录（F3 分桶可用）');
  assert.ok(!('place' in loaded[0]), 'place 不该被塞进来（别动那批新字段的既有语义）');
  // 同天再点 = 同块同天覆盖，不翻倍（markBlock 既有语义）
  markHabitDone(RUN_FIXED, 9, '2026-10-21');
  assert.equal(loadRecords().length, 1);
});

test('markHabitDone(accumulate): 会话号 = 本周已做数+1（s1 → s2），同天多次不互相覆盖', () => {
  localStorage.clear();
  const first = markHabitDone(READ_ACC, 9, '2026-10-21');
  assert.deepEqual(first, { blockId: 'habit-read-s1', session: 1 });
  const second = markHabitDone(READ_ACC, 9, '2026-10-21');
  assert.deepEqual(second, { blockId: 'habit-read-s2', session: 2 }, 'F7-RV5：恒 s1 会被同天覆盖，这条就红');
  assert.equal(loadRecords().length, 2);
  // 新的一周 → 会话号从头计（欠账按周算）
  const nextWeek = markHabitDone(READ_ACC, 10, '2026-10-28');
  assert.deepEqual(nextWeek, { blockId: 'habit-read-s1', session: 1 });
});

test('markHabitDone: 归档习惯 → 不写任何记录（返回 null）', () => {
  localStorage.clear();
  assert.equal(markHabitDone({ ...READ_ACC, archived: true }, 9, '2026-10-21'), null);
  assert.deepEqual(loadRecords(), []);
});

/* ============================================================
 * 六、UI 快照：habitRowViews / habitWeekNoNow（GoalTodoCard 习惯行的可测纯逻辑）
 * ========================================================== */

test('habitRowViews: 三态（空 / 进行中 / 全完成）+ 归档不显示', () => {
  localStorage.clear();
  // 空态
  assert.deepEqual(habitRowViews(9, [], []), []);
  // 进行中：read 做了 1/3，run 没做
  const habits = [RUN_FIXED, READ_ACC, { id: 'gone', title: '归档', kind: 'fixed', archived: true }];
  const partial = habitRowViews(9, [rec({ blockId: 'habit-read-s1', weekNo: 9 })], habits);
  assert.equal(partial.length, 2, '归档的不出现');
  assert.deepEqual(partial.map((r) => r.def.id), ['run', 'read']);
  assert.deepEqual(partial.map((r) => `${r.done}/${r.expected}`), ['0/1', '1/3']);
  assert.equal(partial[0].complete, false);
  assert.equal(partial[1].complete, false);
  // 全完成
  const done = habitRowViews(
    9,
    [
      rec({ blockId: 'habit-run', weekNo: 9 }),
      rec({ blockId: 'habit-read-s1', weekNo: 9 }),
      rec({ blockId: 'habit-read-s2', weekNo: 9 }),
      rec({ blockId: 'habit-read-s3', weekNo: 9 }),
    ],
    habits,
  );
  assert.equal(done.every((r) => r.complete), true, '每行 complete=true（UI 据此显示全完成文案）');
});

test('habitRowViews: expected=0 的畸形数据永远不算完成（不假绿）', () => {
  const out = habitRowViews(9, [], [{ id: 'nocount', title: '没给次数', kind: 'accumulate' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].complete, false);
});

test('habitWeekNoNow: 本周 termStart → 1；三周前 → 4；开学前 / 缺失 / 坏数据 → 1', () => {
  localStorage.clear();
  const monday = mondayOf(todayISO());
  const setTermStart = (ts: unknown) =>
    localStorage.setItem('usst-life-assistant-v2', JSON.stringify({ schedule: { termStart: ts } }));
  setTermStart(monday);
  assert.equal(habitWeekNoNow(), 1, 'termStart = 本周一 → 第 1 周');
  setTermStart(addDays(monday, -21));
  assert.equal(habitWeekNoNow(), 4, 'termStart 提前三周 → 第 4 周');
  setTermStart(addDays(monday, 7));
  assert.equal(habitWeekNoNow(), 1, '开学前 → 回落 1（与 webSync 的 ?? 1 同口径）');
  setTermStart(42);
  assert.equal(habitWeekNoNow(), 1, 'termStart 不是字符串 → 回落 1');
  localStorage.setItem('usst-life-assistant-v2', '{ 坏 JSON');
  assert.equal(habitWeekNoNow(), 1, '主状态坏 JSON → 回落 1');
  localStorage.removeItem('usst-life-assistant-v2');
  assert.equal(habitWeekNoNow(), 1, '没有主状态 → 回落 1');
});

/* ============================================================
 * 七、行为记录通路不回退（markBlock 既有行为顺带回归）
 * ========================================================== */

test('markBlock 既有语义不回退: 不传 startMin/place → 字段缺席；清空入口可用', () => {
  localStorage.clear();
  markHabitDone({ id: 'x', title: 'X', kind: 'accumulate', perWeekCount: 1, durationMin: 30 }, 9, '2026-10-21');
  const loaded = loadRecords();
  assert.equal(loaded.length, 1);
  assert.ok(!('startMin' in loaded[0]), 'accumulate 会话没有 startMin，不该塞 undefined');
  clearRecords();
  assert.deepEqual(loadRecords(), []);
});
