/**
 * 排程引擎属性测试（P0，2026-09-19 · 究极测评体系 L6）
 * ============================================================
 * 只写「对**任意**合法输入都必须成立」的性质，不写具体用例 ——
 * 具体用例测"我想到的输入"，属性测试测"我想不到的输入"。
 *
 * 生成器纪律（防止假红）：
 *   · 课表**同一天的课程节次互不重叠**且 startPeriod 互异 —— 否则 construct
 *     会**正确地**报 time-conflict、正确地生成重叠的课程块，不重叠性质就会
 *     "因为输入本来就坏"而红，那是生成器的锅不是引擎的锅。
 *   · 全部 slots weeks=[]（全学期有效）→ 不引入周次过滤的额外分支。
 *   · 转场用**确定性桩**（不读网络、不读时钟；`buildWeekPlan` 是纯函数，
 *     由调用方注入转场 —— 与 tests/golden-inputs.ts 的冻结纪律一致）。
 *
 * ⚠️ 反向验证（必做，已实测）：把 `model.ts::blockId` 加计数器 → 性质 1+2 红；
 *    把 `construct.ts::fillStudy` 的落点从 `prev.endMin + need + SOFT_BUFFER_MIN`
 *    改成 `prev.endMin - SOFT_BUFFER_MIN` → 性质 3 红；
 *    把 course 块的 `courseId` 改成常量 → 性质 4 红。详见 PR 描述。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildWeekPlan } from '@/lib/planner/schedule.ts';
import type {
  Course, CourseTimeSlot, DayOfWeek, PhasePolicy, Schedule, TransferHint,
} from '@/types';

/* ---------------- 0. 常量与桩（离线、确定性） ---------------- */

const POLICY: PhasePolicy = {
  dailyStudyMin: 120,
  maxBlockMin: 60,
  blankRatio: 0.25,
  eveningAllowed: false,
  weekendWork: false,
  studyPlaces: ['图书馆（图文信息中心）'],
};

const BUILDINGS = ['第一教学楼', '第三教学楼', '国合楼'] as const;
const NAMES = ['高等数学', '大学英语', '模拟电子技术', 'C语言程序设计'] as const;

/** 确定性转场桩：不同地点一律 7 分钟（整数，避免舍入分支）。 */
const stubTransfer = (from: string, to: string): TransferHint | null =>
  from === to ? null
    : ({ fromPlace: from, toPlace: to, minutes: 7, slackMin: 0, tight: false, reliable: true, source: 'stub' });

/* ---------------- 1. 生成器：合法课表（同日不重叠、startPeriod 互异） ---------------- */

interface RawLecture { day: number; len: number }

/** 把一天的听课请求**顺序打包**成互不重叠、起点互异的节次（每讲之间空 1 节）。 */
function packDay(reqs: RawLecture[], courseStartIdx: number): Course[] {
  const out: Course[] = [];
  let cursor = 1;
  for (let i = 0; i < reqs.length && cursor <= 12; i += 1) {
    const len = Math.min(reqs[i].len, 12 - cursor + 1);
    const slot: CourseTimeSlot = {
      dayOfWeek: reqs[i].day as DayOfWeek,
      startPeriod: cursor,
      endPeriod: cursor + len - 1,
      weeks: [],            // 空数组 = 全学期有效
    };
    const bIdx = BUILDINGS[(courseStartIdx + i) % BUILDINGS.length];
    out.push({
      id: `c${courseStartIdx + i}`,
      name: NAMES[(courseStartIdx + i) % NAMES.length],
      credit: 2,
      category: '公共基础',
      campus: bIdx === '国合楼' ? 'JG334' : 'JG516',
      building: bIdx,
      slots: [slot],
    });
    cursor += len + 1;
  }
  return out;
}

const arbSchedule = (): fc.Arbitrary<Schedule> =>
  fc.nat({ max: 7 }).chain((n) => {
    // 每讲随机分到 1..5 天；同一天的请求由 packDay 顺序打包 → 天然合法
    const lectures: fc.Arbitrary<RawLecture>[] = [];
    for (let i = 0; i < n; i += 1) {
      lectures.push(fc.record({
        day: fc.integer({ min: 1, max: 5 }),
        len: fc.integer({ min: 1, max: 3 }),
      }));
    }
    return fc.tuple(...lectures);
  }).map((reqs) => ({
    semesterName: '测试学期',
    semesterType: 'autumn' as const,
    termStart: '2026-09-07',
    totalWeeks: 20,
    source: 'demo' as const,
    courses: packDay(reqs, 0),
  }));

const run = (s: Schedule) => buildWeekPlan({
  schedule: s, weekNo: 9, policy: POLICY, transfer: stubTransfer,
});

/* ============================================================
 * 性质 1 —— 确定性：同输入两次调用逐字段一致（含块 id 与 issues 顺序）。
 * 这是「块可锁定 / churn 可计量」的全部前提。
 * ========================================================== */
test('prop: 同输入两次 buildWeekPlan 逐字段一致', () => {
  fc.assert(fc.property(arbSchedule(), (s) => {
    const a = run(s);
    const b = run(s);
    assert.deepEqual(a.plan.blocks, b.plan.blocks);
    assert.deepEqual(a.plan.stats, b.plan.stats);
    assert.deepEqual(a.plan.issues, b.plan.issues);
    assert.deepEqual(a.notes, b.notes);
  }), { numRuns: 150 });
});

/* ============================================================
 * 性质 2 —— blockId 语义键纪律：唯一 + 形状 + **严禁含时间**。
 * 依据 model.ts §6.4：id 含时间 ⇒ 锁彻底失效 + churn 虚高（P1 前置条件）。
 * 正则在此**独立实现**（不用引擎的 BLOCK_ID_TIME_FRAGMENT_RE —— 那是被测方自己的尺子）。
 * ========================================================== */
test('prop: blockId 唯一、形状合规、语义键不含时间片段', () => {
  const TIMEISH = /\d{1,2}[:：]\d{2}/;   // 09:30
  const FRAGMENT = /-\d{3,4}-/;          // -540-（旧规则 day-kind-startMin-seq 的残留）
  fc.assert(fc.property(arbSchedule(), (s) => {
    const { plan } = run(s);
    const ids = plan.blocks.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, 'blockId 必须唯一');
    for (const id of ids) {
      assert.match(id, /^w9-d[1-7]-[a-z]+-.+$/, `id 形状不对：${id}`);
      const key = id.replace(/^w9-d[1-7]-[a-z]+-/, '');
      assert.ok(!TIMEISH.test(key), `语义键含时间：${id}`);
      assert.ok(!FRAGMENT.test(key), `语义键含 3-4 位数字片段：${id}`);
    }
  }), { numRuns: 150 });
});

/* ============================================================
 * 性质 3 —— 布局可行性：同天块互不重叠 + 零长块不存在 + 转场字段自洽。
 * 转场自洽依据 construct.ts::attachTransfers：
 *   slackMin = round(gap - minutes)、tight = slackMin < 5（gap = start - prev.end）。
 * ========================================================== */
test('prop: 同天块不重叠、无零长块、转场 slack/tight 与位置自洽', () => {
  fc.assert(fc.property(arbSchedule(), (s) => {
    const { plan } = run(s);
    for (const day of [1, 2, 3, 4, 5, 6, 7] as const) {
      const blocks = plan.blocks
        .filter((b) => b.dayOfWeek === day)
        .sort((a, b) => a.startMin - b.startMin);
      for (let i = 0; i < blocks.length; i += 1) {
        const b = blocks[i];
        assert.ok(b.endMin > b.startMin, `零长块：${b.id}`);
        if (i > 0) {
          const prev = blocks[i - 1];
          assert.ok(b.startMin >= prev.endMin,
            `d${day} 重叠：${prev.id}(${prev.startMin}-${prev.endMin}) vs ${b.id}(${b.startMin})`);
          if (b.transfer) {
            const gap = b.startMin - prev.endMin;
            const expectSlack = Math.round(gap - b.transfer.minutes);
            assert.equal(b.transfer.slackMin, expectSlack, `slackMin 不自洽：${b.id}`);
            assert.equal(b.transfer.tight, expectSlack < 5, `tight 判据不一致：${b.id}`);
          }
        }
      }
    }
  }), { numRuns: 150 });
});

/* ============================================================
 * 性质 4 —— 课程不漏：每一个「本周有效」的 (课程, 天, 节次) 都必须产出
 * 一个带该 courseId 的课程块 —— 课表引擎的天职，漏课是产品致命伤。
 * ========================================================== */
test('prop: 每个有效课程节次都产出对应课程块（课程不漏）', () => {
  fc.assert(fc.property(arbSchedule(), (s) => {
    const { plan } = run(s);
    for (const c of s.courses) {
      for (const slot of c.slots) {
        // 生成器保证「每课每天最多一讲」→ 只需断言 (courseId, day) 有课程块；
        // 节次→分钟的精确映射是 constants/time.ts 的职责，不在此猜。
        const hit = plan.blocks.some((b) =>
          b.kind === 'course' && b.courseId === c.id && b.dayOfWeek === slot.dayOfWeek);
        assert.ok(hit, `课程漏排：${c.name}(c${c.id}) d${slot.dayOfWeek} 第${slot.startPeriod}-${slot.endPeriod}节`);
      }
    }
  }), { numRuns: 150 });
});
