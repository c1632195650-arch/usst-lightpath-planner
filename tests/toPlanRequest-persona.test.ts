/**
 * 批 4.3 · persona 透传进引擎（1A-③）
 * ============================================================
 * 实锤（2026-10-02 输入面核查）：引擎会读 `req.persona`（construct 的
 * blockPrefsOf + socialCap：SOC≥70 → 每天 2 次社交），但 `BuildWeekPlanInput`
 * 根本没有 persona 字段可传 —— 画像里的社交动机与部分块级偏好静默失灵。
 * 本批：契约字段新增（单人负责已申报）+ toPlanRequest 透传（条件展开口径与
 * 其余 P2 字段一致：不传 = 不出现在对象上，旧行为逐字段一致）。
 *
 * ⚠️ 反向验证：删掉 toPlanRequest 的 persona 条目展开，本用例红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlanRequest } from '@/lib/planner/schedule';
import { MOCK_SCHEDULE } from '@/data/usst';

const POLICY = {
  name: '测试阶段',
  dailyStudyMin: 120,
  maxBlockMin: 90,
  blankRatio: 0.25,
  eveningAllowed: true,
  weekendWork: false,
} as Parameters<typeof toPlanRequest>[0]['policy'];

const PERSONA = {
  version: 't', scoreVersion: 't',
  axes: { EXP: 40, PLAN: 60, SOC: 80, RES: 50, ACH: 60, HEA: 40, RAT: 50, BOLD: 50 },
  traits: { E: 50, C: 50, ES: 50, O: 50, A: 50 },
  motives: { ACH: 60, SOC: 80, HEA: 40, EXP: 40, STA: 50 },
  scenarios: {
    meal_radius: 'near', planning: 'planned', social_radius: 'close',
    night_supply: 'none', exercise_trigger: 'self_plan', study_place: 'library',
  },
  archetype: { primary: 'x', secondary: 'y', distance: 0.3 },
  confidence: {}, quality: 'ok', updatedAt: '2026-10-02',
} as never;

test('toPlanRequest：persona 传入 → 原样进 PlanRequest（socialCap 链路的入口）', () => {
  const req = toPlanRequest({ schedule: MOCK_SCHEDULE, weekNo: 5, policy: POLICY, persona: PERSONA });
  assert.equal((req as { persona?: unknown }).persona, PERSONA);
});

test('toPlanRequest：不传 persona → 字段不出现（旧行为逐字段一致）', () => {
  const req = toPlanRequest({ schedule: MOCK_SCHEDULE, weekNo: 5, policy: POLICY });
  assert.equal('persona' in req, false);
});
