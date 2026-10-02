/**
 * 类目分类与带依据的推荐（交互升级方案批次 3 · 6.1/6.3/6.4）
 * ============================================================
 * **数据源注记（写死在本文件头，推荐必须带依据）**：
 *   · 运动参考 = 健康库 `aerobic-150`（每周中高强度 ≥150 分钟，**tier A**，
 *     编译值 `src/lib/planner/health.ts::ACTIVITY.weeklyModerateMin = 150`）
 *     + `strength-2days`（力量训练 ≥2 天/周，**tier A**，
 *     `ACTIVITY.strengthDaysPerWeek = 2`）
 *     + `minimumSessionMin = 10`（单次 ≥10 分钟才计入，**tier A**）；
 *   · 学习参考 = 方法库 `deep-work`（单次深度工作 ≤90 分钟）
 *     + `mcm-3day-timeline`（数模国赛全程参考 72 小时）
 *     + `spacing-effect`（分散复习，tier A）。
 *
 * 分级原则（方案 §三.5）：**二分粒度、有 tier A 支撑、不穷举项目** ——
 * 关键词映射只收高频词，未知标题走 `generic` 通用默认。运动二分（有氧/力量）、
 * 学习二分（课程学习/研究探索）；usst 旧「运动模式」口径统一改引健康库。
 */

export type GoalCategory =
  | 'sport-aerobic'   // 运动：有氧
  | 'sport-strength'  // 运动：力量
  | 'study-course'    // 学习：课程学习
  | 'study-research'  // 学习：研究探索
  | 'generic';

export interface TaxonomyEntry {
  label: string;
  /** 高频关键词（不穷举：每类 6-10 个）。匹配按**先具体后一般**的顺序在 classifyGoal 里定。 */
  keywords: string[];
  /** 时长概念锚（批次 3 · 6.4）：按钮卡次行轮换展示 */
  tips: string[];
}

export const TAXONOMY: Record<GoalCategory, TaxonomyEntry> = {
  'sport-aerobic': {
    label: '有氧运动',
    keywords: ['篮球', '足球', '跑步', '晨跑', '慢跑', '夜跑', '骑行', '骑车', '游泳', '羽毛球', '乒乓球', '网球', '跳绳', '打球'],
    tips: [
      '60 分钟 ≈ 半场 3v3 / 操场 8-10 圈',
      '健康底线：单次至少 10 分钟才计入（A级）',
      '每周中高强度累计 ≥150 分钟（健康库 A级）',
    ],
  },
  'sport-strength': {
    label: '力量训练',
    keywords: ['健身房', '健身', '器械', '力量', '撸铁', '举铁', '卧推', '深蹲', '引体'],
    tips: [
      '力量日健康建议每周 ≥2 天（A级）',
      '每次 6-8 个动作 × 2-3 组',
      '同一肌群隔 48 小时再练',
    ],
  },
  'study-course': {
    label: '课程学习',
    keywords: ['作业', '复习', '预习', '考试', '四六级', '期末', '背单词', '刷题', '真题', '网课', '错题'],
    tips: [
      '一门课的常态化复习 ≈ 每天 25-50 分钟（番茄档）',
      '分散复习比考前突击记得牢（spacing-effect，A级）',
      '单块 ≤90 分钟，超了就休息',
    ],
  },
  'study-research': {
    label: '研究探索',
    keywords: ['竞赛', '建模', '数模', '国赛', '项目', '科研', '实验报告', '论文', '开题', '大创', '课题'],
    tips: [
      '数模国赛 72 小时是全程参考线，拆到 3 周 ≈ 每天 3.5 小时',
      '单次深度工作 ≤90 分钟',
      '先搭时间线再铺块（mcm-3day-timeline）',
    ],
  },
  generic: {
    label: '一般事项',
    keywords: [],
    tips: [
      '说个大概时长就行，我按你的日历找空档',
      '单块 ≤90 分钟效率最好',
    ],
  },
};

/** 类目判定。顺序敏感：力量 > 有氧（「健身房跑步」归力量语境）；
 *  研究 > 课程（「实验报告」是产出物不是复习）。未知 → generic。 */
export function classifyGoal(title: string): GoalCategory {
  const t = title || '';
  if (TAXONOMY['sport-strength'].keywords.some((k) => t.includes(k))) return 'sport-strength';
  if (TAXONOMY['sport-aerobic'].keywords.some((k) => t.includes(k))) return 'sport-aerobic';
  if (TAXONOMY['study-research'].keywords.some((k) => t.includes(k))) return 'study-research';
  if (TAXONOMY['study-course'].keywords.some((k) => t.includes(k))) return 'study-course';
  return 'generic';
}

/* ============================================================
 * R4.5（R批任务书 P0-1）· 健康类亲和度（替换目标的「按类目推荐」）
 * ============================================================
 * 「把饭后消食替换成打篮球」—— 新目标是健康类时，候选（被替换对象）里
 * **健康类块排前面**：拿学习块去换运动块，大概率不是用户想要的交换。
 * 「饭后消食 / 散步」这类健康习惯词不在 TAXONOMY 关键词里（放进去会污染
 * classifyGoal → categoryMinutesOfWeek 把消食算进有氧分钟数），所以单独
 * 列一个**只读的**健康词表，供亲和度排序用，不参与类目归类。
 */
const HEALTH_WORDS = ['消食', '散步', '锻炼', '晨跑', '夜跑', '运动', '健身', '拉伸'];

/** 标题是否健康类（sport 两类，或健康习惯词命中）。 */
export function isHealthGoalTitle(title: string): boolean {
  const cat = classifyGoal(title);
  if (cat === 'sport-aerobic' || cat === 'sport-strength') return true;
  return HEALTH_WORDS.some((w) => (title || '').includes(w));
}

/** 替换候选亲和度：同类 2 > 双方都健康 1 > 无关 0。纯函数，排序用。 */
export function replacementAffinity(goalTitle: string, candTitle: string): 0 | 1 | 2 {
  const g = classifyGoal(goalTitle);
  const c = classifyGoal(candTitle);
  if (g !== 'generic' && g === c) return 2;
  if (isHealthGoalTitle(goalTitle) && isHealthGoalTitle(candTitle)) return 1;
  return 0;
}

/** 依据行可拿到的个性化输入（本轮最轻量的两个，方案 6.3） */
export interface EvidenceCtx {
  /** 本周该类目已排分钟数（categoryMinutesOfWeek 的统计） */
  weekMinutes?: number;
  /** 用户自报每周运动次数（BasicInfo.exercisePerWeek，0-7） */
  exercisePerWeek?: number;
}

/**
 * 带依据的一行推荐文案（**≤1 行、必须有来源** —— 方案 §三.4）。
 * generic 不出依据行（没有权威口径可引，宁可不说不编）。
 */
export function evidenceLine(cat: GoalCategory, ctx?: EvidenceCtx): string | undefined {
  const wk = ctx?.weekMinutes;
  const ex = ctx?.exercisePerWeek;
  const selfBits: string[] = [];
  if (wk != null && wk > 0) selfBits.push(`你本周已排 ${wk} 分钟`);
  if (ex != null) selfBits.push(`你自报每周运动 ${ex} 次`);
  const self = selfBits.length > 0 ? `（${selfBits.join('；')}）` : '';
  switch (cat) {
    case 'sport-aerobic':
      return `依据：健康库（A级）中高强度每周 ≥150 分钟${self} —— 建议单次 45-90 分钟`;
    case 'sport-strength':
      return `依据：健康库（A级）力量训练每周 ≥2 天${self} —— 建议单次 30-60 分钟`;
    case 'study-course':
      return `依据：方法库：分散复习（spacing-effect）+ 番茄档单块 25-50 分钟`;
    case 'study-research':
      return `依据：方法库：数模国赛全程参考 72 小时；单次深度工作 ≤90 分钟`;
    default:
      return undefined;
  }
}
