/**
 * R 批 P1-1 · R5 长期 vs 单次 —— 纯函数层测试
 * ============================================================
 * 任务书依据：outputs/R批任务书-交zcode-2026-10-02.md §三 P1-1（R5.1/R5.3/R5.4）。
 * CY 走查实录：「这学期想养成健身的习惯」→ 草稿只排一天（时间：今天 / 第5周周五），
 * 「养成习惯这个怎么能是一天两天的事情？」
 *
 * ⚠️ 反向验证（RV，红线 4）：
 *   RV-R5a ← 删 isSingleDayEvent 的长期闸 → 「长期不是单日」用例红
 *   RV-R5b ← 删 goalToTasks 的学期铺开 → 「学期跨度」用例红
 *   R5.2（recurring 数据结构）【需 CY 裁决】→ 已写 BLOCKERS.md，本批不实现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLongTermWish,
  isSingleDayEvent,
  parseIntentSlots,
  questionsForSlots,
} from '@/features/libao/libaoIntent';
import { checkGoalFeasibility, goalToTasks } from '@/features/libao/weekPlanForChat';
import { detectScope } from '@/features/feedback/parseCorrection';
import type { Schedule } from '@/types';

const TODAY = '2026-10-02';
const TERM_START = '2026-08-31';

const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: TERM_START,
  totalWeeks: 20,
  source: 'demo',
  courses: [],
} as unknown as Schedule;

/* ---------------- R5.1 · 长期判据与单日豁免 ---------------- */

test('R5.1: 「这学期想养成健身的习惯」不是单日事件（RV-R5a 锚）', () => {
  const s = parseIntentSlots('这学期想养成健身的习惯', TODAY);
  assert.equal(isLongTermWish(s.raw), true, '长期判据命中');
  assert.equal(isSingleDayEvent(s), false, '长期诉求必须返回 false —— 哪怕带窗口');
  // RV-R5a 咬合点：带单日 when 的长期句 —— 没有长期闸时 relativeDays 会判成单日
  const s2 = parseIntentSlots('这学期想养成健身的习惯；明天开始', TODAY);
  assert.equal(s2.when?.relativeDays, 1, '测试前提：句子带单日锚点');
  assert.equal(isSingleDayEvent(s2), false, '长期闸压过单日锚点');
  // 单日豁免失效 → 只给单次时长不再算 effort 齐（长期需要 频率 × 时长）
  const withDur = { ...s, durationMin: 30 };
  assert.equal(isSingleDayEvent(withDur), false);
});

test('R5.1: 反例 —— 普通单日句不受影响（明天打球仍是单日）', () => {
  const s = parseIntentSlots('明天我要去打球；每次60分钟', TODAY);
  assert.equal(isLongTermWish(s.raw), false);
  assert.equal(isSingleDayEvent(s), true, '单日豁免对普通单日句保持');
});

test('R5.1: detectScope 同口径 —— 想养成/这学期/保持 判 long（feedback 层打通）', () => {
  assert.equal(detectScope('想养成健身的习惯'), 'long');
  assert.equal(detectScope('这学期想坚持晨跑'), 'long');
  assert.equal(detectScope('保持每周三次'), 'long');
  assert.equal(detectScope('周四下午别排东西'), 'once', '一次性口径不变');
});

/* ---------------- R5.3 · 频率 → 时长 → 时段 的追问顺序 ---------------- */

test('R5.3: 长期 effort 追问拆两步 —— 先频率，答了频率再问时长', () => {
  const s = parseIntentSlots('这学期想养成晨跑的习惯；从下周开始', TODAY);
  const q1 = questionsForSlots(s, ['effort'])[0].question;
  assert.match(q1, /多久一次/, '第一步问频率');
  assert.match(q1, /每周3次/);
  const s2 = { ...s, perWeekCount: 3 };
  const q2 = questionsForSlots(s2, ['effort'])[0].question;
  assert.match(q2, /每次大概多久/, '第二步问时长');
});

test('R5.3: 非长期句的 effort 问法不变（单日「占多久」/ 常规「投入多少」）', () => {
  const single = parseIntentSlots('明天体检', TODAY);
  assert.match(questionsForSlots(single, ['effort'])[0].question, /占多久/);
  const other = parseIntentSlots('九月中旬开始备赛', TODAY);
  assert.match(questionsForSlots(other, ['effort'])[0].question, /投入多少|节奏/);
});

/* ---------------- R5.4 · 学期跨度与「覆盖到第 N 周」 ---------------- */

test('R5.4: goalToTasks 长期 + 频率 → 每周重复任务覆盖多周（RV-R5b 锚；R5.2 路线 A 后为 recurring 形态）', () => {
  const s = parseIntentSlots('这学期想养成晨跑的习惯；从下周开始；每周3次，每次30分钟', TODAY);
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  // R5.2（CY 裁决路线 A）：不再逐周采样成几十个一次性任务 ——
  // 每个「每周名额」一个任务，weeks 覆盖整段 + recurring 标记
  assert.equal(tasks.length, 3, `每周 3 次 = 3 个重复任务，实际 ${tasks.length}`);
  assert.ok(tasks.every((t) => t.recurring === true), '全部带 recurring 标记');
  const weeks = [...new Set(tasks.flatMap((t) => (t.weeks ?? []).filter((w): w is number => Number.isFinite(w))))];
  assert.ok(weeks.length > 1, `落盘覆盖周数必须 > 1，实际 ${weeks.length}（${weeks.join(',')}）`);
});

test('R5.4: 没给频率的长期句不拉长窗口（nBlocks=1，仍是默认窗口）', () => {
  const s = parseIntentSlots('这学期想养成健身的习惯', TODAY);
  const tasks = goalToTasks(s, SCHEDULE, TODAY);
  assert.equal(tasks.length, 1, '没频率就一块 —— 拉长窗口只会把一块甩到学期末');
});

test('R5.4: checkGoalFeasibility 草稿卡说明「铺到第 N 周」（不再说 21 天窗口）', () => {
  const s = parseIntentSlots('这学期想养成晨跑的习惯；从下周开始；每周3次，每次30分钟', TODAY);
  const v = checkGoalFeasibility({ slots: s, schedule: SCHEDULE, profile: null, today: TODAY });
  const joined = v.caveats.join('；');
  assert.ok(!/21 天的窗口/.test(joined), `长期句不该再出现默认窗口口径：${joined}`);
  assert.match(joined, /长期安排|铺到第 \d+ 周/, `应有长期覆盖口径：${joined}`);
});
