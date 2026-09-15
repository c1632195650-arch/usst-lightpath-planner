/**
 * 梨宝评测用的 profile_ctx 生成器
 * ============================================================
 * 产出**真实的** profile_ctx（走 TS 侧序列化器 `features/libao/profileContext.ts`），
 * 供 `scripts/libao_eval.py` 注入后端 —— 这样评测打的是真链路，而不是手写的假档案。
 *
 * 跑：node --import ./scripts/register-alias.mjs scripts/libao_eval_ctx.ts
 * 输出：单行 JSON `{profile_ctx, len}`，便于 Python 侧解析
 */
import { buildProfileContext } from '@/features/libao/profileContext';
import { MOCK_SCHEDULE } from '@/data/usst';
import type { PersonaProfile } from '@/types';

const profile = {
  version: '1.0',
  scoreVersion: '1.0',
  axes: { EXP: 72, PLAN: 41, SOC: 68, RES: 55, ACH: 80, HEA: 30, RAT: 62, BOLD: 47 },
  traits: { E: 55, C: 60, ES: 50, O: 65, A: 50 },
  motives: { ACH: 70, SOC: 60, HEA: 35, EXP: 65, STA: 50 },
  scenarios: {
    meal_radius: 'far',
    planning: 'flexible',
    event_breadth: 'broad',
    social_radius: 'wide',
    night_supply: 'delivery',
    exercise_trigger: 'self_plan',
    study_place: 'library',
    info_channel: 'self_search',
  },
  archetype: {
    primary: { id: 'x', name: '斜杠探索者', tagline: '什么都要试一试', desc: '', axes: {} as never },
    secondary: null,
    distance: 0.1,
  },
  confidence: {},
  quality: 'ok',
  updatedAt: '2026-09-15',
} as unknown as PersonaProfile;

const TODAY = '2026-09-15';
const ctx = buildProfileContext(profile, MOCK_SCHEDULE, TODAY);

// 只输出一行 JSON，便于 Python 侧解析
console.log(JSON.stringify({ profile_ctx: ctx, len: ctx.length }));
