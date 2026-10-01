/**
 * 批 3b · 单日重排意图层回归
 * ============================================================
 * 「重排周四 / 重新排一下周五 / 把周三重新排一版」→ IntentSlots.replanDays。
 * 歧义路由的分工：有块名（targetHint）= 老的单块 reschedule；只有天 = 单日重排。
 * 「重排周四」没有目标名词（对象是「那天」本身）→ looksLikeAction 必须显式放行。
 *
 * ⚠️ 反向验证：删 extractReplanDays / INTENT_PATTERNS 的重排条目 /
 *    looksLikeAction 的显式重排放行，用例逐组变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, looksLikeAction, parseIntentSlots } from '@/features/libao/libaoIntent';

const TODAY = '2026-09-27';

test('重排意图：动词在前的各形态都抽出目标天', () => {
  const cases: Array<[string, number[]]> = [
    ['重排周四', [4]],
    ['重排一下周五', [5]],
    ['重新排这周日', [7]],
    ['只重排周三', [3]],
    ['重排周三和周四', [3, 4]],
  ];
  for (const [q, want] of cases) {
    const s = parseIntentSlots(q, TODAY);
    assert.deepEqual(s.replanDays, want, `「${q}」replanDays=${JSON.stringify(s.replanDays)}`);
    assert.equal(detectIntent(q), 'reschedule', `「${q}」意图应归 reschedule`);
    assert.equal(looksLikeAction(q), true, `「${q}」没有目标名词也必须过动作闸`);
  }
});

test('重排意图：动词在后（「把周四重新排一版」）也能接住', () => {
  const s = parseIntentSlots('把周四重新排一版', TODAY);
  assert.deepEqual(s.replanDays, [4]);
  assert.equal(detectIntent('把周四重新排一版'), 'reschedule');
});

test('重排意图：负例 —— 不把单块挪动和无关句误判成单日重排', () => {
  assert.equal(parseIntentSlots('把高数复习挪到周四', TODAY).replanDays, undefined,
    '「挪到」是单块 reschedule，不得触发整日重排');
  assert.equal(parseIntentSlots('帮我重排一下', TODAY).replanDays, undefined,
    '没点名天 → 不是单日重排（走老路径问对象）');
  assert.equal(parseIntentSlots('教室重新排了座位', TODAY).replanDays, undefined,
    '「重新排」修饰别的宾语时不误伤（无星期词）');
});

test('重排意图：与单块挪动可共存 —— 有块名时执行层应优先单块路由', () => {
  // 合约声明：targetHint 与 replanDays 同时在时，执行层看 targetHint。
  // 这里只验证槽位层两者互不覆盖。
  const s = parseIntentSlots('重排周四', TODAY);
  assert.deepEqual(s.replanDays, [4]);
  assert.equal(s.targetHint, undefined);
});
