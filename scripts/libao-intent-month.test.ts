/**
 * 批 1.3 · 相对月锚 + 过去月滚年回归
 * ============================================================
 * 两个实测翻车（2026-10-02 探针）：
 *   ① 「论文答辩在下月底」被解析成「下周」（错 7 周）—— 槽位没有相对月锚；
 *   ② 「九月中旬比赛」在 10 月说，仍解析到 2026-09-15（过去日期）——
 *      旧 90 天规则只对「早于今天 90 天以上」的月份滚年，铺块会落进已过去的周。
 * 修复：WhenHint.relativeMonths（0=本月/1=下月/2=下下月，旬后缀正交）；
 *       滚年规则改为「整个窗口早于今天 → 年 +1」（窗口还含着今天就不滚）。
 *
 * ⚠️ 反向验证：删掉 extractConcreteWhen 的相对月分支 / resolveWhen 的
 *    relativeMonths 分支 / 滚年条件改回 90 天，下列用例逐组变红。
 * 手算锚点（today=2026-10-02）：下月底 = 2026-11-21 ~ 11-30（真实月末，非 28 截断）；
 * 下月初 = 11-01 ~ 11-10；九月中旬滚年 = 2027-09-11 ~ 09-20。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWhen, parseIntentSlots, resolveWhen } from '@/features/libao/libaoIntent';

const TODAY = '2026-10-02';

/* ── 相对月锚：抽取 ── */

test('抽取：下月底 → relativeMonths=1 + 下旬；不被「下周」吞掉', () => {
  const w = extractWhen('论文答辩在下月底，帮我规划一下准备');
  assert.equal(w?.relativeMonths, 1);
  assert.equal(w?.decade, 'late');
  assert.equal(w?.text, '下月底');
});

test('抽取：月底 / 下月初 / 下月中旬 / 下下个月初 / 月中 各归各位', () => {
  assert.deepEqual(
    { m: extractWhen('月底前完成')?.relativeMonths, d: extractWhen('月底前完成')?.decade },
    { m: 0, d: 'late' },
  );
  assert.deepEqual(
    { m: extractWhen('下月初交')?.relativeMonths, d: extractWhen('下月初交')?.decade },
    { m: 1, d: 'early' },
  );
  assert.deepEqual(
    { m: extractWhen('下月中旬答辩')?.relativeMonths, d: extractWhen('下月中旬答辩')?.decade },
    { m: 1, d: 'middle' },
  );
  assert.deepEqual(
    { m: extractWhen('下下个月初开学')?.relativeMonths, d: extractWhen('下下个月初开学')?.decade },
    { m: 2, d: 'early' },
  );
  assert.deepEqual(
    { m: extractWhen('月中聚餐')?.relativeMonths, d: extractWhen('月中聚餐')?.decade },
    { m: 0, d: 'middle' },
  );
});

test('抽取：「12月底」是明确月份，不得误判成「本月月底」', () => {
  const w = extractWhen('12月底前完成毕设开题');
  assert.equal(w?.relativeMonths, undefined, '数字月份在前不许触发相对月锚');
  assert.equal(w?.month, 12);
});

/* ── 相对月锚：换算（旬窗用真实月末，非 28 截断） ── */

test('换算：下月底 = 2026-11-21 ~ 11-30（真实月末）', () => {
  const r = resolveWhen({ text: '下月底', kind: 'window', relativeMonths: 1, decade: 'late' }, TODAY);
  assert.equal(r.from, '2026-11-21');
  assert.equal(r.to, '2026-11-30');
  assert.equal(r.certainty, 'window');
});

test('换算：下月初 = 2026-11-01 ~ 11-10；下下个月初跨年也正确', () => {
  const r = resolveWhen({ text: '下月初', kind: 'window', relativeMonths: 1, decade: 'early' }, TODAY);
  assert.equal(r.from, '2026-11-01');
  assert.equal(r.to, '2026-11-10');

  const r2 = resolveWhen(
    { text: '下下个月初', kind: 'window', relativeMonths: 2, decade: 'early' },
    '2026-11-20',
  );
  assert.equal(r2.from, '2027-01-01');
  assert.equal(r2.to, '2027-01-10');
});

/* ── 过去月滚年 ── */

test('滚年：10 月说「九月中旬」→ 滚到 2027（整窗已过）', () => {
  const r = resolveWhen({ text: '九月中旬', kind: 'window', month: 9, decade: 'middle' }, TODAY);
  assert.equal(r.from, '2027-09-11');
  assert.equal(r.to, '2027-09-20');
});

test('滚年：明确到日的过去日期同样滚年（9月15日 → 2027-09-15）', () => {
  const r = resolveWhen({ text: '9月15日', kind: 'exact', month: 9, day: 15 }, TODAY);
  assert.equal(r.from, '2027-09-15');
  assert.equal(r.certainty, 'exact');
});

test('滚年：窗口还含着今天就不滚（10 月说「10月」= 本月）', () => {
  const r = resolveWhen({ text: '10月', kind: 'window', month: 10 }, TODAY);
  assert.equal(r.from, '2026-10-01');
  assert.equal(r.to, '2026-10-28');
});

test('滚年：未来月份不受影响（12 月 / 3 月）', () => {
  const dec = resolveWhen({ text: '12月', kind: 'window', month: 12 }, TODAY);
  assert.equal(dec.from, '2026-12-01');
  const mar = resolveWhen({ text: '3月', kind: 'window', month: 3 }, '2026-10-02');
  assert.equal(mar.from, '2027-03-01', '10 月说「3 月」= 明年 3 月（整窗已过 → 滚年）');
});

/* ── 端到端 ── */

test('端到端：「论文答辩在下月底」dateFrom 落在 2026-11', () => {
  const s = parseIntentSlots('论文答辩在下月底，帮我规划一下准备', TODAY);
  assert.ok(s.dateFrom && s.dateFrom.startsWith('2026-11'), `dateFrom=${s.dateFrom}`);
  assert.equal(s.when?.text, '下月底');
});
