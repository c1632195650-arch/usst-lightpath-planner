/**
 * E 批 E3 · 画像 → 块级偏好验收（2026-09-28）
 * ============================================================
 * 判据：① 开关缺省开启（G 批 2026-10-01 拍板全开），env 显式 '0' 关闭；② 映射有据可依（HEA 作息 / planning 碎片 / meal_radius 步行预算）；
 *       ③ **没依据不臆造**（HEA 低 → 不给上午偏好；night_supply 不当作息用）；
 *       ④ 亲和度只认「有实质重叠」的窗口，且确定性；⑤ 指纹可作「画像变更」判据。
 * 反向验证锚点（RV，删实现必红）：
 *   E3-RV1 ← blockPrefs 去掉 HEA≥70 分支 → 「上午偏好」用例红
 *   E3-RV2 ← gapAffinity 不设 30 分钟重叠门槛 → 「擦边不算」用例红
 *   E3-RV3 ← profileFingerprint 不带轴值 → 「改一个轴值指纹必变」用例红
 *   E3-RV4 ← construct 去掉 prefs 排序分支 → 源码锁用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PersonaProfile, ScenarioFields } from '@/types';
import {
  PREFS, blockPrefs, gapAffinity, prefsWired, profileFingerprint,
} from '@/lib/planner/profilePrefs.ts';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

const SCEN: ScenarioFields = {
  meal_radius: 'near', planning: 'planned', event_breadth: 'narrow', social_radius: 'close',
  night_supply: 'none', exercise_trigger: 'self_plan', study_place: 'library', info_channel: 'group_chat',
};

function persona(over: Partial<PersonaProfile['axes']> = {}, scen: Partial<ScenarioFields> = {}): {
  profile: PersonaProfile; scenarios: ScenarioFields;
} {
  return {
    profile: {
      version: 't', scoreVersion: 't',
      axes: { EXP: 50, PLAN: 50, SOC: 50, RES: 50, ACH: 50, HEA: 50, RAT: 50, BOLD: 50, ...over },
      traits: { E: 50, C: 50, ES: 50, O: 50, A: 50 },
      motives: { ACH: 50, SOC: 50, HEA: 50, EXP: 50, STA: 50 },
      scenarios: { ...SCEN, ...scen },
      archetype: { primary: null, secondary: null, distance: 0 },
      confidence: {}, quality: 'ok', updatedAt: '2026-09-28',
    },
    scenarios: { ...SCEN, ...scen },
  };
}

/** G 批起缺省开启：关 = 显式置 '0'（逃生门），不再用「删变量」表达关闭。 */
function withPrefs<T>(on: boolean, fn: () => T): T {
  const prev = process.env.PROFILE_PREFS_WIRED;
  process.env.PROFILE_PREFS_WIRED = on ? '1' : '0';
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.PROFILE_PREFS_WIRED; else process.env.PROFILE_PREFS_WIRED = prev;
  }
}

/* ---------------- ① 开关 ---------------- */

test('E3 开关: prefsWired() 缺省 true（G 批起），env 显式 0 为逃生门', () => {
  withPrefs(false, () => assert.equal(prefsWired(), false));
  withPrefs(true, () => assert.equal(prefsWired(), true));
  const prev = process.env.PROFILE_PREFS_WIRED;
  delete process.env.PROFILE_PREFS_WIRED;
  try { assert.equal(prefsWired(), true, '未设变量 = 缺省开启'); } finally {
    if (prev === undefined) delete process.env.PROFILE_PREFS_WIRED; else process.env.PROFILE_PREFS_WIRED = prev;
  }
});

/* ---------------- ② 映射 ---------------- */

test('E3 映射: 健康自律高 → 上午优先（并给出可读依据）', () => {
  const { profile, scenarios } = persona({ HEA: 85 });
  const p = blockPrefs(profile, scenarios);
  assert.deepEqual(p.deepWorkWindows, [PREFS.MORNING, PREFS.AFTERNOON]);
  assert.ok(p.reasons.some((r) => r.includes('上午')), '必须能说出依据（可解释纪律）');
});

test('E3 映射: 健康自律低 → **不给**上午偏好（不臆造"晚上更好"）', () => {
  const { profile, scenarios } = persona({ HEA: 20 });
  const p = blockPrefs(profile, scenarios);
  assert.deepEqual(p.deepWorkWindows, [], '没有依据就不指定时段');
  assert.ok(p.reasons.some((r) => r.includes('不指定时段偏好')));
});

test('E3 映射: 就餐半径 near/far → 步行预算 10/25，缺省 15', () => {
  assert.equal(blockPrefs(persona({}, { meal_radius: 'near' }).profile, { ...SCEN, meal_radius: 'near' }).mealWalkBudgetMin, PREFS.MEAL_WALK_NEAR);
  assert.equal(blockPrefs(persona({}, { meal_radius: 'far' }).profile, { ...SCEN, meal_radius: 'far' }).mealWalkBudgetMin, PREFS.MEAL_WALK_FAR);
  assert.equal(blockPrefs(null, null).mealWalkBudgetMin, PREFS.MEAL_WALK_DEFAULT);
});

test('E3 映射: 随性而动 → 接受碎片自学档；提前排满 → 不接受', () => {
  assert.equal(blockPrefs(persona({}, { planning: 'flexible' }).profile, { ...SCEN, planning: 'flexible' }).allowFragmentedStudy, true);
  assert.equal(blockPrefs(persona({}, { planning: 'planned' }).profile, { ...SCEN, planning: 'planned' }).allowFragmentedStudy, false);
});

test('E3 无画像: 不产出任何偏好（空 = 无偏好，不是"默认早上"）', () => {
  const p = blockPrefs(null, null);
  assert.deepEqual(p.deepWorkWindows, []);
  assert.deepEqual(p.reasons, []);
});

/* ---------------- ④ 亲和度 ---------------- */

test('E3 亲和度: 与偏好窗口实质重叠才算命中，擦边（<30 分钟）不算', () => {
  const { profile, scenarios } = persona({ HEA: 85 });
  const p = blockPrefs(profile, scenarios);
  const inside = gapAffinity(p, { startMin: 9 * 60, endMin: 11 * 60 });   // 全在上午窗口
  const edge = gapAffinity(p, { startMin: 11 * 60 + 45, endMin: 12 * 60 + 15 }); // 与上午窗口仅 15 分钟重叠
  const outside = gapAffinity(p, { startMin: 20 * 60, endMin: 22 * 60 }); // 晚间，不在任何偏好窗口
  assert.ok(inside > 0, '窗口内应命中');
  assert.equal(edge, 0, '擦边不算命中');
  assert.equal(outside, 0, '窗口外不命中');
  assert.ok(gapAffinity(null, { startMin: 9 * 60, endMin: 11 * 60 }) === 0, '无偏好恒 0');
});

/* ---------------- ⑤ 指纹 ---------------- */

test('E3 指纹: 同画像同串；改一个轴值 / 一个场景字段，指纹必变', () => {
  const a = persona({ HEA: 60 });
  const b = persona({ HEA: 60 });
  const c = persona({ HEA: 61 });
  const d = persona({ HEA: 60 }, { meal_radius: 'far' });
  assert.equal(profileFingerprint(a.profile, a.scenarios), profileFingerprint(b.profile, b.scenarios));
  assert.notEqual(profileFingerprint(a.profile, a.scenarios), profileFingerprint(c.profile, c.scenarios));
  assert.notEqual(profileFingerprint(a.profile, a.scenarios), profileFingerprint(d.profile, d.scenarios));
  assert.ok(profileFingerprint(null, null).startsWith('v-'), '无画像也要有稳定串');
});

/* ---------------- ⑥ 源码锁 ---------------- */

test('E3 源码锁: construct 的画像偏好排序受开关控制，且保留「大空档优先」基线排序', () => {
  const c = src('/src/lib/planner/construct.ts');
  assert.match(c, /prefs: blockPrefsOf\(req\)/, '偏好随 fillStudy 传入');
  assert.match(c, /if \(prefs && prefs\.deepWorkWindows\.length > 0\)/, '有偏好才重排');
  assert.match(c, /gapAffinity\(prefs, y\) - gapAffinity\(prefs, x\)/, '按亲和度排序在位');
  assert.match(
    c,
    /\.sort\(\(a, b\) => \(b\.endMin - b\.startMin\) - \(a\.endMin - a\.startMin\)\)/,
    '既有「大空档优先」基线排序必须保留（关闭态逐位等价的前提）',
  );
});
