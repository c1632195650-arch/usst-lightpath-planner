/**
 * 批 1.2 · weekNo 槽位回归（「第10周周五」不再错 4 周）
 * ============================================================
 * 槽位规约原本没有 weekNo 字段，「第10周周五」被丢掉周次、当成最近的周五解析
 * （2026-10-02 探针实录：→ 10-09，错 4 周）。本批：WhenHint.weekNo + 
 * resolveWhen 按 termStart 换算 + 无 termStart 时安全降级 + mergeLlmPrimary 越界丢弃。
 *
 * ⚠️ 反向验证：删掉 resolveWhen 的 weekNo 分支 / parseIntentSlots 的 opts 透传 /
 *    mergeLlmPrimary 的越界丢弃，下列用例逐组变红。
 * 手算锚点：termStart=2026-08-31（周一）时，第10周周一 = 08-31 + 63 = 2026-11-02，
 * 第10周周五 = 2026-11-06。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeLlmPrimary,
  parseIntentSlots,
  resolveWhen,
  type IntentSlots,
} from '@/features/libao/libaoIntent';

const TODAY = '2026-10-02';
const TERM_START = '2026-08-31';

test('weekNo：第10周周五 = 2026-11-06（termStart 换算，手算锚点）', () => {
  const r = resolveWhen(
    { text: '第10周周五', kind: 'exact', weekNo: 10, weekday: 5 },
    TODAY,
    { termStart: TERM_START },
  );
  assert.equal(r.from, '2026-11-06');
  assert.equal(r.to, '2026-11-06');
  assert.equal(r.certainty, 'exact');
});

test('weekNo：不带周X → 该周周一到周日的窗口（第10周 = 11-02 ~ 11-08）', () => {
  const r = resolveWhen({ text: '第10周', kind: 'window', weekNo: 10 }, TODAY, {
    termStart: TERM_START,
  });
  assert.equal(r.from, '2026-11-02');
  assert.equal(r.to, '2026-11-08');
  assert.equal(r.certainty, 'window');
});

test('weekNo：无 termStart → 安全降级为 window，不编日期', () => {
  const r = resolveWhen({ text: '第10周周五', kind: 'exact', weekNo: 10, weekday: 5 }, TODAY);
  assert.equal(r.certainty, 'window');
  assert.equal(r.from, undefined);
  assert.equal(r.to, undefined);
});

test('weekNo：parseIntentSlots 端到端（opts 透传）—— 日期落对、标题抽对', () => {
  const s = parseIntentSlots('第10周周五交开题报告', TODAY, { termStart: TERM_START });
  assert.equal(s.dateFrom, '2026-11-06');
  assert.equal(s.dateTo, '2026-11-06');
  assert.equal(s.certainty, 'exact');
  assert.equal(s.title, '开题报告');
  assert.equal(s.when?.weekNo, 10);
});

test('weekNo：无 termStart 时 parseIntentSlots 自报 unclear，不编日期', () => {
  const s = parseIntentSlots('第10周周五交开题报告', TODAY);
  assert.equal(s.dateFrom, undefined);
  assert.ok(s.unclear.some((u) => u.includes('学期')), '应提示需要学期起点');
});

test('weekNo：mergeLlmPrimary 越界 weekNo（31）被丢弃，其余字段保留', () => {
  const rule = parseIntentSlots('交开题报告', TODAY);
  const merged = mergeLlmPrimary(rule, {
    when: { text: '第31周周五', kind: 'exact', weekNo: 31, weekday: 5 },
  }, TODAY, { termStart: TERM_START });
  assert.equal(merged.when?.weekNo, undefined, '越界 weekNo 必须丢弃');
  assert.equal(merged.when?.weekday, 5, '同 patch 里的合法字段保留');
});

test('weekNo：mergeLlmPrimary 合法 weekNo 走 resolveWhen 换算', () => {
  const rule: IntentSlots = parseIntentSlots('交开题报告', TODAY);
  const merged = mergeLlmPrimary(rule, {
    when: { text: '第3周周一', kind: 'exact', weekNo: 3, weekday: 1 },
  }, TODAY, { termStart: TERM_START });
  // 第3周周一 = 08-31 + 14 = 2026-09-14
  assert.equal(merged.dateFrom, '2026-09-14');
});
