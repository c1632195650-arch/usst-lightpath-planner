/**
 * 存储迁移（v3 → v4）的确定性测试
 * ============================================================
 * 只测纯函数 `migrate` —— 不碰 localStorage、不依赖浏览器。
 * `loadState` / `saveState` 是它的薄壳（一读一写），没有逻辑可测。
 *
 * 这里测的正是**最容易在真实升级时翻车**的几种情况：
 * 用户已经录了课表、做完了画像，一次版本升级不能把这些弄丢；
 * 存储损坏时也不能让页面白屏。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '@/lib/storage';
import { DEFAULT_APP_STATE } from '@/types';

/** 一份「真实老用户」的 v3 存档：画像做过、课表录过、答案还在 */
function v3Archive() {
  return {
    version: 3,
    onboarded: true,
    persona: { version: '1.0', scoreVersion: '1.0' },
    answers: { 'A1': 2, 'B3': 'a' },
    schedule: { termStart: '2026-09-07', totalWeeks: 20, courses: [{ id: 'c1' }] },
    semesterPlan: { termName: '2026-2027-1' },
    selectedDays: ['2026-09-15', '2026-09-16'],
    lifeMode: 'balanced',
  };
}

test('v3 → v4：补上 planState，且原字段一个都不丢', () => {
  const out = migrate(v3Archive());

  assert.equal(out.version, 4);
  assert.equal(out.planState, null);              // 本版新增的字段，旧数据没有 → 补 null

  assert.equal(out.onboarded, true);              // 以下全部是「不能丢」的用户数据
  assert.equal(out.persona?.version, '1.0');
  assert.deepEqual(out.answers, { 'A1': 2, 'B3': 'a' });
  assert.equal(out.schedule?.termStart, '2026-09-07');
  assert.equal(out.semesterPlan?.termName, '2026-2027-1');
  assert.deepEqual(out.selectedDays, ['2026-09-15', '2026-09-16']);
  assert.equal(out.lifeMode, 'balanced');
});

test('已是 v4 的数据原样通过', () => {
  const v4 = { ...v3Archive(), version: 4, planState: { version: 1, locks: { 'w2-d3-study-a': 'hard' } } };
  const out = migrate(v4);
  assert.equal(out.version, 4);
  assert.equal(out.planState?.locks['w2-d3-study-a'], 'hard');   // 已有的 planState 不被覆盖
  assert.deepEqual(out.selectedDays, ['2026-09-15', '2026-09-16']);
});

test('没有版本号的历史数据也能救回来（不丢字段）', () => {
  const noVersion = { ...v3Archive(), version: undefined };
  const out = migrate(noVersion);
  assert.equal(out.version, 4);
  assert.equal(out.onboarded, true);
  assert.deepEqual(out.selectedDays, ['2026-09-15', '2026-09-16']);
});

test('版本号比当前新 → 回落默认（不认识新形状，不硬读半个状态）', () => {
  const future = { ...v3Archive(), version: 99 };
  const out = migrate(future);
  assert.equal(out.version, 4);
  assert.equal(out.onboarded, false);             // 确实回落了默认，而不是保留了 v99 的内容
  assert.equal(out.persona, null);
});

test('损坏输入一律回落默认，不抛异常', () => {
  for (const bad of [null, undefined, 'not json', 42, true, [], [1, 2]]) {
    const out = migrate(bad);
    assert.equal(out.version, DEFAULT_APP_STATE.version);
    assert.equal(out.onboarded, false);
    assert.deepEqual(out.selectedDays, []);
  }
});

test('selectedDays 不是数组时修正为 []（否则 UI 的 .map 会直接炸）', () => {
  const broken = { ...v3Archive(), selectedDays: 'oops' };
  const out = migrate(broken);
  assert.deepEqual(out.selectedDays, []);
  assert.equal(out.onboarded, true);              // 其余字段照旧保留
});

test('可空字段是 null 时保持 null，不被换成别的', () => {
  const out = migrate({ ...v3Archive(), persona: null, schedule: null, planState: null });
  assert.equal(out.persona, null);
  assert.equal(out.schedule, null);
  assert.equal(out.planState, null);
});

test('返回的是全新对象，不污染 DEFAULT_APP_STATE', () => {
  const out = migrate(v3Archive());
  out.selectedDays.push('2099-01-01');
  (out as { lifeMode: string | null }).lifeMode = 'mutated';

  assert.deepEqual(DEFAULT_APP_STATE.selectedDays, []);
  assert.equal(DEFAULT_APP_STATE.lifeMode, null);
});

test('同输入两次结果完全一致（确定性）', () => {
  assert.deepEqual(migrate(v3Archive()), migrate(v3Archive()));
});
