/**
 * 批 5 · 画像解释（7A）—— explainProfile 纯函数 + 画像页面板源码锁
 * ============================================================
 * 实测发现：画像 → 排程的映射真实存在（applyPersona 的阶段策略 + blockPrefs
 * 的块级偏好 + 模板触发），但画像页只有一句笼统解释 —— 问卷 35 题像测着玩。
 * explainProfile 把**当前画像命中**的规则逐条列成 {element, value, effect}。
 *
 * 阈值锚点（与 applyPersona / blockPrefs 同一口径，两处必须同步改）：
 *   ACH/PLAN/HEA/RES 以 70 / 35 为界；HEA≥70 → 深度窗；planning=flexible → 碎片档；
 *   meal_radius near/far → 10/25 分钟；四个场景字段触发对应模板。
 *
 * ⚠️ 反向验证：删掉 explainProfile 任一规则分支，对应断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainProfile } from '@/lib/planner/profilePrefs';
import type { PersonaProfile } from '@/types';

function persona(axes: Partial<Record<string, number>>): PersonaProfile {
  return {
    version: 't', scoreVersion: 't',
    axes: { EXP: 50, PLAN: 50, SOC: 50, RES: 50, ACH: 50, HEA: 50, RAT: 50, BOLD: 50, ...axes },
    traits: { E: 50, C: 50, ES: 50, O: 50, A: 50 },
    motives: { ACH: 50, SOC: 50, HEA: 50, EXP: 50, STA: 50 },
    scenarios: {},
    archetype: { primary: 'x', secondary: 'y', distance: 0.3 },
    confidence: {}, quality: 'ok', updatedAt: '2026-10-02',
  } as PersonaProfile;
}

test('阶段策略：ACH/PLAN/HEA/RES 的阈值命中（70/35 边界）', () => {
  const hi = explainProfile(persona({ ACH: 70, PLAN: 70, HEA: 70, RES: 30 }), {});
  const text = hi.map((i) => `${i.element}|${i.effect}`).join('\n');
  assert.match(text, /ACH.*上调|成就.*上调/);
  assert.match(text, /PLAN.*放长|单块.*放长/);
  assert.match(text, /HEA.*留白率下调|留白率下调/);
  assert.match(text, /RES.*留白/);

  const lo = explainProfile(persona({ ACH: 35, PLAN: 35, HEA: 35 }), {});
  const t2 = lo.map((i) => `${i.element}|${i.effect}`).join('\n');
  assert.match(t2, /ACH.*下调/);
  assert.match(t2, /PLAN.*45/);
  assert.match(t2, /HEA.*留白.*提|别把自己排满/);
});

test('块级偏好：HEA≥70 → 深度窗；planning=flexible → 碎片档；meal_radius → 步行预算', () => {
  const items = explainProfile(
    persona({ HEA: 80 }),
    { HEA: undefined, planning: 'flexible', meal_radius: 'far' } as never,
  );
  const text = items.map((i) => `${i.element}|${i.effect}`).join('\n');
  assert.match(text, /上午/);
  assert.match(text, /碎片/);
  assert.match(text, /25/);

  const near = explainProfile(persona({}), { meal_radius: 'near' } as never);
  assert.match(near.map((i) => i.effect).join('\n'), /10/);
});

test('模板触发：四个场景字段各产出一条', () => {
  const items = explainProfile(persona({}), {
    exercise_trigger: 'self_plan',
    night_supply: 'convenience',
    social_radius: 'wide',
    event_breadth: 'broad',
  } as never);
  const text = items.map((i) => i.effect).join('\n');
  assert.match(text, /运动/);
  assert.match(text, /夜宵|便利店/);
  assert.match(text, /搭子/);
  assert.match(text, /社团/);
});

test('诚实边界：null 画像 → 空数组；中段轴值（36-69）不产出阈值项', () => {
  assert.deepEqual(explainProfile(null, null), []);
  const mid = explainProfile(persona({ ACH: 50, PLAN: 50, HEA: 50, RES: 50 }), {});
  assert.equal(mid.filter((i) => i.source === 'phase').length, 0, '中段不该命中任何阶段策略规则');
});

test('源码锁：画像页面板存在 + L3 口径文案', () => {
  const pr = readFileSync('src/features/persona/PersonaResult.tsx', 'utf8');
  assert.match(pr, /data-testid="profile-explain-panel"/);
  assert.match(pr, /这会如何影响你的排程/);
  assert.match(pr, /这是我猜的，可在周计划里改/);
  assert.match(pr, /explainProfile/);
});
