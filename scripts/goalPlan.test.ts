/**
 * 防腐层回归测试 · 目标展开 + 干跑把关
 * ============================================================
 * 被测：`src/features/libao/weekPlanForChat.ts` 的两块新能力
 *
 *   `goalToTasks`           意图槽位 → 引擎认的 `UserTask[]`
 *   `checkGoalFeasibility`  **干跑**：先不落盘，让引擎告诉我们排不排得下
 *
 * 为什么这两块必须单独测（而不是只靠意图层那套）：
 *   意图层保证「听懂」，这里保证「听懂了之后引擎真的接得住」。
 *   中间那段接线（tasks 通道）此前**从来没有对话侧调用过** —— 属于典型
 *   「代码在、路没通」，只有真跑一遍引擎才看得出来。
 *
 * 本文件的两条纪律：
 *   ① **纯函数可复现**：`goalToTasks` / `checkGoalFeasibility` 都是同步纯函数，
 *      所以「同输入同输出」是可以直接断言的（引擎侧已注入确定性策略）。
 *   ② **不许把用户的事钉死**：用户说「安排一下」，引擎就该有挪动的余地 ——
 *      所以断言产物**不带 `startMin`**（带了就成了 hard 锁定块）。
 *
 * ⚠️ 反向验证：把 `goalToTasks` 的 `notBeforeMin` 去掉、把
 *    `checkGoalFeasibility` 的「窗口容量诚实检查」删掉，本文件必须变红。
 *    证据见 `_probe/reverse_intent.txt` 同批跑出的结果。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Course, Schedule } from '@/types';
import type { IntentSlots } from '@/features/libao/libaoIntent';
import { parseIntentSlots } from '@/features/libao/libaoIntent';
import {
  DEFAULT_BLOCK_MIN,
  DEFAULT_GOAL_SPAN_DAYS,
  checkGoalFeasibility,
  describeVerdict,
  goalToTasks,
  planWeekWithTasks,
} from '@/features/libao/weekPlanForChat';

/* ============================================================
 * 夹具
 * ========================================================== */

const TERM_START = '2026-09-07'; // 校历 2026-2027-1 第一周周一
const TODAY = '2026-09-07';

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

/**
 * 本地夹具，**刻意不 import `tests/golden-inputs.ts`**：
 * 那份语料一旦拍快照就冻结、且已喂给黄金快照，拿来当这里的输入会让
 * 「改黄金语料」意外地把本文件的期望值也改掉 —— 两件事必须解耦。
 * 形态照抄真实课表：周一二四有课、含跨楼；课从第 3 周起（1-2 周是短学期）。
 */
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
  courses: [
    course('c1', '大学物理A(2)', '第一教学楼', 1, 1, 2, range(3, 18)),
    course('c2', '概率论与数理统计B', '第三教学楼', 1, 3, 5, range(3, 18)),
    course('c3', '模拟电子技术实验', '国合楼', 5, 6, 7, range(10, 18)),
  ],
};

/** 造一份「必需槽位齐全」的槽位；只覆盖本测试关心的字段。 */
function slotsOf(over: Partial<IntentSlots> = {}): IntentSlots {
  return {
    intent: 'create',
    title: '数学建模备赛',
    certainty: 'window',
    priorityHint: 85,
    missing: [],
    unclear: [],
    raw: '帮我安排数学建模备赛',
    ...over,
  };
}

/** 一个落在学期内的 21 天窗口（第 3 周一起） */
const WIN = { dateFrom: '2026-09-21', dateTo: '2026-10-11' };

/* ============================================================
 * 一、goalToTasks：槽位 → 可排任务
 * ========================================================== */

test('展开：没有目标名 → 一条都不编（宁可上层追问）', () => {
  assert.deepEqual(goalToTasks(slotsOf({ title: '' }), SCHEDULE, TODAY), []);
});

test('展开：没有课表 → 一条都不编（算不出往哪儿插）', () => {
  assert.deepEqual(goalToTasks(slotsOf(), null, TODAY), []);
});

test('展开：**不给 startMin** —— 用户说「安排」，不是「钉死在那一刻」', () => {
  // 反向验证锚点：给产物加上 startMin，本断言立刻变红。
  const tasks = goalToTasks(slotsOf(WIN), SCHEDULE, TODAY);
  assert.ok(tasks.length > 0, '夹具应当能产出候选块');
  for (const t of tasks) {
    assert.equal(t.startMin, undefined, `${t.title} 被钉死成了固定块`);
  }
});

test('展开：id 是**语义键**——时段变了不该变成「另一个块」', () => {
  const a = goalToTasks(slotsOf(WIN), SCHEDULE, TODAY).map((t) => t.id);
  const b = goalToTasks(slotsOf({ ...WIN, window: { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' } }), SCHEDULE, TODAY)
    .map((t) => t.id);
  assert.deepEqual(a, b, 'id 里混进了时间 → 同一件事被认成两块');

  // 结构上也确认一遍：id 只由「目标 + 周 + 星期」组成
  for (const id of a) assert.match(id, /^goal-.+-w\d+d\d+$/);
});

test('展开：纯函数 —— 同输入同输出（id 里不许有随机数）', () => {
  assert.deepEqual(goalToTasks(slotsOf(WIN), SCHEDULE, TODAY), goalToTasks(slotsOf(WIN), SCHEDULE, TODAY));
});

test('展开：时段偏好走 notBeforeMin，不用 startMin', () => {
  const night = goalToTasks(
    slotsOf({ ...WIN, window: { fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' } }),
    SCHEDULE,
    TODAY,
  );
  assert.equal(night[0].notBeforeMin, 18 * 60);

  // 没给时段 → 也不许早于 09:00（备赛块不该出现在清晨）
  const plain = goalToTasks(slotsOf(WIN), SCHEDULE, TODAY);
  assert.equal(plain[0].notBeforeMin, 9 * 60);
});

test('展开：必做 → study + essential（单独留预算，不被日常预算挤掉）', () => {
  const hard = goalToTasks(slotsOf({ ...WIN, essential: true }), SCHEDULE, TODAY);
  assert.equal(hard[0].kind, 'study');
  assert.equal(hard[0].essential, true);

  const soft = goalToTasks(slotsOf(WIN), SCHEDULE, TODAY);
  assert.equal(soft[0].kind, 'activity');
  assert.equal(soft[0].essential, undefined);
});

test('展开：只给频率 → 块数 = 每周次数 × 周数', () => {
  // 14 天窗口 = 2 周，每周 3 次 → 6 块
  const tasks = goalToTasks(
    slotsOf({ dateFrom: '2026-09-14', dateTo: '2026-09-27', perWeekCount: 3 }),
    SCHEDULE,
    TODAY,
  );
  assert.equal(tasks.length, 6);
});

test('展开：只给总量 → 块数 = 总量 / 单次时长（向上取整）', () => {
  const tasks = goalToTasks(slotsOf({ ...WIN, totalHours: 9, durationMin: 60 }), SCHEDULE, TODAY);
  assert.equal(tasks.length, 9); // 540 / 60
  assert.ok(tasks.every((t) => t.durationMin === 60));

  // 没给单次时长 → 用默认块长，而不是把总量塞成一个大块
  const dflt = goalToTasks(slotsOf({ ...WIN, totalHours: 6 }), SCHEDULE, TODAY);
  assert.ok(dflt.every((t) => t.durationMin === DEFAULT_BLOCK_MIN));
});

test('展开：用户点名了星期 → 只落在那一天', () => {
  const tasks = goalToTasks(slotsOf({ ...WIN, when: { text: '每周三', kind: 'relative', weekday: 3 } }), SCHEDULE, TODAY);
  assert.ok(tasks.length > 0);
  for (const t of tasks) assert.equal(t.dayOfWeek, 3, '点名了周三却排到了别的天');
});

test('展开：窗口跑到学期外 → 超出的部分被丢掉，绝不生成学期外的块', () => {
  // 一年后的窗口：靠 MAX_GOAL_DAYS 夹住，且 1..totalWeeks 之外的一律丢弃
  const tasks = goalToTasks(slotsOf({ dateFrom: '2026-09-07', dateTo: '2027-09-07' }), SCHEDULE, TODAY);
  for (const t of tasks) {
    const wk = t.weeks?.[0] ?? 0;
    assert.ok(wk >= 1 && wk <= SCHEDULE.totalWeeks, `生成了学期外的块：第 ${wk} 周`);
  }
});

test('展开：没给结束时间 → 按默认窗口铺（但上层必须如实说明用了默认值）', () => {
  const tasks = goalToTasks(slotsOf({ dateFrom: '2026-09-21' }), SCHEDULE, TODAY);
  assert.ok(tasks.length > 0);
  assert.equal(DEFAULT_GOAL_SPAN_DAYS, 21, '默认窗口改了就要一并复核这里的期望');
});

/* ============================================================
 * 二、checkGoalFeasibility：干跑把关
 * ========================================================== */

test('把关：槽位不齐 → 只追问，绝不动手', () => {
  const slots = parseIntentSlots('帮我安排数学建模备赛', TODAY); // 缺时间 / 缺投入
  const v = checkGoalFeasibility({ slots, schedule: SCHEDULE, profile: null, weekNo: 3, today: TODAY });

  assert.equal(v.kind, 'needs_clarification');
  assert.ok(v.questions.length > 0 && v.questions.length <= 2, '一次最多问两条');
  assert.equal(v.placedCount, 0, '信息不全却排了块');

  // 追问顺序：先把「做什么/对象」弄清，再问时间
  assert.match(v.questions[0], /哪件事|什么时候|投入/);
});

test('把关：没有课表 / 周次不在学期内 → 如实说排不了', () => {
  const slots = slotsOf(WIN);
  assert.equal(
    checkGoalFeasibility({ slots, schedule: null, profile: null, weekNo: 3, today: TODAY }).kind,
    'infeasible',
  );
  assert.equal(
    checkGoalFeasibility({ slots, schedule: SCHEDULE, profile: null, weekNo: 99, today: TODAY }).kind,
    'infeasible',
  );
});

test('把关：纯函数 —— 干跑不落盘，两次结果完全一致', () => {
  const args = { slots: slotsOf(WIN), schedule: SCHEDULE, profile: null, weekNo: 4, today: TODAY };
  assert.deepEqual(checkGoalFeasibility(args), checkGoalFeasibility(args));
});

test('把关：排得下 → 有落点，且落点条数与落块数对得上', () => {
  const v = checkGoalFeasibility({
    slots: slotsOf({ ...WIN, totalHours: 3, durationMin: 60 }),
    schedule: SCHEDULE,
    profile: null,
    weekNo: 4,
    today: TODAY,
  });
  assert.ok(['ok', 'tight', 'conflict'].includes(v.kind), `意外结论：${v.kind}`);
  assert.ok(v.placedCount > 0, '一个学期内的正常诉求应当排得下');
  assert.equal(v.placedAt.length, v.placedCount, '落点条数和落块数对不上 = 回显会骗人');
  for (const p of v.placedAt) assert.match(p, /^周[一二三四五六日] \d{2}:\d{2}-\d{2}:\d{2}$/);
});

test('把关：诚实性 —— 目标量超过窗口容量时必须说「放不下」，不能静默只排一部分', () => {
  // 反向验证锚点：删掉「窗口容量」那段检查，本用例立刻变红。
  // 这是「看起来排上了、其实差得远」的堵口 —— 比直接说排不下更该防。
  const v = checkGoalFeasibility({
    slots: slotsOf({ ...WIN, totalHours: 2000, durationMin: 60 }),
    schedule: SCHEDULE,
    profile: null,
    weekNo: 4,
    today: TODAY,
  });
  assert.equal(v.kind, 'conflict', '2000 小时塞进 21 天却没报冲突');
  assert.ok(
    v.caveats.some((c) => /放得下|还差/.test(c)),
    `没把差多少说清楚，只说：${JSON.stringify(v.caveats)}`,
  );
});

test('把关：用了默认窗口 / 时间待定 / 没给地点，都必须如实标注', () => {
  const v = checkGoalFeasibility({
    slots: slotsOf({ dateFrom: '2026-09-21', certainty: 'unknown' }), // 无 dateTo → 默认窗口
    schedule: SCHEDULE,
    profile: null,
    weekNo: 4,
    today: TODAY,
  });
  const all = v.caveats.join('\n');
  assert.match(all, /窗口/, '用了默认窗口却没说');
  assert.match(all, /预估/, '用户说了没定，却当成已定');
  assert.match(all, /地点/, '没给地点却没说转场是估的');
});

test('把关：既有任务必须在场 —— 基线失真会把「挤掉别的块」当成没影响', () => {
  // 塞一个占满用户整天空档的固定块，再排目标：结论应当比空表时更紧
  const heavy = [
    {
      id: 'u-fixed-1', title: '占位块', emoji: '📌',
      dayOfWeek: 1, startMin: 9 * 60, durationMin: 8 * 60,
    },
    {
      id: 'u-fixed-2', title: '占位块2', emoji: '📌',
      dayOfWeek: 3, startMin: 9 * 60, durationMin: 8 * 60,
    },
  ];
  const slots = slotsOf({ ...WIN, totalHours: 9, durationMin: 60 });
  const bare = checkGoalFeasibility({ slots, schedule: SCHEDULE, profile: null, weekNo: 4, today: TODAY });
  const loaded = checkGoalFeasibility({
    slots, schedule: SCHEDULE, profile: null, weekNo: 4, today: TODAY, tasks: heavy,
  });
  assert.ok(
    loaded.placedCount <= bare.placedCount,
    '带既有任务时落块反而更多，说明基线没算进去',
  );
});

test('把关：草稿文案给选项、不替用户拍板（core §4 的 L4 边界）', () => {
  const infeasible = checkGoalFeasibility({
    slots: slotsOf(WIN), schedule: null, profile: null, weekNo: 3, today: TODAY,
  });
  const text = describeVerdict(infeasible).join('\n');
  assert.match(text, /可以：/, '排不下时必须给出可选项');
  assert.ok(!/你应该|你必须/.test(text), '替用户拍板了');
});

/* ============================================================
 * 三、接线：tasks 真的进到引擎里了吗
 * ========================================================== */

test('接线：任务经 planWeekWithTasks 真的落进引擎输出（此前这条路是断的）', async () => {
  const slots = slotsOf({ ...WIN, totalHours: 3, durationMin: 60 });
  const tasks = goalToTasks(slots, SCHEDULE, TODAY);
  assert.ok(tasks.length > 0);

  const without = await planWeekWithTasks(SCHEDULE, null, 4, []);
  const withThem = await planWeekWithTasks(SCHEDULE, null, 4, tasks);
  assert.ok(without && withThem, '第 4 周在本学期内，应当排得出计划');

  const title = slots.title;
  assert.ok(
    !without.blocks.some((b) => b.title === title),
    '没传任务却出现了这个块 —— 夹具串了',
  );
  assert.ok(
    withThem.blocks.some((b) => b.title === title),
    '任务传进了引擎却没出现在计划里 —— tasks 通道还是断的',
  );
});

test('接线：周次不在学期内 → 返回 null（上层应降级为引导，不许编日程）', async () => {
  const p = await planWeekWithTasks(SCHEDULE, null, 99, []);
  assert.equal(p, null);
});
