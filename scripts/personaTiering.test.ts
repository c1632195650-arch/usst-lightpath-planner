/**
 * WP2 题库年级分层 + 上理场景化 —— 结构冻结与出卷逻辑测试
 * ============================================================
 * 铁律保证（dim 与计分逻辑一个字符不许动）用**机械比对**实现：
 * 本文件内嵌改写前题库的结构冻结表（id/order/reverse/trait/var/motif/options 的
 * key+value/output_field/consistency_with），与当前 personaBank 逐题比对 ——
 * 任何触到计分字段的"顺手改动"都会让 ST-STRUCT 用例红。
 *
 * ⚠️ 反向验证纪律（记录见 docs/wp-ledger-v2.md §WP2）：
 *   ST-SEQ  ← 把 buildPersonaSequence 还原成全库按 order 排列 → 出题序列用例红
 *   ST-A03  ← 给 A03 误挂 grades 且删恒插入分支 → A03 用例红
 *   ST-WORD ← 题面还原成改写前文案（git HEAD 版）→ 场景词覆盖用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPersonaSequence,
  PERSONA_ITEMS,
  PERSONA_VERSION,
  type TieredPersonaItem,
} from '@/data/personaBank';
import { buildProfile } from '@/lib/persona';
import type { AnswerMap } from '@/types';

/* ---------------- 结构冻结表（2026.09.01 原版计分字段，只读） ---------------- */

const FROZEN: Record<string, Record<string, unknown>> = {
  A01: { order: 1, reverse: false, trait: 'E' },
  A02: { order: 2, reverse: true, trait: 'E' },
  A03: { order: 3, reverse: false, trait: 'E', consistency_with: 'A01' },
  A04: { order: 4, reverse: false, trait: 'C' },
  A05: { order: 5, reverse: true, trait: 'C' },
  A06: { order: 6, reverse: false, trait: 'C' },
  A07: { order: 7, reverse: true, trait: 'ES' },
  A08: { order: 8, reverse: false, trait: 'ES' },
  A09: { order: 9, reverse: true, trait: 'ES' },
  A10: { order: 10, reverse: false, trait: 'O' },
  A11: { order: 11, reverse: false, trait: 'O' },
  A12: { order: 12, reverse: false, trait: 'A' },
  B01: { order: 13, motif: 'ACH' },
  B02: { order: 14, motif: 'SOC' },
  B03: { order: 15, motif: 'HEA' },
  B04: { order: 16, motif: 'EXP' },
  B05: { order: 17, options: ['ACH', 'SOC', 'HEA', 'EXP', 'STA'] },
  C01: { order: 18, options: { A: 100, B: 0 }, var: 'rationality' },
  C02: { order: 19, var: 'nfc' },
  C03: { order: 20, var: 'nfcc' },
  C04: { order: 21, var: 'maximizing' },
  C05: { order: 22, options: ['A', 'B', 'C', 'D'], output_field: 'help_path' },
  D01: { order: 23, options: { A: 100, B: 0 }, var: 'approach' },
  D02: { order: 24, var: 'cfc' },
  D03: { order: 25, options: { A: 0, B: 100 }, var: 'risk_study' },
  D04: { order: 26, var: 'risk_social' },
  D05: { order: 27, var: 'nightness' },
  E01: { order: 28, options: ['A', 'B'], output_field: 'meal_radius' },
  E02: { order: 29, options: ['A', 'B'], output_field: 'planning' },
  E03: { order: 30, options: ['A', 'B'], output_field: 'event_breadth' },
  E04: { order: 31, options: ['A', 'B'], output_field: 'social_radius' },
  E05: { order: 32, options: ['A', 'B', 'C'], output_field: 'night_supply' },
  E06: { order: 33, options: ['A', 'B'], output_field: 'exercise_trigger' },
  E07: { order: 34, options: ['A', 'B', 'C', 'D'], output_field: 'study_place' },
  E08: { order: 35, options: ['A', 'B', 'C', 'D'], output_field: 'info_channel' },
};

const OPTION_OUTPUTS: Record<string, Record<string, string>> = {
  C05: { A: 'search_self', B: 'ask_friend', C: 'try_self', D: 'defer' },
  E01: { A: 'near', B: 'far' },
  E02: { A: 'planned', B: 'flexible' },
  E03: { A: 'narrow', B: 'broad' },
  E04: { A: 'wide', B: 'close' },
  E05: { A: 'delivery', B: 'convenience', C: 'none' },
  E06: { A: 'with_others', B: 'self_plan' },
  E07: { A: 'library', B: 'classroom', C: 'dorm', D: 'cafe' },
  E08: { A: 'group_chat', B: 'wechat_mp', C: 'word_of_mouth', D: 'self_search' },
};

test('ST-STRUCT: 改写只动题面文案 —— 计分结构与冻结表逐题一致', () => {
  assert.equal(PERSONA_ITEMS.length, 35, '题库总数不变');
  for (const item of PERSONA_ITEMS as TieredPersonaItem[]) {
    const frozen = FROZEN[item.id];
    assert.ok(frozen, `${item.id} 在冻结表中必须存在（不许新增/删除题目）`);
    for (const [field, expect] of Object.entries(frozen)) {
      if (field === 'options') {
        const opts = item.options;
        assert.ok(opts, `${item.id} 的 options 不许丢`);
        if (Array.isArray(expect)) {
          assert.deepEqual(opts.map((o) => o.key), expect, `${item.id} 选项 key 顺序不许动`);
          if (OPTION_OUTPUTS[item.id]) {
            for (const o of opts) assert.equal(o.output ?? o.value, (OPTION_OUTPUTS[item.id] as Record<string, unknown>)[o.key], `${item.id} 选项 output 不许动`);
          }
        } else {
          const rec = expect as Record<string, number>;
          for (const o of opts) assert.equal(o.value, rec[o.key], `${item.id} 选项分值不许动`);
        }
      } else {
        assert.deepEqual(item[field as keyof TieredPersonaItem], expect, `${item.id}.${field} 不许动`);
      }
    }
  }
});

/* ---------------- 分层出卷 ---------------- */

const GRADES = [1, 2, 3, 4] as const;

test('ST-SEQ: grade=1 与 grade=4 出题序列不同；未知年级 → 全库 35 题', () => {
  // 反向：buildPersonaSequence 还原成全库按 order 排列（不做年级过滤）→ 本用例红
  const g1 = buildPersonaSequence(1).map((i) => i.id);
  const g4 = buildPersonaSequence(4).map((i) => i.id);
  assert.notDeepEqual(g1, g4, '两个年级的卷面必须不同');
  assert.equal(g1.length, 31);
  assert.equal(g4.length, 29);

  const full = buildPersonaSequence(undefined).map((i) => i.id);
  assert.equal(full.length, 35, '没填年级（跳过引导）→ 与分层前一致，全库出卷');
  assert.deepEqual(full, [...PERSONA_ITEMS].sort((a, b) => a.order - b.order).map((i) => i.id));
});

test('ST-A03: A03 一致性题在每个年级的卷面都恒出现，且锚定 A01 之后', () => {
  // 反向：A03 被年级标签误伤且恒插入分支被删 → 本用例红
  for (const g of GRADES) {
    const ids = buildPersonaSequence(g).map((i) => i.id);
    assert.ok(ids.includes('A03'), `grade=${g} 的卷面必须有 A03`);
    assert.ok(ids.indexOf('A01') >= 0 && ids.indexOf('A01') < ids.indexOf('A03'), 'A03 需锚定在 A01 之后（一致性对照）');
    assert.ok(ids.indexOf('A02') < ids.indexOf('A03'), 'A03 保持固定序位（A02 之后）');
  }
});

test('ST-COUNT: 分层题总数 ∈ [8,14]；每份卷总题数 ≥ 8（buildProfile 可用）', () => {
  // 分层口径见 personaBank.ts 头注：8~14 按【带 grades 标签的分层题总数】实现
  const tagged = PERSONA_ITEMS.filter((i) => (i as TieredPersonaItem).grades);
  assert.ok(tagged.length >= 8 && tagged.length <= 14, `分层题数 ${tagged.length} 应在 8~14`);
  for (const g of GRADES) {
    assert.ok(buildPersonaSequence(g).length >= 8, `grade=${g} 卷面题量 ≥ 8`);
  }
});

test('ST-TAGS: 分层题的 grades 值域合法（1-4 子集），sceneTag 为非空字符串', () => {
  for (const item of PERSONA_ITEMS as TieredPersonaItem[]) {
    if (item.grades) {
      assert.ok(item.grades.length > 0, `${item.id} grades 不许是空数组（空=永不出现，等于删题）`);
      for (const g of item.grades) assert.ok(g >= 1 && g <= 4, `${item.id} grades 值域 1-4`);
    }
    if (item.sceneTag !== undefined) assert.ok(item.sceneTag.trim().length > 0);
  }
});

/* ---------------- 上理场景化覆盖（≥60%） ---------------- */

const USST_WORDS = [
  '上理', '军工路', '1100', '食堂', '图书馆', '通宵', '光电杯', '体育大课', '校园跑',
  '早八', '宿舍', '社团', '外卖', '教学楼', '通勤', '选课', '保研', '秋招', '考研',
  '高数', '课设', '班级群', '校历', '毕设', '期中',
];

test('ST-WORD: ≥60% 题面命中上理场景词表', () => {
  // 反向：题面还原成改写前文案（git HEAD 版 personaBank.ts）→ 本用例红
  const hit = PERSONA_ITEMS.filter((item) => USST_WORDS.some((w) => item.text.includes(w)));
  assert.ok(
    hit.length / PERSONA_ITEMS.length >= 0.6,
    `场景化覆盖 ${(hit.length / PERSONA_ITEMS.length * 100).toFixed(0)}% 应 ≥60%（当前命中 ${hit.length}/35）`,
  );
});

/* ---------------- buildProfile 固定作答回归 ---------------- */

/** 固定作答：全 35 题一致作答（外向、计划型）——改写前后 buildProfile 输出必须逐值一致 */
const FIXED_ANSWERS: AnswerMap = {
  A01: 5, A02: 2, A03: 5, A04: 4, A05: 2, A06: 4, A07: 2, A08: 4, A09: 2, A10: 4, A11: 4, A12: 3,
  B01: 5, B02: 3, B03: 4, B04: 3,
  B05: ['ACH', 'HEA', 'SOC', 'EXP', 'STA'],
  C01: 'A', C02: 4, C03: 3, C04: 4, C05: 'A',
  D01: 'A', D02: 4, D03: 'B', D04: 4, D05: 3,
  E01: 'A', E02: 'A', E03: 'B', E04: 'A', E05: 'A', E06: 'B', E07: 'A', E08: 'D',
};

test('ST-REG: 固定作答 → buildProfile 可用（原型命中、轴在值域、确定性）', () => {
  const p1 = buildProfile(FIXED_ANSWERS);
  const p2 = buildProfile(FIXED_ANSWERS);
  assert.deepEqual(p1.axes, p2.axes, '同输入同输出（确定性）');
  assert.ok(p1.archetype.primary, '一致作答应命中一个校园原型（buildProfile 可用）');
  assert.equal(p1.quality, 'ok', 'A01/A03 一致作答不该触发低质量标记');
  for (const v of Object.values(p1.axes)) assert.ok(v >= 0 && v <= 100, '轴值域 0-100');
  // 冻结锚（2026-09-27 实测）：改写若意外动了计分结构，这组轴值会漂移（与 ST-STRUCT 互为双保险）
  assert.deepEqual(p1.axes, { EXP: 66, PLAN: 76, SOC: 84, RES: 81, ACH: 75, HEA: 80, RAT: 86, BOLD: 82 });
});

test('ST-REG2: 分层卷面缺题不炸 —— 只答大一卷 31 题也能出画像', () => {
  const g1Ids = new Set(buildPersonaSequence(1).map((i) => i.id));
  const partial: AnswerMap = Object.fromEntries(
    Object.entries(FIXED_ANSWERS).filter(([id]) => g1Ids.has(id)),
  );
  const p = buildProfile(partial);
  assert.ok(p.archetype.primary, '大一卷缺 4 道分层题仍应可用');
  for (const v of Object.values(p.axes)) assert.ok(v >= 0 && v <= 100);
});
