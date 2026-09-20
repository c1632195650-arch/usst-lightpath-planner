/**
 * 画像结果页文案库（E3）—— 模糊文艺 + 趣味称呼
 * ================================================
 * 依据 docs/plan-2026-09-21-full.md §二 E3：
 *  · ARCHETYPE_BLURBS：每原型 4–5 条变体，按周轮换取，避免"背台词感"；
 *  · FALLBACK_BLURBS：未命中原型（距离 > 0.45，即 archetype.primary == null）时的兜底；
 *  · makeEpithet：称呼生成器——槽位从 8 轴阈值 + 场景字段 + 基础信息拼接，
 *    全部正向/中性词，负向轴值用反差幽默表达（不出现"焦虑/摆烂/差"等定性）。
 *
 * 红线（tests 在 scripts/personaCopy.test.ts 里机械扫描）：
 *  · 文案里禁止：焦虑 / 摆烂 / 内卷 / 差 / 落后 / 拖延 / 挂科 / 失败 等负向定性；
 *  · 禁止 markdown 符号与 emoji（与梨宝聊天铁律同源，保持统一）；
 *  · 轮换是确定性的：同 (profile, seed) 恒定，跨周/跨 seed 自然变化。
 */
import type { Archetype, AxisKey, ScenarioFields } from '@/types';
import type { BasicInfo } from '@/lib/identity';
import { AXIS_KEYS } from '@/lib/persona';

/* ============================================================
 * 原型 blurb（每原型 4–5 条，模糊但会心一笑）
 * ========================================================== */

export const ARCHETYPE_BLURBS: Record<Archetype['id'], string[]> = {
  planner: [
    '你的日程表比教务处的还满，但总给周三晚上偷偷留了一格。',
    '别人在纠结先做什么，你的纠结是今天的清单有没有第二页。',
    '你的世界像一本提前排好页码的笔记本，连空白页都写着「留给自己」。',
    '截止日期在你这儿是参考线，因为你总是提前到。',
    '你的计划本自带一层柔光：内容很硬核，装帧很温柔。',
  ],
  social: [
    '食堂的座位图会因为你的出现重新排列。',
    '你随口一句「一起？」，是很多人一天里最好的意外。',
    '你的通讯录像校园地图，每个角落都有一个熟人的名字。',
    '热闹是别人对你的评价，你只是刚好认识所有人。',
    '你走到哪儿，哪儿就自动凑出一桌。',
  ],
  explorer: [
    '你像一本还没定稿的地图册，边走边画，越走越有意思。',
    '别人跟着导航走大路，你总能拐进一条更好走的小路。',
    '你的收藏夹是一座私人博物馆，展品都来自校园的角落。',
    '一个人走的路，你走出了两个人的风景。',
    '小众店主的相册里，大概率有你的身影。',
  ],
  healthy: [
    '操场的清晨认识你，比你的闹钟还熟。',
    '你把「身体是本钱」过成了日常，而不是口号。',
    '你的作息像校历一样可靠，连周末都保持着体面。',
    '体测在你这儿不算难关，算例行公事。',
    '你的水杯容量，是很多人一天饮水量的人生目标。',
  ],
  spontane: [
    '你的计划表总是留白，因为精彩部分喜欢现场发挥。',
    '「说走就走」这四个字，在你身上是日常操作。',
    '你像一阵路过的风，路线随机，但每处风景都没错过。',
    '别人的惊喜需要安排，你的惊喜自带日程。',
    '临时起意是你和这座城市之间的小默契。',
  ],
  steady: [
    '稳稳当当四个字，被你过成了一种低调的天赋。',
    '你不追着日子跑，日子反而绕着你走。',
    '别人赶热潮，你挑值得的——挑出来的都挺对。',
    '你的节奏像图书馆的钟，慢，但从来没错过整点。',
    '你的稳，是身边人慌乱时想起来的那种踏实。',
  ],
};

/** 未命中原型（primary == null）时的兜底——放之四海皆准，同样不许负向定性 */
export const FALLBACK_BLURBS: string[] = [
  '你像一本还没定稿的书，目录已经列好，正文正在犹豫从哪页写起。',
  '你的轮廓还在慢慢显影——好在学期还长，不急。',
  '八条刻度各有各的去处，像开学的第三周，什么都还来得及。',
  '有些节奏要用了才知道：先随手翻翻，梨宝陪你慢慢校准。',
];

/* ============================================================
 * 称呼生成器（makeEpithet）
 * 槽位：高轴（≥70）正向短语 / 低轴（≤35）反差幽默短语 /
 *       中间档用场景字段 / 兜底「有自己的节奏」；尾巴拼身份。
 * ========================================================== */

/** 高轴短语（轴值 ≥70 时候选） */
const AXIS_HIGH: Record<AxisKey, string[]> = {
  PLAN: ['把日程排得比谁都整齐', '日程本比教务系统还勤快'],
  ACH: ['盯着目标不撒手', '把「想做」自动翻译成「在做」'],
  HEA: ['把操场当第二个家', '作息稳得像校历'],
  SOC: ['一喊就到场', '自带热闹磁场'],
  EXP: ['把校园当地图集翻', '角落里的好去处都逃不过你'],
  RAT: ['凡事先算一步', '遇事先列一二三'],
  BOLD: ['新事物第一个报名', '好奇心永远满格'],
  RES: ['天塌下来先睡一觉再说', '稳得住场子'],
};

/** 低轴反差短语（轴值 ≤35 时候选，全部正向/中性） */
const AXIS_LOW: Record<AxisKey, string[]> = {
  PLAN: ['随缘但从不迷路', '把弹性留得很足'],
  ACH: ['把节奏握在自己手里', '不赶场，只赶心仪的场'],
  HEA: ['和床感情深厚', '休息这门课修得很认真'],
  SOC: ['热闹看在眼里，安静留给自己', '固定搭子质量很高'],
  EXP: ['把熟悉的路走成经典', '常去的店都认识你'],
  RAT: ['跟着感觉也能走对', '直觉型选手'],
  BOLD: ['稳字当头', '先观察后出手的谨慎派'],
  RES: ['在乎每件小事的心细派', '感受比常人多一格分辨率'],
};

/** 中间档：场景字段短语（无高轴也无低轴时用） */
const SCENARIO_PHRASES: Record<keyof ScenarioFields, string[]> = {
  meal_radius: ['就近吃饭效率派', '探店特种兵'],
  planning: ['提前把一周摆平', '随叫随走的自由派'],
  event_breadth: ['活动海报都过目一遍', '只挑对胃口的场'],
  social_radius: ['群里一呼百应', '搭子少而精'],
  night_supply: ['夜宵安排得明明白白', '过了十点肠胃下班'],
  exercise_trigger: ['有人约就动起来', '按自己的课表流汗'],
  study_place: ['图书馆常驻选手', '空教室自习派', '宿舍学习稳定发挥', '咖啡馆氛围组'],
  info_channel: ['情报网四通八达', '自己搜才是硬道理'],
};

const SCENARIO_KEYS: (keyof ScenarioFields)[] = [
  'meal_radius', 'planning', 'event_breadth', 'social_radius',
  'night_supply', 'exercise_trigger', 'study_place', 'info_channel',
];

/** 场景字段的取值序号——同字段不同取值映射到短语表的不同下标，避免人人同款 */
function scenarioIdx(v: string | undefined): number {
  if (!v || v === 'unknown') return 0;
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0;
  return h;
}

/** 周轮换种子：同周恒定，跨周自然变化（不引入随机数，保持确定性可测） */
export function defaultSeed(): number {
  return Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
}

interface EpithetInput {
  axes: Record<AxisKey, number>;
  scenarios?: ScenarioFields;
  archetype?: { primary?: Archetype | null; secondary?: Archetype | null };
}

/** 结果页一句话 blurb：命中原型用原型池，未命中走兜底池。 */
export function pickBlurb(profile: EpithetInput, seed: number = defaultSeed()): string {
  const pool = profile.archetype?.primary
    ? ARCHETYPE_BLURBS[profile.archetype.primary.id]
    : FALLBACK_BLURBS;
  return pool[seed % pool.length];
}

/**
 * 趣味称呼：`{短语}的{身份}`，如「把操场当第二个家的光电学院同学」。
 * 短语按 高轴 → 低轴反差 → 场景字段 → 兜底 的顺序取；身份按 专业 → 学院 → 年级 → 上理人。
 */
export function makeEpithet(
  profile: EpithetInput,
  basicInfo?: BasicInfo,
  seed: number = defaultSeed(),
): string {
  const axes = profile.axes;

  const high = AXIS_KEYS.filter((k) => (axes[k] ?? 50) >= 70)
    .sort((a, b) => axes[b] - axes[a]);
  const low = AXIS_KEYS.filter((k) => (axes[k] ?? 50) <= 35)
    .sort((a, b) => axes[a] - axes[b]);

  let texts: string[];
  if (high.length) {
    texts = AXIS_HIGH[high[0]];
  } else if (low.length) {
    texts = AXIS_LOW[low[0]];
  } else {
    const k = SCENARIO_KEYS.find((key) => {
      const v = profile.scenarios?.[key];
      return v !== undefined && v !== 'unknown';
    });
    texts = k ? SCENARIO_PHRASES[k] : ['有自己的节奏'];
    if (k) texts = [texts[scenarioIdx(profile.scenarios?.[k]) % texts.length]];
  }

  let phrase = texts[seed % texts.length];
  if (!phrase.endsWith('的')) phrase += '的';

  const role = basicInfo?.major
    ? `${basicInfo.major}专业同学`
    : basicInfo?.college
      ? `${basicInfo.college}同学`
      : basicInfo?.grade
        ? `${basicInfo.grade}同学`
        : '上理人';

  return `${phrase}${role}`;
}
