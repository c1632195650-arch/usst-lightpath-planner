/**
 * V2 —— 梨宝闭环补口：多目标挑块接续 / hold 意图 / 我的模式文案
 * ============================================================
 * ⚠️ 反向验证（docs/wp-ledger-v2.md §V2）：
 *   RV1 ← matchCandidate 删掉模糊匹配（只留全等）→ 用例红
 *   RV2 ← INTENT_PATTERNS 删 hold 条目 → 口令用例红
 *   RV3 ← holdSlotFrom 缺天时猜整天 → need-time 用例红
 *   （源码断言：LbaoChat picking 接续 + WeekPlanView usst:replan 监听）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchCandidate, holdSlotFrom, holdToUnavailableSlot, type CancelTarget } from '@/features/libao/weekPlanForChat';
import { detectIntent, parseIntentSlots } from '@/features/libao/libaoIntent';
import { MODE_OPTIONS } from '@/features/libao/modeSetup';

const CANDIDATES: CancelTarget[] = [
  { taskId: 't1', title: '高数复习', origin: 'user', hint: '周三 60 分钟' },
  { blockId: 'b1', title: '高数复习（二）', origin: 'plan', hint: '周五 08:00–09:00' },
  { blockId: 'b2', title: '英语早读', origin: 'plan', hint: '周二 07:30–08:00' },
];

test('V2-1: matchCandidate 精确/模糊/未命中三例', () => {
  // 反向：模糊匹配删掉（只留全等）→ 模糊例红
  assert.deepEqual(matchCandidate('高数复习', CANDIDATES).map((c) => c.title),
    ['高数复习', '高数复习（二）'], '模糊包含也要命中');
  assert.equal(matchCandidate('复习（二）', CANDIDATES).length, 1, '部分词命中唯一候选');
  assert.equal(matchCandidate('不存在的事', CANDIDATES).length, 0);
  assert.equal(matchCandidate('', CANDIDATES).length, 0);
});

test('V2-2: hold 口令三条命中；cancel 既有口令不受扰', () => {
  // 反向：INTENT_PATTERNS 删 hold 条目 → 本用例红
  assert.equal(detectIntent('周三下午别排东西'), 'hold');
  assert.equal(detectIntent('周五晚上这段时间别排'), 'hold');
  assert.equal(detectIntent('周六留出来'), 'hold');
  assert.equal(detectIntent('取消备赛安排'), 'cancel', 'cancel 既有口令不动');
  assert.equal(detectIntent('把高数复习挪到周四'), 'reschedule');
});

test('V2-2: hold 槽位 → 时段草稿（星期+窗；窗缺省整天；缺天追问）', () => {
  // 反向：缺天时猜整天 → need-time 用例红
  const s1 = parseIntentSlots('周三下午别排东西', '2026-09-27');
  const d1 = holdSlotFrom(s1);
  assert.ok(!('need' in d1), '给了星期不该追问');
  if (!('need' in d1)) {
    assert.equal(d1.day, 3);
    assert.equal(d1.fromMin, 13 * 60, '下午窗 13:00 起');
  }
  const s2 = parseIntentSlots('这段时间别排', '2026-09-27');
  assert.ok('need' in holdSlotFrom(s2), '没说哪天必须追问');
});

test('V2-2: holdToUnavailableSlot 产出一次性不可时段（引擎/拖拽闸同源消费）', () => {
  const slot = holdToUnavailableSlot({ day: 5, fromMin: 780, toMin: 1080 }, 5, '周五晚上');
  assert.equal(slot.scope, 'once');
  assert.deepEqual(slot.days, [5]);
  assert.deepEqual(slot.weeks, [5]);
  assert.equal(slot.fromMin, 780);
  assert.equal(slot.toMin, 1080);
  assert.equal(slot.createdAtWeek, 5);
});

test('V2-3: 「我的」模式卡说明讲清画像定制（核对项，纯数据）', () => {
  const mine = MODE_OPTIONS.find((m) => m.id === 'mine');
  assert.ok(mine, 'mine 卡必须存在');
  assert.match(mine!.tagline + '', /画像|定制|我/);
});

/* ---- 源码接线断言 ---- */

test('V2 源码: 挑块接续与重排广播在位', () => {
  const chat = readFileSync(fileURLToPath(new URL('../src/features/libao/LbaoChat.tsx', import.meta.url)), 'utf8');
  assert.match(chat, /if \(clarifyPicking\) \{/);
  assert.match(chat, /matchCandidate\(q, clarifyPicking\.candidates\)/);
  assert.match(chat, /dispatchEvent\(new CustomEvent\('usst:replan'\)\)/);
  const wv = readFileSync(fileURLToPath(new URL('../src/features/week/WeekPlanView.tsx', import.meta.url)), 'utf8');
  assert.match(wv, /addEventListener\('usst:replan'/);
});

test('V2-2 源码: send 门放行 hold（hold 无 title，门只认 title 会漏进泛泛分支）', () => {
  // 反向：删掉 || outcome.slots.intent === 'hold' → 本用例红
  const src = readFileSync(fileURLToPath(new URL('../src/features/libao/LbaoChat.tsx', import.meta.url)), 'utf8');
  assert.match(src, /outcome\.slots\.title \|\| outcome\.slots\.intent === 'hold'/);
});

test('V2-2 源码: looksLikeAction 放行 hold 语族（入口闸与 send 门双闸都要过）', () => {
  // 反向：删掉 libaoIntent 的 hold 语族行 → 本用例红
  const src = readFileSync(fileURLToPath(new URL('../src/features/libao/libaoIntent.ts', import.meta.url)), 'utf8');
  assert.match(src, /\(别排\|不要排\|留出来\|空出来\|这段时间有空\|没空\)/);
  assert.match(src, /looksLikeAction[\s\S]*?别排[\s\S]*?return true;/s);
});

test('2026-10-02 源码: needs_clarification 首问必须挂快捷项按钮卡（批次2 曾漏接最主路径）', () => {
  // 反向：删掉该处 options 行 → 本用例红。真机实证（终验）：修前
  // 「帮我规划一下我明天要打篮球」首问只有文字，第二轮才冒出 45/60/90/2h。
  const src = readFileSync(fileURLToPath(new URL('../src/features/libao/LbaoChat.tsx', import.meta.url)), 'utf8');
  assert.match(
    src,
    /planPoints: numberedQuestions\(pairs\),[\s\S]{0,400}?options: pairs\.length > 0[\s\S]{0,200}?quickOptionsFor\(pairs\[0\]\.slot, slots,/s,
  );
});
