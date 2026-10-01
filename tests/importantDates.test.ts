/**
 * 统一日期层测试（总览页改版 批次 1）
 * ============================================================
 * 重点：三源合并（内置/用户/目标）、忽略与恢复、坏数据过滤、
 * 目标源**动态性**（改 Goal.dueAt 后合并结果必须跟着变 —— 防双写的关键）。
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

import type { Deadline } from '@/data/usst';
import type { Goal } from '@/features/activity/goalStore';
import {
  builtinImportantDates, emptyImportantDates, goalImportantDates,
  loadImportantDates, mergeImportantDates, saveImportantDates,
  sanitizeImportantDates, withIgnoredBuiltin, withUserDate,
  withoutIgnoredBuiltin, withoutUserDate,
} from '@/features/overview/importantDatesStore';

/* ---------- 助手 ---------- */

function deadline(over: Partial<Deadline> = {}): Deadline {
  return {
    id: 'd1', date: '2026-10-01', title: '示例节点', emoji: '📌', tag: '竞赛',
    color: '#6B4BA3', ...over,
  };
}

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1', title: '数学建模', emoji: '🏆', kind: 'contest', ...over,
  } as Goal;
}

/* ============================================================
 * 一、来源映射（纯函数）
 * ========================================================== */

test('日期层: 内置种子映射 —— 考试归 exam，其余归 deadline，保留 tag', () => {
  const out = builtinImportantDates([
    deadline({ id: 'exam1', tag: '考试' }),
    deadline({ id: 'race1', tag: '竞赛' }),
    deadline({ id: 'reg1', tag: '报名', note: '盯紧通知' }),
  ]);
  assert.equal(out.length, 3);
  const byId = new Map(out.map((d) => [d.id, d]));
  assert.equal(byId.get('builtin-exam1')!.kind, 'exam');
  assert.equal(byId.get('builtin-race1')!.kind, 'deadline');
  assert.equal(byId.get('builtin-race1')!.source, 'builtin');
  assert.equal(byId.get('builtin-reg1')!.tag, '报名');
  assert.equal(byId.get('builtin-reg1')!.note, '盯紧通知');
  assert.equal(byId.get('builtin-exam1')!.date, byId.get('builtin-exam1')!.date); // 结构稳定
});

test('日期层: 目标源只取带 dueAt 的 Goal', () => {
  const out = goalImportantDates([
    goal({ id: 'a', dueAt: '2026-11-01' }),
    goal({ id: 'b' }),              // 没截止 → 不进
    goal({ id: 'c', dueAt: '' }),   // 空串 → 不进
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'goal-a');
  assert.equal(out[0].date, '2026-11-01');
  assert.equal(out[0].source, 'goal');
});

/* ============================================================
 * 二、合并
 * ========================================================== */

test('日期层: 三源合并按日期升序', () => {
  const deadlines = [deadline({ id: 'late', date: '2026-12-01' })];
  const goals = [goal({ id: 'g', dueAt: '2026-09-20' })];
  let state = emptyImportantDates();
  state = withUserDate(state, { title: '小组展示', date: '2026-10-15', kind: 'personal' });
  const out = mergeImportantDates(state, deadlines, goals);
  assert.deepEqual(out.map((d) => d.date), ['2026-09-20', '2026-10-15', '2026-12-01']);
  assert.deepEqual(out.map((d) => d.source), ['goal', 'user', 'builtin']);
});

test('日期层: 忽略内置项后不再出现，恢复后回来；用户项不受影响', () => {
  const deadlines = [deadline({ id: 'gdb' }), deadline({ id: 'cet' })];
  let state = emptyImportantDates();
  state = withUserDate(state, { title: '个人节点', date: '2026-11-11', kind: 'personal' });

  state = withIgnoredBuiltin(state, 'builtin-gdb');
  let out = mergeImportantDates(state, deadlines, []);
  assert.equal(out.some((d) => d.id === 'builtin-gdb'), false);
  assert.equal(out.some((d) => d.id === 'builtin-cet'), true);
  assert.equal(out.some((d) => d.title === '个人节点'), true);

  // 幂等
  const twice = withIgnoredBuiltin(state, 'builtin-gdb');
  assert.equal(twice.ignoredBuiltinIds.length, state.ignoredBuiltinIds.length);

  state = withoutIgnoredBuiltin(state, 'builtin-gdb');
  out = mergeImportantDates(state, deadlines, []);
  assert.equal(out.some((d) => d.id === 'builtin-gdb'), true);
});

test('日期层: withUserDate / withoutUserDate 往返', () => {
  let state = emptyImportantDates();
  state = withUserDate(state, { title: '答辩', date: '2026-10-20', kind: 'personal' });
  assert.equal(state.items.length, 1);
  const id = state.items[0].id;
  assert.ok(id.startsWith('user-'));
  const after = withoutUserDate(state, id);
  assert.equal(after.items.length, 0);
  // 删不存在的 id：原样返回（同一引用）
  assert.equal(withoutUserDate(state, 'nope'), state);
});

/* ============================================================
 * 三、目标源动态性（防双写的关键）
 * ========================================================== */

test('日期层: 改 Goal.dueAt 后合并结果跟着变（不存储目标项）', () => {
  const deadlines: Deadline[] = [];
  const goals1 = [goal({ id: 'g', dueAt: '2026-11-01' })];
  const state = emptyImportantDates();

  const out1 = mergeImportantDates(state, deadlines, goals1);
  assert.equal(out1[0].date, '2026-11-01');

  // 目标改了截止日期 —— 传入新的 goals 即可，state 不需要任何操作
  const goals2 = [goal({ id: 'g', dueAt: '2026-12-25' })];
  const out2 = mergeImportantDates(state, deadlines, goals2);
  assert.equal(out2[0].date, '2026-12-25');
});

/* ============================================================
 * 四、存储与坏数据
 * ========================================================== */

test('日期层: localStorage 往返', () => {
  let state = emptyImportantDates();
  state = withUserDate(state, { title: '面试', date: '2026-10-30', kind: 'personal', note: '带简历' });
  state = withIgnoredBuiltin(state, 'builtin-gdb');
  saveImportantDates(state);

  const back = loadImportantDates();
  assert.equal(back.items.length, 1);
  assert.equal(back.items[0].title, '面试');
  assert.deepEqual(back.ignoredBuiltinIds, ['builtin-gdb']);
});

test('日期层: 坏数据过滤 —— 单条坏不阻塞整体', () => {
  const raw = {
    schemaVersion: 1,
    items: [
      { id: 'ok1', date: '2026-10-01', title: '好的', kind: 'personal', source: 'user' },
      { id: 'bad-date', date: '10月1号', title: '坏日期', kind: 'personal', source: 'user' },
      { id: 'bad-kind', date: '2026-10-02', title: '坏类别', kind: 'xxx', source: 'user' },
      'not-an-object',
      { id: 'ok2', date: '2026-11-01', title: '也好', kind: 'exam', source: 'user' },
    ],
    ignoredBuiltinIds: ['builtin-gdb', 42, ''],
  };
  const clean = sanitizeImportantDates(raw);
  assert.deepEqual(clean.items.map((i) => i.id), ['ok1', 'ok2']);
  assert.deepEqual(clean.ignoredBuiltinIds, ['builtin-gdb']);
});

test('日期层: load 空环境 / 坏 JSON 返回空结构', () => {
  localStorage.removeItem('usst-important-dates-v1');
  assert.deepEqual(loadImportantDates(), emptyImportantDates());
  localStorage.setItem('usst-important-dates-v1', '{{{bad json');
  assert.deepEqual(loadImportantDates(), emptyImportantDates());
});
