/**
 * R2 测试：用户覆盖层（UserPlanLayer）
 * ============================================================
 * 重点三块：
 *   1. 纯函数（增删改、上限裁剪）
 *   2. **v1 → v2 迁移**（旧两个 key 合并进来，且坏数据不阻塞）
 *   3. 存储往返与坏数据过滤
 *
 * Node 里没有 localStorage，用内存垫片（store 只在函数内访问它）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

class MemStorage {
  _m = new Map();
  get length() { return this._m.size; }
  clear() { this._m.clear(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  key(i) { return [...this._m.keys()][i] ?? null; }
  removeItem(k) { this._m.delete(k); }
  setItem(k, v) { this._m.set(k, String(v)); }
}
globalThis.localStorage = new MemStorage();

import {
  addSlot, addTask, clearUserPlan, emptyUserPlan, excludeBlock, includeBlock,
  LEGACY_KEYS, loadUserPlan, makeLayerId, migrateFromLegacy, movesOfWeek,
  removeMove, removeSlot, removeTask, saveUserPlan, SCHEMA_VERSION,
  setMealPlace, STORAGE_KEY, upsertMove,
} from '@/features/week/userPlanStore';

/* ---------- 助手 ---------- */

function move(over = {}) {
  return { weekNo: 4, blockId: 'w4-d1-study-lib-2', dayOfWeek: 1, startMin: 600, endMin: 660, source: 'drag', ...over };
}
function task(over = {}) {
  return { id: 't1', title: '做实验报告', kind: 'study', durationMin: 90, ...over };
}
function slot(over = {}) {
  return { id: 's1', days: [4], fromMin: 780, toMin: 1080, weeks: [], scope: 'long', createdAtWeek: 5, ...over };
}

/* ============================================================
 * 一、纯函数
 * ========================================================== */

test('R2: 空覆盖层结构正确', () => {
  const e = emptyUserPlan();
  assert.equal(e.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(e.tasks, []);
  assert.deepEqual(e.excluded, []);
  assert.deepEqual(e.moves, []);
  assert.deepEqual(e.slots, []);
  assert.deepEqual(e.courseOverrides, []);
  assert.deepEqual(e.mealPlaces, {});
  assert.deepEqual(e.assignments, []);
});

test('R2: makeLayerId 生成唯一 id', () => {
  const s = new Set([makeLayerId('mv'), makeLayerId('mv'), makeLayerId('mv')]);
  assert.equal(s.size, 3);
});

test('R2: upsertMove 同块同周覆盖（改多次只留最后一次）', () => {
  const a = upsertMove([], move({ startMin: 600 }));
  const b = upsertMove(a, move({ startMin: 700 }));
  assert.equal(b.length, 1);
  assert.equal(b[0].startMin, 700);
});

test('R2: upsertMove 不同周各自独立', () => {
  const a = upsertMove([], move({ weekNo: 4 }));
  const b = upsertMove(a, move({ weekNo: 5 }));
  assert.equal(b.length, 2);
});

test('R2: movesOfWeek 只取该周', () => {
  const list = [move({ weekNo: 4 }), move({ weekNo: 5, blockId: 'x' })];
  assert.equal(movesOfWeek(list, 4).size, 1);
  assert.equal(movesOfWeek(list, 4).get('w4-d1-study-lib-2')?.weekNo, 4);
  assert.equal(movesOfWeek(list, 9).size, 0);
});

test('R2: removeMove 只删同块同周', () => {
  const list = [move({ weekNo: 4 }), move({ weekNo: 5 })];
  assert.equal(removeMove(list, 'w4-d1-study-lib-2', 4).length, 1);
  assert.equal(removeMove(list, 'w4-d1-study-lib-2', 9).length, 2);
});

test('R2: addTask / removeTask', () => {
  const a = addTask([], task());
  assert.equal(a.length, 1);
  assert.equal(addTask(a, task({ durationMin: 30 }))[0].durationMin, 30, '同 id 覆盖');
  assert.equal(removeTask(a, 't1').length, 0);
});

test('R2: excludeBlock 幂等；includeBlock 恢复', () => {
  const a = excludeBlock([], 'b1');
  assert.equal(excludeBlock(a, 'b1').length, 1, '重复排除不该产生两条');
  assert.equal(includeBlock(a, 'b1').length, 0);
});

test('R2: addSlot / removeSlot', () => {
  const a = addSlot([], slot());
  assert.equal(a.length, 1);
  assert.equal(removeSlot(a, 's1').length, 0);
});

test('R2: setMealPlace 设置与清空（传 undefined 删掉该餐次）', () => {
  let mp = setMealPlace({}, 'lunch', '第一食堂');
  assert.equal(mp.lunch, '第一食堂');
  mp = setMealPlace(mp, 'breakfast', '第二食堂');
  assert.equal(mp.breakfast, '第二食堂');
  mp = setMealPlace(mp, 'lunch', undefined);
  assert.equal(mp.lunch, undefined, '传 undefined 应当清空该餐次');
  assert.equal(mp.breakfast, '第二食堂', '不该影响别的餐次');
});

test('R2: setMealPlace 空串视为清空', () => {
  assert.equal(setMealPlace({ lunch: 'x' }, 'lunch', '   ').lunch, undefined);
});

/* ============================================================
 * 二、v1 → v2 迁移（本轮最要紧的一条）
 * ========================================================== */

test('迁移: 旧 planEdits + assignments 都被并进来', () => {
  const out = migrateFromLegacy(
    { schemaVersion: 1, userTasks: [task()], excludedBlockIds: ['b1', 'b2'] },
    { schemaVersion: 1, items: [{ id: 'a1', courseId: 'c1', courseTitle: '高数', weekNo: 3, estimatedMin: 60, createdAt: '' }] },
  );
  assert.equal(out.tasks.length, 1);
  assert.deepEqual(out.excluded, ['b1', 'b2']);
  assert.equal(out.assignments.length, 1);
  assert.equal(out.schemaVersion, SCHEMA_VERSION);
});

test('迁移: 只有一边有数据也能迁（另一个缺失就跳过）', () => {
  const onlyEdits = migrateFromLegacy({ userTasks: [task()] }, null);
  assert.equal(onlyEdits.tasks.length, 1);
  assert.deepEqual(onlyEdits.assignments, []);

  const onlyAsg = migrateFromLegacy(null, { items: [{ id: 'a1', courseId: 'c1', courseTitle: 'x', weekNo: 1, estimatedMin: 30 }] });
  assert.equal(onlyAsg.assignments.length, 1);
  assert.deepEqual(onlyAsg.tasks, []);
});

test('迁移: 坏数据被过滤，不阻塞迁移', () => {
  const out = migrateFromLegacy(
    { userTasks: [task(), { id: '' }, null, '字符串'], excludedBlockIds: ['ok', 123] },
    { items: [{ id: 'ok', courseId: 'c', courseTitle: 't', weekNo: 1, estimatedMin: 30 }, { id: 'bad' }] },
  );
  assert.equal(out.tasks.length, 1, '坏 task 应被丢掉');
  assert.deepEqual(out.excluded, [], '含非字符串的数组整体丢弃（宁缺毋滥）');
  assert.equal(out.assignments.length, 1);
});

test('迁移: 两边都是 null → 空覆盖层', () => {
  assert.deepEqual(migrateFromLegacy(null, null), emptyUserPlan());
});

/* ============================================================
 * 三、存储与 loadUserPlan 的迁移路径
 * ========================================================== */

test('存储: save → load 往返一致', () => {
  clearUserPlan();
  const layer = { ...emptyUserPlan(), excluded: ['b1'], mealPlaces: { lunch: '第一食堂' } };
  saveUserPlan(layer);
  const back = loadUserPlan();
  assert.deepEqual(back.excluded, ['b1']);
  assert.equal(back.mealPlaces.lunch, '第一食堂');
});

test('存储: 没写过任何东西 → 空覆盖层', () => {
  localStorage.clear();
  assert.deepEqual(loadUserPlan(), emptyUserPlan());
});

test('存储: 只有旧 key（模拟升级场景）→ 自动迁移并写回 v2', () => {
  localStorage.clear();
  localStorage.setItem(LEGACY_KEYS.edits, JSON.stringify({
    schemaVersion: 1, userTasks: [task()], excludedBlockIds: ['legacy-1'],
  }));
  const out = loadUserPlan();
  assert.equal(out.excluded.length, 1, '应当迁移出旧数据');
  assert.equal(out.excluded[0], 'legacy-1');
  // 迁移后应当已写回 v2 —— 再读一次走快路径
  assert.ok(localStorage.getItem(STORAGE_KEY), '迁移结果应已写回 v2 key');
  assert.deepEqual(loadUserPlan().excluded, ['legacy-1']);
});

test('存储: v2 坏 JSON → 不抛错（回落空或迁移）', () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, '{ 坏 JSON');
  assert.doesNotThrow(() => loadUserPlan());
});

test('存储: 版本不符 → 视为不可用（回落迁移路径）', () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 999, excluded: ['x'] }));
  assert.deepEqual(loadUserPlan(), emptyUserPlan(), '版本不符不该盲目采信');
});

test('存储: clearUserPlan 清空', () => {
  saveUserPlan({ ...emptyUserPlan(), excluded: ['z'] });
  clearUserPlan();
  assert.deepEqual(loadUserPlan(), emptyUserPlan());
});
