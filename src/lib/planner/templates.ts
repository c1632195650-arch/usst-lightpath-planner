/**
 * 活动模块库 —— 课表之外的时间怎么填
 * ============================================================
 * 课表只给出「哪几节有课」，剩下的大片时间才是真正要规划的部分。
 * 规划的最小单位不是「一小时学习」这种抽象块，而是**可组合的现成模块**：
 * 食堂、图书馆自习、空教室自习、操场锻炼、室内场馆、取快递、午休……
 *
 * 每个模块带三样东西，缺一不可：
 *   ① **时长档位**（`durations`）—— 「填充式」：空档有多大就挑多长的一档，
 *      而不是把 60 分钟写死。空档 35 分钟时用 30 分钟档，空档 90 分钟时用 90 分钟档。
 *   ② **营业/可用时段**（`windows`）—— 来自 campus_map.json 的 hours 字段。
 *      它让排程能回答「17:30 路过五食堂，还开着吗」这种通用日历答不出的问题。
 *   ③ **地点名**（`place`）—— 直接是 POI 名，可喂给 route() 算实测转场。
 *
 * 数据来源：`data/campus_map.json`（146 POI）。
 * ⚠️ 标了「(估)」的时段是按常规饭点推断的（原始数据写的是「常规饭点」），
 *    与 OSM 自动导入、位置待确认的 POI 一样属**未核实**信息 —— UI 应如实标注，
 *    而不是当成既成事实。这是本项目 verified/est 双标的一贯做法。
 */
import type { BlockKind, ScenarioFields } from '@/types';
import { toMinutes } from '../../constants/time.ts';

export type ActivityCategory = 'meal' | 'study' | 'sport' | 'rest' | 'life' | 'custom';
export type CampusName = '北校' | '南校' | '580' | 'any';

export interface ActivityWindow {
  startMin: number;
  endMin: number;
  /** 「早餐」「午餐」「晚餐」「全天」…… 用于按餐次筛选食堂 */
  label?: string;
}

export interface ActivityTemplate {
  id: string;
  name: string;
  emoji: string;
  category: ActivityCategory;
  kind: BlockKind;
  /** 可选时长（分钟）。引擎会挑「不超过空档」的最大一档 —— 这就是填充式 */
  durations: number[];
  /** 地点（POI 名）。缺省表示「没有固定地点」，例如外卖 */
  place?: string;
  campus?: CampusName;
  /** 可用时段。空数组 = 不限时段 */
  windows: ActivityWindow[];
  /**
   * 画像触发：只有 scenarios[field] 落在 in 里，这个模块才参与排程。
   * 缺省 = 总是候选。这是「画像真的改变排程结果」的落点，不是摆设。
   */
  trigger?: { field: keyof ScenarioFields; in: string[] };
  /** 优先级，越大越先占空档 */
  priority: number;
  /**
   * 是否允许引擎**自动**排进周程。
   * 默认 true（运动、午休、夜宵这类由画像驱动的行为）；
   * false = 只进模块库，等用户自己挑（取快递、洗澡这种「偶尔才做一次」的事，
   * 每天自动排一遍既不准也烦人）。
   */
  autoPlace?: boolean;
  note?: string;
  /** 数据是否已核实；false 时 UI 应提示「信息待确认」 */
  verified: boolean;
}

/** "06:30-09:30" / "10:45-13:30,16:30-19:30" → 时段数组 */
function wins(spec: Record<string, string>): ActivityWindow[] {
  return Object.entries(spec).flatMap(([label, s]) =>
    s.split(',').map((seg) => {
      const [a, b] = seg.trim().split('-');
      return { startMin: toMinutes(a), endMin: toMinutes(b), label };
    }),
  );
}

const 北校三餐 = { 早餐: '06:30-09:30', 午餐: '10:45-13:30', 晚餐: '16:30-18:30' };
const 北校三餐晚些 = { 早餐: '06:30-09:30', 午餐: '10:45-13:30', 晚餐: '16:30-19:30' };
// ⚠️ 南校食堂原始数据只写了「常规饭点」，下面是按常规饭点推断的（标「(估)」）
const 南校三餐 = { '早餐(估)': '06:30-09:00', '午餐(估)': '10:45-13:00', '晚餐(估)': '16:30-18:30' };

/** 食堂 —— 覆盖 campus_map 里 11 个食堂 + 4 个餐厅 */
const MEALS: ActivityTemplate[] = [
  {
    id: 'meal-1', name: '第一食堂', emoji: '🍚', category: 'meal', kind: 'meal',
    durations: [40, 50, 60], place: '第一食堂', campus: '北校',
    windows: wins(北校三餐晚些), priority: 80,
    note: '北校主食堂，就在第三教学楼旁边；晚餐开到 19:30', verified: true,
  },
  {
    id: 'meal-2', name: '第二食堂（教工食堂）', emoji: '🍜', category: 'meal', kind: 'meal',
    durations: [40, 50], place: '第二食堂', campus: '北校',
    windows: wins(北校三餐), priority: 74,
    note: '别名教工食堂，晚上 18:30 就收', verified: true,
  },
  {
    id: 'meal-5', name: '第五食堂', emoji: '🥘', category: 'meal', kind: 'meal',
    durations: [40, 50], place: '第五食堂', campus: '北校',
    windows: wins(北校三餐), priority: 72, verified: true,
  },
  {
    id: 'meal-mn', name: '咪昵餐厅', emoji: '🌙', category: 'meal', kind: 'meal',
    durations: [40, 50, 60], place: '咪昵餐厅', campus: '北校',
    windows: wins({ 早餐: '06:30-09:30', 午晚餐: '10:00-22:00', 夜宵: '18:30-22:00' }),
    priority: 60, note: '少数开到 22:00 的，赶不上饭点可以来', verified: true,
  },
  {
    id: 'meal-yue', name: '阅餐厅', emoji: '☕', category: 'meal', kind: 'meal',
    durations: [40, 50], place: '阅餐厅', campus: '北校',
    windows: wins({ 午餐: '11:00-13:00', 晚餐: '16:30-18:30' }),
    priority: 20, note: '仅教职工（学生一般不适用）', verified: true,
  },
  {
    id: 'meal-4', name: '第四食堂', emoji: '🍛', category: 'meal', kind: 'meal',
    durations: [40, 50], place: '第四食堂', campus: '南校',
    windows: wins(南校三餐), priority: 70, verified: false,
  },
  {
    id: 'meal-si', name: '思餐厅', emoji: '🍲', category: 'meal', kind: 'meal',
    durations: [40, 50], place: '思餐厅', campus: '南校',
    windows: wins(南校三餐), priority: 76,
    note: '南校这一侧主要的就餐点', verified: false,
  },
  {
    id: 'meal-6', name: '第六食堂', emoji: '🍱', category: 'meal', kind: 'meal',
    durations: [40, 50], place: '第六食堂', campus: '南校',
    windows: wins(南校三餐), priority: 66, verified: false,
  },
  {
    id: 'meal-halal', name: '清真食堂（334）', emoji: '🕌', category: 'meal', kind: 'meal',
    durations: [40, 50], place: '清真食堂（334）', campus: '南校',
    windows: wins(南校三餐), priority: 64, verified: false,
  },
  {
    id: 'meal-580', name: '民族餐厅（580 号）', emoji: '🍢', category: 'meal', kind: 'meal',
    durations: [40, 50], place: '民族餐厅（580号）', campus: '580',
    windows: wins({ 午餐: '10:30-13:00', 晚餐: '16:30-19:00' }), priority: 70, verified: true,
  },
];

/** 自习点 —— campus_map 的 5 个自习点 + 空教室 + 宿舍 */
const STUDY: ActivityTemplate[] = [
  {
    id: 'study-lib', name: '图书馆自习', emoji: '📚', category: 'study', kind: 'study',
    durations: [45, 60, 90], place: '图书馆（图文信息中心）', campus: '北校',
    windows: wins({ 开放: '08:00-23:00' }), priority: 62,
    note: '8:00-23:00，馆内有自习区和咖啡休闲区', verified: true,
  },
  {
    id: 'study-zhanen', name: '湛恩纪念图书馆自习', emoji: '🌅', category: 'study', kind: 'study',
    durations: [45, 60, 90], place: '湛恩纪念图书馆', campus: '北校',
    windows: wins({ 自修室: '07:00-23:00' }), priority: 60,
    note: '比总馆早开一小时，早起党的选择', verified: true,
  },
  {
    id: 'study-old', name: '老图书馆自习', emoji: '🕰️', category: 'study', kind: 'study',
    durations: [45, 60, 90], place: '老图书馆', campus: '北校',
    windows: wins({ 开放: '06:00-23:00' }), priority: 52, verified: true,
  },
  {
    id: 'study-cls3', name: '第三教学楼空教室', emoji: '🏫', category: 'study', kind: 'study',
    durations: [45, 60, 90], place: '第三教学楼', campus: '北校',
    windows: [], priority: 56, note: '课表上没有课时段可直接用空教室', verified: true,
  },
  {
    id: 'study-cls1', name: '第一教学楼空教室', emoji: '🏫', category: 'study', kind: 'study',
    durations: [45, 60, 90], place: '第一教学楼', campus: '北校',
    windows: [], priority: 54, verified: true,
  },
  {
    id: 'study-slib', name: '南校区图书馆自习', emoji: '📖', category: 'study', kind: 'study',
    durations: [45, 60, 90], place: '南校区图书馆', campus: '南校',
    windows: wins({ 开放: '07:00-23:00' }), priority: 62, verified: true,
  },
  {
    id: 'study-cafe', name: '1906 咖啡厅', emoji: '☕', category: 'study', kind: 'study',
    durations: [45, 60], place: '1906咖啡厅', campus: '北校',
    windows: wins({ 全天: '10:00-21:30' }), priority: 46,
    note: '在体育馆西侧，适合换个环境', verified: true,
  },
  {
    id: 'study-dorm', name: '宿舍自习', emoji: '🛏️', category: 'study', kind: 'study',
    durations: [30, 45], place: '第二学生公寓', campus: '北校',
    windows: [], priority: 34, note: '不用走路，但状态得靠自己守', verified: true,
  },
];

/** 运动模块 —— 触发条件来自画像的「关于运动」一题 */
const SPORT: ActivityTemplate[] = [
  {
    id: 'sport-field', name: '操场跑步', emoji: '🏃', category: 'sport', kind: 'activity',
    durations: [30, 45, 60], place: '运动场', campus: '北校',
    windows: [], priority: 66, trigger: { field: 'exercise_trigger', in: ['self_plan'] },
    note: '北校运动场，灯光篮球场在其北侧', verified: true,
  },
  {
    id: 'sport-gym', name: '北校室内体育馆', emoji: '🏀', category: 'sport', kind: 'activity',
    durations: [45, 60], place: '体育馆/体育活动中心', campus: '北校',
    windows: [], priority: 64, trigger: { field: 'exercise_trigger', in: ['self_plan'] },
    verified: true,
  },
  {
    id: 'sport-sfield', name: '南校区操场', emoji: '🏃', category: 'sport', kind: 'activity',
    durations: [30, 45], place: '南校区操场', campus: '南校',
    windows: [], priority: 64, trigger: { field: 'exercise_trigger', in: ['self_plan'] },
    verified: true,
  },
  {
    id: 'sport-sgym', name: '南校室内体育馆', emoji: '🏸', category: 'sport', kind: 'activity',
    durations: [45, 60], place: '室内体育馆', campus: '南校',
    windows: [], priority: 62, trigger: { field: 'exercise_trigger', in: ['self_plan'] },
    note: '（OSM 导入，具体位置与开放时间待核实）', verified: false,
  },
];

/** 休息 / 生活 */
const LIFE: ActivityTemplate[] = [
  {
    id: 'rest-nap', name: '午休', emoji: '😴', category: 'rest', kind: 'activity',
    durations: [20, 30], place: '第二学生公寓', campus: '北校',
    windows: wins({ 午间: '12:00-14:00' }), priority: 58,
    note: '午饭后 20 分钟，比硬撑一下午划算', verified: true,
  },
  {
    id: 'life-parcel', name: '取快递', emoji: '📦', category: 'life', kind: 'activity',
    durations: [10, 15], place: '菜鸟驿站', campus: '北校',
    windows: [], priority: 32, autoPlace: false,
    note: '菜鸟驿站在操场围栏外那条路上（需要时自己加进日程）', verified: true,
  },
  {
    id: 'life-shop', name: '暖屋超市补给', emoji: '🛒', category: 'life', kind: 'activity',
    durations: [10, 15], place: '暖屋超市', campus: '北校',
    windows: [], priority: 28, autoPlace: false, verified: true,
  },
  {
    id: 'life-bath', name: '洗澡', emoji: '🚿', category: 'life', kind: 'activity',
    durations: [30], place: '第一浴室', campus: '北校',
    windows: wins({ '开放(估)': '15:00-23:00' }), priority: 26, autoPlace: false, verified: false,
  },
  {
    id: 'life-snack', name: '夜宵', emoji: '🍢', category: 'life', kind: 'activity',
    durations: [30, 40], place: '咪昵餐厅', campus: '北校',
    windows: wins({ 夜宵: '18:30-22:00' }), priority: 30,
    trigger: { field: 'night_supply', in: ['convenience'] },
    note: '你选的是「便利店速食」，晚上饿了去咪昵', verified: true,
  },
];

/** 全部内置模块 */
export const DEFAULT_TEMPLATES: ActivityTemplate[] = [...MEALS, ...STUDY, ...SPORT, ...LIFE];

/** 引擎用的三餐定义（与 constants/time.ts 的 MEAL_BLOCKS 对齐） */
export const MEAL_SLOTS: Array<{
  id: 'breakfast' | 'lunch' | 'dinner';
  label: string;
  nominal: string;
  durationMin: number;
}> = [
  { id: 'breakfast', label: '早餐', nominal: '07:00', durationMin: 30 },
  { id: 'lunch', label: '午餐', nominal: '11:55', durationMin: 50 },
  { id: 'dinner', label: '晚餐', nominal: '17:00', durationMin: 50 },
];

/**
 * 用户自定义模块 —— 「时间 + 地点 + 事件」三要素。
 * 指定了 dayOfWeek/startMin 就是固定块（重排时不动），没指定就交给引擎找空档。
 */
export interface UserTask {
  id: string;
  title: string;
  emoji?: string;
  kind?: BlockKind;
  category?: ActivityCategory;
  /** 指定星期（1=周一…7=周日）；不给 = 本周每天都可参与 */
  dayOfWeek?: number;
  /** 指定开始分钟；不给 = 引擎挑空档 */
  startMin?: number;
  /** 指定时长；不给 = 用 durations 里的档位去填 */
  durationMin?: number;
  /** 只在某些周出现（如「第 5-8 周」）；空/未给 = 全学期 */
  weeks?: number[];
  place?: string;
  durations?: number[];
  priority?: number;
  /** 用户写下的说明 */
  note?: string;
}

/** 由用户输入构造一个可排程的模块 */
export function customTemplate(task: UserTask): ActivityTemplate {
  return {
    id: `custom-${task.id}`,
    name: task.title,
    emoji: task.emoji ?? '📌',
    category: task.category ?? 'custom',
    kind: task.kind ?? 'activity',
    durations: task.durationMin ? [task.durationMin] : (task.durations ?? [30, 60]),
    place: task.place,
    campus: 'any',
    windows: [],
    priority: task.priority ?? 90, // 用户自己要排的事，优先于系统建议
    note: task.note,
    verified: true,
  };
}

/** 这个模块今天在这个时段能不能用（没有时段限制 = 随时可用） */
export function openAt(tpl: ActivityTemplate, startMin: number, endMin: number): boolean {
  if (tpl.windows.length === 0) return true;
  return tpl.windows.some((w) => w.startMin <= startMin + 5 && w.endMin >= endMin - 5);
}

/** 找该模块在此时段的可用标签（早餐/午餐/夜宵…） */
export function windowLabelAt(tpl: ActivityTemplate, startMin: number): string | undefined {
  return tpl.windows.find((w) => startMin >= w.startMin - 10 && startMin <= w.endMin)?.label;
}
