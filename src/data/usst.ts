import type { CalEvent, Course, LifeMode, Schedule } from '@/types';

/* ============================================================
 * 上理工 · 生活模式
 * ========================================================== */

export const LIFE_MODES: LifeMode[] = [
  { id: 'balance', name: '平衡模式', emoji: '⚖️', color: '#a6192e', tagline: '学习休息两不误', desc: '默认节奏：白天上课，午后学习，晚上留白，劳逸结合。' },
  { id: 'slack', name: '摸鱼模式', emoji: '🐟', color: '#4f83cc', tagline: '今天不想努力', desc: '降低任务密度，多安排休息与娱乐，见缝插针放松，拒绝内卷。' },
  { id: 'grind', name: '猛攻模式', emoji: '🚀', color: '#b45309', tagline: '火力全开冲刺', desc: '空闲时间全部排满学习与复习，适合考试周或赶 ddl。' },
  { id: 'food', name: '吃饭模式', emoji: '🍜', color: '#c2410c', tagline: '好好吃饭是大事', desc: '每天规划探店 / 食堂路线，兼顾营养与新鲜感。' },
  { id: 'health', name: '健康模式', emoji: '🏃', color: '#1f7a4d', tagline: '早睡早起多运动', desc: '规律作息 + 每日运动打卡，给身体充能。' },
  { id: 'social', name: '社交模式', emoji: '🎉', color: '#7c3aed', tagline: '把日子过热闹', desc: '空余时间留给活动、约饭、搭子，拓展朋友圈。' },
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

export interface Deadline {
  id: string;
  date: string;   // ISO 日期
  title: string;
  emoji: string;
  tag: string;
  color: string;  // 贴纸主色
  note?: string;
}

export const DEADLINES: Deadline[] = [
  { id: 'cet-reg', date: '2026-09-11', title: '四六级报名开启', emoji: '📝', tag: '报名', color: '#4a9fe0', note: '各考点时间不同，盯紧教务处通知' },
  { id: 'gdb', date: '2026-09-28', title: '光电杯报名截止', emoji: '🏆', tag: '竞赛', color: '#4db98a', note: '作品抓紧交，别拖到最后' },
  { id: 'anniv', date: '2026-10-25', title: '建校 120 周年校庆', emoji: '🎂', tag: '校庆', color: '#f5b840', note: '校庆日，校园有活动' },
  { id: 'midterm', date: '2026-11-09', title: '期中考试周', emoji: '📚', tag: '考试', color: '#f07e88', note: '提前开始复习不慌' },
  { id: 'cet-set', date: '2026-11-21', title: '四六级口试', emoji: '🎤', tag: '考试', color: '#f07e88', note: 'CET-SET · 11.21–11.22' },
  { id: 'cet', date: '2026-12-12', title: '四六级笔试', emoji: '✏️', tag: '考试', color: '#f07e88', note: '四级上午 / 六级下午' },
  { id: 'final', date: '2027-01-11', title: '期末考试周', emoji: '😱', tag: '考试', color: '#9d7bf2', note: '最后一搏，冲' },
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
