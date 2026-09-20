import type { CalEvent, Course, LifeMode, Schedule } from '@/types';

/* ============================================================
 * 上理工 · 生活模式
 * ========================================================== */

/** color 取自光谱色板（constants/chartColors.ts 的 SPECTRUM），改色请两边同步。 */
export const LIFE_MODES: LifeMode[] = [
  { id: 'balance', name: '平衡模式', emoji: '⚖️', color: '#2B4C9B', tagline: '学习休息两不误', desc: '默认节奏：白天上课，午后学习，晚上留白，劳逸结合。' },
  { id: 'slack', name: '摸鱼模式', emoji: '🐟', color: '#147A8B', tagline: '今天不想努力', desc: '降低任务密度，多安排休息与娱乐，见缝插针放松，拒绝内卷。' },
  { id: 'grind', name: '猛攻模式', emoji: '🚀', color: '#C24B3A', tagline: '火力全开冲刺', desc: '空闲时间全部排满学习与复习，适合考试周或赶 ddl。' },
  { id: 'food', name: '吃饭模式', emoji: '🍜', color: '#B9762A', tagline: '好好吃饭是大事', desc: '每天规划探店 / 食堂路线，兼顾营养与新鲜感。' },
  { id: 'health', name: '健康模式', emoji: '🏃', color: '#1E7A4F', tagline: '早睡早起多运动', desc: '规律作息 + 每日运动打卡，给身体充能。' },
  { id: 'social', name: '社交模式', emoji: '🎉', color: '#6B4BA3', tagline: '把日子过热闹', desc: '空余时间留给活动、约饭、搭子，拓展朋友圈。' },
];

/* ============================================================
 * 上理工 · 校历（2026–2027 学年第一学期，模拟）
 * ========================================================== */

export const MOCK_SEMESTER_NAME = '2026–2027 学年 · 第一学期';
export const MOCK_TERM_START = '2026-08-31'; // 第一周周一
export const MOCK_TOTAL_WEEKS = 18;

export const CAL_EVENTS: CalEvent[] = [
  { date: '2026-08-31', label: '开学 · 第一周', type: 'term' },
  { date: '2026-09-07', label: '选课周开始', type: 'term' },
  { date: '2026-09-11', label: '四六级报名开启', type: 'exam' },
  { date: '2026-09-25', label: '中秋节', type: 'holiday' },
  { date: '2026-09-28', label: '光电杯报名截止', type: 'activity' },
  { date: '2026-10-01', label: '国庆假期（10.1–10.7）', type: 'holiday' },
  { date: '2026-10-25', label: '建校 120 周年校庆日', type: 'anniversary' },
  { date: '2026-11-09', label: '期中考试周', type: 'exam' },
  { date: '2026-11-21', label: '四六级口试', type: 'exam' },
  { date: '2026-12-12', label: '四六级笔试', type: 'exam' },
  { date: '2027-01-11', label: '期末考试周', type: 'exam' },
];

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
