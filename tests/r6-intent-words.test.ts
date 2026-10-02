/**
 * R 批 P0-4 · R6 意图识别补词 + 未识别显式化 —— 纯函数层测试
 * ============================================================
 * 任务书依据：outputs/R批任务书-交zcode-2026-10-02.md §三 P0-4（R6.1–R6.4）。
 *
 * CY 走查实录：「@image#13 这个语义上没识别到不应该啊」——
 * 「周六晚上要出去吃自助餐」被判为「梨宝没看懂」。
 *
 * 根因（修复前）：
 *  · `GOAL_NOUNS`（libaoIntent.ts:209）有 大餐/聚餐/庆功/生日，**无「自助餐」**；
 *  · 该句也无 ACTION_VERBS 动词、无第一人称「我」 → `looksLikeAction` 判否
 *    → `parseGoalIntent` 返回 action:false → **静默转 RAG**（LbaoChat.tsx:1927）。
 *  真正的「没看懂」文案只在 feedback 层 CorrectionCapture:220 ——
 *  放错了层（那是「改一句计划」的入口，不是对话入口）。
 *
 * ⚠️ 反向验证（RV，红线 4，MOSS 独立复跑）：
 *   RV-R6a ← 从 looksLikeAction 摘掉 looksLikeLifeEvent 闸
 *             → 「吃个日料」用例红（1 条精确）
 *   RV-R6b ← 把 hasConcreteScheduleSignal 门槛恒返回 true
 *             → 「克制性」+「时间还没定」用例红（2 条）
 *   RV-R6c ← 同时摘 GOAL_NOUNS 的「自助餐」+ looksLikeAction 的动宾闸
 *             → 4 条变红（含 R6.1 三条 + R6.2 一条）
 *             证明 R6.1 补词与 R6.2 动宾**各自不可替代**（单摘任一时，
 *             另一条仍能兜住一部分 → 必须双摘才全红）
 *
 * ⚠️ 实施中由既有门禁抓到的一处真实回归（已修，已锁进本文件）：
 *   首版动宾闸只有状态否定闸，「聚餐去哪吃」因「去」命中动词被判成动作句，
 *   被 `scripts/libao-intent-fn-fix.test.ts:83` 抓红。已加疑问闸
 *   LIFE_ASK_NEGATIVE_RE，并补本文件「疑问闸拦住「去哪吃」」用例锁住。
 *   **这是本条最有价值的部分**：过度打扰比漏判更伤，动词放宽必须配疑问守卫。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_NOUNS,
  hasConcreteScheduleSignal,
  looksLikeAction,
  looksLikeLifeEvent,
  parseIntentSlots,
  type IntentSlots,
} from '@/features/libao/libaoIntent';
import { LIFE_EVENT_WORDS } from '@/lib/lifeWords';

const TODAY = '2026-10-02';

/* ---------------- R6.1 · 名词表补词 ---------------- */

test('R6.1: GOAL_NOUNS 含自助餐等高频生活事件', () => {
  for (const n of ['自助餐', '火锅', '烧烤', '聚会', '看电影', '逛街', '演出', '观赛']) {
    assert.ok(GOAL_NOUNS.includes(n), `GOAL_NOUNS 缺「${n}」`);
  }
});

test('R6.1: 「周六晚上要出去吃自助餐」被认成排程动作句', () => {
  assert.equal(looksLikeAction('周六晚上要出去吃自助餐'), true,
    'CY 走查原句必须进排程链路，不能静默转 RAG');
});

test('R6.1: 补词后能抽出 title（不是只判 true 而抽不出事情名）', () => {
  const s: IntentSlots = parseIntentSlots('周六晚上要出去吃自助餐', TODAY);
  assert.ok(s.title && s.title.includes('自助餐'),
    `title 应含「自助餐」，实际：「${s.title}」`);
});

/* ---------------- R6.2 · 动宾模式（不靠名词穷举） ---------------- */

test('R6.2: 动宾模式覆盖「吃个日料」这类词表外表达', () => {
  // 「日料」已由 R6.4 的 lifeWords 收进词表，所以这里用**确实不在任何词表**的
  // 表达来证明是动宾模式兜住的（动宾的价值就在不靠穷举）。
  assert.equal(looksLikeLifeEvent('明天想吃个汉堡'), true);
  assert.ok(!GOAL_NOUNS.includes('汉堡'), '前提：汉堡不在名词表里（证明是动宾兜住的）');
  assert.ok(!LIFE_EVENT_WORDS.includes('汉堡'), '前提：汉堡也不在中立层词表里');
  assert.equal(looksLikeAction('明天想吃个汉堡'), true);
});

test('R6.2: 「去剪头发」「去逛街」也走动宾', () => {
  assert.equal(looksLikeLifeEvent('周六去逛街'), true);
  assert.equal(looksLikeLifeEvent('明天去看展'), true);
});

test('R6.2: 否定闸拦住状态/评价句（不能把「吃饱了撑的」判成排程）', () => {
  for (const s of ['今天吃饱了撑的', '这个看起来不错', '我觉得这书好看']) {
    assert.equal(looksLikeLifeEvent(s), false, `「${s}」不该判成生活事件`);
  }
});

test('R6.2: 疑问闸拦住「去哪吃」这类疑问（MOSS 实施时 ui 门禁抓到的真实回归）', () => {
  // 首版只加了状态否定闸，「聚餐去哪吃」因「去」命中动词被判成动作句，
  // 被 scripts/libao-intent-fn-fix.test.ts:83 抓红 —— 问句不是排程诉求。
  for (const s of ['聚餐去哪吃', '明天去哪玩', '自助餐哪家好']) {
    assert.equal(looksLikeLifeEvent(s), false, `「${s}」是疑问，不该判成生活事件`);
    assert.equal(looksLikeAction(s), false, `「${s}」不该被判成排程动作`);
  }
});

/* ---------------- R6.3 · 未识别显式化门槛：**克制**是第一原则 ---------------- */

test('R6.3: 有日程信号的漏判句会被显式化（门槛为真）', () => {
  for (const s of [
    '周六晚上要出去吃自助餐',
    '下周三下午有安排',
    '周五19:30 有事',
    '每周三晚上',
  ]) {
    assert.equal(hasConcreteScheduleSignal(s), true, `「${s}」应触发显式化`);
  }
});

test('R6.3 · 克制性：纯问句/闲聊**不得**被反问「要不要排进日程」', () => {
  // 这是本条最大的风险 —— 过度打扰比漏判更伤
  for (const s of [
    '光溯是什么',
    '推荐个食堂',
    '这周天气怎么样',
    '你好',
    '什么是分散复习',
  ]) {
    assert.equal(hasConcreteScheduleSignal(s), false, `「${s}」不该被反问排程`);
  }
});

test('R6.3: 「时间还没定」不算日程信号（那正是待定诉求本身）', () => {
  assert.equal(hasConcreteScheduleSignal('那个时间还没定，先记着'), false);
  assert.equal(hasConcreteScheduleSignal('具体日期未定'), false);
});

test('R6.3: 门槛判据是纯函数（两次调用结果一致）', () => {
  const s = '周六晚上要出去吃自助餐';
  assert.equal(hasConcreteScheduleSignal(s), hasConcreteScheduleSignal(s));
});

/* ---------------- R6.4 · 词表单一来源 ---------------- */

test('R6.4: GOAL_NOUNS 已导出且供 feedback 层可复用（单一来源，防两处漂移）', () => {
  assert.ok(Array.isArray(GOAL_NOUNS), 'GOAL_NOUNS 必须是导出的共享常量');
  assert.ok(GOAL_NOUNS.length > 30, `词表长度异常：${GOAL_NOUNS.length}`);
  // 去重：重复项说明两处合并时撞车了
  assert.equal(new Set(GOAL_NOUNS).size, GOAL_NOUNS.length, 'GOAL_NOUNS 有重复项');
});

test('R6.4: 生活事件词住在**中立层** lib/lifeWords，GOAL_NOUNS 由此派生', () => {
  // 架构约束：AC-6·R5 禁止 features 之间横向 import（arch-guards.test.ts:247），
  // 所以词表必须在 src/lib/，两侧各引 —— 这才是真正意义的「单一来源」。
  for (const w of ['自助餐', '火锅', '吃饭', '聚会', '看电影']) {
    assert.ok(LIFE_EVENT_WORDS.includes(w), `lifeWords 缺「${w}」`);
    assert.ok(GOAL_NOUNS.includes(w), `GOAL_NOUNS 应派生自 lifeWords，缺「${w}」`);
  }
  // 中立层自身也不许有重复项
  assert.equal(new Set(LIFE_EVENT_WORDS).size, LIFE_EVENT_WORDS.length,
    'lifeWords 有重复项');
});

/* ---------------- 回归：既有行为不得被破坏 ---------------- */

test('回归: 问句仍判非动作（不被 R6.2 动宾误吞）', () => {
  for (const s of ['今天有什么讲座', '有没有空', '我什么时候要交作业']) {
    assert.equal(looksLikeAction(s), false, `「${s}」不该被判成排程动作`);
  }
});

test('回归: 既有目标句仍照常识别', () => {
  assert.equal(looksLikeAction('我要准备数学建模'), true);
  assert.equal(looksLikeAction('周五下午要在学生会面试'), true);
});
