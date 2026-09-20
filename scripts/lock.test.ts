/**
 * 锁闭环测试（PR-1）
 * 跑法：npm run test:ui
 *
 * 测的是「锁」这条承诺：**用户确认过的块，重排时回到原位**。
 *
 * ⚠️ 为什么必须单独测，而不是靠 `lockLevels` 单测：
 *    `construct` 不读锁、`improve` 只是不主动移动 hard 块 ——
 *    「锁生效」是**两段拼起来**的结果，任何一段缺失都只有跑整条 `solveWeek` 才看得出来。
 *    本文件的第 1 条测试就是为这个而写（它会在 `applyLockedPlacements` 被删掉时变红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reattachTransfers, solveWeek, stablePlanJson } from '@/lib/planner/solver.ts';
import type { PhasePolicy, TimeBlock, WeekPlan } from '@/types';

/* ---------------- 夹具 ---------------- */

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}
function slot(dayOfWeek: number, startPeriod: number, endPeriod: number, weeks = range(1, 20)) {
  return { dayOfWeek, startPeriod, endPeriod, weeks };
}

/** 一份最小课表：周一、周三上午各一门课，其余时间空着（留出自习块） */
const schedule = {
  semesterName: '2026-2027-1', semesterType: 'autumn',
  termStart: '2026-09-07', totalWeeks: 20, source: 'demo',
  courses: [
    {
      id: 'c1', name: '高等数学', credit: 3, category: '公共基础',
      campus: '北校', building: '第一教学楼',
      slots: [slot(1, 1, 2), slot(3, 1, 2)],
    },
  ],
};

const policy: PhasePolicy = {
  dailyStudyMin: 120, maxBlockMin: 60, blankRatio: 0.25,
  eveningAllowed: false, weekendWork: false,
  studyPlaces: ['图书馆（图文信息中心）'],
};

/** 固定转场桩：不走后端，保证测试离线可跑、且确定性 */
const stubTransfer = () => ({ minutes: 5, source: 'stub', reliable: true });

/**
 * 「改变输入」用的那一版策略：**放开晚间 + 允许周末**。
 *
 * 为什么用它（2026-09-19 用探针搜出来的，试了 10 组加课 + 3 组策略变化）：
 *   它得同时满足三个条件 ——
 *     · **A 有自习块被挤走**：否则测不出锁有没有用；
 *     · **B 被挤走那块的原时间在新布局里完全空着**：否则锁回去会撞别的东西，
 *       测的就变成「冲突上报」而不是「锁生效」；
 *     · **C 同一天还有别的块也跟着变**：否则测不出「锁一块不冻结整天」。
 *
 * ⚠️ 为什么不用「加课」：探针实测，加课会**连锁推动**整天的块，
 *    导致目标块的原位置总被别的块占掉（B 不满足）——
 *    包括原先的「周一 9-10 节」和试过的 5-6 / 7-8 / 11-12 节，全部如此。
 *
 * ⚠️ 断言**不写死是哪一个块**（见测试体）：写死具体块的做法一旦布局变化就假失败。
 *    现在动态找出「确实被挤走的那个」，夹具对别处的改动免疫。
 */
const changedPolicy = { ...policy, eveningAllowed: true, weekendWork: true };

/** 变化后的请求（所有「改变输入」的测试都走它） */
function changedReq(over: Record<string, unknown> = {}) {
  return baseReq({ policy: changedPolicy, ...over });
}

function baseReq(over: Record<string, unknown> = {}) {
  return {
    schedule, weekNo: 4, policy, scenarios: null,
    commits: [], tasks: [], transfer: stubTransfer,
    ...over,
  } as never;
}

/** 取「改变输入后会被挤走」的那个块：周一较晚的那个自习块 */
function pickStudy(plan: WeekPlan, day = 1): TimeBlock {
  const list = plan.blocks
    .filter((x) => x.kind === 'study' && x.dayOfWeek === day)
    .sort((a, b) => a.startMin - b.startMin);
  assert.ok(list.length >= 2, `夹具应至少在周${day}排出 2 个自习块，实际 ${list.length}`);
  return list[list.length - 1];
}

function placementOf(b: TimeBlock) {
  return {
    dayOfWeek: b.dayOfWeek, startMin: b.startMin, endMin: b.endMin,
    place: b.place, room: b.room, title: b.title,
  };
}

const lockedReq = (target: TimeBlock, over: Record<string, unknown> = {}) => changedReq({
  lockLevels: { [target.id]: 'hard' },
  lockedPlacements: { [target.id]: placementOf(target) },
  ...over,
});

/* ---------------- 一、锁生效 ---------------- */

test('锁定的块在重排后回到原位（不锁则会动）', () => {
  const p0 = solveWeek(baseReq()).plan;
  const changed = solveWeek(changedReq()).plan;

  /**
   * 动态找出「确实被这次输入变化挤走的那个块」。
   *
   * 为什么不再写死 `pickStudy(p0)`（周一最后一个自习块）：
   * 那种写法把「哪个块会动」硬编码进夹具 —— 一旦别处的改动改变了布局，
   * 测试就会以「前提不成立」假失败，报的不是功能坏了，而是夹具过期了。
   * 改成动态查找后，夹具对布局变化免疫（这正是 2026-09-19 修它的原因）。
   */
  const before = new Map(p0.blocks.map((b) => [b.id, b]));
  const moved = changed.blocks.find((b) => {
    const old = before.get(b.id);
    return old != null && old.kind === 'study' && old.startMin !== b.startMin;
  });
  assert.ok(moved, '夹具前提不成立：这次输入变化没有让任何自习块移动');

  // 先证明「不锁真的会动」—— 否则本测试在锁失效时也会通过（假覆盖）
  const original = before.get(moved.id)!;
  assert.notEqual(
    moved.startMin, original.startMin,
    `夹具前提不成立：不加锁时该块也没动（${original.startMin}），测试无法区分锁是否生效`,
  );

  // 再加锁重排 → 必须回到原位
  const locked = solveWeek(lockedReq(original)).plan.blocks.find((b) => b.id === original.id);

  assert.ok(locked, '锁定后该块仍应存在');
  assert.equal(locked.startMin, original.startMin, '锁定的块应回到原开始时间');
  assert.equal(locked.endMin, original.endMin, '锁定的块应保持原时长');
  assert.equal(locked.place, original.place, '地点应一并还原（时间与地点是一体的）');
});

test('锁只钉住那一块，同一天的其他块照常跟着新输入变（不是整周冻结）', () => {
  const p0 = solveWeek(baseReq()).plan;
  const changed = solveWeek(changedReq()).plan;
  const before = new Map(p0.blocks.map((b) => [b.id, b]));

  // 动态找「一个会被挤走的自习块」来锁（理由同前一条：不写死具体是哪个）
  const victim = changed.blocks.find((b) => {
    const old = before.get(b.id);
    return old != null && old.kind === 'study' && old.startMin !== b.startMin;
  });
  assert.ok(victim, '夹具前提不成立：这次变化没有移动任何自习块');
  const original = before.get(victim.id)!;

  const out = solveWeek(lockedReq(original)).plan;

  // ① 被锁的块回到原位
  assert.equal(
    out.blocks.find((b) => b.id === original.id)?.startMin, original.startMin,
    '前提：被锁的块回到原位',
  );

  /**
   * ② 同一天**还有别的块确实跟着新输入走了** —— 这才说明锁没有把整天冻住。
   *
   * 判据是「它此刻的位置 == 它在『无锁变化版』里的位置」：
   * 只要有一个未锁的块在基线里与新输入下位置不同、且现在取的是新位置，
   * 就证明它照常响应了新输入，没被锁牵连。
   */
  const stillFollowing = out.blocks.some((b) => {
    if (b.dayOfWeek !== original.dayOfWeek || b.id === original.id) return false;
    const c = changed.blocks.find((x) => x.id === b.id);
    const o = before.get(b.id);
    return c != null && o != null && c.startMin !== o.startMin && b.startMin === c.startMin;
  });
  assert.ok(
    stillFollowing,
    '锁一块不该把整天冻住：同一天未锁的块仍应随新输入调整位置',
  );
});

/* ---------------- 二、冲突必须如实上报，不许静默挪走 ---------------- */

test('锁定位置被新课占掉时不恢复，并给出 lock-conflict 问题', () => {
  const p0 = solveWeek(baseReq()).plan;
  // 用周一**较早**的那个自习块（12:55）+ 周一 5-6 节的加课 ——
  // 实测这门课正好压住 12:55–13:55，是「锁的原地被占」的真实场景。
  const target = p0.blocks
    .filter((b) => b.kind === 'study' && b.dayOfWeek === 1)
    .sort((a, b) => a.startMin - b.startMin)[0];
  assert.ok(target, '夹具应有周一自习块');

  const covered = {
    ...schedule,
    courses: [
      ...schedule.courses,
      {
        id: 'c9', name: '专题讲座', credit: 0, category: '公共基础',
        campus: '北校', building: '第一教学楼',
        slots: [slot(1, 5, 6)],
      },
    ],
  };

  const out = solveWeek(baseReq({
    schedule: covered,
    lockLevels: { [target.id]: 'hard' },
    lockedPlacements: { [target.id]: placementOf(target) },
  })).plan;

  const issue = out.issues.find((i) => i.code === 'lock-conflict');
  assert.ok(issue, `冲突时应产出 lock-conflict 问题，实际 issues：${JSON.stringify(out.issues.map((i) => i.code))}`);
  assert.match(issue.message, /你锁定的/);
  assert.equal(issue.level, 'warn');

  // 冲突下必须**如实**：块不再停在原位（否则用户会以为锁生效了，实际是被课程盖住）
  const after = out.blocks.find((b) => b.id === target.id);
  assert.ok(!after || after.startMin !== target.startMin, '冲突时不该假装还原成功');
});

test('锁定的块这次没排出来时，也要说一声（不静默）', () => {
  const p0 = solveWeek(baseReq()).plan;
  const target = pickStudy(p0);
  const snap = placementOf(target);

  // 用一个不存在的 id 制造「排不出来」：锁等级 + 快照都在，但计划里没有这个块
  const out = solveWeek(baseReq({
    lockLevels: { 'w4-d9-study-nope-1': 'hard' },
    lockedPlacements: { 'w4-d9-study-nope-1': { ...snap, dayOfWeek: 9, title: '幽灵自习' } },
  })).plan;

  const issue = out.issues.find((i) => i.code === 'lock-conflict');
  assert.ok(issue, '排不出来时必须给出提示，不能静默');
  assert.match(issue.message, /幽灵自习/);
  assert.equal(issue.level, 'info', '这条更可能是用户自己的改动造成的，不该和真冲突同等报警');
});

/* ---------------- 三、转场必须按「当前位置」重算 ---------------- */

test('reattachTransfers：块被移动后，转场按新位置重算（不留旧值）', () => {
  // 为什么直接单测这个函数、而不是端到端测：
  //   实测这套夹具下 `improve` 一次都没接受改动（`accepted = 0`），
  //   端到端根本走不到「移动后转场失效」的场景 —— 那样的测试即使把
  //   `reattachTransfers` 整个删掉也照样通过（我验证过，确实是假覆盖）。
  //   所以这里**手工挪块**来复现 improve 的效果。
  const plan = solveWeek(baseReq()).plan;
  const day = 1;
  const victim = plan.blocks
    .filter((b) => b.kind === 'study' && b.dayOfWeek === day)
    .sort((a, b) => a.startMin - b.startMin)
    .pop();
  assert.ok(victim, '夹具应有周一下午的自习块');

  /**
   * ① 挪到**上午课程之后**：前序块变成「第一节课」，转场必须跟着变。
   *
   * ⚠️ 原先挪到「傍晚 18:00」，靠「晚餐」当前序块 —— 但 T2 之后三餐不再指定食堂，
   *    餐次块没有 `place`，于是「转场来源 = 前序块的地点」这条断言失去依据。
   *    改成课程块当前序：**课程永远有地点**，这个夹具不会再被餐次的改动波及。
   */
  const toMorning = 10 * 60;
  const shifted = {
    ...plan,
    blocks: plan.blocks.map((b) => (b.id === victim.id
      ? { ...b, startMin: toMorning, endMin: toMorning + 60 } : { ...b })),
  };
  const out = reattachTransfers(shifted, stubTransfer);
  const after = out.blocks.find((b) => b.id === victim.id)!;
  const prev = out.blocks
    .filter((b) => b.dayOfWeek === day && b.id !== victim.id && b.endMin <= after.startMin)
    .sort((a, b) => b.endMin - a.endMin)[0];
  assert.ok(prev, '上午位置应有前序块（第一节课）');
  // 夹具前提：前序块必须有地点 —— 否则 `fromPlace` 的断言等于没测
  assert.ok(prev.place, '夹具前提不成立：前序块没有地点，测不出转场来源');
  assert.equal(after.transfer?.fromPlace, prev.place, '转场来源必须指向新的前序块');
  assert.equal(
    after.transfer?.slackMin,
    Math.round((after.startMin - prev.endMin) - (after.transfer?.minutes ?? 0)),
    '余量必须按新 gap 重算',
  );

  // ② 挪成当天第一个块：它不该再有转场（旧的那条必须被清掉）
  const firstOfDay = 5 * 60;
  const early = reattachTransfers({
    ...plan,
    blocks: plan.blocks.map((b) => (b.id === victim.id
      ? { ...b, startMin: firstOfDay, endMin: firstOfDay + 60 } : { ...b })),
  }, stubTransfer);
  const earlyBlock = early.blocks.find((b) => b.id === victim.id)!;
  assert.equal(earlyBlock.transfer, undefined, '当天第一个块不该挂转场（旧值必须清掉）');

  // ③ 幂等：再跑一次不改变结果，也不重复堆问题
  const again = reattachTransfers(out, stubTransfer);
  assert.deepEqual(again.issues, out.issues, '重复重挂不该累积重复问题');
  assert.deepEqual(reattachTransfers(again, stubTransfer).issues, out.issues);
});

/* ---------------- 四、确定性 ---------------- */

test('同样的输入（含锁）两次求解结果一致', () => {
  const p0 = solveWeek(baseReq()).plan;
  const target = pickStudy(p0);
  const req = lockedReq(target);
  assert.equal(stablePlanJson(solveWeek(req)), stablePlanJson(solveWeek(req)));
});
