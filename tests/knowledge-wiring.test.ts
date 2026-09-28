/**
 * E 批 E1 · 知识库 → 引擎接线验收（2026-09-28）
 * ============================================================
 * 「知识在库里，决策在拍脑袋」的收口验收。四条判据：
 *   ① 开关缺省关闭 = **零行为变化**（基线锚，这是本批最重要的保证）；
 *   ② 开启后知识确实生效（可观测差异：maxBlockMin 被钳到深度工作上限）；
 *   ③ 档位替换纯函数正确（方法库档位 + 久坐安全档）；
 *   ④ 叠加顺序 = 知识赢画像自动调整、**输用户明确说过的话**（源码位置锁）。
 *
 * 反向验证锚点（RV，删实现必红）：
 *   E1-RV1 ← construct.ts 去掉 `knowledgeWired() ?` 三元 → 源码锁用例红
 *   E1-RV2 ← buildPhases 的 kb 补丁不参与合成 → 「开启后钳制生效」用例红
 *   E1-RV3 ← sedentarySafeDurations 去掉 >60 过滤 → 久坐档用例红
 *   E1-RV4 ← policyPatchFromKnowledge 无条件产出 patch → 「不无中生有」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PersonaProfile, PhasePolicy, Schedule } from '@/types';
import { buildPhases } from '@/lib/planner/buildPhases.ts';
import {
  knowledgeWired, policyPatchFromKnowledge, sedentarySafeDurations, studyBlockDurations,
} from '@/lib/planner/knowledge.ts';
import { DEEP_WORK, STUDY_DURATIONS } from '@/lib/planner/methods.ts';
import { SEDENTARY } from '@/lib/planner/health.ts';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL('..' + rel, import.meta.url)), 'utf8');

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 20,
  source: 'demo',
  courses: [
    {
      id: 'c1', name: '大学物理A(2)', credit: 4, category: '公共基础', campus: 'JG516',
      building: '第一教学楼', room: '144',
      slots: [{ dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: range(3, 18) }],
    },
  ],
};

/**
 * 计划性偏高（PLAN 80）→ applyPersona 把 maxBlockMin 抬到「基准 + 30」：
 * normal/midterm 90→**120**（超过深度工作上限 90）——正好是本接线要钳制的情形。
 */
const PERSONA: PersonaProfile = {
  version: 'test', scoreVersion: 'test',
  axes: { EXP: 50, PLAN: 80, SOC: 50, RES: 50, ACH: 50, HEA: 50, RAT: 50, BOLD: 50 },
  traits: { E: 50, C: 50, ES: 50, O: 50, A: 50 },
  motives: { ACH: 50, SOC: 50, HEA: 50, EXP: 50, STA: 50 },
  scenarios: {
    meal_radius: '', planning: '', event_breadth: '', social_radius: '',
    night_supply: '', exercise_trigger: '', study_place: 'library', info_channel: '',
  },
  archetype: { primary: null, secondary: null, distance: 0 },
  confidence: {}, quality: 'ok', updatedAt: '2026-09-28',
};

/** 在指定开关状态下跑一段代码，跑完复原（避免污染同进程的其它用例） */
function withWired<T>(on: boolean, fn: () => T): T {
  const prev = process.env.KNOWLEDGE_WIRED;
  if (on) process.env.KNOWLEDGE_WIRED = '1';
  else delete process.env.KNOWLEDGE_WIRED;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.KNOWLEDGE_WIRED;
    else process.env.KNOWLEDGE_WIRED = prev;
  }
}

/* ---------------- ① 开关 ---------------- */

test('E1 开关: knowledgeWired() 读环境变量，缺省 false', () => {
  withWired(false, () => assert.equal(knowledgeWired(), false, '未设变量 = 关闭'));
  withWired(true, () => assert.equal(knowledgeWired(), true, "'1' = 开启"));
});

/* ---------------- ② 关闭 = 零行为变化（基线锚，最重要） ---------------- */

test('E1 基线锚: 开关关闭时策略与既往逐值一致（maxBlockMin 保持 120，无知识理由）', () => {
  withWired(false, () => {
    const { plan } = buildPhases(SCHEDULE, PERSONA);
    const maxes = plan.phases.map((p) => p.policy.maxBlockMin);
    assert.equal(Math.max(...maxes), 120, '画像放长后的 120 必须原样保留');
    assert.ok(
      !plan.phases.some((p) => p.reasons.some((r) => r.includes('深度工作'))),
      '关闭时不得出现知识库理由',
    );
  });
});

/* ---------------- ③ 开启 = 知识生效（可观测差异） ---------------- */

test('E1 生效: 开启后所有阶段 maxBlockMin ≤ 深度工作上限，且理由说明来源', () => {
  withWired(true, () => {
    const { plan } = buildPhases(SCHEDULE, PERSONA);
    for (const p of plan.phases) {
      assert.ok(
        p.policy.maxBlockMin <= DEEP_WORK.blockMin,
        `${p.kind} 未被钳制：${p.policy.maxBlockMin} > ${DEEP_WORK.blockMin}`,
      );
    }
    const hit = plan.phases.filter((p) => p.reasons.some((r) => r.includes('深度工作')));
    assert.ok(hit.length >= 1, '被钳制的阶段必须给出知识来源理由（可解释纪律）');
    assert.ok(
      plan.phases.some((p) => p.policy.maxBlockMin === DEEP_WORK.blockMin),
      '确实发生了钳制（不是恰好都小于上限）',
    );
  });
});

/* ---------------- ④ 纯函数 ---------------- */

const BASE: PhasePolicy = {
  dailyStudyMin: 120, maxBlockMin: 45, blankRatio: 0.2,
  eveningAllowed: false, weekendWork: false, studyPlaces: [],
};

test('E1 纯函数: 未超限时不产出任何键（不无中生有理由）', () => {
  const r = policyPatchFromKnowledge('normal', BASE);
  assert.deepEqual(r.patch, {});
  assert.deepEqual(r.reasons, []);
});

test('E1 纯函数: 超限时钳到深度工作上限并给出一条理由', () => {
  const r = policyPatchFromKnowledge('normal', { ...BASE, maxBlockMin: 120 });
  assert.equal(r.patch.maxBlockMin, DEEP_WORK.blockMin);
  assert.equal(r.reasons.length, 1);
});

test('E1 档位: 自习档位来自方法库；久坐安全档剔除超过 60 分钟的档位', () => {
  assert.deepEqual(studyBlockDurations(), STUDY_DURATIONS, '档位必须溯源到 method_kb 编译产物');
  assert.deepEqual(sedentarySafeDurations([45, 60, 90]), [45, 60], '>60 的档位被剔除');
  assert.deepEqual([...sedentarySafeDurations(STUDY_DURATIONS)], [...STUDY_DURATIONS], '方法库档位全在安全区');
  assert.deepEqual(sedentarySafeDurations([90, 120]), [SEDENTARY.breakEveryMin], '全超限时兜底到人群上限');
});

/* ---------------- ⑤ 源码锁（接线形状 + 叠加顺序） ---------------- */

test('E1 源码锁: construct 自习档位受 knowledgeWired 控制（关闭回退 [45,60,90]）', () => {
  const c = src('/src/lib/planner/construct.ts');
  assert.match(
    c,
    /knowledgeWired\(\)[\s\S]{0,120}sedentarySafeDurations\(studyBlockDurations\(\)\)[\s\S]{0,60}\[45, 60, 90\]/,
    '三元必须在位：开启走知识档位、关闭回退原档位',
  );
});

test('E1 源码锁: 知识补丁在生活模式之后、用户校正之前（顺序即语义）', () => {
  const bs = src('/src/lib/planner/buildPhases.ts');
  const iLife = bs.indexOf('applyLifeMode(');
  const iKb = bs.indexOf('policyPatchFromKnowledge(');
  const iCorr = bs.indexOf('applyCorrectionsToPolicy(');
  assert.ok(iLife > 0 && iKb > 0 && iCorr > 0, '三处调用都应在位');
  assert.ok(iLife < iKb, '知识补丁应在生活模式之后（先有基线可钳）');
  assert.ok(iKb < iCorr, '知识补丁应在用户校正之前（用户明说的永远赢）');
});
