/**
 * 任务二 P2-2 / P3-2 · 抽取器与存储层单测
 * ============================================================
 * 覆盖（任务书验收项）：
 *   · 「多类待办混合抽题」与「7 天去重」（P2-2 验收）；
 *   · ≤5 道 / 无待办类兜底 / 确定性；
 *   · 「当天已答过则不再弹」（P3-2 验收，依赖注入的日期戳而非真时钟）；
 *   · behaviorLog 的勾选记录 → 时间纪律原料转换。
 * 题库内容（P2-1）BLOCKED 于任务一 —— 本文件用 fixture 题目验证机制，不预演题库。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEDUP_DAYS, QUIZ_MAX, categoriesFromTodoKinds, fallbackCategory, pickQuestions,
  type QuizCategory, type QuizQuestion,
} from '@/features/mobile/eval/questionBank.ts';
import {
  finalDoneKeys, localDateKey, recordBlockToggle, toCheckRecords,
  type BehaviorEvent,
} from '@/features/mobile/eval/behaviorLog.ts';
import {
  hasOfferedToday, loadShown, recordAnswer, recordShown, slugLastShown, toSelfReportAnswers,
} from '@/features/mobile/eval/answerStore.ts';
import type { KV } from '@/features/mobile/eval/behaviorLog.ts';

/** 内存 KV（测试注入；生产传 localStorage） */
function memKV(): KV & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    dump: () => Object.fromEntries(m),
  };
}

let seq = 0;
function q(category: QuizCategory, slug: string): QuizQuestion {
  seq += 1;
  return {
    id: `q${seq}`,
    category,
    text: `今天做${category}类任务时，你实际推迟了吗？（fixture ${seq}）`,
    options: [
      { label: '没推迟', score: 4 },
      { label: '推了 10 分钟内', score: 3 },
      { label: '推了 1 小时内', score: 2 },
      { label: '推到明天', score: 1 },
      { label: '直接放弃', score: 0 },
    ],
    sourceSlug: slug,
  };
}

/* ---------- 待办类型 → 类别映射 ---------- */

test('categoriesFromTodoKinds：关键词映射 + 去重 + 未知不映射', () => {
  assert.deepEqual(categoriesFromTodoKinds(['作业', '复习', '运动']), ['homework', 'review', 'exercise']);
  assert.deepEqual(categoriesFromTodoKinds(['高数作业', '英语作业']), ['homework']);
  assert.deepEqual(categoriesFromTodoKinds(['随便什么']), []);
  assert.deepEqual(categoriesFromTodoKinds([]), []);
});

test('无待办 → fallbackCategory = [none]', () => {
  assert.deepEqual(fallbackCategory(), ['none']);
});

/* ---------- 抽取器 ---------- */

const BANK: QuizQuestion[] = [
  q('homework', 'slug-hw-1'), q('homework', 'slug-hw-2'), q('homework', 'slug-hw-3'),
  q('review', 'slug-rv-1'), q('review', 'slug-rv-2'),
  q('exercise', 'slug-ex-1'),
  q('routine', 'slug-rt-1'),
  q('social', 'slug-so-1'),
  q('none', 'slug-no-1'), q('none', 'slug-no-2'), q('none', 'slug-no-3'),
];

test('抽取：多类待办混合 → 各类轮转填满 ≤5 道', () => {
  const picked = pickQuestions({
    bank: BANK, categories: ['homework', 'review', 'exercise'], todayKey: '2026-10-06',
    slugLastShown: new Map(),
  });
  assert.equal(picked.length, QUIZ_MAX);
  assert.deepEqual(picked.map((x) => x.category), ['homework', 'review', 'exercise', 'homework', 'review']);
});

test('抽取：待办类别多但题不够 → 拿满可用的就停（不多凑）', () => {
  const bank = [q('homework', 's1'), q('review', 's2')];
  const picked = pickQuestions({ bank, categories: ['homework', 'review', 'exercise'], todayKey: '2026-10-06', slugLastShown: new Map() });
  assert.equal(picked.length, 2);
});

test('抽取：无待办 → 只从「无待办」类出题', () => {
  const picked = pickQuestions({ bank: BANK, categories: [], todayKey: '2026-10-06', slugLastShown: new Map() });
  assert.ok(picked.length > 0 && picked.length <= QUIZ_MAX);
  assert.ok(picked.every((x) => x.category === 'none'));
});

test('抽取：7 天内出过的 slug 不再出；满 7 天后可复出', () => {
  const history = new Map([
    ['slug-hw-1', '2026-10-05'], // 1 天前 → 跳过
    ['slug-rv-1', '2026-09-29'], // 恰好 7 天前 → 可复出
  ]);
  const picked = pickQuestions({
    bank: BANK, categories: ['homework', 'review', 'exercise'], todayKey: '2026-10-06',
    slugLastShown: history,
  });
  assert.ok(!picked.some((x) => x.sourceSlug === 'slug-hw-1'), '昨天刚出的 slug 必须跳过');
  assert.ok(picked.some((x) => x.sourceSlug === 'slug-rv-1'), '满 DEDUP_DAYS 天后允许复出');
  assert.equal(DEDUP_DAYS, 7);
});

test('抽取：确定性 —— 同输入同输出', () => {
  const args = { bank: BANK, categories: ['homework', 'review'] as const, todayKey: '2026-10-06', slugLastShown: new Map<string, string>() };
  const a = pickQuestions(args);
  const b = pickQuestions(args);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
});

test('抽取：空题库 → 返回空数组（弹窗静默，不崩）', () => {
  const picked = pickQuestions({ bank: [], categories: ['homework'], todayKey: '2026-10-06', slugLastShown: new Map() });
  assert.deepEqual(picked, []);
});

/* ---------- 每日弹窗门（P3-2） ---------- */

test('答题存储：当天弹过（答/跳过都算）→ hasOfferedToday=true，次日恢复 false', () => {
  const kv = memKV();
  const bank = [q('none', 'slug-a'), q('none', 'slug-b')];
  assert.equal(hasOfferedToday(kv, '2026-10-06'), false);
  recordShown(kv, { todayKey: '2026-10-06', questions: bank });
  assert.equal(hasOfferedToday(kv, '2026-10-06'), true);
  assert.equal(hasOfferedToday(kv, '2026-10-07'), false, '次日是新的一天，允许再弹');
});

test('答题存储：作答覆盖占位；跳过的题不进维度 5 原料', () => {
  const kv = memKV();
  const bank = [q('none', 'slug-a'), q('none', 'slug-b')];
  recordShown(kv, { todayKey: '2026-10-06', questions: bank });
  recordAnswer(kv, { todayKey: '2026-10-06', question: bank[0], optionIdx: 1 });
  const rows = loadShown(kv);
  assert.equal(rows.length, 2);
  const answered = rows.find((r) => r.questionId === bank[0].id)!;
  assert.equal(answered.answered, true);
  assert.equal(answered.score, 3);
  const answers = toSelfReportAnswers(rows);
  assert.equal(answers.length, 1, '跳过的 slug-b 不进维度 5');
  assert.equal(answers[0].slug, 'slug-a');
  assert.equal(answers[0].dayKey, '2026-10-06');
});

test('答题存储：slugLastShown 取每个 slug 最近一次出现日', () => {
  const kv = memKV();
  recordShown(kv, { todayKey: '2026-10-01', questions: [q('none', 's1')] });
  recordShown(kv, { todayKey: '2026-10-05', questions: [q('none', 's1')] });
  assert.equal(slugLastShown(loadShown(kv)).get('s1'), '2026-10-05');
});

/* ---------- behaviorLog ---------- */

test('localDateKey：补零格式（与 parseDate 口径一致）', () => {
  assert.equal(localDateKey(new Date(2026, 8, 5, 23, 59)), '2026-09-05');
  assert.equal(localDateKey(new Date(2026, 11, 31)), '2026-12-31');
});

test('recordBlockToggle：勾完成/取消都落记录；先勾后取消 = undone 不进时间纪律样本', () => {
  const kv = memKV();
  recordBlockToggle(kv, {
    blockId: 'b1', kind: 'study', plannedStartMin: 600,
    when: new Date(2026, 9, 6, 9, 50), done: true,
  });
  recordBlockToggle(kv, {
    blockId: 'b2', kind: 'study', plannedStartMin: 600,
    when: new Date(2026, 9, 6, 11, 0), done: true,
  });
  recordBlockToggle(kv, {
    blockId: 'b2', kind: 'study', plannedStartMin: 600,
    when: new Date(2026, 9, 6, 11, 30), done: false,
  });
  recordBlockToggle(kv, {
    blockId: 'b3', kind: 'sport', plannedStartMin: 1410,
    when: new Date(2026, 9, 6, 23, 59), done: true, // 跨零点前一分钟
  });
  const events: BehaviorEvent[] = JSON.parse(kv.dump()['usst.mobile.evalBehavior']!);
  const checks = toCheckRecords(events);
  assert.equal(checks.length, 2, 'b2 已取消、只剩 b1 与跨零点的 b3');
  const b3 = checks.find((c) => c.blockId === 'b3')!;
  assert.equal(b3.checkedDayKey, '2026-10-06');
  assert.equal(b3.checkedMin, 23 * 60 + 59);
  const done = finalDoneKeys(events);
  assert.ok(done.has('2026-10-06#b1'));
  assert.ok(done.has('2026-10-06#b3'));
  assert.ok(!done.has('2026-10-06#b2'), '取消后不算完成');
});
