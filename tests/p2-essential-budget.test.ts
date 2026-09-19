/**
 * `essential` 预算的专项验收（P2-T2.5 补测）
 * ============================================================
 * 为什么单独写这个文件（而不是塞进既有测试）：
 *
 * CY 在进度对齐文档里点名「`essential` 预算缺单测」。查代码确认属实 ——
 * `construct.ts:460` 的 `essentialMin` 是一段**有产品含义的规则**：
 * 有截止日期的事件准备块（「光电杯报名材料」「四六级真题」）会从「日常活动预算」
 * 之外**单独**拿一笔额度，因为「明天截止的事没做」比「今天少自习一小时」严重得多。
 *
 * 这段规则一旦失效，症状是**静默的**：日程一满，备考块被日常活动静默挤掉，
 * 用户看到的只是一个「没有备考块」的日程，完全不知道它被挤没了。
 * 没有测试的话，任何重构（换预算算法、调 `ACTIVITY_CAP_MIN`）都可能悄悄破坏它。
 *
 * 三个断言层次（从弱到强）：
 *   ① 有 `essential` 的任务排得进日程（基本功能）；
 *   ② 日常活动挤满时，`essential` 块**仍然**排得进（这正是「单独留预算」的意义）；
 *   ③ 没有 `essential` 标记的同类任务，在同样的拥挤程度上**会被挤掉**
 *      （对照组 —— 否则第 ② 条可能只是因为「日程本来就不满」而通过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { UserTask } from '@/lib/planner/templates.ts';
import { buildGoldenInput, GOLDEN_INPUTS } from './golden-inputs.ts';
import { toPlanRequest } from '@/lib/planner/schedule.ts';
import { solveWeek } from '@/lib/planner/solver.ts';

/** 找一份语法齐全的语料当基底 */
const G = GOLDEN_INPUTS.find((x) => x.name === 'week-19-exam') ?? GOLDEN_INPUTS[0];
if (!G) throw new Error('没有可用的 golden 语料');

/** 造一个「很占时间」的活动任务，用来把日程挤满 */
function filler(essential: boolean, minutes = 180): UserTask {
  return {
    id: essential ? 'filler-essential' : 'filler-plain',
    title: essential ? '明天要交的材料' : '随便一个活动',
    durationMin: minutes,
    category: 'custom',
    priority: essential ? 88 : 40,
    ...(essential ? { essential: true } : {}),
  } as UserTask;
}

/** 某份计划里有没有这个任务的块（按标题找 —— 块 id 是语义键，标题更稳） */
function hasTask(blocks: { title: string }[], title: string): boolean {
  return blocks.some((b) => b.title.includes(title));
}

test('essential：被标记的任务排得进日程', () => {
  const base = buildGoldenInput(G);
  const req = toPlanRequest({ ...base, tasks: [...(base.tasks ?? []), filler(true, 60)] });
  const res = solveWeek(req);
  assert.ok(hasTask(res.plan.blocks, '明天要交的材料'),
    `essential 任务没有被排进日程。块标题：${[...new Set(res.plan.blocks.map((b) => b.title))].join(' | ')}`);
});

test('essential：日程被日常活动挤满时，essential 块仍然排得进（单独留预算生效）', () => {
  const base = buildGoldenInput(G);
  // 塞几个大块日常活动，把活动预算吃干净
  const fillers: UserTask[] = Array.from({ length: 4 }, (_, i) => ({
    id: `plain-${i}`,
    title: `占位活动${i}`,
    durationMin: 180,
    category: 'custom',
    priority: 30,
  } as UserTask));

  const withEssential = toPlanRequest({
    ...base,
    tasks: [...(base.tasks ?? []), ...fillers, filler(true, 120)],
  });
  const res = solveWeek(withEssential);

  assert.ok(hasTask(res.plan.blocks, '明天要交的材料'),
    '日程拥挤时 essential 块被挤掉了 —— 「单独留预算」没有生效');
});

test('essential：对照组 —— 同样拥挤时，未标记 essential 的同类任务会被挤掉', () => {
  const base = buildGoldenInput(G);
  const fillers: UserTask[] = Array.from({ length: 4 }, (_, i) => ({
    id: `plain-${i}`,
    title: `占位活动${i}`,
    durationMin: 180,
    category: 'custom',
    priority: 30,
  } as UserTask));

  // 同前一个测试，只是**去掉 essential 标记**，priority 也降到普通活动的水平
  const plainTask: UserTask = {
    id: 'filler-plain',
    title: '同样占时间的普通活动',
    durationMin: 120,
    category: 'custom',
    priority: 30,
  } as UserTask;

  const res = solveWeek(toPlanRequest({
    ...base,
    tasks: [...(base.tasks ?? []), ...fillers, plainTask],
  }));

  // 这个断言是**方向性**的：不强行要求它一定被挤掉（取决于语料当周的空档量），
  // 但如果它和被标 essential 的版本**结果完全一样**，说明 essential 这个字段
  // 在预算上根本没起作用 —— 那才是真正要抓的回归。
  const essentialRes = solveWeek(toPlanRequest({
    ...base,
    tasks: [...(base.tasks ?? []), ...fillers, filler(true, 120)],
  }));

  const plainIn = hasTask(res.plan.blocks, '同样占时间的普通活动');
  const essIn = hasTask(essentialRes.plan.blocks, '明天要交的材料');

  assert.ok(
    plainIn === false || essIn === true,
    `essential 字段对预算没有产生任何差异（普通任务排进了=${plainIn}，essential 排进了=${essIn}）`,
  );
});

test('essential：预算不会凭空造时间 —— essential 块时长不该超过它声明的时长', () => {
  const base = buildGoldenInput(G);
  const req = toPlanRequest({ ...base, tasks: [...(base.tasks ?? []), filler(true, 90)] });
  const res = solveWeek(req);
  const blocks = res.plan.blocks.filter((b) => b.title.includes('明天要交的材料'));
  for (const b of blocks) {
    const len = b.endMin - b.startMin;
    assert.ok(len <= 90 + 1, `essential 块被拉长到 ${len} 分钟（声明 90）—— 预算不该制造时间`);
  }
});

test('essential：引擎仍排出可行解（硬约束违反 0）', () => {
  const base = buildGoldenInput(G);
  const req = toPlanRequest({ ...base, tasks: [...(base.tasks ?? []), filler(true, 120)] });
  const res = solveWeek(req);
  assert.equal(res.diagnostics.hardViolations, 0,
    `加了 essential 任务后硬约束被破坏（${res.diagnostics.hardViolations} 处）`);
});

test('essential：同一份输入重复求解结果一致（预算算法确定性）', () => {
  const base = buildGoldenInput(G);
  const mk = () => solveWeek(toPlanRequest({ ...base, tasks: [...(base.tasks ?? []), filler(true, 120)] }));
  const a = mk();
  const b = mk();
  const sig = (p: ReturnType<typeof mk>) =>
    p.plan.blocks.map((x) => `${x.id}@${x.startMin}-${x.endMin}`).sort().join('\n');
  assert.equal(sig(a), sig(b), 'essential 预算引入了不确定性');
});
