/**
 * ============================================================
 *  上理生活助手（Ugh-Study-Saps-Time / USST）—— 全局数据契约
 * ============================================================
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
  name: string;
  short: string;
  address: string;
}

/** 跨校区转场所需分钟数（排程时自动插缓冲块） */
export const CAMPUS_TRANSFER_MIN: Record<CampusId, Record<CampusId, number>> = {
  JG516:  { JG516: 0,  JG334: 15, JG1100: 25, FUXING: 40, YINGKOU: 35, UNKNOWN: 20 },
  JG334:  { JG516: 15, JG334: 0,  JG1100: 30, FUXING: 40, YINGKOU: 35, UNKNOWN: 20 },
  JG1100: { JG516: 25, JG334: 30, JG1100: 0,  FUXING: 45, YINGKOU: 40, UNKNOWN: 25 },
  FUXING: { JG516: 40, JG334: 40, JG1100: 45, FUXING: 0,  YINGKOU: 45, UNKNOWN: 30 },
  YINGKOU:{ JG516: 35, JG334: 35, JG1100: 40, FUXING: 45, YINGKOU: 0,  UNKNOWN: 30 },
  UNKNOWN:{ JG516: 20, JG334: 20, JG1100: 25, FUXING: 30, YINGKOU: 30, UNKNOWN: 0  },
};

/* ============================================================
 * 二、课程与课表（教务 PDF 导出 → 导入）
 * ========================================================== */

export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface CourseTimeSlot {
  dayOfWeek: DayOfWeek;
  startPeriod: number;
  endPeriod: number;
  /** 上课周次数组，如 [1,2,...,16]。空数组 = 全学期 */
  weeks: number[];
}

export type CourseCategory = '专业核心' | '专业选修' | '公共基础' | '通识选修' | '实践环节' | '其他';

export interface Course {
  id: string;
  name: string;
  teacher?: string;
  credit: number;
  category: CourseCategory;
  campus: CampusId;
  building?: string;
  room?: string;
  slots: CourseTimeSlot[];
  examDate?: string;
}

export type SemesterType = 'autumn' | 'spring' | 'short';

export interface Schedule {
  semesterName: string;
  semesterType: SemesterType;
  /** 学期第一周的周一日期 "YYYY-MM-DD" */
  termStart: string;
  totalWeeks: number;
  courses: Course[];
  source: 'pdf' | 'manual' | 'demo';
}

/* ============================================================
 * 三、用户画像（35 题测评 → 8 轴 + 原型 + 场景字段）
 * ========================================================== */

export type PersonaSection = 'A' | 'B' | 'C' | 'D' | 'E';
export type ItemType = 'L5' | 'FC' | 'SORT' | 'MC';

export interface PersonaOption {
  key: string;
  text: string;
  /** FC 题的计分值 0/100 */
  value?: number;
  /** 场景题的语义输出（E 层字段值） */
  output?: string;
}

export interface PersonaItem {
  id: string;
  order: number;
  section: PersonaSection;
  type: ItemType;
  text: string;
  reverse?: boolean;
  trait?: 'E' | 'C' | 'ES' | 'O' | 'A';
  motif?: 'ACH' | 'SOC' | 'HEA' | 'EXP';
  var?: string;
  options?: PersonaOption[];
  output_field?: string;
  consistency_with?: string;
}

/** 答卷：L5 → number(1-5)；FC/MC → 选项 key；SORT → 排序后的 key 数组 */
export type AnswerEntry = number | string | string[];
export type AnswerMap = Record<string, AnswerEntry>;

export type AxisKey = 'EXP' | 'PLAN' | 'SOC' | 'RES' | 'ACH' | 'HEA' | 'RAT' | 'BOLD';
export type TraitKey = 'E' | 'C' | 'ES' | 'O' | 'A';
export type MotiveKey = 'ACH' | 'SOC' | 'HEA' | 'EXP' | 'STA';
export type Confidence = 'high' | 'mid' | 'low';

export type Axes = Record<AxisKey, number>;
export type Traits = Record<TraitKey, number>;
export type Motives = Record<MotiveKey, number>;

export interface ScenarioFields {
  meal_radius: string;
  planning: string;
  event_breadth: string;
  social_radius: string;
  night_supply: string;
  exercise_trigger: string;
  study_place: string;
  info_channel: string;
}

export interface Archetype {
  id: string;
  name: string;
  tagline: string;
  desc: string;
  axes: Axes;
}

export interface PersonaProfile {
  version: string;
  scoreVersion: string;
  axes: Axes;
  traits: Traits;
  motives: Motives;
  scenarios: ScenarioFields;
  archetype: { primary: Archetype | null; secondary: Archetype | null; distance: number };
  confidence: Partial<Record<AxisKey, Confidence>>;
  quality: 'ok' | 'low';
  updatedAt: string;
}

/* ============================================================
 * 四、生活模式（摸鱼 / 猛攻 / 吃饭 …）
 * ========================================================== */

export interface LifeMode {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  desc: string;
  color: string;
}

/* ============================================================
 * 五、校历事件
 * ========================================================== */

export interface CalEvent {
  date: string;
  label: string;
  type: 'holiday' | 'anniversary' | 'exam' | 'term' | 'activity';
}

/* ============================================================
 * 六、排程（学期阶段 → 周计划 → 时间块）
 *
 * 分层理由：教务课表的「持续周数」决定**整学期**的形态（哪几周有课、
 * 期末冲刺从何时开始），而「节次」只影响**单周**的呈现。二者混在一个
 * 结构里会让每周重算整学期，所以拆成 Phase / WeekPlan / TimeBlock 三层。
 * ========================================================== */

export type PhaseKind = 'adapt' | 'normal' | 'midterm' | 'sprint' | 'exam';

/**
 * 阶段排程策略 —— 规则引擎消费的**结构化参数**，不是自由文本。
 * LLM 可以建议这些参数的取值，用户可以直接改；引擎只认这里。
 */
export interface PhasePolicy {
  /** 每天目标自习时长（分钟） */
  dailyStudyMin: number;
  /** 单个学习块上限（分钟）—— 超过就拆开，防止长时间疲劳 */
  maxBlockMin: number;
  /** 刻意留白比例 0–1：一天里不排任何事的时间占比 */
  blankRatio: number;
  /** 是否允许使用晚间时段（18:00 之后） */
  eveningAllowed: boolean;
  /** 周末是否安排学习 */
  weekendWork: boolean;
  /** 自习地点候选（POI 名，供 route() 算转场与 place 字段使用） */
  studyPlaces: string[];
}

export interface Phase {
  kind: PhaseKind;
  name: string;
  /** 起始周次（含），1-based */
  fromWeek: number;
  /** 结束周次（含） */
  toWeek: number;
  policy: PhasePolicy;
  /**
   * 为什么这样排 —— 依据画像的哪一项 / 校历的哪一段。
   * 面向用户展示，让 TA 能质疑和修改，而不是黑箱。
   */
  reasons: string[];
}

export interface SemesterPlan {
  semesterName: string;
  totalWeeks: number;
  phases: Phase[];
  /** 生成时所依据的画像版本（画像更新后可重新生成对比） */
  personaVersion?: string;
  generatedAt?: string;
}

export type BlockKind = 'course' | 'meal' | 'study' | 'activity' | 'commute' | 'blank';

/**
 * 块的锁级别（v2 三级锁）—— 决定重排时这个块能不能动、动了代价多大。
 *   hard：不动（课程、用户显式锁定的块）
 *   soft：可动但代价高（用户先前确认过、引擎不该轻易改的块）
 *   free：可动（引擎自己排的块）
 * 缺省由引擎按块来源推断，见 `planner/model.ts::resolveLockLevel`。
 */
export type LockLevel = 'hard' | 'soft' | 'free';

/**
 * 计划问题的**机器可读码**。
 *
 * 为什么需要它：前端此前只能拿中文 `message` 做判断 —— `level` 只能过滤严重程度，
 * 想区分「转场偏紧」和「自习不够」就得做字符串包含匹配，**文案一改前端就静默失效**。
 *
 * 取值来自引擎**实际产出**的 7 类问题（`planner/schedule.ts` 的各处 `issues.push`），
 * 不是凭空设计的一套。
 */
export type PlanIssueCode =
  | 'time-conflict'       // 同一天两门课时间重叠
  | 'course-no-place'     // 某节课没有上课地点
  | 'meal-skipped'        // 食堂没排上（营业时段 / 距离）
  | 'study-shortfall'     // 自习总量低于阶段目标
  | 'transfer-late'       // 转场时间不够，会迟到
  | 'transfer-tight'      // 转场余量偏紧
  | 'transfer-no-place'   // 有环节缺地点，转场时间算不出来
  | 'lock-conflict';      // 用户锁定的块没能回到原位（与新课/新安排冲突）

/** 转场提示：由 route() 实测标注，通用日历给不出这个 */
export interface TransferHint {
  fromPlace?: string;
  toPlace?: string;
  /** 实测步行分钟 */
  minutes: number;
  /** 到下一件事的余量（分钟），可为负 = 来不及 */
  slackMin: number;
  tight: boolean;
  note?: string;
  /**
   * 这个分钟数是否来自**真实路网实测**（`true`）还是兜底估算（`false`）。
   *
   * 为什么必须有它（P2-T2.4 / AC-10）：在此之前，「实测还是估算」这件事
   * **只编码在 `note` 的中文字符串里**，前端要判断就得去匹配
   * `'估算值（跨校区）…'` 这样的文案 —— 文案一改判断就静默失效。
   * 转场收敛的诚实原则（「个别转场时间为估算值」）需要一个机器可读的信号。
   *
   * 缺省 `undefined` = 引擎没被告知来源（旧调用方 / 未注入 provider）。
   * **不要把它当 `false` 用** —— 语义是「未知」，不是「估算」。
   */
  reliable?: boolean;
}

export interface TimeBlock {
  id: string;
  kind: BlockKind;
  dayOfWeek: DayOfWeek;
  startMin: number;
  endMin: number;
  title: string;
  /** 关联课程（kind === 'course'） */
  courseId?: string;
  /** 地点（POI 名），排程时用于 route() 与就近推荐 */
  place?: string;
  /** 上课教室（kind === 'course'） */
  room?: string;
  /** 任课教师（kind === 'course'） */
  teacher?: string;
  /** 图标（来自活动模块），用于周程页展示 */
  emoji?: string;
  /**
   * 为什么把这个块排在这儿 —— 面向用户的一句话。
   * 与 Phase.reasons 同一哲学：可解释、可反驳，不是黑箱。
   */
  reason?: string;
  transfer?: TransferHint;
  /** 用户确认过的块：重排时锁定不动 */
  locked?: boolean;
  /** 三级锁：hard 不动 / soft 代价高 / free 可动。缺省由引擎按块的来源推断 */
  lockLevel?: LockLevel;
  source: 'course' | 'template' | 'user';
  /** 若来自校历事件（如「光电杯报名材料」），这里是事件 id —— UI 据此做特殊标注 */
  fromEventId?: string;
}

export interface PlanIssue {
  level: 'error' | 'warn' | 'info';
  message: string;
  /** 机器可读的问题码 —— 让前端不必去匹配中文 `message` */
  code?: PlanIssueCode;
  blockId?: string;
}

export interface WeekPlan {
  weekNo: number;
  blocks: TimeBlock[];
  /** 汇总指标（「评估指南」的数字部分，由规则算出，不靠 LLM 编） */
  stats: {
    courseMin: number;
    studyMin: number;
    blankMin: number;
    blockCount: number;
  };
  issues: PlanIssue[];
}

/* ============================================================
 * 七、排程持久化（v2 契约层）
 * ========================================================== */

/**
 * 跨周负荷状态（引擎侧的计算输入）。
 *
 * 为什么它**也在契约层**：因为它要持久化（见 `PlanPersistState.rolling`），
 * 而契约层**不能 import** `planner/model.ts`（§3.3 禁止反向依赖）。
 * 定义在这里、由引擎 re-export，是唯一不产生「同名两份定义」的位置。
 */
export interface RollingState {
  /** 最近若干周的实际负荷（分钟），越靠后越近 */
  recentLoad: number[];
  /** 即将到来的交期（供紧迫度排序） */
  upcoming: Array<{ id: string; title: string; dueAtWeek: number; urgency: number }>;
  /** 按星期几累计的负荷（长度 8；下标 1–7 有效，0 位留空） */
  loadByDow: number[];
}

/**
 * 排程的持久化状态 —— 只存「跨会话必须记住」的东西。
 *
 * 刻意**不存整周计划本身**：计划由引擎随时重算，存下来反而会与输入
 * （课表 / 画像）不一致，出现「页面显示的和你改过的对不上」。
 * 这里存的是**重算所需要**的状态。
 */
export interface PlanPersistState {
  /** 状态版本，供后续迁移 */
  version: number;
  /** 上次排程的周次；null = 从未排过 */
  lastPlanWeek: number | null;
  /** blockId → 锁级别（用户确认过的块记在这里） */
  locks: Record<string, LockLevel>;
  /** 累计扰动分钟数，用于「最小扰动」目标 */
  churnMin: number;
  /**
   * 被锁块的位置快照 —— **只存被锁的块，不是整周计划**。
   *
   * 为什么必须有它：`construct` 每一步都从头排，**完全不读 `lockLevels`**；
   * `improve` 只是「不主动移动 hard 块」。所以只把锁级别传进去，
   * 块一旦被构造阶段排到别处，就**没有任何机制把它带回来** —— 锁会变成假功能。
   * 位置快照让 `solver` 在构造之后能把 hard 块写回原位。
   *
   * 之所以不违反「不存整周计划」：这里只有用户**显式锁定**的那几块，
   * 且不含 reason / transfer 等派生字段，体量很小（通常个位数条）。
   */
  lockedPlacements: Record<string, LockedPlacement>;
  /** ISO 时间戳，用于判断状态新鲜度 */
  updatedAt: string;
  /** 跨周负荷；null = 尚未积累 */
  rolling: RollingState | null;
}

/** 被锁块的最小位置快照（重排时用来把块写回原位） */
export interface LockedPlacement {
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  place?: string;
  room?: string;
  /**
   * 块名 —— 只为「没能放回原位」时能指名道姓地告诉用户是哪一块。
   * 没有它，冲突提示只能报 id（`w4-d1-study-study-lib-2`），用户看不懂。
   */
  title?: string;
}

/* ============================================================
 * 八、应用状态
 * ========================================================== */

export interface AppState {
  version: number;
  /** 是否已完成画像（首次进入引导） */
  onboarded: boolean;
  persona: PersonaProfile | null;
  /** 原始答卷（可重算、可删除） */
  answers: AnswerMap | null;
  schedule: Schedule | null;
  /** 学期阶段规划（画像或课表变化时重新生成） */
  semesterPlan: SemesterPlan | null;
  /** 周程页选中的日期 */
  selectedDays: string[];
  /** 当前生活模式 id */
  lifeMode: string | null;
  /** 排程持久化状态（锁 / 扰动 / 跨周负荷）；null = 尚未排过 */
  planState: PlanPersistState | null;
}

export const DEFAULT_APP_STATE: AppState = {
  version: 4,
  onboarded: false,
  persona: null,
  answers: null,
  schedule: null,
  semesterPlan: null,
  selectedDays: [],
  lifeMode: null,
  planState: null,
};
