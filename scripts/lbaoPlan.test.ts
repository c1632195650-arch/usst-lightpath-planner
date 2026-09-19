/**
 * 梨宝方案卡：从**引擎计划**到展示模型的映射
 * 跑法：npm run test:ui
 *
 * 这一组盯的是「双轨清理」之后必须成立的契约：
 *   1. 卡片内容**只来自引擎**（不再有硬编码时段那套模板）；
 *   2. 映射**不做取舍** —— 引擎排了几件事，卡片就有几张。
 *      少显示一个块，用户就少看到一件本该知道的事。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { PersonaProfile, TimeBlock, WeekPlan } from '@/types';
import { lbaoShell, pickMode } from '@/lib/lbao';
import { blockToCard, toLbaoPlan } from '@/features/libao/lbaoPlanFromEngine';
import { LIFE_MODES } from '@/data/usst';

/* ---------------- 夹具 ---------------- */

function block(over: Partial<TimeBlock> & { id: string; startMin: number; endMin: number }): TimeBlock {
  return {
    kind: 'study', dayOfWeek: 1, title: '自习', source: 'template', ...over,
  } as TimeBlock;
}

function plan(blocks: TimeBlock[]): WeekPlan {
  return { weekNo: 4, blocks, issues: [], notes: [], stats: {} as never };
}

const persona = (axes: Partial<PersonaProfile['axes']> = {}, mode = 'study_place') => ({
  axes: { ACH: 50, PLAN: 50, SOC: 50, EXP: 50, HEA: 50, RES: 50, BOLD: 50, ...axes },
  scenarios: { meal_radius: 'near', [mode]: 'library' },
}) as unknown as PersonaProfile;

/* ============================================================
 * 一、外壳（画像侧）：与排程无关的那一半
 * ========================================================== */

test('lbaoShell：模式由画像选出，也可以被用户显式指定', () => {
  const p = persona({ ACH: 95, PLAN: 90, RES: 85 });
  const auto = lbaoShell(p);
  assert.equal(auto.mode.id, pickMode(p).id);

  const forced = lbaoShell(p, LIFE_MODES[0].id);
  assert.equal(forced.mode.id, LIFE_MODES[0].id, '显式指定应优先于自动选择');

  const bogus = lbaoShell(p, 'not-a-mode');
  assert.equal(bogus.mode.id, auto.mode.id, '未知模式回退到自动选择，而不是崩掉');
});

test('lbaoShell：每种模式都有开场白与三条依据', () => {
  for (const m of LIFE_MODES) {
    const shell = lbaoShell(persona(), m.id);
    assert.ok(shell.headline.length > 0, `模式 ${m.id} 缺开场白`);
    assert.equal(shell.reasons.length, 3);
  }
});

/* ============================================================
 * 二、块 → 卡片
 * ========================================================== */

test('blockToCard：时间取引擎的真实分钟数，说明优先用引擎给的 reason', () => {
  const c = blockToCard(block({
    id: 'b1', startMin: 8 * 60 + 5, endMin: 9 * 60, kind: 'course',
    title: '高等数学 A', place: '第一教学楼', room: '144', emoji: '📐',
    reason: '必修课，按课表固定时间',
  }));
  assert.equal(c.time, '08:05', '不能写死 08:00 —— 那不是这份课表的时间');
  assert.equal(c.title, '高等数学 A');
  assert.equal(c.icon, '📐');
  assert.equal(c.note, '必修课，按课表固定时间', '「为什么排在这儿」最该被看到');
  assert.equal(c.kind, 'course');

  const noReason = blockToCard(block({
    id: 'b2', startMin: 600, endMin: 660, title: '自习', place: '图书馆', room: '3F',
  }));
  assert.equal(noReason.note, '图书馆 3F', '没有 reason 就退回地点，不编一句');

  const nothing = blockToCard(block({ id: 'b3', startMin: 600, endMin: 660, title: '自习' }));
  assert.ok(nothing.note.length > 0, '什么信息都没有时给类别兜底，不留空白');
  assert.equal(nothing.kind, 'study');
});

test('blockToCard：引擎 6 种类别映射到卡片 5 种，commute 并入 activity', () => {
  const kinds: Array<[TimeBlock['kind'], string]> = [
    ['course', 'course'], ['meal', 'meal'], ['study', 'study'],
    ['activity', 'activity'], ['commute', 'activity'],
  ];
  for (const [engineKind, card] of kinds) {
    const c = blockToCard(block({ id: 'k', startMin: 600, endMin: 660, kind: engineKind }));
    assert.equal(c.kind, card, `${engineKind} 应映射为 ${card}`);
  }
});

/* ============================================================
 * 三、整周映射：契约是「不筛块」
 * ========================================================== */

test('toLbaoPlan：块按天归位、按时间排序，且**一块都不筛**', () => {
  const blocks = [
    block({ id: 'd1-a', dayOfWeek: 1, startMin: 600, endMin: 660, title: 'A' }),
    block({ id: 'd1-b', dayOfWeek: 1, startMin: 480, endMin: 540, title: 'B' }),
    block({ id: 'd1-c', dayOfWeek: 1, startMin: 720, endMin: 780, title: 'C' }),
    block({ id: 'd1-d', dayOfWeek: 1, startMin: 840, endMin: 900, title: 'D' }),
    block({ id: 'd1-e', dayOfWeek: 1, startMin: 960, endMin: 1020, title: 'E' }),
    block({ id: 'd1-f', dayOfWeek: 1, startMin: 1080, endMin: 1140, title: 'F' }),
    block({ id: 'd1-g', dayOfWeek: 1, startMin: 1200, endMin: 1260, title: 'G' }),
    block({ id: 'd3-x', dayOfWeek: 3, startMin: 600, endMin: 660, title: '周三的' }),
  ];
  // 周一 ISO：2026-03-02 是周一
  const out = toLbaoPlan(plan(blocks), lbaoShell(persona()), ['2026-03-02', '2026-03-04']);

  assert.equal(out.days.length, 2);
  const mon = out.days[0];
  assert.equal(mon.label, '周一');
  assert.deepEqual(
    mon.blocks.map((b) => b.title), ['B', 'A', 'C', 'D', 'E', 'F', 'G'],
    '应按时间排序，且 7 个块全部保留 —— 旧实现会 slice(0,5)，等于偷偷藏掉两件事',
  );
  assert.equal(out.days[1].blocks.length, 1);
  assert.equal(out.days[1].blocks[0].title, '周三的');
});

test('toLbaoPlan：刻意留白（blank）不作为卡片 —— 它是「没事的时间」不是一件事', () => {
  const blocks = [
    block({ id: 'x', dayOfWeek: 1, startMin: 600, endMin: 660, title: '自习' }),
    block({ id: 'y', dayOfWeek: 1, startMin: 660, endMin: 720, kind: 'blank', title: '留白' }),
  ];
  const out = toLbaoPlan(plan(blocks), lbaoShell(persona()), ['2026-03-02']);
  assert.deepEqual(out.days[0].blocks.map((b) => b.title), ['自习']);
});

test('toLbaoPlan：周日按 7 匹配（引擎用 1..7，JS 的 getDay 是 0..6）', () => {
  const blocks = [block({ id: 'sun', dayOfWeek: 7, startMin: 600, endMin: 660, title: '周日的事' })];
  // 2026-03-08 是周日
  const out = toLbaoPlan(plan(blocks), lbaoShell(persona()), ['2026-03-08']);
  assert.equal(out.days[0].label, '周日');
  assert.deepEqual(out.days[0].blocks.map((b) => b.title), ['周日的事']);
});

test('toLbaoPlan：那天没有任何块时给空数组，而不是假装有安排', () => {
  const out = toLbaoPlan(plan([]), lbaoShell(persona()), ['2026-03-02']);
  assert.deepEqual(out.days[0].blocks, []);
});
