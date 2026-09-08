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
 * 六、持久化
 * ========================================================== */

export interface AppState {
  version: number;
  /** 是否已完成画像（首次进入引导） */
  onboarded: boolean;
  persona: PersonaProfile | null;
  /** 原始答卷（可重算、可删除） */
  answers: AnswerMap | null;
  schedule: Schedule | null;
  /** 周程页选中的日期 */
  selectedDays: string[];
  /** 当前生活模式 id */
  lifeMode: string | null;
}

export const DEFAULT_APP_STATE: AppState = {
  version: 2,
  onboarded: false,
  persona: null,
  answers: null,
  schedule: null,
  selectedDays: [],
  lifeMode: null,
};
