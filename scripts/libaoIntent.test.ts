/**
 * 对话意图层回归测试（`src/features/libao/libaoIntent.ts`）
 * ============================================================
 * 这一层的存在意义是「把一句人话变成可排的事」，所以测试围绕四件事：
 *
 *   ① **超集纪律**：新入口不许弄丢 `LbaoChat.tsx::isRecommendIntent` 的老能力
 *   ② **不编**：抽不到就留空进 `missing`，不许拿半个动词当目标
 *   ③ **规则优先**：LLM 只补空、不覆盖 —— 否则「这个值哪来的」不可归因
 *   ④ **确定性**：同输入同输出（LLM 路径之外）
 *
 * ⚠️ 本文件按项目纪律做了**反向验证**：把 `extractTitle` 的「撞停用词 break」
 *    改回 continue、把 `mergeSlots` 改成「LLM 覆盖」、把 `extractWhen` 的
 *    `unspecified` 分支删掉，都必须让这里的用例变红。证据见 PR 说明。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClarifyAnswer,
  describeSlots,
  detectIntent,
  extractEffort,
  extractFrequency,
  extractPlace,
  extractPriority,
  extractTarget,
  extractTitle,
  extractWhen,
  extractWindow,
  looksLikeAction,
  mergeSlots,
  missingSlots,
  parseGoalIntent,
  parseIntentSlots,
  resolveWhen,
  topQuestions,
} from '@/features/libao/libaoIntent';

/** 用户原话（本功能的需求来源，逐字保留） */
const USER_SENTENCE =
  '我要报名参加数学建模打算，大概是九月中旬开始比赛，具体时间也没定，请你根据我目前的日程时间帮我规划一下备赛安排';

/** 基准日：2026-09-05（周六）。MOCK 课表 termStart = 2026-08-31（周一），故这天是第 1 周。 */
const TODAY = '2026-09-05';

/* ============================================================
 * 一、快筛
 * ========================================================== */

test('快筛：既有「安排 / 规划 / 这周怎么过」类句子一条都不丢（超集纪律）', () => {
  // 这些是 LbaoChat.tsx 里 isRecommendIntent 原本就认的形态。
  // 它是个未导出的局部函数（且那个文件依赖 React），所以这里按**行为契约**对拍，
  // 而不是 import 它 —— 断言的是「用户看到的效果没退化」。
  //
  // ⚠️ 这张表是**逐条对着源码正则核过**的（`/(安排|规划|计划一下|怎么过|排一下|帮我排|给我排)/`
  //    以及 `/(这周|本周|今天|明天|后天|周末)/ && /(怎么|干嘛|做啥|干点|过|安排)/`）。
  //    第一版把「明天干什么」也塞了进来 —— 那是**假的老能力**：老正则只认「干嘛/做啥/干点」，
  //    「干什么」压根不命中。把不存在的旧行为写成契约，会让超集测试变成自我安慰。
  //    它被移到下一条，作为**本层新扩**的能力单独断言。
  const legacy = [
    '帮我安排这周',
    '给我排一下',
    '规划一下这周',
    '这周怎么过',
    '后天干点啥',
    '这周干嘛',
  ];
  for (const q of legacy) {
    assert.equal(looksLikeAction(q), true, `老能力丢了：${q}`);
  }
});

test('快筛：新扩的口语形态也得认（这是扩，不是回归）', () => {
  // 「明天干什么」老正则漏掉（只认「干嘛/做啥/干点」），但它明明是在求安排。
  assert.equal(looksLikeAction('明天干什么'), true);
  assert.equal(looksLikeAction('明天干啥'), true);
});

test('快筛：用户的真实句子必须命中（现状是半个关键词都不命中）', () => {
  assert.equal(looksLikeAction(USER_SENTENCE), true);
});

test('快筛：纯事实问句不命中 —— 该走 RAG 问答，不该动日程', () => {
  const facts = [
    '四六级什么时候报名',
    '图书馆在哪里',
    '光电杯报名截止是几号',
    '奖学金怎么申请',
    '转专业的流程是什么',
  ];
  for (const q of facts) {
    assert.equal(looksLikeAction(q), false, `不该动日程却被判成动作：${q}`);
  }
});

test('快筛：求建议不命中 —— 问「怎么做」不等于「帮我做」', () => {
  const advice = ['怎么复习高数', '如何准备期末考试', '怎样刷题效率高', '我要不要报名四六级'];
  for (const q of advice) {
    assert.equal(looksLikeAction(q), false, `建议类被误判成动作：${q}`);
  }
});

/* ============================================================
 * 二、目标名（这里曾踩过一个真坑）
 * ========================================================== */

test('目标名：从「报名参加数学建模」里抽出「数学建模」，不带动词碎片', () => {
  // 反向验证锚点：把 TITLE_STOP 命中后的 `break` 改回 `continue`，
  // 会退化成「加数学建模」（「参加」的碎片「加」被当成修饰语）—— 本断言立刻变红。
  assert.equal(extractTitle(USER_SENTENCE), '数学建模');
});

test('目标名：名义化动词本身可以当目标（「备赛」就是那件事）', () => {
  assert.equal(extractTitle('帮我规划一下备赛安排'), '备赛');
});

test('目标名：左右扩能带上限定语', () => {
  assert.equal(extractTitle('期中复习'), '期中复习');
});

test('目标名：抽不到就留空 —— 宁可追问，不拿半个动词当目标', () => {
  assert.equal(extractTitle('帮我看看明天有啥要交的'), '');
  assert.equal(extractTitle('随便安排点啥吧'), '');
});

/* ============================================================
 * 三、时间：「有锚点」与「确切没定」可以同时成立
 * ========================================================== */

test('时间：有锚点 + 明说没定 —— 两者都要留下（最关键的回归）', () => {
  const w = extractWhen(USER_SENTENCE);
  // 反向验证锚点：把「unspecified 与具体表达共存」改回「互相覆盖」，
  // 下面第一条或第三条必然变红。
  assert.equal(w?.unspecified, true, '「具体时间也没定」被丢了');
  assert.equal(w?.month, 9, '「九月中旬」这个锚点被丢了');
  assert.equal(w?.decade, 'middle');
  assert.equal(w?.kind, 'window');
});

test('时间：完全没提 ≠ 没定 —— 前者要追问，后者要标注', () => {
  assert.equal(extractWhen('帮我安排数学建模备赛'), undefined);
});

test('时间：明确到日 / 明天 / 下周三 各归各位', () => {
  const md = extractWhen('10月8日之前把论文交了');
  assert.deepEqual({ k: md?.kind, m: md?.month, d: md?.day }, { k: 'exact', m: 10, d: 8 });

  const rd = extractWhen('明天去图书馆复习');
  assert.equal(rd?.relativeDays, 1);

  const rw = extractWhen('下周三晚上练口语');
  assert.deepEqual({ w: rw?.relativeWeeks, d: rw?.weekday }, { w: 1, d: 3 });
});

test('日期换算：九月中旬 = 9/11–9/20（基准日 2026-09-05）', () => {
  const r = resolveWhen({ text: '九月中旬', kind: 'window', month: 9, decade: 'middle' }, TODAY);
  assert.equal(r.from, '2026-09-11');
  assert.equal(r.to, '2026-09-20');
  assert.equal(r.certainty, 'window');
});

test('日期换算：下周三 = 2026-09-09（基准周六 09-05，周一为 08-31）', () => {
  const r = resolveWhen(
    { text: '下周三', kind: 'relative', relativeWeeks: 1, weekday: 3 },
    TODAY,
  );
  assert.equal(r.from, '2026-09-09');
  assert.equal(r.certainty, 'exact');
});

test('日期换算：不读时钟 —— 基准日由调用方给，纯函数', () => {
  const a = resolveWhen({ text: '明天', kind: 'relative', relativeDays: 1 }, '2026-09-05');
  const b = resolveWhen({ text: '明天', kind: 'relative', relativeDays: 1 }, '2026-09-05');
  assert.deepEqual(a, b);
  assert.equal(a.from, '2026-09-06');
});

/* ============================================================
 * 四、投入 / 频率 / 地点 / 时段
 * ========================================================== */

test('投入：总量与单次分开 —— 混在一起会把 20 小时排成一个 20 小时的块', () => {
  const total = extractEffort('这个比赛我一共要准备20小时');
  assert.equal(total.totalHours, 20);
  assert.equal(total.durationMin, undefined);

  const per = extractEffort('每周3次，每次90分钟');
  assert.equal(per.durationMin, 90);

  const perHour = extractEffort('每天2小时');
  assert.equal(perHour.durationMin, 120);
  assert.equal(perHour.totalHours, undefined, '「每天2小时」被重复计成了总量');
});

test('频率：每周N次 / 每天；只写「每周」不算给了频率', () => {
  assert.equal(extractFrequency('每周3次'), 3);
  assert.equal(extractFrequency('每天刷题'), 7);
  assert.equal(extractFrequency('每周都练'), undefined);
});

test('地点与时段窗', () => {
  assert.equal(extractPlace('在图书馆备考'), '图书馆');
  assert.equal(extractPlace('去第三教学楼上课'), '第三教学楼');
  assert.deepEqual(extractWindow('晚上复习'), { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' });
});

test('可让步度：有截止 / 强调词 → 标 essential 且优先级更高', () => {
  const hard = extractPriority('这个必须在10月8日之前交');
  assert.equal(hard.essential, true);
  assert.ok(hard.priorityHint >= 95);

  const soft = extractPriority('有空的时候练一下口语');
  assert.equal(soft.essential, undefined);
  assert.ok(soft.priorityHint < 85);
});

test('intent：取消 / 改时间 / 替换 / 只问 各归各位，且「对象」能抽出来', () => {
  assert.equal(detectIntent('取消周四的复习'), 'cancel');
  assert.equal(detectIntent('把高数复习挪到周四'), 'reschedule');
  assert.equal(detectIntent('把周三的社团改成备赛'), 'replace');
  assert.equal(detectIntent('这周我忙不忙'), 'query');
  assert.equal(detectIntent('帮我安排数学建模备赛'), 'create');

  assert.equal(extractTarget('把高数复习挪到周四'), '高数复习');
  assert.equal(extractTarget('取消周四的复习'), '周四的复习');
});

/* ============================================================
 * 五、缺口与追问
 * ========================================================== */

test('缺口：用户那句缺「投入」—— 追问直接由 missing 生成', () => {
  const s = parseIntentSlots(USER_SENTENCE, TODAY);
  assert.equal(s.title, '数学建模');
  assert.ok(s.missing.includes('effort'), `missing = ${JSON.stringify(s.missing)}`);
  assert.ok(!s.missing.includes('title'));
  assert.ok(!s.missing.includes('when'));

  const q = topQuestions(s, 2);
  assert.equal(q.length, 1);
  assert.match(q[0], /投入|总量|节奏/);
});

test('缺口：缺目标时先问目标（顺序即优先级，不是随机顺序）', () => {
  const s = parseIntentSlots('帮我安排一下这周', TODAY);
  assert.ok(s.missing.includes('title'));
  assert.match(topQuestions(s, 2)[0], /哪件事/);
});

test('缺口：create 齐了就没缺口', () => {
  // ⚠️ 必须带上时间才算「齐」—— `create` 的必需槽位是 title + when + effort。
  //    用户只说时长不给时间时，梨宝**应该问一句**（这正是不替用户拍板的落点），
  //    而不是自己默认「从今天起」就排。第一版这条用例漏了时间，等于把「不问」
  //    写成了期望值，会顺手把追问逻辑测没。
  const s = parseIntentSlots('10月中旬帮我安排数学建模备赛，一共18小时，每次2小时', TODAY);
  assert.deepEqual(s.missing, []);
  assert.equal(s.totalHours, 18);
  assert.equal(s.durationMin, 120);
});

test('缺口：只给时长不给时间 —— 仍要问「什么时候」，不许自己定起点', () => {
  const s = parseIntentSlots('帮我安排数学建模备赛，一共18小时，每次2小时', TODAY);
  assert.deepEqual(s.missing, ['when']);
  assert.match(topQuestions(s, 2)[0], /什么时候/);
});

test('缺口：取消只需要「对象」，不需要时长', () => {
  const s = parseIntentSlots('取消周四的复习', TODAY);
  assert.equal(s.intent, 'cancel');
  assert.deepEqual(missingSlots(s), []);
});

/* ============================================================
 * 六、规则优先 / 确定性 / LLM 路径
 * ========================================================== */

test('确定性：同输入同输出（无时钟、无随机）', () => {
  assert.deepEqual(parseIntentSlots(USER_SENTENCE, TODAY), parseIntentSlots(USER_SENTENCE, TODAY));
});

test('规则优先：LLM 只补空，绝不覆盖规则已抽到的字段', () => {
  const rule = parseIntentSlots(USER_SENTENCE, TODAY);
  const merged = mergeSlots(rule, { title: '模型猜的别的什么', totalHours: 20 });

  assert.equal(merged.title, '数学建模', '规则抽到的 title 被 LLM 覆盖了');
  assert.equal(merged.totalHours, 20, '空位没有被补上');
  assert.deepEqual(merged.missing, []);
});

test('LLM 只在「确有缺口」时被调用 —— 规则抽全了就不花钱', async () => {
  let calls = 0;
  const llm = async () => { calls += 1; return null; };

  // 非动作句：不调
  await parseGoalIntent('四六级什么时候报名', { today: TODAY, llm });
  assert.equal(calls, 0);

  // 抽全了：不调（带时间 → create 三槽齐）
  await parseGoalIntent('10月中旬帮我安排数学建模备赛，一共18小时，每次2小时', { today: TODAY, llm });
  assert.equal(calls, 0);

  // 有缺口：调一次
  await parseGoalIntent(USER_SENTENCE, { today: TODAY, llm });
  assert.equal(calls, 1);
});

test('LLM 抛错不降级成失败：已抽到的槽位仍然有效', async () => {
  const out = await parseGoalIntent(USER_SENTENCE, {
    today: TODAY,
    llm: async () => { throw new Error('boom'); },
  });
  assert.equal(out.action, true);
  assert.equal(out.source, 'rule');
  assert.equal(out.slots.title, '数学建模');
});

test('非动作句：action=false，交回 RAG 老路径（这不是失败）', async () => {
  const out = await parseGoalIntent('四六级什么时候报名', { today: TODAY });
  assert.equal(out.action, false);
  assert.equal(out.source, 'rule');
});

test('LLM 补上缺口后，missing 清空且来源可归因', async () => {
  const out = await parseGoalIntent(USER_SENTENCE, {
    today: TODAY,
    llm: async () => ({ totalHours: 18, durationMin: 120 }),
  });
  assert.equal(out.source, 'rule+llm');
  assert.deepEqual(out.slots.missing, []);
});

test('回显：把听懂的与没听懂的都说清楚（用户要能一眼核对）', () => {
  const lines = describeSlots(parseIntentSlots(USER_SENTENCE, TODAY)).join('\n');
  assert.match(lines, /数学建模/);
  assert.match(lines, /九月中旬/);
  assert.match(lines, /待定/);
});

/* ============================================================
 * 七、追问接续（applyClarifyAnswer）
 * 🔴 2026-09-20 真实翻车回归：用户说「帮我安排10月2号的数学建模比赛备赛计划」
 *    → 梨宝正确追问「打算投入多少」→ 用户回「每周 3 次、每次 2 小时」
 *    → 这句不是动作句 → 掉进 RAG 问答被记忆带偏，日程一个块都没排。
 * ========================================================== */

/** 翻车现场第一句（逐字） */
const CLARIFY_SEED = parseIntentSlots('帮我安排10月2号的数学建模比赛备赛计划', TODAY);

test('追问接续：节奏式回答「每周 3 次、每次 2 小时」补齐 effort，missing 清空', () => {
  assert.ok(CLARIFY_SEED.missing.includes('effort'), '种子句应缺 effort');

  const { slots, contributed } = applyClarifyAnswer('每周 3 次、每次 2 小时', CLARIFY_SEED, TODAY);
  assert.equal(contributed, true, '回答没被接住 —— 这就是翻车的根因');
  assert.equal(slots.perWeekCount, 3);
  assert.equal(slots.durationMin, 120);
  assert.deepEqual(slots.missing, [], '补完还留缺口 = 白追问一轮');
  assert.equal(slots.title, CLARIFY_SEED.title, '已听懂的 title 不许被改写');
  assert.equal(slots.when?.text, CLARIFY_SEED.when?.text, '已听懂的 when 不许被改写');
});

test('追问接续：总量式回答「一共20小时」同样补齐', () => {
  const { slots, contributed } = applyClarifyAnswer('一共20小时', CLARIFY_SEED, TODAY);
  assert.equal(contributed, true);
  assert.equal(slots.totalHours, 20);
  assert.deepEqual(slots.missing, []);
});

test('追问接续：补一半也算数 —— 只给单次时长，剩下缺口继续追问', () => {
  const { slots, contributed } = applyClarifyAnswer('每次 1 小时', CLARIFY_SEED, TODAY);
  assert.equal(contributed, true, '半份信息被扔掉 = 用户重说一遍全量，体验崩坏');
  assert.equal(slots.durationMin, 60);
  assert.ok(slots.missing.includes('effort'), '节奏不完整时 effort 仍算缺');
});

test('追问接续：答非所问不硬吃（contributed=false，交回普通分流）', () => {
  for (const noise of ['图书馆几点开门', '帮我看看这周忙不忙']) {
    const { contributed } = applyClarifyAnswer(noise, CLARIFY_SEED, TODAY);
    assert.equal(contributed, false, `「${noise}」不该被当成追问的答案`);
  }
});

test('追问接续：回应里给时间也能补 when 槽（「十月开始吧」）', () => {
  const seed = parseIntentSlots('我要报名数学建模，帮我规划备赛', TODAY);
  assert.ok(seed.missing.includes('when'));

  const { slots, contributed } = applyClarifyAnswer('十月中旬开始吧', seed, TODAY);
  assert.equal(contributed, true);
  assert.ok(slots.when, 'when 没被补上');
  assert.ok(!slots.missing.includes('when'));
});

test('追问接续：确定性 —— 同输入同输出', () => {
  const a = applyClarifyAnswer('每周 3 次、每次 2 小时', CLARIFY_SEED, TODAY);
  const b = applyClarifyAnswer('每周 3 次、每次 2 小时', CLARIFY_SEED, TODAY);
  assert.deepEqual(a, b);
});
