/**
 * 偏好校正层测试（阶段 B）
 * ============================================================
 * 覆盖三块：
 *   · store            —— 纯函数（upsert / setActive / remove / isRule）+ localStorage 往返
 *   · corrections      —— compose / apply / summarize（合成与「可撤销」语义）
 *   · parseCorrection  —— 语义映射（8 类样例 + 边界）
 *
 * Node 里没有 localStorage，用内存垫片。`store.ts` 只在**函数内**访问它
 * （模块顶层不碰），所以垫片赋值与 import 的先后顺序不影响结果。
 *
 * 零依赖：只用 node:test / node:assert，符合项目纪律（禁 tsx / ts-node）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- localStorage 内存垫片 ---------- */
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
  upsertRule, setActive, updatePayload, removeRule, isRule,
  loadRules, saveRules, clearRules, makeRuleId,
  STORAGE_KEY, SCHEMA_VERSION, MAX_RULES_LIMIT,
} from '@/features/feedback/store';
import {
  composeEffectivePrefs, applyCorrectionsToPolicy,
  summarizeCorrections, countCorrections,
} from '@/lib/planner/corrections';
import { parseCorrection, asNoteDraft } from '@/features/feedback/parseCorrection';
import { DEFAULT_WEIGHTS } from '@/lib/planner/model';

/** 造一条规则（默认是「周日不排」） */
function rule(over = {}) {
  return {
    id: 'r1',
    kind: 'avoid_day',
    payload: { kind: 'avoid_day', days: [7] },
    active: true,
    source: 'ui',
    createdAt: '2026-09-19T00:00:00.000Z',
    mapsTo: 'policy',
    ...over,
  };
}

/** 一个最小的 PhasePolicy（测试 applyCorrectionsToPolicy 用） */
function basePolicy() {
  return {
    dailyStudyMin: 120, maxBlockMin: 90, blankRatio: 0.25,
    eveningAllowed: false, weekendWork: false, studyPlaces: ['图书馆'],
  };
}

/* ============================================================
 * 一、store 纯函数
 * ========================================================== */

test('store: 新 id 追加', () => {
  const r = upsertRule([], rule({ id: 'a' }));
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'a');
});

test('store: 同 id 覆盖而非追加（用户改主意是常态）', () => {
  const r1 = upsertRule([], rule({ id: 'a' }));
  const r2 = upsertRule(r1, rule({ id: 'a', active: false }));
  assert.equal(r2.length, 1, '同 id 不该变成两条');
  assert.equal(r2[0].active, false, '应当被覆盖');
});

test('store: 超出上限裁掉最旧的（保最新的）', () => {
  let rules = [];
  for (let i = 0; i < MAX_RULES_LIMIT + 5; i += 1) {
    rules = upsertRule(rules, rule({ id: `r${i}` }));
  }
  assert.equal(rules.length, MAX_RULES_LIMIT);
  assert.equal(rules[rules.length - 1].id, `r${MAX_RULES_LIMIT + 4}`, '最后一条应当是最新的');
  assert.ok(!rules.some((x) => x.id === 'r0'), '最旧的应当被裁掉');
});

test('store: setActive 只翻指定那条，且不碰别的', () => {
  const rules = [rule({ id: 'a' }), rule({ id: 'b' })];
  const next = setActive(rules, 'a', false, '2026-09-19T01:00:00.000Z');
  assert.equal(next[0].active, false);
  assert.equal(next[0].updatedAt, '2026-09-19T01:00:00.000Z');
  assert.equal(next[1].active, true, 'b 不该被动到');
  assert.equal(next[1].updatedAt, undefined);
});

test('store: removeRule 只删指定那条', () => {
  const rules = [rule({ id: 'a' }), rule({ id: 'b' })];
  const next = removeRule(rules, 'a');
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'b');
});

test('store: updatePayload 改字段并记时间', () => {
  const rules = [rule({ id: 'a' })];
  const next = updatePayload(rules, 'a', { utterance: '改过的原话' }, 'now');
  assert.equal(next[0].utterance, '改过的原话');
  assert.equal(next[0].updatedAt, 'now');
});

test('store: isRule 接受合法规则', () => {
  assert.equal(isRule(rule()), true);
});

test('store: isRule 拒绝各类坏数据（坏数据只该丢自己）', () => {
  assert.equal(isRule(null), false);
  assert.equal(isRule(undefined), false);
  assert.equal(isRule('字符串'), false);
  assert.equal(isRule({}), false, '缺字段');
  assert.equal(isRule(rule({ id: '' })), false, '空 id');
  assert.equal(isRule(rule({ kind: '不存在的类型' })), false, 'kind 不在枚举里');
  assert.equal(isRule(rule({ active: 'yes' })), false, 'active 不是布尔');
  assert.equal(isRule(rule({ source: 'robot' })), false, 'source 不合法');
  assert.equal(isRule(rule({ mapsTo: '随便' })), false, 'mapsTo 不合法');
  assert.equal(isRule(rule({ payload: { kind: 'avoid_kind', days: [7] } })), false,
    'payload.kind 与外层 kind 不一致');
});

test('store: makeRuleId 生成唯一 id', () => {
  const ids = new Set([makeRuleId(), makeRuleId(), makeRuleId()]);
  assert.equal(ids.size, 3, '三次调用必须得到三个不同 id');
});

/* ============================================================
 * 二、store 存储层
 * ========================================================== */

test('存储: save → load 往返一致', () => {
  clearRules();
  const rules = [rule({ id: 'a' }), rule({ id: 'b', active: false })];
  saveRules(rules);
  const back = loadRules();
  assert.equal(back.length, 2);
  assert.equal(back[0].id, 'a');
  assert.equal(back[1].active, false);
});

test('存储: 版本不符 → 回落空（不抛错）', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 999, rules: [rule()] }));
  assert.deepEqual(loadRules(), []);
});

test('存储: 坏 JSON → 回落空（不抛错）', () => {
  localStorage.setItem(STORAGE_KEY, '{ 这不是合法 JSON');
  assert.deepEqual(loadRules(), []);
});

test('存储: 坏条目被逐条过滤，好条目保留', () => {
  const good = rule({ id: 'ok' });
  const bad = { id: 'bad', kind: '不存在' };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, rules: [good, bad] }));
  const back = loadRules();
  assert.equal(back.length, 1, '坏的应当被丢掉');
  assert.equal(back[0].id, 'ok', '好的应当保留');
});

test('存储: 没写过 → 空数组', () => {
  clearRules();
  assert.deepEqual(loadRules(), []);
});

/* ============================================================
 * 三、corrections：合成与「可撤销」语义
 * ========================================================== */

test('compose: 撤销的规则完全不参与（可撤销语义的关键断言）', () => {
  const eff = composeEffectivePrefs(null, [rule({ id: 'a', active: false })]);
  assert.deepEqual(eff.avoidDays, [], '已撤销的不能被算进去');
  assert.deepEqual(eff.unavailableByDay, {});
});

test('compose: 生效的 avoid_day 被收进 avoidDays 且去重排序', () => {
  const eff = composeEffectivePrefs(null, [
    rule({ id: 'a', payload: { kind: 'avoid_day', days: [7, 3] } }),
    rule({ id: 'b', payload: { kind: 'avoid_day', days: [3] } }),
  ]);
  assert.deepEqual(eff.avoidDays, [3, 7]);
});

test('compose: unavailable_slot 按星期归类', () => {
  const eff = composeEffectivePrefs(null, [
    rule({
      id: 'a',
      kind: 'unavailable_slot',
      payload: {
        kind: 'unavailable_slot', days: [4],
        window: { startMin: 780, endMin: 1080, label: '下午' },
      },
    }),
  ]);
  assert.equal(eff.unavailableByDay[4].length, 1);
  assert.equal(eff.unavailableByDay[4][0].startMin, 780);
});

test('compose: 多条 target_duration 累加而非覆盖', () => {
  const eff = composeEffectivePrefs(null, [
    rule({ id: 'a', kind: 'target_duration', payload: { kind: 'target_duration', deltaMinPerDay: 60, scope: 'study' } }),
    rule({ id: 'b', kind: 'target_duration', payload: { kind: 'target_duration', deltaMinPerDay: 30, scope: 'study' } }),
  ]);
  assert.equal(eff.policyOverrides.dailyStudyMin, 90);
});

test('compose: persona 为 null 也不崩（无画像用户同样能用校正层）', () => {
  const eff = composeEffectivePrefs(null, [rule()]);
  assert.equal(eff.persona, null);
  assert.deepEqual(eff.avoidDays, [7]);
});

test('apply: 在 base 上叠加增量，且不改动传入对象', () => {
  const base = basePolicy();
  const snapshot = { ...base };
  const eff = composeEffectivePrefs(null, [
    rule({ id: 'a', kind: 'target_duration', payload: { kind: 'target_duration', deltaMinPerDay: 60, scope: 'study' } }),
  ]);
  const out = applyCorrectionsToPolicy(base, eff);
  assert.equal(out.dailyStudyMin, 180, '120 + 60');
  assert.deepEqual(base, snapshot, 'base 不该被改动');
});

test('apply: 目标时长有下限 0（用户说「少学点」不能变负数）', () => {
  const eff = composeEffectivePrefs(null, [
    rule({ id: 'a', kind: 'target_duration', payload: { kind: 'target_duration', deltaMinPerDay: -999, scope: 'study' } }),
  ]);
  const out = applyCorrectionsToPolicy(basePolicy(), eff);
  assert.equal(out.dailyStudyMin, 0);
});

test('apply: 没有校正时原样返回', () => {
  const base = basePolicy();
  const out = applyCorrectionsToPolicy(base, composeEffectivePrefs(null, []));
  assert.equal(out.dailyStudyMin, base.dailyStudyMin);
  assert.equal(out.maxBlockMin, base.maxBlockMin);
});

test('summarize: 输出人话且含关键信息（透明性的落点）', () => {
  const items = summarizeCorrections([rule({
    id: 'a',
    kind: 'unavailable_slot',
    payload: {
      kind: 'unavailable_slot', days: [4],
      window: { startMin: 780, endMin: 1080, label: '下午' },
    },
    utterance: '周四下午别排东西',
  })]);
  assert.equal(items.length, 1);
  assert.ok(items[0].title.includes('周四'), `标题应含周四，实际：${items[0].title}`);
  assert.ok(items[0].title.includes('13:00'), `标题应含 13:00，实际：${items[0].title}`);
  assert.equal(items[0].group, '排程策略');
  assert.equal(items[0].utterance, '周四下午别排东西');
});

test('summarize: 撤销的条目标记为 active=false（仍可展示，只是置灰）', () => {
  const items = summarizeCorrections([rule({ id: 'a', active: false })]);
  assert.equal(items[0].active, false);
});

test('count: 正确统计生效与撤销', () => {
  const c = countCorrections([rule({ id: 'a' }), rule({ id: 'b', active: false }), rule({ id: 'c' })]);
  assert.equal(c.active, 2);
  assert.equal(c.revoked, 1);
});

/* ============================================================
 * 四、parseCorrection：语义映射
 * ========================================================== */

test('parse: 「我想每天多学1小时」→ 目标时长 +60', () => {
  const d = parseCorrection('我想每天多学1小时');
  assert.ok(d, '应当解析成功');
  assert.equal(d.kind, 'target_duration');
  assert.equal(d.payload.deltaMinPerDay, 60);
  assert.equal(d.mapsTo, 'policy');
});

test('parse: 「少学30分钟」→ 负增量', () => {
  const d = parseCorrection('每天少学30分钟');
  assert.ok(d);
  assert.equal(d.payload.deltaMinPerDay, -30);
});

test('parse: 「周四下午别排东西」→ 周四下午不可用', () => {
  const d = parseCorrection('周四下午别排东西');
  assert.ok(d, '应当解析成功');
  assert.equal(d.kind, 'unavailable_slot');
  assert.deepEqual(d.payload.days, [4]);
  assert.equal(d.payload.window.startMin, 780, '13:00');
  assert.equal(d.payload.window.endMin, 1080, '18:00');
});

test('parse: 「周四下午别排自习」→ 限定块类型的 avoid_kind', () => {
  const d = parseCorrection('周四下午别排自习');
  assert.ok(d);
  assert.equal(d.kind, 'avoid_kind');
  assert.equal(d.payload.blockKind, 'study');
  assert.equal(d.payload.window.startMin, 780);
});

test('parse: 「周日别排」→ 整天禁排', () => {
  const d = parseCorrection('周日别排');
  assert.ok(d);
  assert.equal(d.kind, 'avoid_day');
  assert.deepEqual(d.payload.days, [7]);
});

test('parse: 「周一三五别排」→ 解析出 3 天（多星期）', () => {
  const d = parseCorrection('周一三五别排');
  assert.ok(d);
  assert.equal(d.kind, 'avoid_day');
  assert.deepEqual(d.payload.days, [1, 3, 5], '口语里的连写要能拆开');
});

test('parse: 「自习别排太密」→ 密度系数', () => {
  const d = parseCorrection('自习别排太密');
  assert.ok(d);
  assert.equal(d.kind, 'block_density');
  assert.equal(d.payload.blockKind, 'study');
  assert.ok(d.payload.factor < 1, '应当是变稀疏');
});

test('parse: 「图书馆别排了」→ 地点回避，归到场景维度', () => {
  const d = parseCorrection('图书馆别排了');
  assert.ok(d);
  assert.equal(d.kind, 'avoid_place');
  assert.equal(d.payload.placeId, 'library');
  assert.equal(d.mapsTo, 'scenario');
  assert.equal(d.scenarioKey, 'study_place');
});

test('parse: 「早八我起不来」→ 全周早间不可用', () => {
  const d = parseCorrection('早八我起不来');
  assert.ok(d, '「起不来」也算回避意图');
  assert.equal(d.kind, 'unavailable_slot');
  assert.deepEqual(d.payload.days, [1, 2, 3, 4, 5, 6, 7], '没说哪天就是每天');
  assert.equal(d.payload.window.startMin, 360, '06:00');
});

test('parse: 解析不出返回 null（不瞎猜 —— 交给表单兜底）', () => {
  assert.equal(parseCorrection('今天天气不错'), null);
  assert.equal(parseCorrection('你好'), null);
  assert.equal(parseCorrection(''), null);
  assert.equal(parseCorrection('   '), null);
});

test('parse: 「第三教学楼别排自习」不该把「三」误判成周三', () => {
  const d = parseCorrection('第三教学楼别排自习');
  assert.ok(d, '应当命中块类型禁排');
  assert.equal(d.kind, 'avoid_kind', '没有「周」字，就不该当成指定星期');
  assert.equal(d.payload.blockKind, 'study');
  assert.equal(d.payload.window, undefined, '没提时段就不该编一个出来');
});

test('parse: asNoteDraft 兜底保留原话（信号不丢）', () => {
  const d = asNoteDraft('随便说点啥');
  assert.equal(d.kind, 'manual_note');
  assert.equal(d.payload.text, '随便说点啥');
  assert.equal(d.mapsTo, 'none');
});

/* ============================================================
 * 五、契约层未被动到的守护
 * ========================================================== */

test('未使用任何新增依赖：DEFAULT_WEIGHTS 仍可读（冒烟）', () => {
  assert.equal(typeof DEFAULT_WEIGHTS.churn, 'number');
});
