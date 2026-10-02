/**
 * 批 1.1 · 规则层 7 条固有 FN 修复的回归测试（金标 i02/i15/i21/i23/i25/i29/i30）
 * ============================================================
 * 这 7 句是理解金标（evals/golden/plan_understand.jsonl）里规则先行口径的
 * 长期 FN（action F1 恒 0.868）：生产聊天的 LLM 主理解能救，但端点超时/离线时
 * 规则兜底层接不住 —— 本批把缺口补在词表/模式上，让兜底层真正兜得住。
 *
 * ⚠️ 反向验证：把 looksLikeAction 的新增分支（意愿句放宽 / query 放行 /
 *    频率陈述兜底 / 时间陈述兜底）、TITLE_STOP 的新增停用词、GOAL_NOUNS 的
 *    新增名词逐项还原，下面的用例会逐组变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectIntent,
  extractTitle,
  looksLikeAction,
  parseIntentSlots,
} from '@/features/libao/libaoIntent';

const TODAY = '2026-09-27';

/* ── 金标 7 条：快筛 + 槽位逐项对齐金标期望 ── */

test('i02「我周五下午要在学生会面试」—— 意愿句被时间词隔开也要接住', () => {
  const q = '我周五下午要在学生会面试';
  assert.equal(looksLikeAction(q), true, '「我…（隔时间词）…要」必须命中');
  const s = parseIntentSlots(q, TODAY);
  assert.equal(s.intent, 'create');
  assert.equal(s.title, '学生会面试', '「学生会」入词表后 title 应完整扩出');
});

test('i15「明天下午两点到四点在图书馆自习」—— 在+地点+活动名词的陈述句', () => {
  const q = '明天下午两点到四点在图书馆自习';
  assert.equal(looksLikeAction(q), true);
  const s = parseIntentSlots(q, TODAY);
  assert.equal(s.title, '自习');
  assert.equal(s.place, '图书馆');
  assert.equal(s.when?.text, '明天');
});

test('i21「我这周忙不忙」—— query 是动作语境，快筛必须放行', () => {
  assert.equal(looksLikeAction('我这周忙不忙'), true);
  assert.equal(detectIntent('我这周忙不忙'), 'query');
});

test('i23「周五晚上班级聚餐」—— 时间词 + 目标名词的纯陈述句', () => {
  const q = '周五晚上班级聚餐';
  assert.equal(looksLikeAction(q), true);
  const s = parseIntentSlots(q, TODAY);
  assert.equal(s.title, '聚餐', '时段词「晚上」不得被扩进标题');
  assert.equal(s.when?.text, '周五');
});

test('i25「期末周之前把实验报告写完」—— 完成语族进动词表', () => {
  const q = '期末周之前把实验报告写完';
  assert.equal(looksLikeAction(q), true);
  const s = parseIntentSlots(q, TODAY);
  assert.equal(s.title, '实验报告', '「写完」不得被扩进标题');
  assert.equal(s.intent, 'create');
});

test('i29「下周一起我每天要晨跑」—— 习惯目标名词 + 频率', () => {
  const q = '下周一起我每天要晨跑';
  assert.equal(looksLikeAction(q), true);
  const s = parseIntentSlots(q, TODAY);
  assert.equal(s.title, '晨跑');
  assert.equal(s.perWeekCount, 7, '「每天」= 每周 7 次');
  assert.equal(s.when?.text, '下周一');
});

test('i30「隔天去一次健身房，每次一小时」—— 隔天频率 + 单次时长', () => {
  const q = '隔天去一次健身房，每次一小时';
  assert.equal(looksLikeAction(q), true);
  const s = parseIntentSlots(q, TODAY);
  assert.equal(s.title, '健身房', '「次」不得被扩进标题');
  assert.equal(s.perWeekCount, 4, '「隔天」≈ 每周 4 次（金标口径）');
  assert.equal(s.durationMin, 60, '「每次一小时」= 单次 60 分钟');
});

/* ── 防误伤负例：词表/模式放宽后，问句与闲聊必须仍然不走排程 ── */

test('负例：问句与闲聊不因词表放宽被误判成动作', () => {
  const negatives: Array<[string, string]> = [
    ['学生会面试一般什么时候？', 'PURE_FACT：什么时候'],
    ['聚餐去哪吃', '疑问词「哪」'],
    ['忙不忙是怎么算的', '求建议「怎么」在先'],
    ['今天校园里有什么讲座', '金标 b03：什么 + 讲座（名词在场也不许命中）'],
    ['学校有什么社团', '金标 b06'],
    ['健身房在哪', '金标形态：在哪问路'],
    ['晨跑有什么好处', '什么 + 新增名词晨跑'],
  ];
  for (const [q, why] of negatives) {
    assert.equal(looksLikeAction(q), false, `误判成动作（${why}）：${q}`);
  }
});

/* ── 标题抽取单元：新增停用词的直接断言 ── */

test('标题抽取：时段词与完成词族是停用词（金标 title 对齐的前提）', () => {
  assert.equal(extractTitle('周五晚上班级聚餐'), '聚餐');
  assert.equal(extractTitle('期末周之前把实验报告写完'), '实验报告');
  assert.equal(extractTitle('隔天去一次健身房，每次一小时'), '健身房');
});
