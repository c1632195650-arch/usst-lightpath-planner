/**
 * 学期阶段规划（buildPhases）
 * ============================================================
 * 回答一个问题：**这个学期，什么时候该松、什么时候该紧？**
 *
 * 为什么不直接用「课表 + 任务」实时求解：
 *   课表只管「哪几节有课」，管不了「第 3 周还在适应、第 16 周要冲刺」。
 *   阶段是学生自己就能说清的东西（开学别急着排满 / 期末提前两周收心），
 *   所以它应该是**显式、可解释、可改**的，而不是调度器里的隐式权重。
 *
 * 设计约束（与项目其它纯函数模块一致）：
 *   1. 纯函数：不读时钟、不 fetch、不用随机数 —— 同理测试可复现。
 *   2. 依赖注入：校历由调用方传入（buildPhasesFromCalendar 做了这层封装），
 *      这样本文件只依赖类型，node --test 能直接跑。
 *   3. 每个决策都给出 reasons：用户能看懂「为什么给我排成这样」，
 *      也能据此反驳。这是「引擎给倾向 + 理由，不替用户拍板」的落点。
 */
import type {
  PersonaProfile, Phase, PhaseKind, PhasePolicy, Schedule, SemesterPlan,
} from '@/types';

/** 校历里与本模块相关的最小信息（从 constants/term.ts 的 TermCalendar 取） */
export interface PhaseCalendar {
  /** 理论教学开始周 */
  theoryFromWeek?: number;
  /** 考试周开始周 */
  examFromWeek?: number;
}

/** 无画像时的基准策略：不激进、不空转 */
const BASE_POLICY: Record<PhaseKind, PhasePolicy> = {
  adapt:   { dailyStudyMin: 90,  maxBlockMin: 45, blankRatio: 0.40, eveningAllowed: false, weekendWork: false, studyPlaces: [] },
  normal:  { dailyStudyMin: 120, maxBlockMin: 90, blankRatio: 0.25, eveningAllowed: false, weekendWork: false, studyPlaces: [] },
  midterm: { dailyStudyMin: 150, maxBlockMin: 90, blankRatio: 0.15, eveningAllowed: true,  weekendWork: false, studyPlaces: [] },
  sprint:  { dailyStudyMin: 180, maxBlockMin: 60, blankRatio: 0.20, eveningAllowed: true,  weekendWork: true,  studyPlaces: [] },
  exam:    { dailyStudyMin: 150, maxBlockMin: 45, blankRatio: 0.30, eveningAllowed: true,  weekendWork: true,  studyPlaces: [] },
};

const PHASE_NAME: Record<PhaseKind, string> = {
  adapt: '开学适应期',
  normal: '常规学习期',
  midterm: '期中密集期',
  sprint: '期末冲刺期',
  exam: '考试周',
};

/** 自习偏好 → 校园 POI（名字取自 campus_map.json，可直接喂给 route()） */
const STUDY_PLACES: Record<string, string[]> = {
  library: ['图书馆（图文信息中心）'],
  classroom: ['第三教学楼', '第一教学楼'],
  dorm: ['第二学生公寓', '第三学生公寓'],
  cafe: ['1906咖啡厅'],
};

const DEFAULT_STUDY_PLACES = ['图书馆（图文信息中心）', '第三教学楼'];

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * 依据画像微调基准策略。返回改后的 policy 与**逐条理由**。
 * 每条规则都刻意写得能读出来「哪一项画像 → 哪个参数变化」。
 */
function applyPersona(kind: PhaseKind, base: PhasePolicy, persona: PersonaProfile | null): {
  policy: PhasePolicy;
  reasons: string[];
} {
  const policy: PhasePolicy = { ...base };
  const reasons: string[] = [];
  if (!persona) {
    reasons.push('还没有画像，先用保守的默认值 —— 做完画像测评可以再来看看差异');
    policy.studyPlaces = DEFAULT_STUDY_PLACES;
    return { policy, reasons };
  }

  const { axes, scenarios } = persona;

  // 成就驱动 → 每天目标时长
  if (axes.ACH >= 70) {
    policy.dailyStudyMin = Math.round(policy.dailyStudyMin * 1.2);
    reasons.push(`成就驱动偏高（${axes.ACH}），每天目标时长上调两成`);
  } else if (axes.ACH <= 35) {
    policy.dailyStudyMin = Math.round(policy.dailyStudyMin * 0.8);
    reasons.push(`成就驱动偏低（${axes.ACH}），目标时长下调两成，先保住节奏`);
  }

  // 计划性 → 单块长度（能坚持长块 vs 需要短块推进）
  if (axes.PLAN >= 70) {
    policy.maxBlockMin = policy.maxBlockMin + 30;
    reasons.push(`计划性高（${axes.PLAN}），单块可以放长到 ${policy.maxBlockMin} 分钟`);
  } else if (axes.PLAN <= 35) {
    policy.maxBlockMin = Math.min(policy.maxBlockMin, 45);
    reasons.push(`计划性偏低（${axes.PLAN}），单块压到 ${policy.maxBlockMin} 分钟以内，靠短块推进`);
  }

  // 健康自律 / 韧性 → 留白（越不需要留白的人越要强制留）
  if (axes.HEA <= 35) {
    policy.blankRatio = Math.min(0.6, policy.blankRatio + 0.10);
    reasons.push(`健康自律偏低（${axes.HEA}），留白提到 ${Math.round(policy.blankRatio * 100)}%，别把自己排满`);
  } else if (axes.HEA >= 70) {
    policy.blankRatio = Math.max(0.1, policy.blankRatio - 0.05);
    reasons.push(`健康自律高（${axes.HEA}），留白降到 ${Math.round(policy.blankRatio * 100)}%，你可以承受更密的安排`);
  }
  if (axes.RES <= 35) {
    policy.blankRatio = Math.min(0.6, policy.blankRatio + 0.05);
    reasons.push(`韧性偏低（${axes.RES}），多留一点缓冲，避免连续受挫`);
  }

  // 自习偏好 → 地点候选（直接映射到校园 POI）
  const place = scenarios.study_place;
  policy.studyPlaces = STUDY_PLACES[place] ?? DEFAULT_STUDY_PLACES;
  if (STUDY_PLACES[place]) {
    reasons.push(`自习偏好是「${place === 'library' ? '图书馆' : place === 'classroom' ? '空教室' : place === 'dorm' ? '宿舍' : '咖啡馆'}」，默认地点按它来`);
  }
  return { policy, reasons };
}

/** 画像决定的阶段长度（周） */
function phaseLengths(persona: PersonaProfile | null) {
  let adapt = 2;
  const reasons: string[] = [];
  if (persona) {
    if (persona.axes.EXP >= 70) {
      adapt += 1;
      reasons.push(`探索度高（${persona.axes.EXP}），适应期多给一周，先到处看看再定节奏`);
    }
    if (persona.scenarios.planning === 'flexible') {
      adapt += 1;
      reasons.push('习惯随性而动，适应期拉长一周，不急着上强度');
    }
  }
  return { adapt: Math.min(adapt, 4), reasons };
}

export interface BuildPhasesResult {
  plan: SemesterPlan;
  /** 生成过程中的整体说明（阶段划分的依据） */
  notes: string[];
}

/**
 * 生成学期阶段规划。
 *
 * @param schedule 课表（用 termStart/totalWeeks，以及课程周次算实际有课区间）
 * @param persona  画像，可为 null
 * @param calendar 校历（可选）：给了就用官方的理论教学/考试周边界
 */
export function buildPhases(
  schedule: Schedule,
  persona: PersonaProfile | null = null,
  calendar?: PhaseCalendar,
): BuildPhasesResult {
  const totalWeeks = Math.max(1, schedule.totalWeeks);
  const notes: string[] = [];

  // 实际有课的周次区间 —— 比校历更贴近这份课表（有的课 3-18 周，有的 7-15 周）
  let minWeek = Number.POSITIVE_INFINITY;
  let maxWeek = 0;
  for (const c of schedule.courses) {
    for (const s of c.slots) {
      for (const w of s.weeks) {
        if (w < minWeek) minWeek = w;
        if (w > maxWeek) maxWeek = w;
      }
    }
  }
  const theoryFrom = calendar?.theoryFromWeek ?? (Number.isFinite(minWeek) ? minWeek : 1);
  if (Number.isFinite(minWeek)) {
    notes.push(`你的课从第 ${minWeek} 周排到第 ${maxWeek} 周`);
  }
  if (maxWeek > 0 && !Number.isFinite(minWeek)) {
    notes.push('课表缺少周次信息，按整学期处理');
  }

  // 考试周起点：校历优先；否则留最后 2 周
  const examFrom = clampInt(calendar?.examFromWeek ?? Math.max(totalWeeks - 1, theoryFrom + 1), theoryFrom, totalWeeks);

  // 三个段的长度
  const { adapt: adaptLen, reasons: adaptReasons } = phaseLengths(persona);
  let midLen = 2;

  // 排段：adapt → （normal/midterm 交替）→ sprint → exam
  const segs: Array<{ kind: PhaseKind; from: number; to: number }> = [];
  let cur = 1;

  // 1) 适应期（覆盖短学期 + 开学头两周）
  const adaptTo = Math.min(cur + adaptLen - 1, examFrom - 2);
  if (adaptTo >= cur) {
    segs.push({ kind: 'adapt', from: cur, to: adaptTo });
    cur = adaptTo + 1;
  }

  // 2) 理论教学主体：midterm 插在中间的 2 周
  const bodyEnd = examFrom - 1;
  const sprintLen = persona && persona.axes.ACH >= 70 ? 4 : 3;
  const sprintFrom = Math.max(bodyEnd - sprintLen + 1, cur);
  const midCenter = Math.round((cur + sprintFrom - 1) / 2);
  const midFrom = Math.max(cur, midCenter - Math.floor(midLen / 2));
  const midTo = Math.min(midFrom + midLen - 1, sprintFrom - 1);

  if (cur <= midFrom - 1) {
    segs.push({ kind: 'normal', from: cur, to: midFrom - 1 });
    cur = midFrom;
  }
  if (midTo >= cur) {
    segs.push({ kind: 'midterm', from: cur, to: midTo });
    cur = midTo + 1;
  }
  if (cur <= sprintFrom - 1) {
    segs.push({ kind: 'normal', from: cur, to: sprintFrom - 1 });
    cur = sprintFrom;
  }
  if (cur <= bodyEnd) {
    segs.push({ kind: 'sprint', from: cur, to: bodyEnd });
    cur = bodyEnd + 1;
  }
  // 3) 考试周
  if (cur <= totalWeeks) {
    segs.push({ kind: 'exam', from: cur, to: totalWeeks });
  }

  if (persona && persona.axes.ACH >= 70) {
    notes.push(`成就驱动高（${persona.axes.ACH}），期末冲刺提前到第 ${sprintFrom} 周开始`);
  }
  notes.push('阶段划分依据：校历的教学周结构 + 你课表的实际周次区间 + 画像');
  notes.push(...adaptReasons);

  const phases: Phase[] = segs.map(({ kind, from, to }) => {
    const { policy, reasons } = applyPersona(kind, BASE_POLICY[kind], persona);
    const rs = [...reasons];
    if (kind === 'exam') rs.unshift(`第 ${from}-${to} 周是考试周，课已结束，重点是复习节奏与睡眠`);
    return {
      kind,
      name: PHASE_NAME[kind],
      fromWeek: from,
      toWeek: to,
      policy,
      reasons: rs,
    };
  });

  return {
    plan: {
      semesterName: schedule.semesterName,
      totalWeeks,
      phases,
      personaVersion: persona?.version,
    },
    notes,
  };
}

/** 便捷封装：从校历常量取边界（会给本模块注入数据，保持 buildPhases 本身纯函数） */
export function buildPhasesFromCalendar(
  schedule: Schedule,
  persona: PersonaProfile | null,
  calendar?: { phases?: Array<{ kind: string; fromWeek: number; toWeek: number }> },
): BuildPhasesResult {
  const theory = calendar?.phases?.find((p) => p.kind === 'theory');
  const exam = calendar?.phases?.find((p) => p.kind === 'exam');
  return buildPhases(schedule, persona, {
    theoryFromWeek: theory?.fromWeek,
    examFromWeek: exam?.fromWeek,
  });
}

/** 查某周落在哪个阶段（周计划生成时用） */
export function phaseOfWeek(plan: SemesterPlan, weekNo: number): Phase | undefined {
  return plan.phases.find((p) => weekNo >= p.fromWeek && weekNo <= p.toWeek);
}
