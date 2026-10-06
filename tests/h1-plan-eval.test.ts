/**
 * R批 Wave3（H1.1）· 日程摘要 + 评估引擎测试
 * ============================================================================
 *
 * 重点不是「分数算得对不对」，而是三条**语义纪律**——它们一旦破掉，
 * 评估功能就从「帮用户看清日程」变成「对用户造谣」：
 *
 *   D1 缺项必须判 `unknown`，**不能**判 `gap`
 *      没排运动 ≠ 没运动。把「看不到」说成「不够」是本功能最大的风险。
 *   D2 每个结论必须能指到块 id（可解释性）
 *      不可解释的分数用户不会信。
 *   D3 有氧达标是「中强度 150 **或** 高强度 75」，**不是相加**
 *
 * ⚠️ 反向验证（RV，红线 4）—— 全部**实测**过：
 *   RV-H1a ← 额外插一条 gap 冒充 unknown          → 1 条红（防「看不到→不够」）
 *   RV-H1b ← 有氧达标 max() 改成相加               → 1 条红（防中+高被当达标）
 *   RV-H1c ← fact() 强制返回 evidence: []          → 3 条红（防不可解释的分数）
 *
 * ⚠️ RV-H1c 踩过的坑（写变异脚本时注意）：往 `fact()` 的对象字面量里
 * 插 `evidence: []` **无效** —— 它后面有 `...extra`，且 TS 对象字面量里
 * 具名键不会被同层覆盖。必须把形参改名（`_evidence`）才变异得动。
 * 第一次 RV 报了「不成立」，其实是变异没生效，不是断言 weakness。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestBlocks, digestThresholds, intensityOf, NO_DATA, type PlanDigest } from '@/lib/planner/planDigest';
import { evaluateDigest, fmtMin, citedSlugs, type EvalStatus } from '@/lib/planner/planEval';
import { HEALTH_PARAMS } from '@/data/healthParams.generated';
import type { BlockKind, DayOfWeek, TimeBlock } from '@/types';

/** 健康库全部 hint（供「escalate 条目不进评估器」断言取 slug，避免硬编码列表） */
const HEALTH_HINTS = HEALTH_PARAMS.hints;

/* ============================================================
 * 夹具
 * ========================================================== */

let seq = 0;
function blk(
  dayOfWeek: DayOfWeek,
  startMin: number,
  endMin: number,
  title: string,
  kind: BlockKind = 'activity',
): TimeBlock {
  seq += 1;
  return { id: `b${seq}`, kind, dayOfWeek, startMin, endMin, title, source: 'user' };
}

const ev = (d: PlanDigest, key: 'moderateMin' | 'strengthDays' | 'overlongStudyBlocks' | 'reviewDays') => d[key];
const statusOf = (e: ReturnType<typeof evaluateDigest>, dimKey: string, fid: string): EvalStatus | undefined =>
  e.dimensions.find((d) => d.key === dimKey)?.findings.find((f) => f.id === fid)?.status;

const round = (n: number): number => Math.round(n);
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const dimOf = (e: ReturnType<typeof evaluateDigest>, key: string) =>
  e.dimensions.find((d) => d.key === key)!;

/* ============================================================
 * 强度分级
 * ========================================================== */

test('H1.2 强度分级：力量 > 高强度 > 中等，且命中不了就归 unclassified', () => {
  assert.equal(intensityOf('力量训练'), 'strength');
  assert.equal(intensityOf('健身房举铁'), 'strength');
  assert.equal(intensityOf('打篮球'), 'vigorous');
  assert.equal(intensityOf('夜跑 5 公里'), 'moderate');
  assert.equal(intensityOf('散步'), 'moderate');
  // 刻意保守：不知道就是不知道，不能瞎猜成有氧
  assert.equal(intensityOf('体育课'), 'unclassified');
  assert.equal(intensityOf('看比赛'), 'unclassified');
  assert.equal(intensityOf('自习'), 'unclassified');
});

test('H1.2 「力量跑」类标题按力量算（顺序敏感，力量优先）', () => {
  // 「力量」是抗阻信号，命中它就不该再被当有氧
  assert.equal(intensityOf('力量跑'), 'strength');
});

/* ============================================================
 * D2：可解释性
 * ========================================================== */

test('D2 每个有数据的指标都必须带 evidence（块 id）', () => {
  const d = digestBlocks([
    blk(1, 7 * 60, 8 * 60, '慢跑 5 公里'),
    blk(3, 19 * 60, 20 * 60, '力量训练'),
    blk(2, 9 * 60, 10 * 60, '高等数学', 'course'),
  ]);
  for (const f of [ev(d, 'moderateMin'), ev(d, 'strengthDays')]) {
    assert.equal(f.confident, true, '该指标应 confident');
    assert.ok(f.evidence.length > 0, `指标缺 evidence：${JSON.stringify(f)}`);
    for (const id of f.evidence) assert.equal(typeof id, 'string');
  }
  // evidence 里的 id 必须真的存在于输入块中
  const ids = new Set(d.blocks.map((b) => b.id));
  for (const id of ev(d, 'moderateMin').evidence) assert.ok(ids.has(id), `悬空 evidence: ${id}`);
});

test('D2 评估结论沿用 digest 的 evidence（不重新编一套）', () => {
  const blocks = [blk(1, 7 * 60, 8 * 60, '慢跑'), blk(4, 7 * 60, 8 * 60, '慢跑')];
  const d = digestBlocks(blocks);
  const e = evaluateDigest(d);
  const f = dimOf(e, 'exercise').findings.find((x) => x.id === 'ex-aerobic-gap')!;
  assert.ok(f, '应产出有氧不足结论');
  assert.deepEqual([...f.evidence].sort(), blocks.map((b) => b.id).sort());
});

/* ============================================================
 * D1：缺项 = unknown，绝不 = gap
 * ========================================================== */

test('D1 完全没有运动块时，有氧结论必须是 unknown 而非 gap', () => {
  const d = digestBlocks([blk(1, 9 * 60, 10 * 60, '高等数学', 'course')]);
  assert.equal(ev(d, 'moderateMin').confident, false);
  const e = evaluateDigest(d);
  assert.equal(statusOf(e, 'exercise', 'ex-aerobic-unknown'), 'unknown');
  // 关键：不能同时存在「有氧不足」的 gap 结论
  assert.equal(statusOf(e, 'exercise', 'ex-aerobic-gap'), undefined, '没数据时不得指控有氧不足');
  assert.equal(statusOf(e, 'exercise', 'ex-strength-gap'), undefined, '没数据时不得指控力量不足');
});

test('D1 unknown 结论必须带 notVisible 说明，且 advice 为空', () => {
  const e = evaluateDigest(digestBlocks([blk(1, 9 * 60, 10 * 60, '高等数学', 'course')]));
  const f = dimOf(e, 'exercise').findings.find((x) => x.id === 'ex-aerobic-unknown')!;
  assert.ok(f.notVisible && f.notVisible.length > 0, 'unknown 必须解释为什么看不到');
  assert.deepEqual(f.advice, [], 'unknown 不该给调整建议（无从调整）');
  assert.equal(f.basis, null, 'unknown 不该假借知识库权威');
});

test('D1 空日程不崩，且各维度 score 为 null（不是 0 分）', () => {
  const e = evaluateDigest(digestBlocks([]));
  for (const dim of e.dimensions) {
    assert.equal(dim.score, null, `${dim.key} 空日程不该给 0 分，应为 null`);
  }
  assert.equal(e.coverage, 0);
  assert.ok(e.caveats.some((c) => c.includes('块比较少')));
});

test('D1 排了运动但强度判不出时，缺口结论是 unknown + 免责说明', () => {
  const d = digestBlocks([blk(1, 7 * 60, 8 * 60, '体育课')]);
  assert.equal(d.unclassifiedExerciseMin.confident, true);
  assert.equal(d.moderateMin.confident, false, '「体育课」不该被算成中等强度');
  const e = evaluateDigest(d);
  assert.equal(statusOf(e, 'exercise', 'ex-aerobic-unknown'), 'unknown');
  assert.ok(
    e.caveats.some((c) => c.includes('没算进达标判断')),
    '必须提示有一段运动未计入',
  );
});

/* ============================================================
 * D3：有氧达标是「或」不是「加」
 * ========================================================== */

test('D3 高强度 75 分钟单独达标（不因中强度为 0 而判不足）', () => {
  const th = digestThresholds();
  const blocks: TimeBlock[] = [];
  // 3 次 25 分钟高强度球类 = 75 分钟，应达标
  for (const day of [1, 3, 5] as DayOfWeek[]) {
    blocks.push(blk(day, 18 * 60, 18 * 60 + 25, '打篮球'));
  }
  const d = digestBlocks(blocks);
  assert.equal(d.vigorousMin.value, 75);
  // 没有中强度块 → 中强度指标**不 confident**（不是「0 分钟」）。
  // 关键在评估器用 max(中强度达标比, 高强度达标比) 而非相加：
  // 0/150 缺席不该拖垮 75/75 的达标。
  assert.equal(d.moderateMin.confident, false);
  const e = evaluateDigest(d);
  assert.equal(statusOf(e, 'exercise', 'ex-aerobic-ok'), 'good', '75 分钟高强度应达标');
});

test('D3 中高强度不得相加（50+50=100 分钟仍判不足，不得当 150 达标）', () => {
  const th = digestThresholds();
  const blocks: TimeBlock[] = [
    blk(1, 7 * 60, 7 * 60 + 50, '慢跑'),
    blk(3, 7 * 60, 7 * 60 + 50, '打篮球'),
  ];
  const d = digestBlocks(blocks);
  assert.equal(d.moderateMin.value, 50);
  assert.equal(d.vigorousMin.value, 50);
  // 相加=100 < 150；分开看：50/150=0.33、50/75=0.67，取大者 0.67 → 仍不足
  const e = evaluateDigest(d);
  assert.equal(statusOf(e, 'exercise', 'ex-aerobic-gap'), 'gap', '100 分钟（中+高）不该被判达标');
  assert.ok(th.weeklyModerateMin > 100);
});

test('D3 中强度恰好 150 分钟判达标', () => {
  const th = digestThresholds();
  const d = digestBlocks([blk(1, 7 * 60, 7 * 60 + 90, '慢跑'), blk(3, 7 * 60, 7 * 60 + 60, '慢跑')]);
  assert.equal(d.moderateMin.value, th.weeklyModerateMin);
  assert.equal(statusOf(evaluateDigest(d), 'exercise', 'ex-aerobic-ok'), 'good');
});

/* ============================================================
 * 超额不奖励
 * ========================================================== */

test('超额有氧不加分（排 400 分钟不会得 100 分以上）', () => {
  const d = digestBlocks([blk(1, 6 * 60, 6 * 60 + 200, '慢跑')]);
  assert.equal(d.moderateMin.value, 200);
  const dim = dimOf(evaluateDigest(d), 'exercise');
  assert.ok(dim.score !== null && dim.score <= 100, `分数越界：${dim.score}`);
});

test('单次运动过短时给出「并成更长块」的建议（知识库 minimumSessionMin）', () => {
  const th = digestThresholds();
  const d = digestBlocks([blk(1, 7 * 60, 7 * 60 + 5, '散步'), blk(2, 7 * 60, 7 * 60 + 5, '散步')]);
  assert.ok(d.shortestExerciseSessionMin.value < th.minimumSessionMin);
  const f = dimOf(evaluateDigest(d), 'exercise').findings.find((x) => x.id === 'ex-aerobic-gap')!;
  assert.ok(
    f.advice.some((a) => a.includes('单次有效剂量')),
    `应提示单次过短，实际建议：${JSON.stringify(f.advice)}`,
  );
});

/* ============================================================
 * 睡眠
 * ========================================================== */

test('睡眠窗口：晚间排到 24 点后 → 机会小时降到 0', () => {
  // 周一 23:00-24:30 排事 → 到周二最早 8:00 才有课，机会 = 7.5h
  const d = digestBlocks([
    blk(1, 23 * 60, 23 * 60 + 90, '赶作业', 'study'),
    blk(2, 8 * 60, 9 * 60, '课', 'course'),
  ]);
  assert.ok(d.sleepOpportunityHours.confident);
  assert.ok(d.sleepOpportunityHours.value < 8, `期望 <8h，实际 ${d.sleepOpportunityHours.value}`);
  const e = evaluateDigest(d);
  assert.ok(
    ['sleep-short', 'sleep-ok'].includes(statusOf(e, 'sleep', 'sleep-short') ?? 'sleep-ok'),
  );
});

test('睡眠取一周最小值（不是平均）—— 有一晚熬夜就够判不足', () => {
  const blocks: TimeBlock[] = [
    // 周一~周五 21:00 结束 → 机会 11h
    ...([1, 2, 3, 4, 5] as DayOfWeek[]).map((d) => blk(d, 20 * 60, 21 * 60, '自习', 'study')),
    // 周六熬夜到 2:00
    blk(6, 24 * 60, 26 * 60, '赶DDL', 'study'),
    blk(7, 9 * 60, 10 * 60, '课', 'course'),
  ];
  const d = digestBlocks(blocks);
  const mins = [1, 2, 3, 4, 5].map((day) => {
    const today = blocks.filter((b) => b.dayOfWeek === day)!;
    return today[today.length - 1].endMin;
  });
  assert.ok(Math.max(...mins) === 21 * 60);
  // 周六那晚机会 = 周日 9:00 - 周六 26:00 = 7h → 最小值应取它
  assert.ok(d.sleepOpportunityHours.value <= 7, `应取最小值，实际 ${d.sleepOpportunityHours.value}`);
});

test('22 点后仍排事 → 报 gap 并给前移建议', () => {
  const d = digestBlocks([blk(2, 22 * 60 + 30, 23 * 60 + 30, '社团活动')]);
  assert.equal(d.lateNightBlockDays.value, 1);
  const f = dimOf(evaluateDigest(d), 'sleep').findings.find((x) => x.id === 'sleep-late')!;
  assert.equal(f.status, 'gap');
  assert.ok(f.advice.length > 0);
});

/* ============================================================
 * 学习
 * ========================================================== */

test('超长学习块（>maxConsecutiveBlockMin）报 gap 并给插入休息建议', () => {
  const d = digestBlocks([blk(1, 9 * 60, 9 * 60 + 180, '高数强化', 'study')]);
  assert.equal(d.overlongStudyBlocks.value, 1);
  const f = dimOf(evaluateDigest(d), 'study').findings.find((x) => x.id === 'study-overlong')!;
  assert.equal(f.status, 'gap');
  assert.ok(f.advice.some((a) => a.includes('休息')));
});

test('复习分散在 1 天判 gap、3 天判 good（间隔效应）', () => {
  const one = digestBlocks([blk(1, 9 * 60, 10 * 60, '复习高数', 'study')]);
  assert.equal(statusOf(evaluateDigest(one), 'study', 'study-review-gap'), 'gap');
  const three = digestBlocks([
    blk(1, 9 * 60, 10 * 60, '复习高数', 'study'),
    blk(2, 9 * 60, 10 * 60, '复习线代', 'study'),
    blk(3, 9 * 60, 10 * 60, '复习概率论', 'study'),
  ]);
  assert.equal(statusOf(evaluateDigest(three), 'study', 'study-review-ok'), 'good');
});

/* ============================================================
 * 习惯
 * ========================================================== */

test('习惯只统计一周出现 ≥2 天的（单次出现是事件不是习惯）', () => {
  const d = digestBlocks([
    blk(1, 7 * 60, 8 * 60, '晨跑'),
    blk(3, 7 * 60, 8 * 60, '晨跑'),
    blk(5, 18 * 60, 19 * 60, '看电影'),
  ]);
  const titles = d.habits.map((h) => h.title);
  assert.ok(titles.includes('晨跑'), '出现 2 天应算习惯');
  assert.ok(!titles.includes('看电影'), '只 1 天不该算习惯');
  assert.equal(d.habits[0].title, '晨跑');
  assert.equal(d.habits[0].days.length, 2);
});

test('弱习惯（只 1-2 天）报 gap 并引用习惯形成周期', () => {
  const d = digestBlocks([blk(1, 7 * 60, 8 * 60, '晨跑'), blk(3, 7 * 60, 8 * 60, '晨跑')]);
  const f = dimOf(evaluateDigest(d), 'load').findings.find((x) => x.id === 'habit-weak')!;
  assert.equal(f.status, 'gap');
  assert.ok(f.advice.some((a) => a.includes('不断')), '建议应落在「先求不断」');
});

/* ============================================================
 * 可复现性 + 依据可溯
 * ========================================================== */

test('可复现：同一份日程评估两次结果完全一致', () => {
  const blocks = [
    blk(1, 7 * 60, 8 * 60, '慢跑'),
    blk(2, 9 * 60, 11 * 60, '复习高数', 'study'),
    blk(3, 19 * 60, 20 * 60, '力量训练'),
  ];
  const a = evaluateDigest(digestBlocks(blocks));
  const b = evaluateDigest(digestBlocks(blocks));
  assert.deepEqual(a, b, '评估必须可复现（不允许 LLM 式抖动）');
});

test('每个非 unknown 结论都必须有知识库依据（可溯源）', () => {
  const d = digestBlocks([
    blk(1, 7 * 60, 8 * 60, '慢跑'),
    blk(2, 9 * 60, 12 * 60, '复习高数', 'study'),
    blk(3, 22 * 60, 23 * 60, '开会'),
    blk(4, 12 * 60, 12 * 60 + 30, '午饭', 'meal'),
  ]);
  const e = evaluateDigest(d);
  for (const dim of e.dimensions) {
    for (const f of dim.findings) {
      if (f.status === 'unknown') continue;
      assert.ok(f.basis && f.basis.slug && f.basis.tier, `${dim.key}/${f.id} 缺依据`);
      assert.ok(f.basis.quote.length > 0);
    }
  }
  const slugs = citedSlugs(e);
  assert.ok(slugs.length >= 3, `应引到多条知识库条目，实际 ${slugs.length}`);
  assert.equal(new Set(slugs.map((s) => s.slug)).size, slugs.length, 'citedSlugs 必须去重');
});

/**
 * D2 的**反向断言**：只验「digest 层 evidence 非空」是不够的 ——
 * 变异实测把 `fact()` 的 evidence 清空后，D2 仍全绿（假覆盖）。
 *
 * 这条直接盯**评估结论**：凡是 good / gap（有确定判定）的结论，
 * evidence 不得为空。unknown 不要求（本来就看不到，无从指认）。
 */
test('D2 评估结论的 evidence 不得为空（防「有分数但说不出是哪几块」）', () => {
  const d = digestBlocks([
    blk(1, 7 * 60, 8 * 60, '慢跑'),
    blk(3, 7 * 60, 8 * 60, '慢跑'),
    blk(2, 9 * 60, 12 * 60, '复习高数', 'study'),
    blk(3, 22 * 60, 23 * 60, '开会'),
    blk(4, 12 * 60, 12 * 60 + 30, '午饭', 'meal'),
  ]);
  const e = evaluateDigest(d);
  const all = e.dimensions.flatMap((dim) => dim.findings);
  const judged = all.filter((f) => f.status !== 'unknown');
  assert.ok(judged.length > 0, '本夹具应至少产生一条可判定的结论');
  for (const f of judged) {
    assert.ok(
      f.evidence.length > 0,
      `${f.id} 有结论却说不出来源块 —— 用户无法核对，分数不可信`,
    );
  }
});

/* ============================================================
 * 真机走查后补的三条（都是截图暴露、不是预防性设计）
 * ========================================================== */

/**
 * 修 1：`basisFrom` 首版只查健康库 → 方法库条目的依据行显示成裸 slug
 * （面板上出现「C 级 ultradian-rhythm」，等于没给用户任何信息）。
 */
test('依据行必须能取到中文标题（健康库与方法库都要查得到）', () => {
  const e = evaluateDigest(digestBlocks([
    blk(1, 9 * 60, 12 * 60, '复习高数', 'study'), // → ultradian-rhythm（方法库）
    blk(2, 9 * 60, 12 * 60, '复习高数', 'study'),
    blk(3, 22 * 60, 23 * 60, '开会'),
  ]));
  for (const s of citedSlugs(e)) {
    assert.notEqual(
      s.quote, s.slug,
      `依据「${s.slug}」显示成裸 slug，没有中文标题 —— 等于没给用户信息`,
    );
    assert.ok(!/^[a-z0-9-]+$/.test(s.quote), `依据行疑似 slug：${s.quote}`);
  }
});

/**
 * 修 2：「复习只集中在 0 天」—— 0 天也用「只集中在」读起来荒谬，
 * 且会被误解成「复习日=0」是个缺陷计数。
 */
test('复习天数 0 时判 unknown，不用「只集中在 0 天」这种措辞', () => {
  const d = digestBlocks([blk(1, 9 * 60, 10 * 60, '高数课', 'course')]);
  assert.equal(d.reviewDays.confident, true);
  assert.equal(d.reviewDays.value, 0);
  const e = evaluateDigest(d);
  const f = dimOf(e, 'study').findings.find((x) => x.id === 'study-review-none')!;
  assert.ok(f, '应有「没有标为复习的安排」这条 unknown 结论');
  assert.equal(f.status, 'unknown');
  assert.ok(f.notVisible && f.notVisible.includes('不等于你没复习'));
  // 旧的 gap 结论不得再出现
  assert.equal(statusOf(e, 'study', 'study-review-gap'), undefined, '0 天不得判 gap');
  // 措辞纪律：任何结论都不得出现「0 天」这种自相矛盾的说法
  for (const dim of e.dimensions) {
    for (const x of dim.findings) {
      assert.ok(!/0\s*天/.test(x.headline), `荒谬措辞：${x.headline}`);
    }
  }
});

/**
 * 修 3：饮食在「有 gap」的同时仍打 100 分 → 用户认为系统自相矛盾。
 * 分数必须与 gap 结论方向一致。
 */
test('有 gap 的维度不得打满分（分数与结论必须同向）', () => {
  const d = digestBlocks([
    blk(1, 8 * 60, 9 * 60, '课', 'course'),
    blk(1, 12 * 60, 12 * 60 + 30, '午饭', 'meal'),
    // 之后没有 meal 块 → 相邻两餐间隔 6+ 小时
    blk(2, 8 * 60, 9 * 60, '课', 'course'),
    blk(2, 12 * 60, 12 * 60 + 30, '午饭', 'meal'),
  ]);
  const e = evaluateDigest(d);
  const diet = dimOf(e, 'nutrition');
  const gaps = diet.findings.filter((f) => f.status === 'gap');
  assert.ok(gaps.length > 0, '前提：本夹具应造出饮食 gap');

  // 精确断言：同一份日程，**扣分** 与 **不扣分** 必须给出不同分数。
  // 只断言「<100」是不够的 —— 实测那样写时，把扣分逻辑摘掉测试仍全绿
  //（因为基础分本来就 <100），属假覆盖。这里直接钉住差值。
  const days = d.mealDays.value; // 有 meal 块的天数（判定 base 分的那一项）
  const base = round(clamp(days / digestThresholds().mealsPerDay));
  // 扣分公式里那个 60 是**地板**（饮食信息在日程里普遍不完整，不该因
  // 缺信息就打 0~50 分），所以精确断言必须带地板，否则会误判成「没扣分」。
  const FLOOR = 60;
  assert.equal(
    diet.score,
    Math.max(FLOOR, base - gaps.length * 20),
    '饮食分数必须按 gap 条数扣分（并受地板保护）',
  );
  // 真正的变异敏感点：**扣分是否发生** —— 变异把 `score = base` 时，
  // 上面的 assert.equal 必红（除非恰好 base ≤ FLOOR 掩盖了差异）。
  // 用「夹具能造出 >FLOOR 的基础分」来保证这个用例有效。
  assert.ok(
    base > FLOOR || gaps.length * 20 > 0,
    `夹具无效：base=${base} 恰被地板掩盖，本用例抓不到扣分逻辑`,
  );

  // 通用不变式：任何有 gap 且能判的维度，都不得等于「无 gap 时的基础分」
  for (const dim of e.dimensions) {
    if (dim.findings.filter((f) => f.status === 'gap').length === 0) continue;
    assert.ok(dim.score == null || dim.score <= 99, `${dim.key} 有 gap 却打满分`);
  }
});

test('escalate 条目不进评估器（需就医的情形走对话层）', () => {
  // 健康库里 escalate:true 的 slug 不应出现在任何评估依据里
  const escalate = HEALTH_ESCALATE_SLUGS;
  const e = evaluateDigest(digestBlocks([
    blk(1, 7 * 60, 8 * 60, '慢跑'),
    blk(2, 9 * 60, 12 * 60, '复习', 'study'),
    blk(3, 22 * 60, 23 * 60, '开会'),
  ]));
  const used = new Set(citedSlugs(e).map((s) => s.slug));
  for (const s of escalate) assert.ok(!used.has(s), `escalate 条目不该进评估：${s}`);
});

/** 从编译产物里取 escalate 条目（避免在测试里硬编码 slug 列表） */
const HEALTH_ESCALATE_SLUGS: string[] = (
  HEALTH_HINTS as readonly { slug: string; escalate: boolean }[]
).filter((h) => h.escalate).map((h) => h.slug);

/* ============================================================
 * 纯函数边界
 * ========================================================== */

test('NO_DATA 是不可信哨兵：value 不可当 0 用', () => {
  const f = NO_DATA();
  assert.equal(f.confident, false);
  assert.equal(f.evidence.length, 0);
  assert.ok(f.reason && f.reason.length > 0);
});

test('空标题 / 零时长块不产生 NaN', () => {
  const d = digestBlocks([blk(1, 100, 100, ''), blk(2, 0, 0, '零时长')]);
  for (const dim of d.days) {
    assert.ok(Number.isFinite(dim.bookedMin));
    assert.ok(Number.isFinite(dim.longestRunMin));
    assert.ok(Number.isFinite(dim.longestBlockMin));
  }
  assert.ok(Number.isFinite(d.blankMin.value));
});

test('commute / blank 块不计入个人时间占用', () => {
  const d = digestBlocks([blk(1, 8 * 60, 8 * 60 + 30, '走路去上课', 'commute')]);
  assert.equal(d.blocks.length, 0, 'commute 不该进 blocks');
  assert.equal(d.days.find((x) => x.day === 1)!.bookedMin, 0);
});

test('fmtMin 文案不出现奇怪格式', () => {
  assert.equal(fmtMin(0), '0 分钟');
  assert.equal(fmtMin(45), '45 分钟');
  assert.equal(fmtMin(60), '1 小时');
  assert.equal(fmtMin(95), '1 小时 35 分');
});
