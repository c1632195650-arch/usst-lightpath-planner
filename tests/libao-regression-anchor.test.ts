/**
 * 排程回归锚（交互升级方案 2026-10-02 · 批次 0）—— 现状固化（characterization）
 * ============================================================
 * 被锁的是**已真机调通**的排程对话行为（方案 §〇.1 锚表 R1/R2 + 编号兜底）。
 * 后续批次 1-3 改解析层/交互层时，本文件必须全程保持绿；
 * 红 = 新改动破坏了已调通行为，停下修复，不许改断言凑绿。
 *
 * 与新功能测试（先红后绿）的分工：
 *   · 本文件锁「现状对的部分」—— 写的时候就该是绿的（2026-10-02 实测）；
 *   · 批次 1-3 的新能力断言在各自测试文件里，先红后绿。
 *
 * 覆盖不到的回归面（由既有体系守着，此处不重复）：
 *   R3 问答 RAG → scripts/libao.test.ts 既有用例；
 *   R4 S1 批量应答 / applyClarifyAnswers / T批换向 / confirm 双闸 → engine 459+ 全绿底线；
 *   R5 golden 快照 → golden-compare（只增不改）；
 *   R6 undo / cancel / reschedule / replace / pick_candidate → engine+ui 既有用例；
 *   「确认后落盘层含任务」→ scripts/lbaoPlan.test.ts / tests/d-batch.test.ts 既有锁。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Course, Schedule } from '@/types';
import {
  applyClarifyAnswers,
  describeSlots,
  mergeLlmPrimary,
  parseIntentSlots,
  parseOptionChoice,
} from '@/features/libao/libaoIntent';
import { checkGoalFeasibility, proposeReplanOptions } from '@/features/libao/weekPlanForChat';

const TERM_START = '2026-09-07'; // 周一
const TODAY = '2026-09-07';

function course(
  id: string,
  name: string,
  building: string,
  dayOfWeek: number,
  startPeriod: number,
  endPeriod: number,
  weeks: number[],
): Course {
  return {
    id,
    name,
    credit: 2,
    category: '公共基础',
    campus: 'JG516',
    building,
    slots: [{ dayOfWeek: dayOfWeek as Course['slots'][number]['dayOfWeek'], startPeriod, endPeriod, weeks }],
  };
}

const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: TERM_START,
  totalWeeks: 20,
  source: 'demo',
  courses: [course('c1', '大学物理A(2)', '第一教学楼', 1, 1, 2, [3, 4, 5])],
};

/* ============================================================
 * 锚 A（R1）：「周四晚上出去玩一小时」→ 单次 60 分钟草稿，时长不再被重问
 * ========================================================== */

test('锚A · 规则层：一小时=单次时长（不再判成总量/不重问占多久）', () => {
  const s = parseIntentSlots('周四晚上出去玩一小时', TODAY);
  assert.equal(s.durationMin, 60);
  // R批 P0-2（R2.4）：TimeWindow 新增 said 来源字段（原话抽出的 = true），断言随字段更新
  assert.deepEqual(s.window, { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上', said: true });
  assert.equal(s.when?.weekday, 4);
  assert.equal(s.dateFrom, '2026-09-10');
  // 关键口径：effort / when 都不算缺 —— 时长与时间都不该被追问
  //（title 规则层抽不到属已知现状，生产由 LLM 主理解通道补，见下一条）
  assert.deepEqual(s.missing, ['title']);
});

test('锚A · 生产路径（LLM 补 title 后）missing=[] 且草稿卡写「单次：60 分钟」', () => {
  const rule = parseIntentSlots('周四晚上出去玩一小时', TODAY);
  const s = mergeLlmPrimary(rule, { title: '出去玩' }, TODAY);
  assert.deepEqual(s.missing, []);
  const card = describeSlots(s).join('\n');
  assert.ok(card.includes('单次：60 分钟'), `草稿卡应含「单次：60 分钟」，实际：${card}`);
});

/* ============================================================
 * 锚 B（R2）：「下周一开始；一共10小时」→ 撞车协商 + 真编号选项 + 答"1"可选中
 * ========================================================== */

test('锚B · 追问应答：总量并入、缺口清空、起点=下周一', () => {
  const base = parseIntentSlots('帮我排个实验报告', TODAY);
  assert.equal(base.title, '实验报告');
  const r = applyClarifyAnswers('下周一开始；一共10小时', base, base.missing, TODAY);
  const s = r.slots;
  assert.equal(s.totalHours, 10);
  assert.deepEqual(s.missing, []);
  assert.equal(s.dateFrom, '2026-09-14');
});

test('锚B · 干跑判 conflict 且编号选项含 reduce_total；答"1"选中有效方案', () => {
  const base = parseIntentSlots('帮我排个实验报告', TODAY);
  const s = applyClarifyAnswers('下周一开始；一共10小时', base, base.missing, TODAY).slots;
  const verdict = checkGoalFeasibility({ slots: s, schedule: SCHEDULE, profile: null, today: TODAY });
  assert.equal(verdict.kind, 'conflict');

  const options = proposeReplanOptions({ slots: s, verdict, schedule: SCHEDULE, profile: null, today: TODAY });
  assert.ok(options.length > 0, 'blocked 态必须拿得到编号选项（承诺过「回①②③」）');
  assert.ok(options.some((o) => o.id === 'reduce_total'), `编号选项应含 reduce_total，实际：${options.map((o) => o.id).join(',')}`);

  // 「答 1 出新草稿」的纯函数侧：编号必须能选中；选中方案的槽位是**降档后**的
  const pick = parseOptionChoice('1', options.length);
  assert.equal(pick, 1);
  const chosen = options[pick - 1];
  assert.ok(chosen.slots.totalHours == null || chosen.slots.totalHours < s.totalHours!,
    '选中 reduce_total 后收到的应是降档槽位');
});

/* ============================================================
 * 锚 C：编号兜底与频率的现状口径（批次 1 互斥改造不许误伤的边界）
 * ========================================================== */

test('锚C · parseOptionChoice 认得的形态与负例', () => {
  assert.equal(parseOptionChoice('1', 3), 1);
  assert.equal(parseOptionChoice('①', 3), 1);
  assert.equal(parseOptionChoice('方案2', 3), 2);
  assert.equal(parseOptionChoice('就 3', 3), 3);
  // 越界 / 问句不是编号
  assert.equal(parseOptionChoice('5', 3), null);
  assert.equal(parseOptionChoice('四六级什么时候报名', 3), null);
  assert.equal(parseOptionChoice('', 3), null);
});

test('锚C · 频率现状：每周N次×每次M 与「每天都来（无时长）」不受批次1互斥影响', () => {
  const weekly = parseIntentSlots('每周3次，每次90分钟', TODAY);
  assert.equal(weekly.perWeekCount, 3);
  assert.equal(weekly.durationMin, 90);

  const daily = parseIntentSlots('每天都来，不用时长', TODAY);
  assert.equal(daily.perWeekCount, 7);
});
