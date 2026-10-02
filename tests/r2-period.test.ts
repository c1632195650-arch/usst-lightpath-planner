/**
 * R 批 P0-2 · R2 排程必问时段 —— 纯函数层测试
 * ============================================================
 * 任务书依据：outputs/R批任务书-交zcode-2026-10-02.md §三 P0-2（R2.1/R2.2/R2.4）。
 * CY 走查实录：「所有的排程你都没问具体时间…可以是空闲时间」——此前 create
 * 只要 when/effort 齐就直接落位，时段全凭引擎猜（「明天我要去打球」直接排出
 * 09:00 与 18:20 两个落点）。
 *
 * ⚠️ 反向验证（RV，红线 4）：
 *   RV-R2a ← 删 needsPeriodAsk 的 window/clock/freeWhen 三闸 → 「必问矩阵」用例红
 *   RV-R2b ← 删 quickOptionsFor 的 period case → 「选项含空闲时间档」用例红
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyClarifyAnswers,
  describeSlots,
  extractWindow,
  needsPeriodAsk,
  parseIntentSlots,
  PERIOD_OPTION_TEXTS,
  type IntentSlots,
} from '@/features/libao/libaoIntent';
import { quickOptionsFor } from '@/features/libao/weekPlanForChat';

const TODAY = '2026-10-02';

const baseSlots = (patch: Partial<IntentSlots>): IntentSlots => ({
  intent: 'create',
  title: '打球',
  certainty: 'unknown',
  priorityHint: 85,
  missing: [],
  unclear: [],
  raw: '明天我要去打球',
  ...patch,
});

/* ---------------- R2.1 · needsPeriodAsk 矩阵 ---------------- */

test('R2.1: needsPeriodAsk —— create 没说时段/没授权空闲 → 必问', () => {
  assert.equal(needsPeriodAsk(baseSlots({})), true, 'create 无 window/clock/freeWhen → 问');
});

test('R2.1: 三闸任一在 → 不问（说了时段 / 给了钟点 / 显式授权空闲）', () => {
  assert.equal(needsPeriodAsk(baseSlots({ window: { fromMin: 1080, toMin: 1380, text: '晚上', said: true } })), false, '说了时段');
  assert.equal(needsPeriodAsk(baseSlots({ clock: { startMin: 1080, endMin: 1200, text: '6点到8点' } })), false, '给了钟点');
  assert.equal(needsPeriodAsk(baseSlots({ freeWhen: true })), false, '显式授权空闲');
});

test('R2.1: 只对 create 问 —— cancel/hold/add_deadline 各有自己的时间追问', () => {
  assert.equal(needsPeriodAsk(baseSlots({ intent: 'cancel' })), false);
  assert.equal(needsPeriodAsk(baseSlots({ intent: 'hold' })), false);
  assert.equal(needsPeriodAsk(baseSlots({ intent: 'add_deadline' })), false);
});

/* ---------------- R2.2 · 时段按钮卡（与 PERIOD_WORDS 同源） ---------------- */

test('R2.2: quickOptionsFor("period") —— 5 个时段 + 自定义 + 空闲时间档', () => {
  const opts = quickOptionsFor('period', baseSlots({}));
  assert.equal(opts.length, 7);
  assert.deepEqual(opts.slice(0, 5).map((o) => o.label), ['早上', '上午', '中午', '下午', '晚上'],
    '时段按钮与 PERIOD_WORDS 同源（PERIOD_OPTION_TEXTS，禁第二套词表）');
  assert.ok(opts.some((o) => o.label === '自定义时间'), '自定义档在位');
  assert.ok(opts.some((o) => o.label === '空闲时间，你来安排'), '空闲时间档在位（验收硬要求）');
});

test('R2.2: 每个时段按钮 value 都能被 extractWindow 认出（互通锁）', () => {
  for (const t of PERIOD_OPTION_TEXTS) {
    const win = extractWindow(t);
    assert.ok(win, `「${t}」应产出时段窗`);
    assert.equal(win!.text, t);
    assert.equal(win!.said, true, 'extractWindow 产出必须标 said（R2.4 来源标注的正侧）');
  }
});

/* ---------------- R2.1 · period 回答的三形态（applyClarifyAnswers） ---------------- */

test('R2.1: 答「晚上」→ window 落位且 said=true', () => {
  const r = applyClarifyAnswers('晚上', baseSlots({}), ['period'], TODAY);
  assert.equal(r.contributed, true);
  assert.ok(r.slots.window, 'window 落位');
  assert.equal(r.slots.window!.text, '晚上');
  assert.equal(r.slots.window!.said, true);
  assert.equal(r.slots.freeWhen, undefined);
});

test('R2.1: 答「空闲时间，你来安排」→ freeWhen 显式授权，不设 window', () => {
  const r = applyClarifyAnswers('空闲时间，你来安排', baseSlots({}), ['period'], TODAY);
  assert.equal(r.contributed, true);
  assert.equal(r.slots.freeWhen, true, '空闲 = 用户显式授权，不是默认猜测');
  assert.equal(r.slots.window, undefined);
});

test('R2.1: 答「下午3点到5点」→ clock 落位 + 时长按钟点推算', () => {
  const r = applyClarifyAnswers('下午3点到5点', baseSlots({}), ['period'], TODAY);
  assert.equal(r.contributed, true);
  assert.ok(r.slots.clock, 'clock 落位');
  assert.equal(r.slots.clock!.startMin, 15 * 60);
  assert.equal(r.slots.clock!.endMin, 17 * 60);
  assert.equal(r.slots.durationMin, 120, '钟点双端齐 → durationMin 推算（批次 1 通道）');
});

/* ---------------- R2.4 · 草稿卡来源标注 ---------------- */

test('R2.4: describeSlots —— 按钟点推算的时长必须标「推算」来源', () => {
  const s = parseIntentSlots('明天打球；晚上6点到8点', TODAY);
  const lines = describeSlots(s).join('\n');
  assert.match(lines, /单次：120 分钟（按你说的6点到8点推算）/, '推算时长标注来源');
});

test('R2.4: describeSlots —— 用户亲口说的时长不添乱；freeWhen 有「你选的」标注', () => {
  const plain = describeSlots(parseIntentSlots('明天打球；每次60分钟', TODAY)).join('\n');
  assert.match(plain, /单次：60 分钟(?!（)/, '用户自己给的时长不加标注');
  const free = describeSlots(baseSlots({ freeWhen: true })).join('\n');
  assert.match(free, /时段：空闲，由引擎找空档（你选的）/);
});

test('R2.4: 引擎代填的 window（said=false）标「梨宝推断」，用户说的不标', () => {
  const inferred = describeSlots(baseSlots({ window: { fromMin: 1080, toMin: 1380, text: '晚上', said: false } })).join('\n');
  assert.match(inferred, /只在：晚上（梨宝推断）/, '不是用户说的必须标');
  const said = describeSlots(baseSlots({ window: { fromMin: 1080, toMin: 1380, text: '晚上', said: true } })).join('\n');
  assert.doesNotMatch(said, /梨宝推断/, '用户说的窗口不诬标');
});

/* ---------------- 语义回归：isSingleDayEvent 认「下周X」为单日（R4 批随件） ---------------- */

test('R2 回归: 下周二是单日事件（relative+weekday 一律 exact 单日，resolveWhen 同口径）', () => {
  const s = parseIntentSlots('下周二去打球；每次60分钟', TODAY);
  assert.equal(s.when?.weekday, 2);
  assert.equal(s.when?.relativeWeeks, 1);
  assert.ok(s.durationMin != null && s.durationMin > 0, '单次时长被抽到');
  // 单日 → durationMin 即满足 effort（旧口径把它误判成多日诉求 → 追问频率）
  assert.ok(!s.missing.includes('effort'), '单日豁免：单次时长即足');
});
