/**
 * M3 · 云同步契约测试（F8/F9 · tests/syncContract.test.ts）
 * ============================================================
 * 覆盖方案 §10 验收矩阵的 TS 部分：
 *   · buildSyncPayload 序列化往返（JSON 消毒后关键字段逐值相等）
 *   · LWW 决策函数 decideLww（新/旧/相等/非法/无服务端 五分支）
 *   · weekNoFromTermStart 日期数学（手算锚点：2026-09-07 周一起算）
 *   · applyLayerToBlocks 覆盖层映射（§7.3：excluded/moves/done/排序）
 *   · todaySignature（F9 变化标记）稳定 + 敏感
 *   · webSyncTick：**开关关=零网络请求**（方案 §11 回滚承诺）+ 上传体契约 + LWW 拒绝路径
 *
 * ⚠️ 反向验证记录（2026-10-03 夜）：decideLww 的「相等→false」与 webSyncTick 的
 * 「开关关→零 fetch」两组断言，在实现被临时破坏（相等改 true / 开关判定删掉）时
 * 均变红，恢复后全绿 —— 过程见通宵日志。
 */
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  } as Storage;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Schedule, TimeBlock } from '@/types';
import {
  buildSyncPayload, decideLww, weekNoFromTermStart,
  applyLayerToBlocks, todaySignature, stableHash, parseDate, fmtMin,
} from '@/features/mobile/lib/sync.ts';
import {
  completeTodo, mergeGoals, mergeTodos, plannedDoneLabel, stampNewer, todoStamp,
  type Goal, type Todo,
} from '@/features/mobile/lib/memoTypes.ts';
import {
  webSyncTick, WEB_STATE_KEY, WEB_LAYER_KEY, SWITCH_KEY, LAST_SIG_KEY, LAST_SYNC_KEY,
  type WebSyncDeps,
} from '@/features/mobile/lib/webSync.ts';
import { emptyUserPlan, type UserPlanLayer } from '@/features/week/userPlanStore';

const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 20,
  source: 'demo',
  courses: [{
    id: 'c1', name: '高等数学AI', credit: 4, category: '公共基础', campus: 'main',
    slots: [{ dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3] }],
  }],
};

const PLAN_STATE = {
  version: 1, lastPlanWeek: 4, locks: { 'w4-d1-x': 'hard' as const }, churnMin: 12,
  lockedPlacements: {}, updatedAt: '2026-10-02T10:00:00.000Z', rolling: null, rollingBase: null,
};

const LAYER: UserPlanLayer = {
  ...emptyUserPlan(),
  moves: [{ weekNo: 4, blockId: 'w4-d1-study-lib-1', dayOfWeek: 1, startMin: 795, endMin: 885, source: 'edit' as const, done: true }],
  excluded: ['w4-d2-blank-1'],
};

/* ---------------- 序列化往返 ---------------- */

test('buildSyncPayload：关键字段经 JSON 消毒后逐值往返相等', () => {
  const payload = buildSyncPayload({
    schedule: SCHEDULE, planState: PLAN_STATE, userOverrides: LAYER,
    termStart: '2026-09-07', weekNo: 4, clientUpdatedAt: '2026-10-03T12:00:00.000Z',
  });
  assert.equal(payload.schemaVer, 2, 'schemaVer=2（新任务三 P0 契约）');
  assert.equal(payload.termStart, '2026-09-07');
  assert.equal(payload.weekNo, 4);
  const rt = JSON.parse(JSON.stringify(payload));
  assert.deepEqual(rt.schedule, SCHEDULE, 'schedule 应原样往返');
  assert.deepEqual(rt.planState, PLAN_STATE, 'planState 应原样往返');
  assert.deepEqual(rt.userOverrides, LAYER, '覆盖层应原样往返');
  // 前向兼容条款：多余字段允许存在（客户端忽略）——这里只锁必需键存在
  for (const k of ['schemaVer', 'termStart', 'weekNo', 'schedule', 'clientUpdatedAt']) {
    assert.ok(k in rt, `payload 必须含 ${k}`);
  }
});

test('buildSyncPayload：null 的 planState/userOverrides 序列化为 null 而非缺省丢失', () => {
  const payload = buildSyncPayload({
    schedule: SCHEDULE, planState: null, userOverrides: null,
    termStart: '2026-09-07', weekNo: 1, clientUpdatedAt: '2026-10-03T12:00:00.000Z',
  });
  const rt = JSON.parse(JSON.stringify(payload));
  assert.equal(rt.planState, null);
  assert.equal(rt.userOverrides, null);
});

/* ---------------- LWW ---------------- */

test('decideLww：新→true、旧→false、相等→false、非法→false、无服务端→true', () => {
  const now = '2026-10-03T12:00:00.000Z';
  assert.equal(decideLww('2026-10-03T12:00:01.000Z', now), true, '客户端新 1 秒 → 可写');
  assert.equal(decideLww('2026-10-03T11:59:59.000Z', now), false, '客户端旧 → 拒');
  assert.equal(decideLww(now, now), false, '相等 → 拒（不许无意义覆写）');
  // Z 与 +00:00、毫秒位数差异：解析成时间比，不吃字符串序的亏
  assert.equal(decideLww('2026-10-03T20:00:00+08:00', '2026-10-03T12:00:00Z'), false, '同一时刻不同写法 → 相等 → 拒');
  assert.equal(decideLww('2026-10-03T12:00:01+00:00', '2026-10-03T12:00:00Z'), true, '+00:00 后缀同样可解析');
  assert.equal(decideLww('昨天', now), false, '非法时间戳 → 宁可拒');
  assert.equal(decideLww(now, null), true, '云端没有状态 → 首传必放行');
});

/* ---------------- 周号日期数学（手算锚点） ---------------- */

test('weekNoFromTermStart：周一锚点、周日收尾、跨周进位、学期前 → null', () => {
  const d = (s: string) => {
    const [y, m, dd] = s.split('-').map(Number);
    return new Date(y, m - 1, dd);
  };
  assert.equal(weekNoFromTermStart('2026-09-07', d('2026-09-07')), 1, 'termStart 当天 = 第 1 周周一');
  assert.equal(weekNoFromTermStart('2026-09-07', d('2026-09-13')), 1, '第 1 周周日仍是第 1 周');
  assert.equal(weekNoFromTermStart('2026-09-07', d('2026-09-14')), 2, '第二个周一 = 第 2 周');
  assert.equal(weekNoFromTermStart('2026-09-07', d('2026-10-03')), 4, '2026-10-03（周六）= 第 4 周');
  assert.equal(weekNoFromTermStart('2026-09-07', d('2026-09-06')), null, '学期开始前 → null');
  assert.equal(weekNoFromTermStart('not-a-date', d('2026-10-03')), null, '非法 termStart → null');
  assert.equal(parseDate('2026-13-40'), null, 'parseDate 拒收假日期字符串由正则兜底');
});

/* ---------------- 覆盖层映射（§7.3） ---------------- */

function block(p: Partial<TimeBlock>): TimeBlock {
  return {
    id: 'b', kind: 'study', dayOfWeek: 1, startMin: 480, endMin: 540,
    title: '块', source: 'template', ...p,
  };
}

test('applyLayerToBlocks：excluded 剔除、moves 改位、done 标记、按时间排序', () => {
  const plan = {
    weekNo: 4,
    blocks: [
      block({ id: 'w4-d1-course-0', startMin: 480, endMin: 570, title: '高数', kind: 'course' as const }),
      block({ id: 'w4-d1-study-lib-1', startMin: 780, endMin: 870, title: '自习' }),
      block({ id: 'w4-d1-blank-9', startMin: 960, endMin: 1020, title: '留白' }),
      block({ id: 'w4-d2-x', dayOfWeek: 2 as const, startMin: 600, endMin: 660, title: '别天' }),
    ],
    stats: { courseMin: 0, studyMin: 0, blankMin: 0, blockCount: 4 },
    issues: [],
  };
  const layer: UserPlanLayer = {
    ...emptyUserPlan(),
    excluded: ['w4-d1-blank-9'],
    moves: [{ weekNo: 4, blockId: 'w4-d1-study-lib-1', dayOfWeek: 1, startMin: 795, endMin: 885, source: 'edit' as const, done: true }],
  };
  const { blocks, doneIds } = applyLayerToBlocks(plan as never, layer, 4, 1);
  const ids = blocks.map((b) => b.id);
  assert.ok(!ids.includes('w4-d1-blank-9'), 'excluded 的块必须消失');
  assert.ok(!ids.includes('w4-d2-x'), '只出今天（dow=1）的块');
  const moved = blocks.find((b) => b.id === 'w4-d1-study-lib-1');
  assert.ok(moved);
  assert.equal(moved.startMin, 795, 'move 的 startMin 生效');
  assert.equal(moved.endMin, 885, '时长守恒（90 分钟平移）');
  assert.ok(doneIds.has('w4-d1-study-lib-1'), 'done 进 doneIds');
  // 排序
  const starts = blocks.map((b) => b.startMin);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), '按 startMin 升序');
  // 向后兼容：别的周的 move 不影响本周
  const { blocks: otherWeek } = applyLayerToBlocks(plan as never, layer, 5, 1);
  assert.equal(otherWeek.find((b) => b.id === 'w4-d1-study-lib-1')?.startMin, 780, '第 5 周不受第 4 周覆盖影响');
});

test('todaySignature：内容不变签名稳定；时间/完成态任一变化即变', () => {
  const a = [block({ id: 'x', startMin: 480, endMin: 540 })];
  const b = [block({ id: 'x', startMin: 480, endMin: 540 })];
  assert.equal(todaySignature(a, new Set()), todaySignature(b, new Set()));
  const c = [block({ id: 'x', startMin: 495, endMin: 555 })];
  assert.notEqual(todaySignature(a, new Set()), todaySignature(c, new Set()), '顺延后签名必须变');
  assert.notEqual(todaySignature(a, new Set()), todaySignature(a, new Set(['x'])), '标记完成后签名必须变');
  assert.notEqual(stableHash('abc'), stableHash('abd'), '哈希对输入敏感');
});

/* ---------------- schemaVer=2：todos / goals / persona 契约 ---------------- */

const T1: Todo = {
  id: 't1', kind: 'recent', title: '还书', createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-05T08:00:00.000Z', completion: null,
};
const T2: Todo = {
  id: 't2', kind: 'longterm', title: '背完六级词', createdAt: '2026-10-01T09:00:00.000Z',
  completion: null, plannedDone: '2026-12-中旬',
};
const G1: Goal = {
  id: 'g1', title: '拿下六级', createdAt: '2026-10-01T07:00:00.000Z',
  updatedAt: '2026-10-05T07:00:00.000Z',
  milestones: [{ id: 'ms1', title: '词汇量过 6000', done: false }],
};

test('buildSyncPayload：todos/goals/persona 随 schemaVer=2 完整往返', () => {
  const payload = buildSyncPayload({
    schedule: SCHEDULE, planState: PLAN_STATE, userOverrides: LAYER,
    termStart: '2026-09-07', weekNo: 4, clientUpdatedAt: '2026-10-05T12:00:00.000Z',
    todos: [T1, T2], goals: [G1],
    persona: { axes: { social: 62 }, scenarios: null } as never,
  });
  assert.equal(payload.schemaVer, 2);
  const rt = JSON.parse(JSON.stringify(payload));
  assert.deepEqual(rt.todos, [T1, T2], 'todos 应原样往返');
  assert.deepEqual(rt.goals, [G1], 'goals 应原样往返');
  assert.equal(rt.persona.axes.social, 62, 'persona 应原样往返');
});

test('buildSyncPayload：空数组 / null 一律**键不出现**（不用空值覆盖云端）', () => {
  const absent = buildSyncPayload({
    schedule: SCHEDULE, planState: null, userOverrides: null,
    termStart: '2026-09-07', weekNo: 1, clientUpdatedAt: '2026-10-05T12:00:00.000Z',
  });
  assert.ok(!('todos' in absent), '缺省时 todos 键不得出现');
  assert.ok(!('goals' in absent), '缺省时 goals 键不得出现');
  assert.ok(!('persona' in absent), '缺省时 persona 键不得出现');
  const empty = buildSyncPayload({
    schedule: SCHEDULE, planState: null, userOverrides: null,
    termStart: '2026-09-07', weekNo: 1, clientUpdatedAt: '2026-10-05T12:00:00.000Z',
    todos: [], goals: [], persona: null,
  });
  assert.ok(!('todos' in empty), '空数组也视为「没有」');
  assert.ok(!('goals' in empty));
  assert.ok(!('persona' in empty));
});

test('前向兼容：云端 state 含客户端不认识的字段 → 已知字段读取不受影响', () => {
  const fromCloud = JSON.parse(JSON.stringify({
    ...buildSyncPayload({
      schedule: SCHEDULE, planState: null, userOverrides: LAYER,
      termStart: '2026-09-07', weekNo: 4, clientUpdatedAt: '2026-10-05T12:00:00.000Z',
    }),
    futureField: { anything: true }, // 未来版本可能新增的键
  }));
  assert.equal(fromCloud.termStart, '2026-09-07');
  assert.equal(fromCloud.userOverrides.moves[0].blockId, 'w4-d1-study-lib-1');
  assert.equal(fromCloud.futureField.anything, true, '未知键原样存在（客户端忽略即可）');
});

/* ---------------- 逐项 LWW 合并（memoTypes 纯函数，服务端有同语义实现） ---------------- */

test('mergeTodos：并集保序去重；同 id 新者胜（双向）', () => {
  const localEdit: Todo = { ...T1, title: '还三本书', updatedAt: '2026-10-06T08:00:00.000Z' };
  const remoteEdit: Todo = { ...T2, completion: 'done', actualDoneAt: '2026-10-06T09:00:00.000Z', updatedAt: '2026-10-06T09:00:00.000Z' };
  // 本地改了 t1、云端改了 t2、两侧都有对方没有的项
  const merged = mergeTodos([localEdit], [T1, remoteEdit, T2]);
  const byId = new Map(merged.map((t) => [t.id, t]));
  assert.equal(byId.get('t1')?.title, '还三本书', '本地新 → 本地胜');
  assert.equal(byId.get('t2')?.completion, 'done', '云端新 → 云端胜');
  assert.equal(merged.length, 2, '并集无重复');
});

test('mergeTodos：时间戳平局 → 云端副本胜（以云端为准）', () => {
  const sameStamp: Todo = { ...T1 };
  const remoteSame: Todo = { ...T1, title: '云端同戳版本' };
  const merged = mergeTodos([sameStamp], [remoteSame]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, '云端同戳版本', '平局不许本地覆盖云端');
});

test('mergeTodos：updatedAt 缺省退回 createdAt；脏项（无 id）丢弃', () => {
  const oldByCreatedAt: Todo = { ...T1, updatedAt: undefined, createdAt: '2026-10-02T00:00:00.000Z' };
  const newerRemote: Todo = { ...T1, updatedAt: '2026-10-03T00:00:00.000Z' };
  const merged = mergeTodos([oldByCreatedAt], [newerRemote, { title: '没 id 的毒项' } as never]);
  assert.equal(merged.length, 1, '毒项必须被丢弃');
  assert.equal(merged[0].updatedAt, '2026-10-03T00:00:00.000Z', 'createdAt 旧 → 云端胜');
  const localNewer: Todo = { ...T1, updatedAt: undefined, createdAt: '2026-10-04T00:00:00.000Z' };
  const merged2 = mergeTodos([localNewer], [newerRemote]);
  assert.equal(merged2[0].createdAt, '2026-10-04T00:00:00.000Z', 'createdAt 新 → 本地胜');
});

test('mergeGoals：与待办同语义（里程碑整项随目标 LWW）', () => {
  const localEdit: Goal = { ...G1, why: '为了出国交流', updatedAt: '2026-10-06T00:00:00.000Z' };
  const remoteNew: Goal = { id: 'g2', title: '保研', createdAt: '2026-10-05T00:00:00.000Z' };
  const merged = mergeGoals([localEdit], [G1, remoteNew]);
  const byId = new Map(merged.map((g) => [g.id, g]));
  assert.equal(byId.get('g1')?.why, '为了出国交流');
  assert.equal(byId.get('g2')?.title, '保研');
  assert.equal(merged.length, 2);
});

test('stampNewer/todoStamp：ISO 变体按时间比、非法退字符串比、空串最旧', () => {
  assert.equal(stampNewer('2026-10-03T20:00:00+08:00', '2026-10-03T12:00:00Z'), false, '同一时刻不同写法 = 平局');
  assert.equal(stampNewer('2026-10-03T12:00:01+00:00', '2026-10-03T12:00:00Z'), true);
  assert.equal(stampNewer('abc', 'abd'), false, '非法退字符串比');
  assert.equal(stampNewer('abd', 'abc'), true);
  assert.equal(stampNewer('', ''), false, '双空 = 平局');
  assert.equal(todoStamp({ updatedAt: undefined, createdAt: '2026-10-01T00:00:00Z' }), '2026-10-01T00:00:00Z');
});

/* ---------------- 完成分流（CY 核心：两类待办完成流程必须不同） ---------------- */

test('completeTodo：recent 打勾即完成，**不要求**填时间', () => {
  const nowIso = '2026-10-06T10:00:00.000Z';
  const r = completeTodo(T1, { nowIso });
  assert.ok(r.ok);
  assert.equal(r.todo.completion, 'done');
  assert.equal(r.todo.actualDoneAt, nowIso);
  assert.equal(r.todo.plannedDone, undefined, 'recent 不许被塞完成期');
  assert.equal(r.todo.updatedAt, nowIso, 'updatedAt 必须刷新（逐项 LWW 依据）');
});

test('completeTodo：longterm 未填完成时间 → 拒绝（防遗忘的硬规则）', () => {
  const r = completeTodo(T2, { nowIso: '2026-10-06T10:00:00.000Z' });
  assert.deepEqual(r, { ok: false, reason: 'need-planned-done' });
  const r2 = completeTodo(T2, { nowIso: '2026-10-06T10:00:00.000Z', plannedDone: '  ' });
  assert.equal(r2.ok, false);
});

test('completeTodo：longterm 填了粗粒度时间 → 完成；格式非法 → 拒绝', () => {
  const nowIso = '2026-10-06T10:00:00.000Z';
  const ok = completeTodo(T2, { nowIso, plannedDone: '2026-10-中旬' });
  assert.ok(ok.ok);
  assert.equal(ok.todo.plannedDone, '2026-10-中旬');
  assert.equal(ok.todo.actualDoneAt, nowIso);
  const bad = completeTodo(T2, { nowIso, plannedDone: '2026-10-15' }); // 精确到日 = 违反 CY「粗糙一点」
  assert.deepEqual(bad, { ok: false, reason: 'bad-planned-done' });
});

test('plannedDoneLabel：粗粒度编码 → 人类文案；解析失败原样返回', () => {
  assert.equal(plannedDoneLabel('2026-09-中旬'), '2026 年 9 月中旬');
  assert.equal(plannedDoneLabel('2027-03-上旬'), '2027 年 3 月上旬');
  assert.equal(plannedDoneLabel('随便'), '随便');
});

/* ---------------- F8 webSyncTick：开关关 = 零网络 ---------------- */

function makeDeps(over: Partial<WebSyncDeps> = {}): { deps: WebSyncDeps; calls: Array<{ url: string; init: RequestInit }> } {
  const store = new Map<string, string>();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  store.set(WEB_STATE_KEY, JSON.stringify({
    version: 4, schedule: SCHEDULE, planState: PLAN_STATE, persona: null,
  }));
  store.set(WEB_LAYER_KEY, JSON.stringify(LAYER));
  const deps: WebSyncDeps = {
    read: (k) => store.get(k) ?? null,
    write: (k, v) => void store.set(k, v),
    fetchImpl: (async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ accepted: true, updatedAt: '2026-10-03T12:00:05.000Z' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch,
    today: () => new Date('2026-10-03T12:00:00.000Z'),
    token: 'tok',
    ...over,
  };
  return { deps, calls };
}

test('webSyncTick：开关关 → 一次 fetch 都不发（F8 回滚承诺）', async () => {
  const { deps, calls } = makeDeps();
  const r = await webSyncTick(deps);
  assert.equal(r.reason, 'switch-off');
  assert.equal(calls.length, 0, '零网络请求');
});

test('webSyncTick：开关开 + 内容变化 → 恰好一次 PUT，请求体契约正确', async () => {
  const { deps, calls } = makeDeps();
  deps.write(SWITCH_KEY, '1');
  const r = await webSyncTick(deps);
  assert.equal(r.reason, 'accepted');
  assert.equal(calls.length, 1, '只发一次');
  assert.equal(calls[0].url, '/api/sync/state');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.schemaVer, 2);
  assert.equal(body.state.termStart, '2026-09-07');
  assert.equal(body.state.weekNo, 4, 'termStart+today 推算当前周');
  assert.equal(body.state.userOverrides.moves[0].blockId, 'w4-d1-study-lib-1', 'web 覆盖层原样上行');
  assert.equal(body.clientUpdatedAt, '2026-10-03T12:00:00.000Z');
  // 签名落档：内容不变 → 下一 tick 不再发
  assert.ok(deps.read(LAST_SIG_KEY));
  const r2 = await webSyncTick(deps);
  assert.equal(r2.reason, 'unchanged');
  assert.equal(calls.length, 1, '去抖后零新增请求');
});

test('webSyncTick：LWW 被拒 → 不重试刷屏，记录云端 updatedAt', async () => {
  const store = new Map<string, string>();
  store.set(WEB_STATE_KEY, JSON.stringify({ schedule: SCHEDULE }));
  store.set(SWITCH_KEY, '1');
  const calls: Array<unknown> = [];
  const deps: WebSyncDeps = {
    read: (k) => store.get(k) ?? null,
    write: (k, v) => void store.set(k, v),
    fetchImpl: (async () => {
      calls.push(1);
      return new Response(JSON.stringify({ accepted: false, updatedAt: '2026-10-03T13:00:00.000Z' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch,
    today: () => new Date('2026-10-03T12:00:00.000Z'),
    token: 'tok',
  };
  const r = await webSyncTick(deps);
  assert.equal(r.reason, 'rejected');
  assert.equal(r.serverUpdatedAt, '2026-10-03T13:00:00.000Z');
  const r2 = await webSyncTick(deps);
  assert.equal(r2.reason, 'unchanged', '被拒后同内容不得反复重试');
  assert.equal(calls.length, 1);
  assert.equal(deps.read(LAST_SYNC_KEY), '2026-10-03T13:00:00.000Z');
});

test('webSyncTick：无 token / 无主状态 / schedule 缺 termStart → 都不发网络', async () => {
  const noToken = makeDeps({ token: '' });
  noToken.deps.write(SWITCH_KEY, '1');
  assert.equal((await webSyncTick(noToken.deps)).reason, 'no-token');
  assert.equal(noToken.calls.length, 0);

  const noState = makeDeps();
  noState.deps.write(SWITCH_KEY, '1');
  const deps2: WebSyncDeps = {
    ...noState.deps,
    // 只有主状态读不到（其余键走原 store）
    read: (k) => (k === WEB_STATE_KEY ? null : noState.deps.read(k)),
  };
  assert.equal((await webSyncTick(deps2)).reason, 'no-state');

  const noTerm = makeDeps();
  noTerm.deps.write(SWITCH_KEY, '1');
  noTerm.deps.write(WEB_STATE_KEY, JSON.stringify({ schedule: { semesterName: 'x' } }));
  assert.equal((await webSyncTick(noTerm.deps)).reason, 'no-schedule');
  assert.equal(noTerm.calls.length, 0);
});

/* ---------------- 小工具 ---------------- */

test('fmtMin：分钟 → HH:MM（含跨午夜回卷）', () => {
  assert.equal(fmtMin(480), '08:00');
  assert.equal(fmtMin(1255), '20:55');
  assert.equal(fmtMin(1440 + 30), '00:30', '越界回卷');
});
