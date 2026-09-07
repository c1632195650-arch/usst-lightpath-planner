/**
 * ============================================================
 *  光溯 · 上理生涯规划助手 —— 全局数据契约
 * ============================================================
 *
 *  ⚠️⚠️⚠️  这是两人并行开发的「宪法」 ⚠️⚠️⚠️
 *
 *  规则：
 *   1. D2 结束之前可以随便改。
 *   2. D2 之后任何字段的增删改，必须两人同时在场、口头确认。
 *   3. 需要新字段？先在这里加，再各自写代码。不要在自己的文件里
 *      用 any 绕过 —— 那是并行开发崩盘的开始。
 *   4. 所有 lib/ 与 features/ 下的代码只能 import 这里的类型，
 *      不允许自己另起炉灶定义同名结构。
 *
 *  字段命名统一：camelCase；时间统一 24 小时制 "HH:mm" 字符串；
 *  日期统一 ISO "YYYY-MM-DD" 字符串（避免时区坑）。
 */

/* ============================================================
 * 一、校区与地理（上理工五校区）
 * ========================================================== */

export type CampusId = 'JG516' | 'JG334' | 'JG1100' | 'FUXING' | 'YINGKOU' | 'UNKNOWN';

export interface Campus {
  id: CampusId;
  /** 展示名，如「军工路 516 号」 */
  name: string;
  /** 短名，用于紧凑展示，如「516」 */
  short: string;
  address: string;
}

/**
 * 跨校区转场所需分钟数（用于排程时自动插缓冲块）。
 * 值来自校方短驳班车 + 实际通勤经验，可按反馈微调。
 */
export const CAMPUS_TRANSFER_MIN: Record<CampusId, Record<CampusId, number>> = {
  JG516:  { JG516: 0,  JG334: 15, JG1100: 25, FUXING: 40, YINGKOU: 35, UNKNOWN: 20 },
  JG334:  { JG516: 15, JG334: 0,  JG1100: 30, FUXING: 40, YINGKOU: 35, UNKNOWN: 20 },
  JG1100: { JG516: 25, JG334: 30, JG1100: 0,  FUXING: 45, YINGKOU: 40, UNKNOWN: 25 },
  FUXING: { JG516: 40, JG334: 40, JG1100: 45, FUXING: 0,  YINGKOU: 45, UNKNOWN: 30 },
  YINGKOU:{ JG516: 35, JG334: 35, JG1100: 40, FUXING: 45, YINGKOU: 0,  UNKNOWN: 30 },
  UNKNOWN:{ JG516: 20, JG334: 20, JG1100: 25, FUXING: 30, YINGKOU: 30, UNKNOWN: 0  },
};

/* ============================================================
 * 二、课程与课表
 * ========================================================== */

/** 星期，1 = 周一 */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 一节大课的时间槽 */
export interface CourseTimeSlot {
  dayOfWeek: DayOfWeek;
  /** 起始节次，从 1 开始（对应 PERIOD_TIME 表） */
  startPeriod: number;
  /** 结束节次（含），如第 1-2 节则为 2 */
  endPeriod: number;
  /** 上课周次数组，如 [1,2,3,...,16]。空数组 = 全学期 */
  weeks: number[];
}

export type CourseCategory =
  | '专业核心'
  | '专业选修'
  | '公共基础'
  | '通识选修'
  | '实践环节'
  | '其他';

export interface Course {
  id: string;
  name: string;
  teacher?: string;
  credit: number;
  category: CourseCategory;
  campus: CampusId;
  /** 教学楼，如「第一教学楼」 */
  building?: string;
  /** 教室号，如「301」 */
  room?: string;
  slots: CourseTimeSlot[];
  /** 期末考试日期 "YYYY-MM-DD"，无则为 undefined */
  examDate?: string;
  /** 自评掌握度 0–1，默认 0.5。用于期末紧迫度计算 */
  mastery?: number;
  /** 学生自评难度 1–5，默认 3 */
  difficulty?: number;
}

/** 课表整体 */
export interface Schedule {
  /** 学期名，如「2026–2027 学年 第一学期」 */
  semesterName: string;
  semesterType: SemesterType;
  /** 学期第一周的周一日期 "YYYY-MM-DD" */
  termStart: string;
  totalWeeks: number;
  courses: Course[];
  /** 导入方式，用于排障 */
  source: 'paste' | 'csv' | 'manual' | 'demo';
}

/* ============================================================
 * 三、学期与阶段
 * ========================================================== */

/** 上理工三学期制：秋季 / 春季 / 短学期 */
export type SemesterType = 'autumn' | 'spring' | 'short';

export type PhaseId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export interface Phase {
  id: PhaseId;
  name: string;
  startWeek: number;
  endWeek: number;
  /** 该阶段建议留白率 0–1。数值越高 = 休息越多 */
  blankRate: number;
  /** 一句话任务重心 */
  focus: string;
}

/** 阶段引擎输出 */
export interface PhasePlan {
  phases: Phase[];
  /** 当前所处阶段 id */
  currentPhaseId: PhaseId;
  /** 当前周次（1-based） */
  currentWeek: number;
  /** 距本学期结束还有几周 */
  weeksLeft: number;
}

/* ============================================================
 * 四、用户画像（问卷产出）
 * ========================================================== */

/** 大学目标 —— 决定课程权重表 */
export type GoalType = 'postgrad' | 'job' | 'abroad' | 'contest' | 'explore';

/** 能量曲线：晨型 / 中间型 / 夜型 */
export type Chronotype = 'morning' | 'neutral' | 'night';

export interface UserProfile {
  /** 问卷版本，后续改题时用于判断是否需要重测 */
  version: 1;
  goal: GoalType;
  chronotype: Chronotype;
  /** 每周期望学习投入小时数（不含上课） */
  weeklyStudyHours: number;
  /** 压力承受度 1（很脆弱）–5（很抗压） */
  stressTolerance: 1 | 2 | 3 | 4 | 5;
  /** 兴趣标签，如 ['篮球','摄影','吉他'] */
  interests: string[];
  /** 平时起床时间 "HH:mm" */
  wakeTime: string;
  /** 平时入睡时间 "HH:mm" */
  sleepTime: string;
  /** 期望留白率 0–1，滑块可调。这是本产品的核心参数 */
  blankRate: number;
  /** 填答时间戳 */
  createdAt: string;
}

/* ============================================================
 * 五、课程优先级
 * ========================================================== */

/** 目标 → 权重映射表 */
export interface GoalWeights {
  /** 学分权重 */
  credit: number;
  /** 目标相关度权重 */
  relevance: number;
  /** 挂科风险权重 */
  risk: number;
  /** 掌握度（负向）权重 */
  mastery: number;
}

/** 单门课的优先级计算结果（含可解释性） */
export interface CoursePriority {
  courseId: string;
  courseName: string;
  /** 归一化后的优先级 0–100 */
  score: number;
  /** 各项贡献值，用于「为什么这门排第一」的解释 */
  breakdown: {
    label: string;
    value: number;
    detail: string;
  }[];
  /** 一句话人话解释 */
  reason: string;
}

/* ============================================================
 * 六、任务与排程
 * ========================================================== */

export type TaskType = 'homework' | 'review' | 'project' | 'reading' | 'interest' | 'errand';

export interface Task {
  id: string;
  title: string;
  /** 关联课程（可为空，如「取快递」） */
  courseId?: string;
  type: TaskType;
  /** 预计耗时（分钟） */
  estimateMin: number;
  /** 截止日期 "YYYY-MM-DD"（可为空） */
  dueDate?: string;
  /** 已完成 */
  done: boolean;
  /** 引擎算出的排序键，越大越优先 */
  priority?: number;
}

export type BlockKind =
  | 'course'   // 上课
  | 'study'    // 学习任务
  | 'rest'     // 主动休息
  | 'blank'    // 留白（未安排）
  | 'commute'  // 跨校区转场
  | 'meal'     // 三餐
  | 'sleep';   // 睡眠

export interface TimeBlock {
  /** "HH:mm" */
  start: string;
  /** "HH:mm" */
  end: string;
  kind: BlockKind;
  /** 展示标题 */
  title: string;
  courseId?: string;
  taskId?: string;
  campus?: CampusId;
  /** 补充说明，如「跨校区：516 → 1100」 */
  note?: string;
}

export interface DayPlan {
  /** "YYYY-MM-DD" */
  date: string;
  /** 周日=0 … 周六=6，与 Date.getDay() 一致 */
  weekday: number;
  blocks: TimeBlock[];
  /** 当日学习总分钟 */
  studyMin: number;
  /** 当日留白总分钟 */
  blankMin: number;
  /** 当日课程总分钟 */
  courseMin: number;
}

export interface WeekPlan {
  weekNo: number;
  /** 周一至周日，固定 7 项 */
  days: DayPlan[];
  /** 本周学习总分钟 */
  studyMin: number;
  /** 本周留白总分钟 */
  blankMin: number;
  /** 实际达成的留白率 0–1 */
  actualBlankRate: number;
}

/* ============================================================
 * 七、期末冲刺
 * ========================================================== */

/** T-21 / T-14 / T-7 / T-3 四级 */
export type CountdownLevel = 'T-21' | 'T-14' | 'T-7' | 'T-3';

export interface ExamCountdown {
  courseId: string;
  courseName: string;
  examDate: string;
  /** 距今天数，负数表示已考完 */
  daysLeft: number;
  /** 紧迫度 U 值 */
  urgency: number;
  /** 建议今日投入分钟 */
  suggestMin: number;
  level: CountdownLevel | null;
  /** 该阶段该做什么 */
  action: string;
}

/* ============================================================
 * 八、光照模块（P1-A，可缺失）
 * ========================================================== */

export type LightLevel = 'too-dim' | 'ok' | 'good' | 'too-bright';

export interface LightReading {
  /** 照度 lux */
  lux: number;
  level: LightLevel;
  /** 人话建议 */
  advice: string;
  /** 采集时间戳 */
  at: string;
  /** 数据来源：传感器 / 手动输入 */
  source: 'sensor' | 'manual';
}

/* ============================================================
 * 九、AI 层（P1-B，可缺失）
 * ========================================================== */

export interface AiConfig {
  /** 是否启用。false 时全部走降级话术 */
  enabled: boolean;
  /** base URL，如 https://api.deepseek.com */
  baseUrl: string;
  /** 模型名 */
  model: string;
  /** API Key 存在 localStorage，不进 types */
}

export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/* ============================================================
 * 十、持久化
 * ========================================================== */

/** localStorage 中保存的根数据结构 */
export interface AppState {
  version: 1;
  profile: UserProfile | null;
  schedule: Schedule | null;
  tasks: Task[];
  /** 最近一次生成的计划，按周次索引 */
  plans: Record<number, WeekPlan>;
  light: LightReading | null;
  ai: AiConfig;
}

export const DEFAULT_APP_STATE: AppState = {
  version: 1,
  profile: null,
  schedule: null,
  tasks: [],
  plans: {},
  light: null,
  ai: {
    enabled: false,
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
};
