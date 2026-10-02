/**
 * R批 Wave3（H1）· 日程摘要抽取器 —— 把 `TimeBlock[]` 翻译成**可评估的指标**
 * =============================================================================
 * 为什么需要这一层（这是整个评估引擎的地基）：
 *
 * 评估不能直接读 `TimeBlock`。用户问「这版日程健康吗」，而引擎手里只有
 * 一堆 `{dayOfWeek, startMin, endMin, title, kind}` —— 「每周有氧够不够
 * 150 分钟」这种问题，无法从单个块回答，必须先把一周的块**归约**成指标。
 * 归约规则一旦散落在 UI 或 LLM 提示词里，同一份日程会算出两个答案。
 *
 * 所以本文件是**唯一的归约口**：所有指标都在这里算，UI / 评估 / 未来的
 * LLM 增强都只读它的输出。
 *
 * ── 三条纪律（写之前先想清楚，违反了分数就不可信）────────────────────────
 *
 * 1. **纯函数、零副作用、零 LLM**。同样的输入必须给出同样的输出 —— 评估
 *    分数要能被复现，不能「这次说 72 分下次说 68 分」。
 *
 * 2. **每个指标必须带 `evidence`（块 id 列表）**。这是可解释性的地基：
 *    UI 上任何一个分数都要能点开看「是哪几个块加出来的」。没有 evidence
 *    的分数一律不允许出现在界面上 —— 用户不信任看不见来源的数字。
 *
 * 3. **只算日程里「有」的东西，不猜用户没写的**。没排运动 ≠ 用户不运动，
 *    所以缺项是 `null`（未知）而不是 `0`（零）。`null` 在评估层显示为
 *    「日程里看不到」，`0` 显示为「你这一周一次都没排」—— 这两句话对用户
 *    是完全不同的含义，混为一谈会造成误评。
 *
 * ── 强度分级口径（为什么不能用「所有 activity 块加起来」）──────────────
 *
 * 健康库的 `aerobic-150` 说的是「**中等强度** 150 分钟 / **高强度** 75 分钟」，
 * 两者不能相加 —— 把「散步 40 分钟」和「篮球 90 分钟」都算成有氧，会得出
 * 「190 分钟，达标」的结论，但按标准其中 40 分钟不计入。这里按标题做
 * **强度分级**（MODERATE / VIGOROUS / STRENGTH），分级不确定的记为
 * `unclassified`（仍计入总量，但不抵扣阈值）—— 宁可少算，不要虚高。
 *
 * 分级词表刻意保守：只认明确的运动名。命中不了的一律 `unclassified`，
 * 宁可漏判强度，也不把「体育课看比赛」算成有氧。
 *
 * 强度分级本身是**启发式**（标题关键词），不是权威判定 —— 所以
 * `PlanDigest` 里 `intensityConfidence` 明确标出它只是启发式，UI 上不能
 * 把它包装成「医学评估」。真正的阈值全部来自健康库参数，见 planEval.ts。
 */
import type { DayOfWeek, TimeBlock, WeekPlan } from '@/types';
import { HEALTH_PARAMS } from '@/data/healthParams.generated';
import { METHOD_PARAMS } from '@/data/methodParams.generated';

/* ============================================================
 * 强度分级
 * ========================================================== */

export type ExerciseIntensity = 'moderate' | 'vigorous' | 'strength' | 'unclassified';

/**
 * 运动强度词表（启发式，**刻意保守** —— 命中不了就归 unclassified）。
 *
 * ⚠️ 为什么不能用现有 `classifyGoal`：它在 `features/libao/taxonomy.ts`，
 * 而 `src/lib/**` 不允许 import `features/**`（arch-guards 域对隔离）。
 * 这里只保留**评估必需**的强度信息，与 taxonomy 的类目判定是不同维度
 * （taxonomy 分「有氧/力量」类目，这里分「中等/高强度/力量」并要计入
 * 阈值），不重复也不冲突。
 */

/** 高强度：按心率/代谢特征会显著累的球类与冲刺类运动。 */
const VIGOROUS_WORDS: readonly string[] = [
  '篮球', '足球', '羽毛球', '乒乓球', '网球', '排球',
  '冲刺', '间歇', 'hiit', 'HIIT', '变速跑',
  // ⚠️ 刻意**不含**「比赛」：单独一个「比赛」分不清是「打球」还是「看比赛」，
  // 而看球和打球的活动量差一个量级。宁可归 unclassified 也不虚高。
];

/** 中等强度：能说话但不能唱歌的持续有氧。 */
const MODERATE_WORDS: readonly string[] = [
  '跑步', '慢跑', '夜跑', '晨跑', '快走', '散步', '走路',
  '游泳', '骑行', '单车', '骑车', '椭圆机', '划船机',
  '跳绳', '操课', '健身操', '有氧', '拉伸', '瑜伽', '八段锦',
];

/** 力量训练：抗阻/器械/俯卧撑一类。 */
const STRENGTH_WORDS: readonly string[] = [
  '力量', '举重', '举铁', '撸铁', '器械', '哑铃', '杠铃', '俯卧撑', '深蹲',
  '引体向上', '卧推', '背蹲', '核心训练', '抗阻',
];

/** 块标题 → 强度分级。**不**读 `kind`：meal/course 块不是运动。 */
export function intensityOf(title: string): ExerciseIntensity {
  const t = title || '';
  // 顺序敏感：力量优先（避免「力量跑」被当成有氧），高强度次之
  if (STRENGTH_WORDS.some((w) => t.includes(w))) return 'strength';
  if (VIGOROUS_WORDS.some((w) => t.includes(w))) return 'vigorous';
  if (MODERATE_WORDS.some((w) => t.includes(w))) return 'moderate';
  return 'unclassified';
}

/**
 * 标题是否**像运动安排**（含「像运动但强度判不出」的那种）。
 *
 * ⚠️ 这里**不能**写成 `intensityOf(t) !== 'unclassified'` —— 那会让
 * `unclassified` 分支变成**死代码**（永远为空），于是「排了体育课但说不清
 * 强度」这种最常见的情况会被当成「没排运动」，反而报成 unknown，
 * 把用户明确排过的事说成看不到。
 *
 * 正确问法是「有没有命中运动词表」，与强度分级是两个独立判断。
 */
export function looksLikeExercise(title: string): boolean {
  return EXERCISE_HINT_WORDS.some((w) => (title || '').includes(w));
}

/** 运动词表全集（三个强度表 + 泛化运动词）—— 只用于「像不像运动」这一问。 */
const EXERCISE_HINT_WORDS: readonly string[] = [
  ...STRENGTH_WORDS,
  ...VIGOROUS_WORDS,
  ...MODERATE_WORDS,
  // 强度判不出、但明显是运动的场合（体育课、训练、比赛、运动打卡）
  '体育课', '体育', '运动', '训练', '比赛', '锻炼', '健身', '球',
];

/* ============================================================
 * 指标摘要
 * ========================================================== */

/** 一个指标值 + 它的来源块 id（可解释性的最小单元）。 */
export interface DigestFact<T> {
  value: T;
  /** 贡献了这个值的块 id —— UI 必须能据此列出「是哪几块」 */
  evidence: string[];
  /** 该指标是否可信（false = 数据不足，不该给分） */
  confident: boolean;
  /** 不可信原因（给 UI 展示，不给用户看术语） */
  reason?: string;
}

/**
 * 「日程里看不到」的哨兵。`value` 是**占位符**，不是真实数值 ——
 * 调用方必须先判 `confident` 再读 `value`，绝不能拿它当 0 算分
 * （那正是纪律 3 要防的误评：没排 ≠ 零）。
 *
 * @param reason 不可信原因，直接给 UI 展示（不要求用户懂术语）
 */
export const UNKNOWN = <T>(placeholder: T, reason = '日程里没有可判定的相关安排'): DigestFact<T> => ({
  value: placeholder,
  evidence: [],
  confident: false,
  reason,
});

/** 数值指标缺数据时的简写（占位 0 不可信，故用 NO_DATA 而非 0）。 */
export const NO_DATA = (reason?: string): DigestFact<number> => UNKNOWN<number>(0, reason);

/** 一天的时间占用（分钟）。用于算连续久坐与负荷分布。 */
export interface DayLoad {
  day: DayOfWeek;
  /** 已排分钟（不含 blank） */
  bookedMin: number;
  /** 最长「连续被占」时长（分钟）—— 相邻块间隔 ≤15 分钟视为连续 */
  longestRunMin: number;
  /** 单块最长时长（分钟） */
  longestBlockMin: number;
  /** 22:00 之后仍排事的分钟数（睡眠卫生的代理指标） */
  lateNightMin: number;
}

/** 习惯覆盖统计：同一标题在一周内出现在几天。 */
export interface HabitCoverage {
  title: string;
  days: DayOfWeek[];
  totalMin: number;
  /** 覆盖天数 / 7 */
  dayRatio: number;
}

export interface PlanDigest {
  /** 参与统计的块（已剔除 blank 与纯 commute） */
  blocks: TimeBlock[];
  weekNo: number;

  /* —— 运动（对应健康库 exercise 域）—— */
  /** 计入「运动」的中/高强度分钟数（未分级者单列，不抵扣阈值） */
  moderateMin: DigestFact<number>;
  vigorousMin: DigestFact<number>;
  /** 强度未定的运动分钟数 —— UI 必须如实告知「这 N 分钟没计入达标判断」 */
  unclassifiedExerciseMin: DigestFact<number>;
  /** 力量训练覆盖天数（阈值：strengthDaysPerWeek） */
  strengthDays: DigestFact<number>;
  /** 单次运动最短时长（阈值：minimumSessionMin）—— 过短不计入是有氧达标 */
  shortestExerciseSessionMin: DigestFact<number>;

  /* —— 睡眠（对应健康库 sleep 域）—— */
  /** 每天「最后一个块结束」到次日「第一个块开始」的可支配小时数，取一周最小值 */
  sleepOpportunityHours: DigestFact<number>;
  /** 睡前一小时内仍有排事的天数（咖啡因/屏幕/亢奋代理指标） */
  lateNightBlockDays: DigestFact<number>;

  /* —— 饮食（对应健康库 nutrition 域）—— */
  /** 有 meal 块的天数（阈值：mealsPerDay = 3，实际排 meal 块数是上限代理） */
  mealDays: DigestFact<number>;
  /** 三餐时间间隔（小时）—— 只在同一日 meal 块 ≥2 时可算 */
  mealGapHours: DigestFact<number | null>;

  /* —— 学习与深度工作（对应方法库）—— */
  /** 单块超过 maxConsecutiveBlockMin 的「超长块」个数 */
  overlongStudyBlocks: DigestFact<number>;
  /** 最长连续块（分钟） */
  longestBlockMin: DigestFact<number>;
  /** 深度块数（≥deepBlockMin 的学习块） */
  deepBlockCount: DigestFact<number>;
  /** 复习类排程覆盖天数（间隔效应只能靠分散出现来达成） */
  reviewDays: DigestFact<number>;

  /* —— 负荷分布 —— */
  days: DayLoad[];
  /** 全周最长连续占用（分钟） */
  longestRunMin: DigestFact<number>;
  /** 留白总分钟（block 之间的空隙，不含块本身） */
  blankMin: DigestFact<number>;

  /* —— 习惯 —— */
  habits: HabitCoverage[];

  /** 启发式来源声明 —— UI 不得把本摘要包装成医学评估 */
  intensityConfidence: 'heuristic';
  /** 数据稀疏提示（如一周只有 2 个块，评估结论置信度低） */
  sparseData: boolean;
}

/* ============================================================
 * 工具
 * ========================================================== */

const dur = (b: TimeBlock): number => Math.max(0, b.endMin - b.startMin);

/** 是否算进「占用」—— commute 不算个人时间占用，blank 已在别处处理。 */
const isLoad = (b: TimeBlock): boolean => b.kind !== 'blank' && b.kind !== 'commute';

const allDays: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];

/** 合并同一标题的块（kind 不同也算同一习惯，如「晨跑」course? 不 —— 只并 activity/study） */
const MERGEABLE: ReadonlySet<string> = new Set(['activity', 'study']);

/**
 * 连续占用：把同一天按 startMin 排序，间隔 ≤ GAP_TOLERANCE_MIN 视为连续。
 * 15 分钟是刻意选的：小于它通常只是「从教室走到下一个教室」，
 * 不该被算成「一直忙」；大于它就是真留白了。
 */
const GAP_TOLERANCE_MIN = 15;

function dayRuns(blocks: TimeBlock[]): { longestRun: number; longestBlock: number } {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);
  let longestRun = 0;
  let curStart = 0;
  let curEnd = 0;
  let longestBlock = 0;
  let first = true;
  for (const b of sorted) {
    longestBlock = Math.max(longestBlock, dur(b));
    if (first) {
      curStart = b.startMin;
      curEnd = b.endMin;
      first = false;
      continue;
    }
    if (b.startMin - curEnd <= GAP_TOLERANCE_MIN) {
      curEnd = Math.max(curEnd, b.endMin);
    } else {
      longestRun = Math.max(longestRun, curEnd - curStart);
      curStart = b.startMin;
      curEnd = b.endMin;
    }
  }
  if (!first) longestRun = Math.max(longestRun, curEnd - curStart);
  return { longestRun, longestBlock };
}

/** 24:00 记作 1440 */
const DAY_END = 24 * 60;

/* ============================================================
 * 抽取主函数
 * ========================================================== */

export function digestPlan(plan: WeekPlan): PlanDigest {
  return digestBlocks(plan.blocks, plan.weekNo);
}

/** 纯函数入口：只吃块列表。测试与「单日评估」都走这个。 */
export function digestBlocks(rawBlocks: readonly TimeBlock[], weekNo = 0): PlanDigest {
  const blocks = rawBlocks.filter(isLoad);

  /* —— 运动 —— */
  const exBlocks = blocks.filter((b) => looksLikeExercise(b.title));
  const byIntensity = (k: ExerciseIntensity) => exBlocks.filter((b) => intensityOf(b.title) === k);
  const sumMin = (list: TimeBlock[]) => list.reduce((s, b) => s + dur(b), 0);

  const moderate = byIntensity('moderate');
  const vigorous = byIntensity('vigorous');
  const strength = byIntensity('strength');
  const unclassified = exBlocks.filter((b) => intensityOf(b.title) === 'unclassified');

  const strengthDaySet = new Set(strength.map((b) => b.dayOfWeek));
  const exSessionMins = exBlocks.map(dur);

  /* —— 睡眠 —— */
  /**
   * 睡眠机会 = 「前一天最后一个块的结束」到「次日第一个块的开始」之间的空档。
   *
   * ⚠️ 必须用**绝对时间轴**（abs = (day-1)×1440 + min）算，不能直接比
   * `lastToday.endMin` 与 `firstTomorrow.startMin`：熬夜跨天的块 endMin 会
   * 超过 1440（23:00 → 次日 2:00 = endMin 1560），直接比会得到**负值**，
   * 于是「负值就不记」的写法恰好把最该报警的那一晚丢弃 —— 实测一整周
   * 只看得到 15 小时的「睡眠窗口」，熬夜反而看不见了。
   *
   * 现在负值归 0 并照常计入：0 就是「这一晚完全没有可用睡眠窗口」，
   * 是最严重的情况，不该被藏起来。
   *
   * 跨周（周日 → 次周一）不参与计算 —— 本摘要只看一周内。
   */
  const absOf = (day: DayOfWeek, min: number): number => (day - 1) * DAY_END + min;
  const sleepGaps: number[] = [];
  const sleepEvidence: string[] = [];
  for (let d = 1; d <= 6; d++) {
    const nextDay = (d + 1) as DayOfWeek;
    const tomorrowAbs = blocks
      .filter((b) => b.dayOfWeek === nextDay)
      .map((b) => absOf(nextDay, b.startMin));
    if (tomorrowAbs.length === 0) continue; // 次日全天无安排 → 无从判断，不猜
    const firstTomorrowAbs = Math.min(...tomorrowAbs);
    // 只看结束于「次日首个块开始之前」的块 —— 这才是「昨晚到此为止」
    const before = blocks.filter((b) => absOf(b.dayOfWeek, b.endMin) <= firstTomorrowAbs);
    if (before.length === 0) continue;
    const lastEndAbs = Math.max(...before.map((b) => absOf(b.dayOfWeek, b.endMin)));
    sleepGaps.push(Math.max(0, firstTomorrowAbs - lastEndAbs) / 60);
    sleepEvidence.push(before.find((b) => absOf(b.dayOfWeek, b.endMin) === lastEndAbs)!.id);
  }

  // 晚间块：22:00 后仍有安排（阈值取 22:00，健康库 caffeine-cutoff / 睡前避强光）
  const LATE_NIGHT_FROM = 22 * 60;
  const lateBlocks = blocks.filter((b) => b.endMin > LATE_NIGHT_FROM);
  const lateDays = new Set(lateBlocks.map((b) => b.dayOfWeek));
  // 睡前一小时：最后一个块结束 > 23:00
  const preSleepLateDays = new Set(
    allDays.filter((d) => {
      const today = blocks.filter((b) => b.dayOfWeek === d).sort((a, b) => a.startMin - b.startMin);
      const last = today[today.length - 1];
      return !!last && last.endMin > 23 * 60;
    }),
  );

  /* —— 饮食 —— */
  const mealBlocks = blocks.filter((b) => b.kind === 'meal');
  const mealDays = new Set(mealBlocks.map((b) => b.dayOfWeek));
  const mealGaps: number[] = [];
  const mealEvidence: string[] = [];
  for (const d of allDays) {
    const day = mealBlocks.filter((b) => b.dayOfWeek === d).sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < day.length; i++) {
      const gap = (day[i].startMin - day[i - 1].endMin) / 60;
      if (gap > 0) {
        mealGaps.push(gap);
        mealEvidence.push(day[i - 1].id);
      }
    }
  }

  /* —— 学习 —— */
  const studyBlocks = blocks.filter((b) => b.kind === 'study' || b.kind === 'course');
  const overlong = studyBlocks.filter((b) => dur(b) > METHOD_PARAMS.blocks.maxConsecutiveBlockMin);
  const deep = studyBlocks.filter((b) => dur(b) >= METHOD_PARAMS.blocks.deepBlockMin);
  const REVIEW_HINT = ['复习', '预习', '回顾', '错题', '背诵', '默写', '笔记', '复习', 'revision', 'review'];
  const reviewDays = new Set(
    studyBlocks.filter((b) => REVIEW_HINT.some((w) => (b.title || '').includes(w))).map((b) => b.dayOfWeek),
  );
  const longestBlockAll = blocks.length === 0 ? 0 : Math.max(...blocks.map(dur));

  /* —— 负荷分布 —— */
  const days: DayLoad[] = allDays.map((d) => {
    const day = blocks.filter((b) => b.dayOfWeek === d);
    const { longestRun, longestBlock } = dayRuns(day);
    return {
      day: d,
      bookedMin: day.reduce((s, b) => s + dur(b), 0),
      longestRunMin: longestRun,
      longestBlockMin: longestBlock,
      lateNightMin: day.reduce((s, b) => s + Math.max(0, b.endMin - LATE_NIGHT_FROM), 0),
    };
  });
  const longestRun = days.length === 0 ? 0 : Math.max(...days.map((d) => d.longestRunMin));

  /* —— 留白：7×24h 减去占用 —— */
  const bookedTotal = blocks.reduce((s, b) => s + dur(b), 0);
  const blankTotal = allDays.length * DAY_END - bookedTotal;

  /* —— 习惯覆盖 —— */
  const habitMap = new Map<string, { days: Set<DayOfWeek>; totalMin: number }>();
  for (const b of blocks) {
    if (!MERGEABLE.has(b.kind)) continue;
    const key = (b.title || '').trim();
    if (!key) continue;
    const cur = habitMap.get(key) ?? { days: new Set<DayOfWeek>(), totalMin: 0 };
    cur.days.add(b.dayOfWeek);
    cur.totalMin += dur(b);
    habitMap.set(key, cur);
  }
  const habits: HabitCoverage[] = [...habitMap.entries()]
    .map(([title, v]) => ({
      title,
      days: [...v.days].sort((a, b) => a - b),
      totalMin: v.totalMin,
      dayRatio: v.days.size / 7,
    }))
    // 只留「一周出现 ≥2 天」的 —— 那才叫习惯，单次出现是事件不是习惯
    .filter((h) => h.days.length >= 2)
    .sort((a, b) => b.dayRatio - a.dayRatio || b.totalMin - a.totalMin);

  const fact = <T>(value: T, evidence: string[], extra?: Partial<DigestFact<T>>): DigestFact<T> => ({
    value,
    evidence,
    confident: true,
    ...extra,
  });

  const sparse = blocks.length < 5;

  return {
    blocks,
    weekNo,
    // ⚠️ confident 的判据是「**至少有一个能定级的运动块**」，不是
    // 「exBlocks 非空」。若这一周只有「体育课」这类定不出强度的块，
    // 报 moderate=0 会让评估器判成「有氧严重不足」—— 而真相是
    // 「这 60 分钟算中等还是高强度我不知道」。宁可承认不知道。
    moderateMin: moderate.length === 0
      ? NO_DATA('没有能判定强度的中等强度运动')
      : fact(sumMin(moderate), moderate.map((b) => b.id)),
    vigorousMin: vigorous.length === 0
      ? NO_DATA('没有能判定强度的高强度运动')
      : fact(sumMin(vigorous), vigorous.map((b) => b.id)),
    unclassifiedExerciseMin: exBlocks.length === 0
      ? NO_DATA()
      : fact(
          sumMin(unclassified),
          unclassified.map((b) => b.id),
          // 强度靠标题启发式判定，说清楚别让人以为这是精确分类
          { reason: '靠标题关键词判定强度，不一定准' },
        ),
    // ⚠️ 判据必须是「**有力量块**」而不是「有任何运动块」——
    // 后者会在「只排了慢跑」时把力量天数报成 0，评估器据此说
    // 「你一周没练力量」。但力量完全可能在日程之外（去健身房、
    // 家里练），那是「看不到」，不是「没做」（纪律 3）。
    strengthDays: strength.length === 0
      ? NO_DATA('日程里没有力量训练块')
      : fact(strengthDaySet.size, strength.map((b) => b.id)),
    shortestExerciseSessionMin: exSessionMins.length === 0
      ? NO_DATA()
      : fact(Math.min(...exSessionMins), exBlocks.map((b) => b.id)),

    sleepOpportunityHours: sleepGaps.length === 0
      ? NO_DATA()
      : fact(
          Math.min(...sleepGaps),
          sleepEvidence,
          { reason: '按「当天最后结束 → 次天最早开始」估算，没算熬夜后的补觉' },
        ),
    lateNightBlockDays: lateDays.size === 0
      ? NO_DATA()
      : fact(lateDays.size, lateBlocks.map((b) => b.id)),

    mealDays: mealBlocks.length === 0
      ? NO_DATA()
      : fact(mealDays.size, mealBlocks.map((b) => b.id)),
    mealGapHours: mealGaps.length === 0
      ? {
          value: null,
          evidence: [],
          confident: false,
          reason: '排程里没有可用于算间隔的相邻两餐',
        }
      : fact(
          Math.max(...mealGaps),
          mealEvidence,
          { reason: '取相邻两餐间隔里最长的一次' },
        ),

    overlongStudyBlocks: studyBlocks.length === 0
      ? NO_DATA()
      : fact(overlong.length, overlong.map((b) => b.id)),
    longestBlockMin: blocks.length === 0 ? NO_DATA() : fact(longestBlockAll, [blocks.find((b) => dur(b) === longestBlockAll)!.id]),
    deepBlockCount: studyBlocks.length === 0
      ? NO_DATA()
      : fact(deep.length, deep.map((b) => b.id)),
    reviewDays: studyBlocks.length === 0
      ? NO_DATA()
      : fact(reviewDays.size, blocks.filter((b) => reviewDays.has(b.dayOfWeek)).map((b) => b.id)),

    days,
    longestRunMin: blocks.length === 0 ? NO_DATA() : fact(longestRun, []),
    blankMin: fact(blankTotal, []),

    habits,
    intensityConfidence: 'heuristic',
    sparseData: sparse,
  };
}

/* ============================================================
 * 阈值直读（供 UI 显示「对比标准」，避免各处硬编码数字）
 * ========================================================== */

export interface DigestThresholds {
  weeklyModerateMin: number;
  weeklyVigorousMin: number;
  minimumSessionMin: number;
  strengthDaysPerWeek: number;
  sleepMinHours: number;
  sleepWindowHours: readonly [number, number];
  mealsPerDay: number;
  maxConsecutiveBlockMin: number;
  deepBlockMin: number;
}

/** 全部来自编译好的知识库参数 —— **不硬编码**，改库即改。 */
export function digestThresholds(): DigestThresholds {
  return {
    weeklyModerateMin: HEALTH_PARAMS.blocks.weeklyModerateMin,
    weeklyVigorousMin: HEALTH_PARAMS.blocks.weeklyVigorousMin,
    minimumSessionMin: HEALTH_PARAMS.blocks.minimumSessionMin,
    strengthDaysPerWeek: HEALTH_PARAMS.blocks.strengthDaysPerWeek,
    sleepMinHours: HEALTH_PARAMS.blocks.sleepMinHours,
    sleepWindowHours: HEALTH_PARAMS.blocks.sleepWindowHours,
    mealsPerDay: HEALTH_PARAMS.blocks.mealsPerDay,
    maxConsecutiveBlockMin: METHOD_PARAMS.blocks.maxConsecutiveBlockMin,
    deepBlockMin: METHOD_PARAMS.blocks.deepBlockMin,
  };
}
