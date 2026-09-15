/**
 * Golden baseline 输入语料（T1.6 / A4）
 * 依据：`docs/scheduler-v2-spec.md` §9-T1.6（「合并后的旧引擎输出，只拍一次」）
 *
 * ⚠️ **本语料一旦拍过快照就冻结**：任何修改都会让既有 `tests/golden/*.json` 失效。
 *    要加场景 → **只增不改**（新 `name`），旧条目不得动。
 * ⚠️ 与 `scripts/scheduler.test.ts` 的同名夹具**有意分开**：那是 CY 的测试夹具，会随开发演进；
 *    黄金语料必须「钉死」。故此处**自持一份**，不 import `scripts/`。
 * ⚠️ 转场来源必须**确定性**：`'none'`（恒 null）或 `'campus'`（`campusFallbackTransfer`，纯函数）。
 *    禁止注入随机或读网络的 provider。
 */
import type { Course, CourseTimeSlot, PhasePolicy, ScenarioFields, Schedule, UserTask } from '@/types';
import type { BuildWeekPlanInput } from '@/lib/planner/schedule.ts';
import { campusFallbackTransfer } from '@/lib/planner/schedule.ts';

/* ---------------- 夹具工厂 ---------------- */

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

function slot(
  dayOfWeek: CourseTimeSlot['dayOfWeek'],
  startPeriod: number,
  endPeriod: number,
  weeks: number[],
): CourseTimeSlot {
  return { dayOfWeek, startPeriod, endPeriod, weeks };
}

function course(
  id: string,
  name: string,
  building: string | undefined,
  campus: Course['campus'],
  slots: CourseTimeSlot[],
  category = '公共基础',
  room?: string,
): Course {
  return { id, name, credit: 2, category, campus, building, slots, room };
}

/**
 * 一份贴近真实的课表（与 `scripts/scheduler.test.ts` 的夹具同构，但在此**冻结**）：
 *   周一 一教 1-2 节 → 三教 3-5 节（课间仅 20 分钟，跨楼转场）
 *   周二 篮球 3-5 节（**无地点**，考验提示）
 *   周三 金工实习 6-9 节，只在 6-9 周
 *   周四 一教 6-7 节
 *   周五 国合楼（JG334，**跨校区**）6-7 节，只在 10-18 周
 */
const SCHEDULE: Schedule = {
  semesterName: '2026-2027-1',
  semesterType: 'autumn',
  termStart: '2026-09-07',
  totalWeeks: 20,
  source: 'demo',
  courses: [
    course('c1', '大学物理A(2)', '第一教学楼', 'JG516',
      [slot(1, 1, 2, range(3, 18)), slot(4, 6, 7, range(3, 18))], '公共基础', '144'),
    course('c2', '概率论与数理统计B', '第三教学楼', 'JG516', [slot(1, 3, 5, range(3, 18))]),
    course('c3', '金工实习', '综合楼', 'JG516', [slot(3, 6, 9, range(6, 9))], '实践环节'),
    course('c4', '篮球', undefined, 'JG516', [slot(2, 3, 5, range(3, 18))], '通识选修'),
    course('c5', '模拟电子技术实验', '国合楼', 'JG334', [slot(5, 6, 7, range(10, 18))], '实践环节'),
  ],
};

function policy(over: Partial<PhasePolicy> = {}): PhasePolicy {
  return {
    dailyStudyMin: 120,
    maxBlockMin: 60,
    blankRatio: 0.25,
    eveningAllowed: false,
    weekendWork: false,
    studyPlaces: ['图书馆（图文信息中心）'],
    ...over,
  };
}

function scen(over: Partial<ScenarioFields> = {}): ScenarioFields {
  return {
    meal_radius: 'near',
    planning: 'planned',
    event_breadth: 'narrow',
    social_radius: 'close',
    night_supply: 'convenience',
    exercise_trigger: 'self_plan',
    study_place: 'library',
    info_channel: 'self_search',
    ...over,
  };
}

/* ---------------- 语料 ---------------- */

export interface GoldenInput {
  /** 稳定标识；同时是快照文件名 `tests/golden/<name>.json`（符合 §9 的 `week-*.json`） */
  name: string;
  /** 这个场景想钉住什么行为 */
  note: string;
  schedule: Schedule;
  weekNo: number;
  policy: PhasePolicy;
  scenarios: ScenarioFields | null;
  tasks?: UserTask[];
  /** 转场来源：`'none'` = 恒 null（最确定）；`'campus'` = 跨校区兜底估算（纯函数） */
  transfer: 'none' | 'campus';
}

export const GOLDEN_INPUTS: GoldenInput[] = [
  {
    name: 'week-04-typical',
    note: '常规教学周：周一二四有课、含跨楼转场与「无地点」告警',
    schedule: SCHEDULE,
    weekNo: 4,
    policy: policy(),
    scenarios: scen(),
    transfer: 'none',
  },
  {
    name: 'week-06-practice',
    note: '含金工实习（6-9 节长时段，仅 6-9 周）—— 考验长课挤占与三餐顺延',
    schedule: SCHEDULE,
    weekNo: 6,
    policy: policy(),
    scenarios: scen(),
    transfer: 'none',
  },
  {
    name: 'week-12-crosscampus',
    note: '国合楼（JG334，跨校区）+ 兜底转场估算 —— 钉住跨校区排程与转场口径',
    schedule: SCHEDULE,
    weekNo: 12,
    policy: policy({ eveningAllowed: true }),
    scenarios: scen(),
    transfer: 'campus',
  },
  {
    name: 'week-19-exam',
    note: '考试周（该周无课）—— 钉住「没课也要排出合法计划」',
    schedule: SCHEDULE,
    weekNo: 19,
    policy: policy(),
    scenarios: scen(),
    transfer: 'none',
  },
  {
    name: 'week-04-usertasks',
    note: '用户自定义模块：一个固定（星期+时间，锁定）+ 一个浮动（填空档）',
    schedule: SCHEDULE,
    weekNo: 4,
    policy: policy(),
    scenarios: scen(),
    tasks: [
      { id: 'u-fixed', title: '小组会议', emoji: '👥', dayOfWeek: 3, startMin: 19 * 60, durationMin: 60, place: '第三教学楼' },
      { id: 'u-float', title: '练英语听力', emoji: '🎧', durations: [30, 45] },
    ],
    transfer: 'none',
  },
];

export function goldenInputByName(name: string): GoldenInput | undefined {
  return GOLDEN_INPUTS.find((g) => g.name === name);
}

/** 转场 provider（确定性；见文件头约束） */
export function transferProviderOf(g: GoldenInput) {
  return g.transfer === 'campus' ? campusFallbackTransfer : () => null;
}

/** 语料 → `buildWeekPlan` 入参（旧引擎与未来的新引擎共用同一份输入构造） */
export function buildGoldenInput(g: GoldenInput): BuildWeekPlanInput {
  return {
    schedule: g.schedule,
    weekNo: g.weekNo,
    policy: g.policy,
    scenarios: g.scenarios,
    tasks: g.tasks ?? [],
    transfer: transferProviderOf(g),
  };
}

/** 语料的可序列化摘要（写进快照，便于人眼核对「拍的是哪份输入」） */
export function goldenInputSummary(g: GoldenInput) {
  return {
    name: g.name,
    note: g.note,
    weekNo: g.weekNo,
    transfer: g.transfer,
    policy: g.policy,
    scenarios: g.scenarios,
    taskIds: (g.tasks ?? []).map((t) => t.id),
    schedule: {
      semesterName: g.schedule.semesterName,
      termStart: g.schedule.termStart,
      totalWeeks: g.schedule.totalWeeks,
      courseIds: g.schedule.courses.map((c) => c.id),
    },
  };
}
