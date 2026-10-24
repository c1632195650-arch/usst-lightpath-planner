/**
 * F6 · A4 场景模式验收（2026-10-24）
 * ============================================================
 * 守四件事（技术方案 F6 行）：
 *   ① 关闭 = 零漂移：patchPolicy('off') 原引用返回 + patchWeights 空（引擎 merge 不变）；
 *   ② 模式生效 = 只在安全档内（knowledge 同源：单块≤90 / 留白 0.15–0.45 / 日自习 60–360）；
 *   ③ 超界输入必被钳回（RV：去掉钳制 → 本组恰红）；
 *   ④ 权重补丁走 F4 通道（考试周 dueOverdue×1.3 / 比赛周 transferRisk×1.5），
 *      off 空 Partial。
 * 接线锁（源码层）：useWeekPlan 读模式 patch policy/weights + notes 带模式名；
 * OverviewPage 挂 ScenarioModeCard。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PhasePolicy } from '@/types';
import { DEFAULT_WEIGHTS } from '@/lib/planner/model';
import {
  SAFE_RANGE, patchPolicy, patchWeights, modeNoteOf, SCENARIO_MODES,
} from '@/lib/scenarioModes';

const here = dirname(fileURLToPath(import.meta.url));
const srcOf = (rel: string) => readFileSync(join(here, rel), 'utf8');

const policy = (over: Partial<PhasePolicy> = {}): PhasePolicy => ({
  dailyStudyMin: 120, maxBlockMin: 60, blankRatio: 0.25,
  eveningAllowed: false, weekendWork: false, studyPlaces: ['图书馆'],
  ...over,
});

test('F6-① 关闭=零漂移：off 原引用返回 + 权重空补丁', () => {
  const p = policy();
  assert.equal(patchPolicy(p, 'off'), p, 'off 必须原引用（结构零漂移）');
  assert.deepEqual(patchWeights(DEFAULT_WEIGHTS, 'off'), {});
  assert.equal(modeNoteOf('off'), null);
});

test('F6-② 考试周：自习×1.25、留白×0.65、单块钳 90——全部落在安全档', () => {
  const out = patchPolicy(policy(), 'exam-week');
  assert.equal(out.dailyStudyMin, 150, '120×1.25');
  assert.equal(out.blankRatio, 0.16, '0.25×0.65=0.1625 → toFixed(2) 后 0.16');
  assert.ok(out.blankRatio >= SAFE_RANGE.blankRatio[0] && out.blankRatio <= SAFE_RANGE.blankRatio[1]);
  assert.ok(out.dailyStudyMin >= SAFE_RANGE.dailyStudyMin[0] && out.dailyStudyMin <= SAFE_RANGE.dailyStudyMin[1]);
  assert.ok(out.maxBlockMin <= SAFE_RANGE.maxBlockMin);
  // 其余字段不动（只补不改）
  assert.equal(out.eveningAllowed, false);
  assert.deepEqual(out.studyPlaces, ['图书馆']);
  assert.match(modeNoteOf('exam-week')!, /考试周模式/);
});

test('F6-③ 超界输入必被钳回（RV：去掉钳制 → 本用例恰红）', () => {
  const wild = policy({ dailyStudyMin: 400, blankRatio: 0.05, maxBlockMin: 150 });
  for (const mode of ['exam-week', 'competition-week'] as const) {
    const out = patchPolicy(wild, mode);
    assert.ok(out.dailyStudyMin <= SAFE_RANGE.dailyStudyMin[1], `${mode} 日自习越档`);
    assert.ok(out.blankRatio >= SAFE_RANGE.blankRatio[0], `${mode} 留白越下界`);
    assert.ok(out.maxBlockMin <= SAFE_RANGE.maxBlockMin, `${mode} 单块越 90`);
  }
});

test('F6-④ 权重通道：考试周 dueOverdue×1.3 / 比赛周 transferRisk×1.5，只含被改键', () => {
  const exam = patchWeights(DEFAULT_WEIGHTS, 'exam-week');
  assert.deepEqual(Object.keys(exam), ['dueOverdue']);
  assert.equal(exam.dueOverdue, Number((DEFAULT_WEIGHTS.dueOverdue * 1.3).toFixed(2)));
  const comp = patchWeights(DEFAULT_WEIGHTS, 'competition-week');
  assert.deepEqual(Object.keys(comp), ['transferRisk']);
  assert.equal(comp.transferRisk, Number((DEFAULT_WEIGHTS.transferRisk * 1.5).toFixed(2)));
  assert.match(modeNoteOf('competition-week')!, /比赛周模式/);
  // 模式清单完整性（UI 三档）
  assert.deepEqual(SCENARIO_MODES.map((m) => m.id), ['off', 'exam-week', 'competition-week']);
});

test('F6-⑤ 接线锁：useWeekPlan 走 patchPolicy/patchWeights/notes；OverviewPage 挂卡', () => {
  const hook = srcOf('../src/features/week/useWeekPlan.ts');
  assert.match(hook, /patchPolicy\(phase\.policy, scenario\)/, 'policy 补丁接线');
  assert.match(hook, /weights: patchWeights\(DEFAULT_WEIGHTS, scenario\)/, '权重通道接线（F4）');
  assert.match(hook, /modeNoteOf\(scenario\)/, 'notes 带模式名（如实说明）');
  const ov = srcOf('../src/features/overview/OverviewPage.tsx');
  assert.match(ov, /<ScenarioModeCard \/>/, '总览挂模式卡');
});
