import type { CalEvent, Course, LifeMode, Schedule } from '@/types';
import { normalizeLifeModeId } from '@/lib/planner/lifeModePolicy';

/* ============================================================
 * 上理工 · 生活模式（2026-10-07 恢复，随 CY 排程壳搬运）
 * ============================================================
 * 历史：这里原有一份 LIFE_MODES，2026-09-30 移除 —— 移除理由（六模式只等价于
 * 一个乘数、六个按钮产出四种计划）针对的是**旧实现**，仍然成立。
 * 恢复原因：CY 线 WP5 把模式参数化了（sportSessions/extraMeals/blankBlocks 三条
 * 结构通道，见 lifeModePolicy.ts），其 LbaoChat 的 ModeSetupDialog（本次随排程壳
 * 搬进来的「这一周想过什么节奏」六模式卡）消费这份数据。
 * 🔴 诚实状态：本地引擎**暂不消费** `PlanRequest.lifeModeExtras`（字段已预留，
 * construct 未接线）⟹ 模式预览目前只有展示意义；「lifeMode 去留」裁决仍 pending，
 * 合流接线前不要对模式卡的实际排程效果做承诺。
 */
/** color 取自光谱色板（constants/chartColors.ts 的 SPECTRUM），改色请两边同步。 */
export const LIFE_MODES: LifeMode[] = [
  { id: 'grind', name: '内卷模式', emoji: '🚀', color: '#C24B3A', tagline: '火力全开冲刺', desc: '空闲时间全部排满学习与复习，每周一练保持状态，适合考试周或赶 ddl。' },
  { id: 'balance', name: '均衡模式', emoji: '⚖️', color: '#2B4C9B', tagline: '学习休息两不误', desc: '默认节奏：白天上课，午后学习，晚上留白，每周两次运动。' },
  { id: 'faraway', name: '远方模式', emoji: '🫙', color: '#147A8B', tagline: '把时间留给诗和远方', desc: '大幅压缩任务密度，空档实体化成「自由格」，探索想去的任何地方。' },
  { id: 'sport', name: '运动模式', emoji: '🏃', color: '#1E7A4F', tagline: '隔天一练，科学安排', desc: '按健康库指引每周四次锻炼，错开课程与饭点，给身体充能。' },
  { id: 'snack', name: '小馋猫模式', emoji: '🧋', color: '#B9762A', tagline: '好好吃饭是大事', desc: '不与课程冲突的前提下，把下午茶和夜宵时刻也排进日程。' },
  { id: 'mine', name: '我的模式', emoji: '🪞', color: '#6B4BA3', tagline: '按我的画像来', desc: '不套固定模板 —— 梨宝按你的画像、记忆与校正记录量身定制。' },
];

/** 旧模式 id 归一（localStorage 里可能还存着 slack/food/health/social） */
export function normalizeLifeMode(id: string | null | undefined): string | null {
  return normalizeLifeModeId(id);
}

/* ============================================================
 * 上理工 · 校历（2026–2027 学年第一学期，模拟）
 * ========================================================== */

export const MOCK_SEMESTER_NAME = '2026–2027 学年 · 第一学期';
export const MOCK_TERM_START = '2026-08-31'; // 第一周周一
export const MOCK_TOTAL_WEEKS = 18;

/* ============================================================
 * 上理工 · 时间节点 / 倒计时（即将到来的重要节点）
 * ========================================================== */

/**
 * 排程准备策略 —— 把「截止日」变成日程里真正的准备块。
 *
 * 为什么需要它：一个倒计时数字只回答「还有几天」，不回答「我什么时候动手」。
 * 有了 prep，光电杯截止前 10 天就会开始往日程里塞「报名材料」的块，
 * 四六级考前四周开始每周排真题 —— 事件从此**参与排程**，而不只是被展示。
 *
 * 只有「需要提前准备」的事件才配 prep；纯提醒类（报名开启、校庆活动）留空。
 */
export interface PrepPlan {
  /** 提前几天开始准备（窗口 = [截止日 − leadDays, 截止日前一天]） */
  leadDays: number;
  /** 每次准备块的时长（分钟），也是引擎挑空档的档位 */
  blockMin: number;
  /** 总共需要几小时准备 —— 用它和 blockMin 算出要排几块，再在窗口内均匀铺开 */
  prepHours: number;
  /** 准备块标题（出现在日程里的名字） */
  taskTitle: string;
  /** 准备地点（POI 名，可选；给了就能算转场时间） */
  place?: string;
  /** 优先级，默认 88 —— 略低于用户手动添加的 90，高于系统建议的自习块 */
  priority?: number;
}

export interface Deadline {
  id: string;
  date: string;   // ISO 日期
  title: string;
  emoji: string;
  tag: string;
  color: string;  // 贴纸主色
  note?: string;
  /** 有 prep = 这个事件会反向展开成日程里的准备块；没有 = 纯提醒 */
  prep?: PrepPlan;
}

/** color 与 constants/chartColors.ts 的 deadlineColor(tag) 保持一致。 */
export const DEADLINES: Deadline[] = [
  { id: 'cet-reg', date: '2026-09-11', title: '四六级报名开启', emoji: '📝', tag: '报名', color: '#147A8B', note: '各考点时间不同，盯紧教务处通知' },
  {
    id: 'gdb', date: '2026-09-28', title: '光电杯报名截止', emoji: '🏆', tag: '竞赛', color: '#6B4BA3',
    note: '作品抓紧交，别拖到最后',
    prep: { leadDays: 10, blockMin: 90, prepHours: 6, taskTitle: '光电杯报名材料', place: '第三教学楼' },
  },
  { id: 'anniv', date: '2026-10-25', title: '建校 120 周年校庆', emoji: '🎂', tag: '校庆', color: '#B9762A', note: '校庆日，校园有活动' },
  {
    id: 'midterm', date: '2026-11-09', title: '期中考试周', emoji: '📚', tag: '考试', color: '#C24B3A',
    note: '提前开始复习不慌',
    prep: { leadDays: 12, blockMin: 90, prepHours: 12, taskTitle: '期中复习', place: '图书馆（图文信息中心）' },
  },
  {
    id: 'cet-set', date: '2026-11-21', title: '四六级口试', emoji: '🎤', tag: '考试', color: '#C24B3A',
    note: 'CET-SET · 11.21–11.22',
    prep: { leadDays: 7, blockMin: 45, prepHours: 4, taskTitle: '四六级口语练习' },
  },
  {
    id: 'cet', date: '2026-12-12', title: '四六级笔试', emoji: '✏️', tag: '考试', color: '#C24B3A',
    note: '四级上午 / 六级下午',
    prep: { leadDays: 28, blockMin: 60, prepHours: 24, taskTitle: '四六级真题', place: '图书馆（图文信息中心）' },
  },
  {
    id: 'final', date: '2027-01-11', title: '期末考试周', emoji: '😱', tag: '考试', color: '#C24B3A',
    note: '最后一搏，冲',
    prep: { leadDays: 16, blockMin: 90, prepHours: 30, taskTitle: '期末复习', place: '图书馆（图文信息中心）' },
  },
];

/* ============================================================
 * 上理工 · 模拟课表（大一 · 光电/信息方向）
 * ========================================================== */

function slot(dayOfWeek: number, startPeriod: number, endPeriod: number, weeks: number[] = []) {
  return { dayOfWeek: dayOfWeek as Course['slots'][number]['dayOfWeek'], startPeriod, endPeriod, weeks };
}

export const MOCK_COURSES: Course[] = [
  {
    id: 'c-math', name: '高等数学 A', teacher: '王老师', credit: 5, category: '公共基础',
    campus: 'JG516', building: '第一教学楼', room: '301',
    slots: [slot(1, 1, 2), slot(3, 1, 2)],
  },
  {
    id: 'c-phys', name: '大学物理 B', teacher: '李老师', credit: 4, category: '公共基础',
    campus: 'JG516', building: '第三教学楼', room: '205',
    slots: [slot(2, 1, 2), slot(4, 3, 4)],
  },
  {
    id: 'c-c', name: 'C 语言程序设计', teacher: '张老师', credit: 3.5, category: '专业核心',
    campus: 'JG334', building: '卓越楼', room: '408',
    slots: [slot(1, 3, 4), slot(3, 5, 6)],
  },
  {
    id: 'c-en', name: '大学英语 III', teacher: '陈老师', credit: 2, category: '公共基础',
    campus: 'JG516', building: '综合楼', room: 'B201',
    slots: [slot(2, 3, 4)],
  },
  {
    id: 'c-circ', name: '电路分析基础', teacher: '刘老师', credit: 3, category: '专业核心',
    campus: 'JG516', building: '光电学院楼', room: '210',
    slots: [slot(4, 1, 2), slot(5, 1, 2)],
  },
  {
    id: 'c-pe', name: '大学体育（篮球）', teacher: '赵老师', credit: 1, category: '公共基础',
    campus: 'JG516', building: '田径场', room: '',
    slots: [slot(5, 7, 8)],
  },
  {
    id: 'c-intro', name: '专业导论', teacher: '周教授', credit: 1, category: '专业选修',
    campus: 'JG516', building: '大礼堂', room: '',
    slots: [slot(3, 9, 10)],
  },
];

export const MOCK_SCHEDULE: Schedule = {
  semesterName: MOCK_SEMESTER_NAME,
  semesterType: 'autumn',
  termStart: MOCK_TERM_START,
  totalWeeks: MOCK_TOTAL_WEEKS,
  courses: MOCK_COURSES,
  source: 'demo',
};

/* ============================================================
 * 上理工 · 知识库（供「梨宝」推荐使用）
 * ========================================================== */

export const DINING_SPOTS = [
  { name: '第一食堂', tag: '性价比', note: '出餐快，适合 40 分钟速战', campus: '军工路 516' },
  { name: '第二食堂', tag: '花样多', note: '窗口多，适合慢慢逛', campus: '军工路 516' },
  { name: '风味餐厅', tag: '小吃', note: '麻辣香锅、盖浇饭人气高', campus: '军工路 516' },
  { name: '清真餐厅', tag: '清淡', note: '牛肉面、抓饭，人少安静', campus: '军工路 516' },
  { name: '教工餐厅', tag: '安静', note: '错峰可去，环境好', campus: '军工路 516' },
];

export const STUDY_SPOTS = [
  { name: '图书馆（图文信息中心）', note: '座位多、有预约系统，靠窗位抢手' },
  { name: '第一教学楼空教室', note: '晚上空教室多，可自习到闭楼' },
  { name: '光电学院楼自修室', note: '专业氛围浓，同学院同学多' },
  { name: '校园咖啡馆', note: '氛围轻松，适合小组讨论' },
];

export const ACTIVITY_TYPES = [
  { name: '社团招新', note: '百团大战，兴趣社团集中纳新' },
  { name: '学术讲座', note: '院士 / 教授讲座，可盖第二课堂章' },
  { name: '学科竞赛', note: '光电杯、挑战杯等，练手拿奖' },
  { name: '体育活动', note: '篮球、羽毛球约球，操场夜跑' },
];
