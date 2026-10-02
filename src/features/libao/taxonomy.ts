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
  /** 时长概念锚（批次 3 · 6.4）：按钮卡次行轮换展示
   *
   *  ⚠️ R批 P0-3（R3.3）已弃用「按数组索引轮换」的读法，改为 `tipsByDuration`
   *  （键 = 该档的**分钟数**）。`tips` 仅作**兜底**（档位缺项时取推荐档那一条），
   *  保留字段是为了不打断既有调用方；新代码一律走 tipsByDuration。 */
  tips: string[];
  /**
   * R批 P0-3（R3.1）· **档位 → 该档说明**。
   *
   *  为什么必须改：此前 `quickOptionsFor` 拿 `catTips[i % catTips.length]` 轮换，
   *  于是「选 45 分钟」配到「每周 ≥150 分钟」这种**周总量**说明 —— 档位与
   *  说明之间没有任何语义关系（CY 走查实录：tips 跟选项相关性不大）。
   *  键用分钟数（45/60/90/120），与 effort 按钮的档位一一对应。
   */
  tipsByDuration?: Record<number, string>;
  /**
   * R批 P0-3 · **频率档 → 该档说明**。与 tipsByDuration 同理：长期诉求的按钮是
   * 「每周 1-2 次 / 每周 3-4 次 / 每天 30 分钟」，此前同样吃了索引轮换的亏
   * （第 1 档配到「每次 6-8 个动作」这种单次口径）。键 = 每周次数（2/4/7）。
   */
  tipsByFrequency?: Record<number, string>;
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
    // R3.1：每一档都给「这一档到底算多少」的量感，不复述周总量
    tipsByDuration: {
      45: '≈ 半场 3v3 跑几趟 / 慢跑 4 公里',
      60: '≈ 半场 3v3，或操场 8-10 圈',
      90: '≈ 半场足球 + 热身，或慢跑 7-8 公里',
      120: '≈ 篮球全场两节 + 拉伸；出汗多，记得补水',
    },
    tipsByFrequency: {
      2: '每周 2 次 = 中高强度累计约 120-180 分钟，逼近健康库 ≥150 分钟线',
      4: '每周 4 次，每次 45 分钟已超 150 分钟线（健康库 A级）',
      7: '每天 30 分钟强度偏低，更像活动量；中高强度建议分段加速',
    },
  },
  'sport-strength': {
    label: '力量训练',
    keywords: ['健身房', '健身', '器械', '力量', '撸铁', '举铁', '卧推', '深蹲', '引体'],
    tips: [
      '力量日健康建议每周 ≥2 天（A级）',
      '每次 6-8 个动作 × 2-3 组',
      '同一肌群隔 48 小时再练',
    ],
    tipsByDuration: {
      45: '≈ 5-6 个动作 × 2 组（手臂 + 肩 + 核心）',
      60: '≈ 6-8 个动作 × 2-3 组（力量日推荐档）',
      90: '≈ 全身 10 个动作 × 2 组，练透要留够恢复',
      120: '单次 2 小时容易过量；力量更看总量而非单次时长',
    },
    tipsByFrequency: {
      2: '每周 2 天 = 正好踩到力量训练 ≥2 天线（健康库 A级）',
      4: '每周 4 天可行，但同一肌群要隔 48 小时再练',
      7: '每天练力量收益递减；建议隔天练 + 穿插有氧',
    },
  },
  'study-course': {
    label: '课程学习',
    keywords: ['作业', '复习', '预习', '考试', '四六级', '期末', '背单词', '刷题', '真题', '网课', '错题'],
    tips: [
      '一门课的常态化复习 ≈ 每天 25-50 分钟（番茄档）',
      '分散复习比考前突击记得牢（spacing-effect，A级）',
      '单块 ≤90 分钟，超了就休息',
    ],
    tipsByDuration: {
      45: '番茄档 2 轮：25 学 + 5 休息 × 2',
      60: '一节课的量：讲 40 分钟 + 消化 20 分钟',
      90: '单块上限；超过 90 分钟注意力明显掉档',
      120: '单块 2 小时偏长；建议拆成两段 60 分钟并隔开',
    },
    tipsByFrequency: {
      2: '每周 2 次足够；分散复习优于考前突击（spacing-effect A级）',
      4: '每周 4 次 ≈ 隔天一次，遗忘曲线最经济',
      7: '每天 30 分钟 = 每天固定时段，习惯比单次时长更值钱',
    },
  },
  'study-research': {
    label: '研究探索',
    keywords: ['竞赛', '建模', '数模', '国赛', '项目', '科研', '实验报告', '论文', '开题', '大创', '课题'],
    tips: [
      '数模国赛 72 小时是全程参考线，拆到 3 周 ≈ 每天 3.5 小时',
      '单次深度工作 ≤90 分钟',
      '先搭时间线再铺块（mcm-3day-timeline）',
    ],
    tipsByDuration: {
      45: '≈ 一次实验/读一篇文献的量',
      60: '≈ 一个完整推进段：读 + 算 + 记笔记',
      90: '单次深度工作上限（方法库 ≤90 分钟）',
      120: '2 小时要拆：90 分钟深做 + 30 分钟缓冲与记录',
    },
    tipsByFrequency: {
      2: '每周 2 次推进较慢；72 小时拆 3 周建议每天都有产出',
      4: '每周 4 次 ≈ 每天 2-3 小时，72 小时约 2-3 周',
      7: '每天 30 分钟适合打底（文献/笔记），但不足以推进大块任务',
    },
  },
  generic: {
    label: '一般事项',
    keywords: [],
    tips: [
      '说个大概时长就行，我按你的日历找空档',
      '单块 ≤90 分钟效率最好',
    ],
    tipsByDuration: {
      45: '够处理一件小事；先排进来，之后可调',
      60: '最通用的一档：约一小时整块',
      90: '单块效率上限；再长容易拖到没做完',
      120: '2 小时大块；建议拆两段，中间留缓冲',
    },
    tipsByFrequency: {
      2: '每周 2 次，先把这事稳住',
      4: '每周 4 次，节奏偏密',
      7: '每天 30 分钟 → 每天都排得进，最容易坚持',
    },
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
