/**
 * 批 1.4 · 学期词挂校历回归
 * ============================================================
 * 实测翻车（2026-10-02 探针）：「期末考试前我要把高数复习完」「期中之前把文献
 * 综述写完」都抽不到日期（学期词只记原话），铺块默认窗口与校历完全脱钩。
 * 修复：termAnchorsFrom(校历) 推导 期中=理论教学中点周周一、期末=考试周跨度；
 * resolveWhen 的学期词在有锚点时落真实窗口（「…之前」→ [今天, 锚点前一日]），
 * 无锚点安全降级为原状（window 不编日期）。
 *
 * ⚠️ 反向验证：删 resolveWhen 的学期词分支 / termAnchorsFrom 的中点推导 /
 *    extractConcreteWhen 的「期中」裸词与「前」后缀，用例逐组变红。
 * 手算锚点（termStart=2026-09-07，理论 3-18 周、考试 19-20 周）：
 *   期中 = 第 round((3+18)/2)=11 周周一 = 2026-11-16；
 *   期末 = 第19周周一 2027-01-11 ~ 第20周周日 2027-01-24（与校历来源互证）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWhen,
  parseIntentSlots,
  resolveWhen,
  termAnchorsFrom,
} from '@/features/libao/libaoIntent';

const TODAY = '2026-10-02';
const TERM = {
  termStart: '2026-09-07',
  phases: [
    { name: '短学期', fromWeek: 1, toWeek: 2, kind: 'short' },
    { name: '理论教学', fromWeek: 3, toWeek: 18, kind: 'theory' },
    { name: '考试周', fromWeek: 19, toWeek: 20, kind: 'exam' },
  ],
};
const ANCHORS = termAnchorsFrom(TERM);

test('termAnchorsFrom：期中=教学中点周周一、期末=考试周跨度（手算互证）', () => {
  assert.equal(ANCHORS?.midterm, '2026-11-16');
  assert.equal(ANCHORS?.finalsFrom, '2027-01-11');
  assert.equal(ANCHORS?.finalsTo, '2027-01-24');
});

test('termAnchorsFrom：无考试周/无 phases → 对应锚点缺省，不编', () => {
  const noExam = termAnchorsFrom({ termStart: '2026-09-07', phases: [{ name: '理论', fromWeek: 1, toWeek: 16, kind: 'theory' }] });
  assert.equal(noExam?.finalsFrom, undefined);
  assert.ok(noExam?.midterm);
  assert.equal(termAnchorsFrom(undefined), undefined);
  assert.equal(termAnchorsFrom({ termStart: '2026-09-07' }), undefined);
});

test('抽取：「期中」裸词与「之前/前」后缀都能进 when 原话', () => {
  assert.equal(extractWhen('期中之前把文献综述写完')?.text, '期中之前');
  assert.equal(extractWhen('期末考试前我要把高数复习完')?.text, '期末考试前');
  assert.equal(extractWhen('期末周之前把实验报告写完')?.text, '期末周之前');
});

test('换算：「期末考试前」→ [今天, 考试周前一日] = 2026-10-02 ~ 2027-01-10', () => {
  const r = resolveWhen({ text: '期末考试前', kind: 'window' }, TODAY, { term: ANCHORS });
  assert.equal(r.from, '2026-10-02');
  assert.equal(r.to, '2027-01-10');
  assert.equal(r.certainty, 'window');
});

test('换算：「期中之前」→ [今天, 期中前一日] = 2026-10-02 ~ 2026-11-15', () => {
  const r = resolveWhen({ text: '期中之前', kind: 'window' }, TODAY, { term: ANCHORS });
  assert.equal(r.from, '2026-10-02');
  assert.equal(r.to, '2026-11-15');
});

test('换算：不带「前」的「期末」= 考试周本身；「期中」= 期中当日（重要日语义）', () => {
  const finals = resolveWhen({ text: '期末', kind: 'window' }, TODAY, { term: ANCHORS });
  assert.deepEqual([finals.from, finals.to], ['2027-01-11', '2027-01-24']);
  const mid = resolveWhen({ text: '期中考试', kind: 'window' }, TODAY, { term: ANCHORS });
  assert.deepEqual([mid.from, mid.to], ['2026-11-16', '2026-11-16']);
});

test('换算：无校历锚点 → 维持 window 不编日期（原状降级）', () => {
  const r = resolveWhen({ text: '期末考试前', kind: 'window' }, TODAY);
  assert.equal(r.certainty, 'window');
  assert.equal(r.from, undefined);
});

test('端到端：parseIntentSlots 带 term 锚点，dateTo 落在考试周前', () => {
  const s = parseIntentSlots('期末考试前我要把高数复习完', TODAY, { term: ANCHORS });
  assert.equal(s.dateFrom, '2026-10-02');
  assert.equal(s.dateTo, '2027-01-10');
  // 已知局限（申报）：规则层 extractTitle 的 break-at-stop 语义跨不过「我要把」，
  // 抽到「复习」；生产 LLM 主理解会补全为「高数复习」（2026-10-02 探针实录）。
  // 本断言守的是「不是学期词当标题」这条底线，标题细化留给 LLM 层。
  assert.ok(['复习', '高数复习'].includes(s.title), `title=${s.title}`);
  assert.notEqual(s.title, '期末考试', '学期词时间锚不得当标题');
});
