/**
 * S2a（2026-10-07）· 自然计划陈述族：规则层识别升级的单测
 * ============================================================
 * CY 反馈①②：排程模式下说「我明天打算去吃大餐」→ 掉进校园问答长闲聊，
 * 不出草稿。规则层此前只认「安排/规划/排一下」（LEGACY_RECOMMEND 命令式口径），
 * 不认「打算/想去/要去/想吃」这类自然陈述。
 *
 * 本文件锁三件事：
 *   ① 自然陈述句命中 create 意图（title 抽得到、动词残渣不带进标题）；
 *   ② 疑问句守卫仍生效（「打算去哪里玩」留给 RAG，不硬拽进排程）；
 *   ③ 旧口径一条不丢（「帮我安排这周」等 LEGACY 命中不变 —— 纪律④超集）。
 *
 * ⚠️ 反向验证（reversed-verified）：
 *   · 删 looksLikeAction 的 NATURAL_PLAN_RE 入口 → 「周末想去看电影」漏判 → 本文件红；
 *   · 删 extractTitle 的 PLAN_VERB_MASK_RE 掩码 → 「吃」带不上（title 回退「大餐」）→ 本文件红。
 *   实测红记录见 commit message。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, extractTitle, looksLikeAction, parseIntentSlots } from '@/features/libao/libaoIntent.ts';

test('S2a · 「我明天打算去吃大餐」→ create + 标题含「吃大餐」', () => {
  const s = parseIntentSlots('我明天打算去吃大餐');
  assert.equal(s.intent, 'create');
  assert.ok(s.title.includes('吃大餐'), `title 应含「吃大餐」，实际「${s.title}」`);
  assert.ok(!s.title.includes('打算'), '动词残渣「打算」不得进标题');
  // 时间已听到，缺口只剩投入 → collect 相只追问时长
  assert.ok(!s.missing.includes('when'));
  assert.ok(s.missing.includes('effort'));
});

test('S2a · 「我打算去吃大餐」→ 标题恰为「吃大餐」（动词+去 被掩码，不带「去」）', () => {
  assert.equal(extractTitle('我打算去吃大餐'), '吃大餐');
});

test('S2a · 同族自然陈述命中：周末想去看电影 / 打算去健身房', () => {
  const a = parseIntentSlots('周末想去看电影');
  assert.equal(a.intent, 'create');
  assert.ok(looksLikeAction('周末想去看电影'), '「周末想去看电影」应在快筛命中');
  assert.equal(a.title, '电影');

  const b = parseIntentSlots('打算去健身房');
  assert.equal(b.intent, 'create');
  assert.ok(looksLikeAction('打算去健身房'), '「打算去健身房」应在快筛命中');
  assert.equal(b.title, '健身房');
  // 没带时间词 → 走槽位追问补齐（when 进 missing），不编时间
  assert.ok(b.missing.includes('when'));
});

test('S2a · 疑问句守卫：问句形态的自然计划词仍留给 RAG', () => {
  assert.equal(looksLikeAction('打算去哪里玩'), false);
  assert.equal(looksLikeAction('图书馆几点开门'), false);
});

test('S2a · 名词性「打算」仍停：不带进标题、不破坏左扩', () => {
  // 「高数打算复习」的「打算」后面不是去/要 → 仍是停用词，标题只到「复习」
  assert.equal(extractTitle('高数打算复习'), '复习');
});

test('S2a · 旧口径一条不丢（纪律④超集）', () => {
  for (const q of ['帮我安排这周', '帮我排一下明天', '规划一下备赛', '这周怎么过']) {
    assert.ok(looksLikeAction(q), `旧口径「${q}」必须仍命中`);
    assert.equal(parseIntentSlots(q).intent, 'create');
  }
  // 旧口径的标题抽取不受掩码影响（无 打算/准备/计划+去/要 形态的句子逐位不变）
  assert.equal(detectIntent('把高数复习挪到周四'), 'reschedule');
});
