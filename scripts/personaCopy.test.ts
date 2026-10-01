/**
 * E3 画像结果页文案库测试
 * ========================
 * 验收（docs/plan-2026-09-21-full.md §二 E3）：
 *  · 6 原型 × 多轴值组合抽查，无负面表述（敏感词全量扫描）；
 *  · 未命中路径（primary == null）有兜底；
 *  · 同 (profile, seed) 确定性、跨 seed 可变；
 *  · makeEpithet：槽位拼接正确、身份尾巴按 专业→学院→年级→上理人 回落。
 * 全部纯函数，不碰 localStorage、不碰浏览器。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHETYPE_BLURBS, FALLBACK_BLURBS, makeEpithet, pickBlurb,
} from '@/features/persona/personaCopy';
import { ARCHETYPES, AXIS_KEYS } from '@/lib/persona';
import type { PersonaProfile } from '@/types';

/** 敏感词表（红线：文案里不许出现任何负向定性） */
const BANNED = ['焦虑', '摆烂', '内卷', '落后', '拖延', '效率低', '挂科', '失败', '垃圾', '差', '废', '烂'];
const MARKDOWN = /\*\*|__|`|#/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

/** 构造最小画像（personaCopy 只消费 axes / scenarios / archetype.primary） */
function fakeProfile(
  axes: Partial<Record<string, number>>,
  primaryId?: string,
): PersonaProfile {
  const full = Object.fromEntries(AXIS_KEYS.map((k) => [k, axes[k] ?? 50]));
  const primary = primaryId ? ARCHETYPES.find((a) => a.id === primaryId) ?? null : null;
  return {
    axes: full,
    archetype: { primary, secondary: null, distance: primary ? 0.1 : 0.9 },
  } as unknown as PersonaProfile;
}

test('文案库结构：6 原型每家 ≥4 条变体，兜底池 ≥3 条', () => {
  for (const a of ARCHETYPES) {
    const pool = ARCHETYPE_BLURBS[a.id];
    assert.ok(Array.isArray(pool) && pool.length >= 4, `原型 ${a.id} 变体不足`);
    for (const t of pool) assert.ok(t.trim().length >= 8, `${a.id} 有过短变体`);
  }
  assert.ok(FALLBACK_BLURBS.length >= 3);
});

test('红线扫描：全部 blurb + 兜底无敏感词、无 markdown、无 emoji', () => {
  const all = [...Object.values(ARCHETYPE_BLURBS).flat(), ...FALLBACK_BLURBS];
  for (const t of all) {
    for (const w of BANNED) {
      assert.ok(!t.includes(w), `文案含敏感词「${w}」：${t}`);
    }
    assert.ok(!MARKDOWN.test(t), `文案含 markdown 符号：${t}`);
    assert.ok(!EMOJI.test(t), `文案含 emoji：${t}`);
  }
});

test('未命中路径有兜底：primary == null 时 blurb 来自 FALLBACK_BLURBS', () => {
  const p = fakeProfile({ PLAN: 50 });
  const b = pickBlurb(p, 0);
  assert.ok(FALLBACK_BLURBS.includes(b), `兜底池没接上：${b}`);
});

test('同 (profile, seed) 两次生成逐字一致（确定性）', () => {
  const p = fakeProfile({ PLAN: 85 }, 'planner');
  assert.equal(pickBlurb(p, 3), pickBlurb(p, 3));
  assert.equal(makeEpithet(p, { major: '光电信息科学与工程' }, 3),
               makeEpithet(p, { major: '光电信息科学与工程' }, 3));
});

test('同 profile 跨 seed 文案可变（不背台词）', () => {
  const p = fakeProfile({}, 'social');
  const seen = new Set<string>();
  for (let seed = 0; seed < 20; seed++) seen.add(pickBlurb(p, seed));
  assert.ok(seen.size >= 2, `20 个 seed 只出 ${seen.size} 种 blurb`);
});

test('6 原型 × 3 组轴值：blurb 与 epithet 全部非空且不含敏感词', () => {
  const axisSets: Partial<Record<string, number>>[] = [
    { PLAN: 85, ACH: 75 },                       // 高计划
    { SOC: 80, EXP: 72, PLAN: 30 },              // 高社交低计划
    {},                                          // 全轴中性（走场景/兜底槽位）
  ];
  for (const a of ARCHETYPES) {
    for (const axes of axisSets) {
      const p = fakeProfile(axes, a.id);
      const texts = [pickBlurb(p, 1), pickBlurb(p, 2), makeEpithet(p, { grade: '大二' }, 1)];
      for (const t of texts) {
        assert.ok(t.trim().length > 0, `${a.id} 出现空文案`);
        for (const w of BANNED) assert.ok(!t.includes(w), `${a.id} 文案含「${w}」：${t}`);
      }
    }
  }
});

test('makeEpithet：高轴命中正向短语，身份尾巴用专业', () => {
  const p = fakeProfile({ HEA: 85, PLAN: 72, EXP: 20, BOLD: 20, RAT: 20, RES: 20, ACH: 20, SOC: 20 });
  const e = makeEpithet(p, { major: '光电信息科学与工程' }, 0);
  assert.ok(e.includes('光电信息科学与工程'), e);
  assert.ok(e.endsWith('专业同学'), e);
  // 最高轴是 HEA（85）→ 短语应出自 AXIS_HIGH.HEA（把操场当第二个家 / 作息稳得像校历）
  assert.match(e, /^(把操场当第二个家|作息稳得像校历)的/, e);
});

test('makeEpithet：身份回落链 专业 → 学院 → 年级 → 上理人', () => {
  const p = fakeProfile({});
  assert.match(makeEpithet(p, { major: '机械设计', college: '机院', grade: '大三' }, 0), /机械设计专业同学$/);
  assert.match(makeEpithet(p, { college: '机院', grade: '大三' }, 0), /机院同学$/);
  assert.match(makeEpithet(p, { grade: '大三' }, 0), /大三同学$/);
  assert.match(makeEpithet(p, {}, 0), /上理人$/);
  assert.match(makeEpithet(p, undefined, 0), /上理人$/);
});

test('makeEpithet：全轴中性且无场景时走兜底短语，不抛异常', () => {
  const p = fakeProfile({});
  const e = makeEpithet(p, undefined, 5);
  assert.ok(e.includes('有自己的节奏') || e.length > 4, e);
});

test('makeEpithet：低轴反差幽默（低 PLAN 轴不产生负向表述）', () => {
  const p = fakeProfile({ PLAN: 20 });
  for (let seed = 0; seed < AXIS_KEYS.length + 2; seed++) {
    const e = makeEpithet(p, undefined, seed);
    for (const w of BANNED) assert.ok(!e.includes(w), `含「${w}」：${e}`);
  }
});
