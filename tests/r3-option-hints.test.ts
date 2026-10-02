/**
 * R 批 P0-3 · R3 选项与依据对齐 —— 纯函数层测试
 * ============================================================
 * 任务书依据：outputs/R批任务书-交zcode-2026-10-02.md §三 P0-3（R3.1/R3.2/R3.3）。
 *
 * CY 走查实录：
 *   「你给的 tips 跟用户选项有的相关性不大」——
 *   选「45 分钟」→ 次行写「60 分钟 ≈ 半场 3v3」；选「90 分钟」→
 *   次行写「每周中高强度累计 ≥150 分钟」（周总量，与"单次多久"毫无关系）。
 *
 * 根因（修复前 `weekPlanForChat.ts`）：
 *   hint: i === 1 && evidence ? evidence : catTips[i % catTips.length]
 * `catTips` 是 taxonomy 的**类别通用提示数组**，按数组下标轮换 → 第 i 个档位
 * 配到第 i 条类别提示，两者之间没有任何语义关系。
 *
 * ⚠️ 反向验证（RV，红线 4）：
 *   RV-R3a ← 把 durationTip/frequencyTip 改回 `tips[i % tips.length]` 轮换
 *             → 「四档 hint 互不相同」与「单次档不含周总量」用例红
 *   RV-R3b ← 删 taxonomy 任一类目的 tipsByDuration 整块
 *             → 「每类目四档齐全」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyGoal, TAXONOMY, type GoalCategory } from '@/features/libao/taxonomy';
import { quickOptionsFor, type QuickOption } from '@/features/libao/weekPlanForChat';
import type { IntentSlots } from '@/features/libao/libaoIntent';

const TODAY = '2026-10-02';

/** 单次事件（isSingleDayEvent 为真）→ 走 45/60/90/120 四档
 *  ⚠️ 判据（libaoIntent.ts:1282）：必须有 when 的 exact / relative 形态，
 *  只填 `certainty: 'exact'` 不算 —— `certainty` 是「把握度」，不是日期形态。 */
const singleSlots = (patch: Partial<IntentSlots> = {}): IntentSlots => ({
  intent: 'create',
  title: '打球',
  certainty: 'exact',
  priorityHint: 85,
  missing: [],
  unclear: [],
  raw: '明天打球一小时',
  when: { text: '明天', kind: 'relative', relativeDays: 1 },
  ...patch,
});

/** 长期诉求（无具体日期 + 含长期词）→ 走 每周1-2 / 3-4 / 每天30 三档 */
const longSlots = (patch: Partial<IntentSlots> = {}): IntentSlots => ({
  intent: 'create',
  title: '这学期想养成健身的习惯',
  certainty: 'window',
  priorityHint: 70,
  missing: [],
  unclear: [],
  raw: '这学期想养成健身的习惯',
  ...patch,
});

const hints = (opts: QuickOption[]): string[] => opts.map((o) => o.hint ?? '');

/** 周总量字样 —— 出现在**单次**档就是错配（R3.2 验收硬条件） */
const WEEK_TOTAL_WORDS = ['每周', '一周', '累计'];

/* ---------------- R3.1 · 单次四档 hint 互不相同 ---------------- */

test('R3.1: 单次四档 hint 互不相同（原缺陷=索引轮换会撞车/错配）', () => {
  const opts = quickOptionsFor('effort', singleSlots(), { today: TODAY });
  assert.equal(opts.length, 4, '单次事件仍是 45/60/90/120 四档');
  const hs = hints(opts);
  assert.equal(new Set(hs).size, 4, `四档 hint 必须互不相同，实际：\n${hs.join('\n')}`);
});

test('R3.1: 「45 分钟」配的是 45 分钟的量感，不是 60 分钟那条', () => {
  const hs = hints(quickOptionsFor('effort', singleSlots(), { today: TODAY }));
  assert.ok(hs[0].includes('45') || hs[0].includes('半场 3v3 跑几趟'),
    `45 档应说 45 分钟的量，实际：「${hs[0]}」`);
  assert.ok(!hs[0].includes('60 分钟 ≈ 半场 3v3'),
    `45 档不得配 60 档那条（原缺陷），实际：「${hs[0]}」`);
});

test('R3.2: 单次档 hint 不含周总量字样（每周/一周/累计）', () => {
  for (const cat of ['sport-aerobic', 'sport-strength', 'study-course', 'study-research', 'generic'] as GoalCategory[]) {
    const opts = quickOptionsFor('effort', singleSlots({ title: cat === 'generic' ? '写点东西' : TAXONOMY[cat].keywords[0] }), { today: TODAY });
    hints(opts).forEach((h, i) => {
      // 依据行（推荐档 i===1）允许出现「每周 ≥150 分钟」——那是 evidenceLine 的职责
      if (i === 1) return;
      for (const w of WEEK_TOTAL_WORDS) {
        assert.ok(!h.includes(w), `${cat} 第 ${i} 档混入周总量字样「${w}」：${h}`);
      }
    });
  }
});

/* ---------------- R3.2 · 依据行只出现在推荐档 ---------------- */

test('R3.2: 依据行（依据：…）只出现在推荐档，其余档不冒充依据', () => {
  // 造一个能产出 evidenceLine 的类目 + 本周已排量
  const opts = quickOptionsFor('effort', singleSlots({ title: '跑步' }), {
    today: TODAY,
    exercisePerWeek: 1,
  });
  const marked = opts.map((o, i) => (o.hint ?? '').startsWith('依据：') ? i : -1).filter((i) => i >= 0);
  assert.equal(marked.length, 1, `依据行应只出现 1 次，实际出现在第 ${JSON.stringify(marked)} 档`);
  assert.equal(marked[0], 1, '依据行落在推荐档（第二项 = 60 分钟）');
});

test('R3.2: 无证据来源时，任何档都不该冒出「依据：」字样', () => {
  const opts = quickOptionsFor('effort', singleSlots({ title: '写点东西' }), { today: TODAY });
  hints(opts).forEach((h) => assert.ok(!h.startsWith('依据：'), `凭空出现依据行：${h}`));
});

/* ---------------- R3.3 · 数据源：tipsByDuration 覆盖每类目四档 ---------------- */

test('R3.3: 每个类目 tipsByDuration 覆盖 45/60/90/120 四档', () => {
  for (const cat of Object.keys(TAXONOMY) as GoalCategory[]) {
    const byDur = TAXONOMY[cat].tipsByDuration;
    assert.ok(byDur, `${cat} 缺 tipsByDuration`);
    for (const min of [45, 60, 90, 120]) {
      assert.ok(byDur[min], `${cat}.tipsByDuration 缺 ${min} 档`);
    }
  }
});

test('R3.3: 每个类目 tipsByFrequency 覆盖 2/4/7 三档', () => {
  for (const cat of Object.keys(TAXONOMY) as GoalCategory[]) {
    const byFreq = TAXONOMY[cat].tipsByFrequency;
    assert.ok(byFreq, `${cat} 缺 tipsByFrequency`);
    for (const n of [2, 4, 7]) {
      assert.ok(byFreq[n], `${cat}.tipsByFrequency 缺 ${n} 档`);
    }
  }
});

test('R3.3: 频率档 hint 互不相同（同样禁轮换）', () => {
  const opts = quickOptionsFor('effort', longSlots(), { today: TODAY });
  assert.equal(opts.length, 3, '长期诉求仍是三档频率按钮');
  const hs = hints(opts);
  assert.equal(new Set(hs).size, 3, `三档 hint 必须互不相同，实际：\n${hs.join('\n')}`);
});

/* ---------------- 覆盖：分类判定未受影响 ---------------- */

test('sanity: 分类判定仍正常（关键词 → 类目）', () => {
  assert.equal(classifyGoal('打篮球'), 'sport-aerobic');
  assert.equal(classifyGoal('健身房'), 'sport-strength');
  assert.equal(classifyGoal('背单词'), 'study-course');
  assert.equal(classifyGoal('数模'), 'study-research');
  assert.equal(classifyGoal('随便什么'), 'generic');
});

test('sanity: 缺项回退到类目 tips[0]（一句话总纲），不返回空', () => {
  // 造一个不存在的档位 → 走回退分支
  const opts = quickOptionsFor('effort', singleSlots({ title: '跑步' }), { today: TODAY });
  for (const o of opts) {
    assert.ok((o.hint ?? '').length > 0, `${o.label} 的 hint 不得为空`);
  }
});
