/**
 * F5 · C1 晨报 + C2 周报验收（2026-10-24）
 * ============================================================
 * 纯函数三件（morningBrief / weeklyReview / planBriefNotifications）+
 * 挂载接线锁。RV：摘掉实现的关键分支 → 对应用例恰红（收尾批实测留痕）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { TimeBlock } from '@/types';
import { morningBrief, WARN_WINDOW_DAYS } from '@/features/mobile/lib/morningBrief';
import { planBriefNotifications, BRIEF_AT_MIN, DEADLINE_AT_MIN } from '@/features/mobile/lib/notifyBridge';
import { weeklyReview } from '@/lib/weeklyReview';
import type { BehaviorRecord } from '@/lib/behaviorLog';

const here = dirname(fileURLToPath(import.meta.url));
const srcOf = (rel: string) => readFileSync(join(here, rel), 'utf8');

const block = (id: string, startMin: number, endMin: number, title = '自习', place?: string): TimeBlock =>
  ({ id, dayOfWeek: 1, startMin, endMin, title, kind: 'study', source: 'engine' as never, place }) as TimeBlock;

test('F5-① 晨报：标题带数量与第一件；正文前 3 块 + 余量；空安排如实说', () => {
  const b = morningBrief({
    blocksToday: [
      block('a', 8 * 60, 9 * 60 + 30, '早自习', '图书馆'),
      block('b', 12 * 60, 13 * 60, '午饭'),
      block('c', 14 * 60, 15 * 60, '听力'),
      block('d', 19 * 60, 20 * 60, '夜跑'),
    ],
    todos: [], goals: [], nowMin: 7 * 60, dateKey: '2026-10-24',
  });
  assert.equal(b.title, '今天 4 个安排，第一件 08:00 早自习');
  assert.equal(b.lines.length, 4, '3 块时刻表 + 1 行余量');
  assert.match(b.lines[3], /还有 1 件/);
  assert.deepEqual(b.warnings, []);
  const empty = morningBrief({ blocksToday: [], todos: [], goals: [], nowMin: 0, dateKey: '2026-10-24' });
  assert.equal(empty.title, '今天没有排好的安排');
});

test('F5-② 晨报提醒：3 天内未办结才报、逾期如实说、≤3 条、done 不报', () => {
  const b = morningBrief({
    blocksToday: [], todos: [], goals: [], nowMin: 0, dateKey: '2026-10-24',
    deadlines: [
      { id: 'd0', title: '今天截止的事', dueISO: '2026-10-24' },
      { id: 'd1', title: '后天截止', dueISO: '2026-10-26' },
      { id: 'd3', title: '三天后截止', dueISO: '2026-10-27' },
      { id: 'd4', title: '四天后（窗口外）', dueISO: '2026-10-28' },
      { id: 'dover', title: '已逾期两天', dueISO: '2026-10-22' },
      { id: 'ddone', title: '已办结', dueISO: '2026-10-25', done: true },
    ],
  });
  assert.equal(b.warnings.length, 3, '命中 4 条但按「宁缺毋滥」截最紧迫 3 条（dover/d1/d0；d3 被挤出）');
  assert.match(b.warnings[0], /已过截止 2 天/); // 逾期最紧迫排最前
  assert.match(b.warnings.find((w) => w.includes('今天截止'))!, /今天截止/);
  assert.ok(!b.warnings.some((w) => w.includes('四天后')));
  assert.ok(!b.warnings.some((w) => w.includes('已办结')));
  assert.equal(WARN_WINDOW_DAYS, 3);
  // 窗口语义区分锚（≤3 截断观测不到的场景）：只有远期截止 → 0 提醒
  //（RV：摘掉 WARN_WINDOW_DAYS 过滤 → 本断言恰红，实测留痕）
  const far = morningBrief({
    blocksToday: [], todos: [], goals: [], nowMin: 0, dateKey: '2026-10-24',
    deadlines: [{ id: 'f', title: '远期事', dueISO: '2026-11-15' }],
  });
  assert.deepEqual(far.warnings, [], '窗口外截止不提醒（哪怕没满 3 条）');
});

test('F5-③ 通知清单：晨报 1 条明早 7:30（确定性 id）+ 截止 D-3/D-1 各 1 条', () => {
  const brief = morningBrief({ blocksToday: [block('a', 480, 540)], todos: [], goals: [], nowMin: 0, dateKey: '2026-10-24' });
  const specs = planBriefNotifications(brief, [
    { id: 'g1', title: '光电杯作品', dueISO: '2026-10-27' }, // 剩 3 天 → D-3
    { id: 'g2', title: '六级报名', dueISO: '2026-10-25' },   // 剩 1 天 → D-1
    { id: 'g3', title: '还早', dueISO: '2026-11-15' },       // 不排
  ], '2026-10-24');
  assert.equal(specs.length, 3, '晨报 + D-3 + D-1');
  const morning = specs[0];
  assert.equal(morning.atMin, BRIEF_AT_MIN);
  assert.equal(morning.dayOffset, 1);
  assert.equal(morning.title, brief.title);
  const ddl = specs.slice(1);
  assert.ok(ddl.every((s) => s.atMin === DEADLINE_AT_MIN && s.dayOffset === 0));
  assert.match(ddl[0].title, /光电杯作品.*3 天/);
  assert.match(ddl[1].title, /六级报名.*1 天/);
  // 确定性：同输入两次 id 逐个一致（重排幂等的地基）
  const again = planBriefNotifications(brief, [{ id: 'g1', title: '光电杯作品', dueISO: '2026-10-27' }], '2026-10-24');
  assert.equal(again.find((s) => s.title.includes('光电杯'))!.id, ddl[0].id);
});

/* ---------------- C2 周报 ---------------- */

const rec = (over: Partial<BehaviorRecord>): BehaviorRecord => ({
  id: 'r', blockId: 'x', date: '2026-10-20', weekNo: 4, status: 'done', plannedMin: 60,
  ...over,
} as BehaviorRecord);

test('F5-④ 周报：完成率/环比/最爱挪时段（F3 startMin）/欠账目标/诚实空态', () => {
  const records = [
    rec({ id: '1', blockId: 'goal-g1-a', status: 'done', startMin: 500 }),
    rec({ id: '2', blockId: 'goal-g1-b', status: 'skipped', startMin: 1100 }),
    rec({ id: '3', blockId: 'study-c', status: 'skipped', startMin: 1100 }),
    rec({ id: '4', blockId: 'study-d', status: 'done', weekNo: 3 }),
    rec({ id: '5', blockId: 'study-e', status: 'skipped', weekNo: 3 }),
  ];
  const r = weeklyReview(records, 4, 3, new Map([['g1', '光电杯']]));
  assert.equal(r.rate, 1 / 3);
  assert.equal(r.delta, 1 / 3 - 1 / 2, '环比 = 本周 - 上周');
  assert.match(r.movedSlotTop!, /晚间/, '两条 skipped 都在晚间（startMin 1100）');
  assert.deepEqual(r.debtGoals, [{ id: 'g1', skipped: 1 }]);
  assert.ok(r.lines.some((l) => /完成率 33%/.test(l)));
  assert.ok(r.lines.some((l) => /光电杯/.test(l) && /跳过 1 次/.test(l)));
  assert.ok(r.lines.some((l) => /由你决定/.test(l)), 'L3/L4 分寸句');
  // 无记录 → 诚实空态（不冒充 0%）
  const none = weeklyReview([], 4, 3);
  assert.equal(none.rate, null);
  assert.equal(none.movedSlotTop, null);
  assert.ok(none.lines.some((l) => /还没有标记记录/.test(l)));
});

test('F5-⑤ 接线锁：TodayTab 挂晨报卡 / MeTab 挂周报卡（源码锁，摘挂载必红）', () => {
  const tt = srcOf('../../src/features/mobile/TodayTab.tsx');
  assert.match(tt, /<MorningCard blocksToday=\{displayed\?\.blocks \?\? \[\]\} nowMin=\{nowMin\} \/>/, '今天页挂晨报卡');
  const mt = srcOf('../../src/features/mobile/MeTab.tsx');
  assert.match(mt, /<WeeklyReviewCard \/>/, '我的页挂周报卡');
});
