/**
 * 阶段 C 测试：偏好校正真正影响阶段策略
 * ============================================================
 * 验证三件事：
 *   1. **不传 corrections 时输出与原来逐字节一致** —— 这是「既有调用方零改动」的保证，
 *      也是 golden 快照能继续通过的原因；
 *   2. 传了 corrections 后，`PhasePolicy` 确实被改变（目标时长叠加）；
 *   3. 变更**被说出来**（`reasons` 里出现「已应用你的要求」）——
 *      用户提了要求却看不到任何痕迹，会以为功能坏了。
 *
 * 零依赖：node:test + register.mjs 的 `@/` 钩子。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPhases } from '@/lib/planner/buildPhases';
import { GOLDEN_INPUTS, buildGoldenInput } from './golden-inputs.ts';

const G = GOLDEN_INPUTS.find((x) => x.name === 'week-04-typical');
if (!G) throw new Error('找不到 week-04-typical 语料');
const schedule = buildGoldenInput(G).schedule;

/** 造一条「每天多学 60 分钟」的校正 */
function moreStudy(deltaMinPerDay = 60) {
  return {
    id: 'c1',
    kind: 'target_duration',
    payload: { kind: 'target_duration', deltaMinPerDay, scope: 'study' },
    active: true,
    source: 'ui',
    createdAt: '2026-09-19T00:00:00.000Z',
    mapsTo: 'policy',
  };
}

test('C: 不传 corrections → 输出与原来逐字段一致（零改动保证）', () => {
  const a = buildPhases(schedule, null, {});
  const b = buildPhases(schedule, null, {}, null);
  const c = buildPhases(schedule, null, {}, []);
  assert.deepEqual(a.plan, b.plan, '传 null 应当等价于不传');
  assert.deepEqual(a.plan, c.plan, '传空数组应当等价于不传');
});

test('C: 传了「每天多学 60 分」→ 各阶段目标时长都 +60', () => {
  const base = buildPhases(schedule, null, {});
  const withCorr = buildPhases(schedule, null, {}, [moreStudy(60)]);

  assert.equal(base.plan.phases.length, withCorr.plan.phases.length, '阶段数量不该变');

  for (let i = 0; i < base.plan.phases.length; i += 1) {
    const b = base.plan.phases[i];
    const w = withCorr.plan.phases[i];
    assert.equal(w.kind, b.kind, '阶段顺序不该变');
    assert.equal(
      w.policy.dailyStudyMin,
      b.policy.dailyStudyMin + 60,
      `阶段「${b.name}」的每日目标应当 +60（原 ${b.policy.dailyStudyMin}）`,
    );
    // 其它策略项不该被动到 —— 校正只声明了什么就只改什么
    assert.equal(w.policy.maxBlockMin, b.policy.maxBlockMin);
    assert.equal(w.policy.blankRatio, b.policy.blankRatio);
  }
});

test('C: 变更被说出来（reasons 含「已应用你的要求」）', () => {
  const r = buildPhases(schedule, null, {}, [moreStudy(30)]);
  const first = r.plan.phases[0];
  assert.ok(
    first.reasons.some((x) => x.includes('已应用你的要求')),
    `阶段理由里应当明确写出校正已生效，实际：${JSON.stringify(first.reasons)}`,
  );
  assert.ok(
    first.reasons.some((x) => x.includes('自习目标')),
    '理由里应当点出改了什么',
  );
});

test('C: 撤销的校正不影响输出（可撤销语义贯通到引擎）', () => {
  const base = buildPhases(schedule, null, {});
  const revoked = buildPhases(schedule, null, {}, [{ ...moreStudy(60), active: false }]);
  assert.deepEqual(revoked.plan, base.plan, '已撤销的规则不该产生任何影响');
});

test('C: 负增量把目标压到 0 以下时被截断（不为负）', () => {
  const r = buildPhases(schedule, null, {}, [moreStudy(-9999)]);
  for (const p of r.plan.phases) {
    assert.ok(p.policy.dailyStudyMin >= 0, `阶段「${p.name}」目标不该为负`);
  }
});

test('C: 多条校正累加（+60 与 +30 → 共 +90）', () => {
  const base = buildPhases(schedule, null, {});
  const r = buildPhases(schedule, null, {}, [
    moreStudy(60),
    { ...moreStudy(30), id: 'c2' },
  ]);
  for (let i = 0; i < base.plan.phases.length; i += 1) {
    assert.equal(
      r.plan.phases[i].policy.dailyStudyMin,
      base.plan.phases[i].policy.dailyStudyMin + 90,
    );
  }
});

test('C: 无人提要求时不写「已应用」这句话（别制造噪音）', () => {
  const r = buildPhases(schedule, null, {});
  for (const p of r.plan.phases) {
    assert.ok(
      !p.reasons.some((x) => x.includes('已应用你的要求')),
      '没有校正时不该出现这句话',
    );
  }
});
