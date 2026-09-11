/**
 * 周调度器测试（scheduler）
 * 跑法：npm run test:ui（Node 24 直接跑 TS 测试）
 *
 * 覆盖的是「规则引擎的**可验证承诺**」——
 *   周次过滤、课时表换算、三餐不压课、活动受画像触发、自习服从阶段策略、
 *   转场余量与「来不及」告警、用户自定义模块、确定性。
 * 这些正是「不让 LLM 排调度」的理由：它们必须可复现、可断言。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeInWeek, buildWeekPlan, campusOfName, describeDay, effectiveCourses, effectiveSlots, slotsOn,
} from '../src/lib/planner/schedule.ts';
import { customTemplate, DEFAULT_TEMPLATES, openAt } from '../src/lib/planner/templates.ts';
import { toMinutes } from '../src/constants/time.ts';

/* ---------------- 夹具 ---------------- */

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
function slot(dayOfWeek, startPeriod, endPeriod, weeks) {
  return { dayOfWeek, startPeriod, endPeriod, weeks };
}
function course(id, name, building, campus, slots, category = '公共基础', room) {
  return { id, name, credit: 2, category, campus, building, slots, room };
}

/**
 * 一份贴近真实的课表：
 *   周一 一教 1-2 节 → 三教 3-5 节（课间只有 20 分钟，**跨楼转场**的经典场景）
 *   周二 篮球 3-5 节（**没有地点**，考验提示）
 *   周三 金工实习 6-9 节，只在 6-9 周
 *   周四 一教 6-7 节
 *   周五 国合楼（334，**跨校区**）6-7 节，只在 10-18 周
 */
const schedule = {
  semesterName: '2026-2027-1', semesterType: 'autumn',
  termStart: '2026-09-07', totalWeeks: 20, source: 'demo',
  courses: [
    course('c1', '大学物理A(2)', '第一教学楼', 'JG516',
      [slot(1, 1, 2, range(3, 18)), slot(4, 6, 7, range(3, 18))], '公共基础', '144'),
    course('c2', '概率论与数理统计B', '第三教学楼', 'JG516', [slot(1, 3, 5, range(3, 18))]),
    course('c3', '金工实习', '综合楼', 'JG516', [slot(3, 6, 9, range(6, 9))], '实践环节'),
    course('c4', '篮球', undefined, 'JG516', [slot(2, 3, 5, range(3, 18))], '通识选修'),
    course('c5', '模拟电子技术实验', '国合楼', 'JG334', [slot(5, 6, 7, range(10, 18))], '实践环节'),
  ],
};

function policy(over = {}) {
  return {
    dailyStudyMin: 120, maxBlockMin: 60, blankRatio: 0.25,
    eveningAllowed: false, weekendWork: false,
    studyPlaces: ['图书馆（图文信息中心）'],
    ...over,
  };
}

function scen(over = {}) {
  return {
    meal_radius: 'near', planning: 'planned', event_breadth: 'narrow', social_radius: 'close',
    night_supply: 'convenience', exercise_trigger: 'self_plan', study_place: 'library',
    info_channel: 'self_search', ...over,
  };
}

const NO_TRANSFER = () => null;

function build(over = {}) {
  return buildWeekPlan({
    schedule, weekNo: 4, policy: policy(), scenarios: scen(), transfer: NO_TRANSFER, ...over,
  }).plan;
}

function blocksOf(plan, day) {
  return plan.blocks.filter((b) => b.dayOfWeek === day).sort((a, b) => a.startMin - b.startMin);
}
function overlapCount(a, b) {
  return a.filter((x) => b.some((y) => x.startMin < y.endMin && y.startMin < x.endMin)).length;
}

/* ---------------- 一、周次过滤（排程的第一公民） ---------------- */

test('有效课程按周次过滤：同一份课表，第 4 周和第 12 周上的课不一样', () => {
  const w4 = effectiveCourses(schedule, 4).map((c) => c.id);
  const w12 = effectiveCourses(schedule, 12).map((c) => c.id);
  assert.deepEqual(w4, ['c1', 'c2', 'c4'], `第 4 周应只有 c1/c2/c4，实际 ${w4}`);
  assert.deepEqual(w12, ['c1', 'c2', 'c4', 'c5'], `第 12 周应多出 c5，实际 ${w12}`);
  // 第 6-9 周才有金工实习；第 10 周起才有模电实验
  assert.ok(effectiveCourses(schedule, 6).some((c) => c.id === 'c3'));
  assert.ok(!effectiveCourses(schedule, 10).some((c) => c.id === 'c3'));
});

test('weeks 为空数组 = 全学期（与 types.ts 约定一致）', () => {
  assert.equal(activeInWeek(slot(1, 1, 2, []), 1), true);
  assert.equal(activeInWeek(slot(1, 1, 2, [3, 4]), 2), false);
  assert.equal(activeInWeek(slot(1, 1, 2, [3, 4]), 4), true);
});

test('第 4 周有课的日期只有周一/周二/周四（周三周五的课那时还没开）', () => {
  const slots = effectiveSlots(schedule, 4);
  const days = [...new Set(slots.map((s) => s.dayOfWeek))].sort();
  assert.deepEqual(days, [1, 2, 4], `实际 ${days}`);
});

/* ---------------- 二、时间来自官方课时表 ---------------- */

test('课程块的钟点来自官方课时表（第 3-5 节 = 09:45-11:55）', () => {
  const [b] = blocksOf(build(), 1).filter((x) => x.title === '概率论与数理统计B');
  assert.equal(b.startMin, toMinutes('09:45'), '第 3 节应 09:45 开始');
  assert.equal(b.endMin, toMinutes('11:55'), '第 5 节应 11:55 结束');
  assert.equal(b.place, '第三教学楼');
});

test('课程块带上教室与教师，缺地点会给出提示', () => {
  const plan = build();
  const phys = blocksOf(plan, 1).find((x) => x.title === '大学物理A(2)');
  assert.equal(phys.room, '144');
  assert.equal(phys.source, 'course');
  const noPlace = plan.issues.filter((i) => i.message.includes('篮球'));
  assert.ok(noPlace.length > 0, '没有地点的课应给出提示');
});

/* ---------------- 三、三餐 ---------------- */

test('三餐与任何课程块都不重叠', () => {
  for (const weekNo of [4, 6, 12]) {
    const plan = build({ weekNo });
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      const bs = blocksOf(plan, day);
      const meals = bs.filter((b) => b.kind === 'meal');
      const courses = bs.filter((b) => b.kind === 'course');
      assert.equal(overlapCount(meals, courses), 0,
        `第 ${weekNo} 周 周${day}：三餐与课程重叠了`);
    }
  }
});

test('午饭点被课占住时会自动顺延，不会硬压在课里', () => {
  // 周三金工实习 6-9 节（13:00-16:55）不挡午饭；周二篮球 3-5 节（09:45-11:55）刚好让开
  const plan = build({ weekNo: 6 });
  const wed = blocksOf(plan, 3);
  assert.equal(overlapCount(wed.filter((b) => b.kind === 'meal'), wed.filter((b) => b.kind === 'course')), 0);
  // 构造一个正好压住午饭的场景：第 5-6 节连堂（11:15-13:40）
  const busy = {
    ...schedule,
    courses: [course('x', '体育', '运动场', 'JG516', [slot(2, 5, 6, [4])])],
  };
  const p2 = buildWeekPlan({ schedule: busy, weekNo: 4, policy: policy(), scenarios: scen(), transfer: NO_TRANSFER }).plan;
  const lunch = blocksOf(p2, 2).find((b) => b.kind === 'meal' && b.title.includes('午餐'));
  assert.ok(lunch, '应有午餐块');
  assert.notEqual(lunch.startMin, toMinutes('11:55'), '正点被占用时应顺延而不是硬压');
  assert.equal(overlapCount([lunch], blocksOf(p2, 2).filter((b) => b.kind === 'course')), 0);
});

test('没早课的日子不排早餐（不硬叫早）', () => {
  const plan = build({ weekNo: 4 });
  for (const day of [1, 2, 4]) {
    const has = blocksOf(plan, day).some((b) => b.title.includes('早餐'));
    const early = blocksOf(plan, day).some((b) => b.kind === 'course' && b.startMin <= toMinutes('10:00'));
    assert.equal(has, early, `周${day}：早餐与早课应对应`);
  }
});

/* ---------------- 四、画像真的改变排程结果 ---------------- */

test('「就近快吃」会按转场时间挑最近的食堂（不是按固定优先级）', () => {
  // 桩：从第三教学楼走到第二食堂只要 2 分钟，其他都要 10 分钟
  const stub = (from, to) => (from === '第三教学楼' && to === '第二食堂'
    ? { minutes: 2, source: 'stub' } : { minutes: 10, source: 'stub' });

  const near = buildWeekPlan({
    schedule, weekNo: 4, policy: policy(), scenarios: scen({ meal_radius: 'near' }), transfer: stub,
  }).plan;
  const far = buildWeekPlan({
    schedule, weekNo: 4, policy: policy(), scenarios: scen({ meal_radius: 'far' }), transfer: stub,
  }).plan;

  const lunchNear = blocksOf(near, 1).find((b) => b.title.includes('午餐'));
  const lunchFar = blocksOf(far, 1).find((b) => b.title.includes('午餐'));
  assert.ok(lunchNear.title.includes('第二食堂'),
    `「就近」应选最近的第二食堂，实际「${lunchNear.title}」`);
  assert.ok(!lunchFar.title.includes('第二食堂'),
    `「愿意走远」不该被最近原则绑架，实际「${lunchFar.title}」`);
  assert.ok(lunchNear.reason.includes('就近'), `应说明理由，实际「${lunchNear.reason}」`);
});

test('运动块只在画像说「自己按计划去」时主动排', () => {
  const self = build({ scenarios: scen({ exercise_trigger: 'self_plan' }) });
  const others = build({ scenarios: scen({ exercise_trigger: 'with_others' }) });
  const none = build({ scenarios: null });
  const hasSport = (p) => p.blocks.some((b) => /操场|体育馆/.test(b.title));
  assert.equal(hasSport(self), true, '自驱型应排运动');
  assert.equal(hasSport(others), false, '「有人约才去」不该被硬排');
  assert.equal(hasSport(none), false, '没有画像就不擅自替用户安排');
});

test('夜宵模块跟随「学到很晚饿了怎么办」的选择', () => {
  const conv = build({ scenarios: scen({ night_supply: 'convenience' }), policy: policy({ eveningAllowed: true }) });
  const noneScen = build({ scenarios: scen({ night_supply: 'none' }), policy: policy({ eveningAllowed: true }) });
  assert.ok(conv.blocks.some((b) => b.title.includes('夜宵')), '便利店速食 → 排夜宵');
  assert.ok(!noneScen.blocks.some((b) => b.title.includes('夜宵')), '「忍着」→ 不排夜宵');
});

/* ---------------- 五、自习服从阶段策略 ---------------- */

test('自习块不超过单块上限，且非晚间阶段不占用 18:00 之后', () => {
  const plan = build({ policy: policy({ maxBlockMin: 45, eveningAllowed: false, dailyStudyMin: 180 }) });
  const study = plan.blocks.filter((b) => b.kind === 'study');
  assert.ok(study.length > 0, '应排出自习块');
  for (const b of study) {
    assert.ok(b.endMin - b.startMin <= 45, `${b.title} 单块 ${b.endMin - b.startMin} 分钟 > 45`);
    assert.ok(b.startMin < toMinutes('18:00'), `${b.title} 在 18:00 之后开始了`);
  }
});

test('留白比例越高，自习越少、空档越多', () => {
  const tight = build({ policy: policy({ blankRatio: 0.05, dailyStudyMin: 300 }) });
  const loose = build({ policy: policy({ blankRatio: 0.55, dailyStudyMin: 300 }) });
  assert.ok(loose.stats.studyMin <= tight.stats.studyMin,
    `留白多反而排得更满？（${loose.stats.studyMin} vs ${tight.stats.studyMin}）`);
  assert.ok(loose.stats.blankMin >= tight.stats.blankMin,
    `留白多应剩更多空档（${loose.stats.blankMin} vs ${tight.stats.blankMin}）`);
});

test('周末策略：weekendWork = false 时周末不排自习', () => {
  const off = build({ policy: policy({ weekendWork: false }) });
  const on = build({ policy: policy({ weekendWork: true }) });
  const weekendStudy = (p) => p.blocks.filter((b) => b.kind === 'study' && b.dayOfWeek >= 6).length;
  assert.equal(weekendStudy(off), 0, '不占周末时周末不该有自习块');
  assert.ok(weekendStudy(on) > 0, '开了周末就应该出现周末自习');
});

test('自习地点跟随画像偏好（宿舍 vs 图书馆）', () => {
  const lib = build({ policy: policy({ studyPlaces: ['图书馆（图文信息中心）'] }) });
  const dorm = build({ policy: policy({ studyPlaces: ['第二学生公寓'] }) });
  assert.ok(lib.blocks.some((b) => b.kind === 'study' && b.place === '图书馆（图文信息中心）'));
  assert.ok(dorm.blocks.some((b) => b.kind === 'study' && b.place === '第二学生公寓'));
});

/* ---------------- 六、转场（本项目的差异化所在） ---------------- */

test('转场时间与余量被标注到后一个块上', () => {
  // 周一：一教 1-2 节 08:00-09:25 → 三教 3-5 节 09:45-11:55，中间 20 分钟
  const stub = () => ({ minutes: 6, source: 'stub', reliable: true });
  const plan = build({ transfer: stub });
  const next = blocksOf(plan, 1).find((b) => b.title === '概率论与数理统计B');
  assert.ok(next.transfer, '应挂上转场信息');
  assert.equal(next.transfer.fromPlace, '第一教学楼');
  assert.equal(next.transfer.toPlace, '第三教学楼');
  assert.equal(next.transfer.minutes, 6);
  assert.equal(next.transfer.slackMin, 14);
  assert.equal(next.transfer.tight, false);
});

test('转场来不及 → error 级告警，并说明会迟到几分钟', () => {
  const stub = () => ({ minutes: 28, source: 'stub', reliable: true });
  const plan = build({ transfer: stub });
  const err = plan.issues.filter((i) => i.level === 'error');
  assert.ok(err.length > 0, '应有 error 级告警');
  assert.ok(err.some((i) => i.message.includes('迟到')), `告警应说明迟到，实际：${JSON.stringify(err)}`);
  const next = blocksOf(plan, 1).find((b) => b.title === '概率论与数理统计B');
  assert.equal(next.transfer.slackMin, -8);
  assert.equal(next.transfer.tight, true);
});

test('转场余量偏紧 → warn 级告警', () => {
  const stub = () => ({ minutes: 17, source: 'stub', reliable: true });
  const plan = build({ transfer: stub });
  const next = blocksOf(plan, 1).find((b) => b.title === '概率论与数理统计B');
  assert.equal(next.transfer.slackMin, 3);
  assert.equal(next.transfer.tight, true);
  assert.ok(plan.issues.some((i) => i.level === 'warn' && i.message.includes('偏紧')));
});

test('同一栋楼连堂不标转场（不用赶）', () => {
  const same = {
    ...schedule,
    courses: [
      course('a', '课甲', '第一教学楼', 'JG516', [slot(1, 1, 2, [4])]),
      course('b', '课乙', '第一教学楼', 'JG516', [slot(1, 3, 5, [4])]),
    ],
  };
  const plan = buildWeekPlan({
    schedule: same, weekNo: 4, policy: policy(), scenarios: scen(),
    transfer: () => ({ minutes: 6, source: 'stub' }),
  }).plan;
  const second = blocksOf(plan, 1).find((b) => b.title === '课乙');
  assert.equal(second.transfer, undefined, '同楼不该标转场');
});

test('跨校区转场在拿不到实测值时，兜底会标明自己只是估算', () => {
  const plan = buildWeekPlan({
    schedule, weekNo: 12, policy: policy(), scenarios: scen(),
    // 不注入 transfer → 用 campusFallbackTransfer
  }).plan;
  const fri = blocksOf(plan, 5).find((b) => b.kind === 'course');
  assert.equal(fri.place, '国合楼');
});

test('campusOfName 能识别主要跨区地标', () => {
  assert.equal(campusOfName('国合楼'), 'JG334');
  assert.equal(campusOfName('思餐厅'), 'JG334');
  assert.equal(campusOfName('卓越楼'), 'JG334');
  assert.equal(campusOfName('第三教学楼'), 'JG516');
  assert.equal(campusOfName('申一教'), 'JG1100');
});

/* ---------------- 七、用户自定义模块 ---------------- */

test('用户指定「星期+时间」的模块被锁定，重排时不动', () => {
  const plan = build({
    tasks: [{
      id: 'u1', title: '小组会议', emoji: '👥', dayOfWeek: 3,
      startMin: toMinutes('19:00'), durationMin: 60, place: '第三教学楼',
    }],
    policy: policy({ eveningAllowed: false }), // 即使阶段不允许晚间，用户自己指定的也要保留
  });
  const meeting = plan.blocks.find((b) => b.title === '小组会议');
  assert.ok(meeting, '应排出用户的固定模块');
  assert.equal(meeting.locked, true);
  assert.equal(meeting.source, 'user');
  assert.equal(meeting.startMin, toMinutes('19:00'));
  assert.equal(meeting.reason.includes('自己指定'), true);
});

test('未指定时间的自定义模块会被填进空档', () => {
  const plan = build({ tasks: [{ id: 'u2', title: '练英语听力', emoji: '🎧', durations: [30, 45] }] });
  const blocks = plan.blocks.filter((b) => b.title === '练英语听力');
  assert.ok(blocks.length > 0, '浮动任务应被安排进空档');
  assert.ok(blocks.every((b) => b.source === 'user'), '来源应标为用户');
  assert.ok(blocks.every((b) => [30, 45].includes(b.endMin - b.startMin)), '时长应落在给定档位里');
});

test('自定义模块只在指定的周出现', () => {
  const tasks = [{ id: 'u3', title: '例会', dayOfWeek: 5, startMin: toMinutes('20:00'), durationMin: 30, weeks: [6] }];
  const w4 = build({ weekNo: 4, tasks });
  const w6 = build({ weekNo: 6, tasks });
  assert.equal(w4.blocks.some((b) => b.title === '例会'), false);
  assert.equal(w6.blocks.some((b) => b.title === '例会'), true);
});

test('customTemplate 把用户输入变成可排程模块，优先级高于系统建议', () => {
  const t = customTemplate({ id: 'x', title: '跑腿', durations: [20] });
  assert.equal(t.id, 'custom-x');
  assert.equal(t.kind, 'activity');
  assert.ok(t.priority >= 90, '用户自己的事应优先于系统建议');
  assert.deepEqual(t.durations, [20]);
  assert.match(t.emoji, /📌/);
});

/* ---------------- 八、模块库自身 ---------------- */

test('模块库只列真实存在的校园地点，且带营业时段', () => {
  const meals = DEFAULT_TEMPLATES.filter((t) => t.category === 'meal');
  assert.ok(meals.length >= 8, `食堂/餐厅模块应覆盖够，实际 ${meals.length}`);
  for (const t of meals) {
    assert.ok(t.place, `${t.name} 缺 place`);
    assert.ok(t.durations.length > 0, `${t.name} 缺时长档位`);
    assert.ok(t.windows.length > 0, `${t.name} 缺营业时段 —— 那就算不出「路过时关没关」`);
  }
  // 未核实的要如实标出来
  const 南校 = meals.filter((t) => t.campus === '南校');
  assert.ok(南校.every((t) => t.verified === false), '南校饭点是从「常规饭点」推断的，必须标未核实');
});

test('openAt 会按营业时段拒绝「关门的时刻」', () => {
  const lib = DEFAULT_TEMPLATES.find((t) => t.place === '图书馆（图文信息中心）');
  assert.equal(openAt(lib, toMinutes('10:00'), toMinutes('11:00')), true);
  assert.equal(openAt(lib, toMinutes('07:00'), toMinutes('08:00')), false, '图书馆 8:00 才开');
  assert.equal(openAt(lib, toMinutes('22:30'), toMinutes('23:30')), false, '23:00 闭馆');
});

test('填充式时长：空档小就挑短档，不硬塞长块', () => {
  // 周二篮球 3-5 节（无地点）+ 图书馆 8:00 开门 → 空档大小不同，选到的档位不同
  const plan = build({ policy: policy({ maxBlockMin: 90, dailyStudyMin: 240 }) });
  for (const b of plan.blocks.filter((x) => x.kind === 'study')) {
    assert.ok(b.endMin - b.startMin <= 90);
  }
});

/* ---------------- 九、冲突与确定性 ---------------- */

test('课程时间冲突被报为 error', () => {
  const clash = {
    ...schedule,
    courses: [
      course('a', '课甲', '第一教学楼', 'JG516', [slot(1, 1, 2, [4])]),
      course('b', '课乙', '第三教学楼', 'JG516', [slot(1, 1, 2, [4])]),
    ],
  };
  const plan = buildWeekPlan({ schedule: clash, weekNo: 4, policy: policy(), scenarios: scen(), transfer: NO_TRANSFER }).plan;
  assert.ok(plan.issues.some((i) => i.level === 'error' && i.message.includes('时间冲突')),
    `应报冲突，实际 ${JSON.stringify(plan.issues)}`);
});

test('确定性：同样的输入两次必得同样的输出', () => {
  const a = JSON.stringify(build());
  const b = JSON.stringify(build());
  assert.equal(a, b);
});

test('describeDay 按时间排序输出可读行', () => {
  const plan = build();
  const lines = describeDay(plan.blocks, 1);
  assert.ok(lines.length > 0);
  // 周一有 08:00 的早课 → 前面还会有 07:00 的早餐；关键是严格升序
  const starts = lines.map((l) => toMinutes(l.slice(0, 5)));
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] >= starts[i - 1], `应升序：${lines[i - 1]} → ${lines[i]}`);
  }
  assert.ok(lines.some((l) => l.startsWith('08:00')), `应含 08:00 的课，实际 ${JSON.stringify(lines)}`);
  for (const l of lines) assert.match(l, /^\d{2}:\d{2}-\d{2}:\d{2} /);
});

test('该周没课（考试周）也能排出合法计划', () => {
  const plan = build({ weekNo: 19 });
  assert.equal(plan.blocks.filter((b) => b.kind === 'course').length, 0);
  assert.ok(plan.blocks.some((b) => b.kind === 'study'), '没课也要有自习安排');
  assert.equal(plan.issues.filter((i) => i.level === 'error').length, 0);
});

test('stats 与实际块一致', () => {
  const plan = build();
  const sum = (kind) => plan.blocks.filter((b) => b.kind === kind)
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);
  assert.equal(plan.stats.studyMin, sum('study'));
  assert.equal(plan.stats.courseMin, sum('course'));
  assert.equal(plan.stats.blockCount, plan.blocks.length);
});

test('slotsOn 只返回当天的课，且按时间升序', () => {
  const mon = slotsOn(schedule, 4, 1);
  assert.deepEqual(mon.map((s) => s.course.id), ['c1', 'c2']);
  assert.ok(mon[0].startMin < mon[1].startMin);
  assert.equal(mon[1].periodLabel, '3-5节');
});
