/**
 * 健康库编译链测试（反向验证①的断言集）
 * ------------------------------------
 * 断言的是「编译产物确实来自 health_kb」—— 改了 scripts/health_kb_data.py 里的
 * 参数并重新编译后，这里的期望值必须变红（否则编译链形同虚设）。
 *
 * 反向验证做法：
 *   1. 把 health_kb_data.py 里 sleep-duration-adult 的 minHours 由 7 改成 8
 *   2. python scripts/build_health_kb.py && python scripts/compile_health_params.py
 *   3. 跑本测试 → 必须红（actual 8 ≠ expected 7）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTH,
  HEALTH_DISCLAIMER,
  SLEEP_GUARD,
  ACTIVITY,
  SEDENTARY,
  NUTRITION,
  activityMinutesPerDay,
  dailyWaterMl,
  healthHintsForDomain,
  healthFloorNotes,
} from '@/lib/planner/health';

test('编译产物带出处与安全声明', () => {
  assert.equal(HEALTH._meta.source, 'data/health_kb.db');
  assert.ok(HEALTH._meta.hint_count >= 30);
  assert.ok(HEALTH_DISCLAIMER.includes('医生'));
});

test('睡眠/活动/饮食参数与源数据一致', () => {
  assert.equal(SLEEP_GUARD.minHours, 7);
  assert.deepEqual([...SLEEP_GUARD.windowHours], [7, 9]);
  assert.equal(ACTIVITY.weeklyModerateMin, 150);
  assert.equal(ACTIVITY.weeklyVigorousMin, 75);
  assert.equal(ACTIVITY.strengthDaysPerWeek, 2);
  assert.equal(SEDENTARY.breakEveryMin, 60);
  assert.equal(NUTRITION.mealsPerDay, 3);
  assert.equal(NUTRITION.saltMaxG, 5);
  assert.equal(NUTRITION.waterMlMale, 1700);
  assert.equal(NUTRITION.waterMlFemale, 1500);
});

test('安全升级与争议条目不得进编译产物', () => {
  const slugs = HEALTH.hints.map((h) => h.slug);
  for (const s of slugs) {
    const h = HEALTH.hints.find((x) => x.slug === s)!;
    if (h.escalate) {
      // escalate 条目可以出现在 hints（展示/口径用），但不得成为可编译 blocks 的来源
      assert.ok(!Object.values(HEALTH._meta.provenance ?? {}).some((p) => p.slug === s));
    }
  }
  // contested 条目不进 blocks：例如「睡前刷手机」是 contested，永不被编译引用
  const prov = HEALTH._meta.provenance ?? {};
  assert.ok(Object.keys(prov).length > 0, 'provenance 必须落进产物');
  for (const key of Object.keys(prov)) {
    const p = prov[key];
    const h = HEALTH.hints.find((x) => x.slug === p.slug);
    assert.ok(h, `provenance 指向未知条目 ${p.slug}`);
    assert.notEqual(h!.status, 'contested', `${key} 不得来自争议条目`);
    assert.equal(h!.escalate, false, `${key} 不得来自安全升级条目`);
  }
});

test('纯函数换算', () => {
  assert.equal(activityMinutesPerDay(5), 30);
  assert.equal(activityMinutesPerDay(0), 150);          // 天数非法 → 夹到 1 天
  assert.equal(activityMinutesPerDay(99), 21);          // 天数越界 → 夹到 7 天（150/7）
  assert.equal(dailyWaterMl('female'), 1500);
  assert.equal(dailyWaterMl('unknown'), 1700);
  const notes = healthFloorNotes();
  assert.equal(notes.length, 4);
  assert.ok(notes[0].includes('7 小时'));
  const sleep = healthHintsForDomain('sleep', 2);
  assert.ok(sleep.length <= 2);
  assert.ok(sleep.every((h) => h.domain === 'sleep'));
});
