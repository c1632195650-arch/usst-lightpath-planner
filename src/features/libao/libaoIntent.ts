/**
 * 梨宝 · 对话意图层（「说一句话就能排进日程」的第一段）
 * ============================================================
 *
 * ── 为什么需要这个文件 ────────────────────────────────────────
 * `docs/scheduler-v2-spec.md` §1.3 早就把这一层**明确划在引擎之外**：
 *
 *   > LLM 意图解析（「下周三交实验报告」→ 结构化 `Commit` 属于意图层，
 *   > 不在本引擎内）。
 *
 * 于是引擎、排程、周计划页都齐了，**唯独「把一句人话变成可排的事」这一段没人写**。
 * 现状的替代品是 `LbaoChat.tsx` 里那段正则 `isRecommendIntent`：只认
 * 「安排/规划/排一下」+「这周/今天」。用户说「我要报名数学建模，帮我规划备赛」——
 * 半个关键词都不命中，掉进 RAG 问答，梨宝去查数学建模的资讯，日程上一块都不排。
 *
 * 本文件补的就是这一段。**它只做「听懂」，不做任何执行、不碰引擎**：
 *   · 输入：一句人话
 *   · 输出：`IntentSlots`（结构化槽位 + 自报缺口 + 歧义点）
 *   · 谁执行：`weekPlanForChat.ts`（唯一防腐层）→ `userPlanStore` 落盘
 *
 * ── 四条纪律 ─────────────────────────────────────────────────
 *
 * ① **规则优先，LLM 只补空。**
 *    规则抽到的字段**不允许**被 LLM 覆盖 —— 规则的产物可审计、可复现、零成本；
 *    LLM 只在规则抽不到的字段上补位。于是「哪来的这个值」始终可归因
 *    （是正则抽的，还是模型猜的），回归测试也才有意义。
 *
 * ② **抽不到就说抽不到，绝不编。**
 *    与产品红线一致（core §4 派生规则 2「不确定必须标注」）。
 *    识别不出目标 → `title` 留空并进 `missing`，由调用方追问，**不拿半个动词当目标**。
 *
 * ③ **「有锚点」与「确切没定」可以同时成立。**
 *    「大概是九月中旬开始比赛，具体时间也没定」是最真实的用户说法：
 *    既有可用锚点，又明确说没定。所以**保留锚点**（用于排默认窗口）
 *    同时把 `certainty` 标为 `unknown`（用于如实告知）—— 两者不互相吞掉。
 *
 * ④ **是既有行为的超集。**
 *    `looksLikeAction` 对 `isRecommendIntent` 命中过的句子**必须也命中** ——
 *    新入口只许扩大可懂范围，不许弄丢老能力。这条有专门的测试守着
 *    （见 `scripts/libaoIntent.test.ts` 的「超集」组）。
 */

/** 用户想对日程做的动作。 */
export type GoalIntent =
  | 'create'      // 新增一件事
  | 'replace'     // 用新安排顶掉已排的某块
  | 'reschedule'  // 同一件事换时间
  | 'cancel'      // 取消已排的事
  | 'query';      // 只问不建议（「我这周忙不忙」）

/**
 * 时间的确定程度 —— 决定后面走哪条出口。
 *   exact   明确到日（「10月8日」）
 *   window  只有区间（「九月中旬」）→ 照排，但必须标注是窗口
 *   unknown 用户明说没定（「具体时间也没定」）→ 按锚点排默认窗口，并**如实标注待定**
 */
export type TimeCertainty = 'exact' | 'window' | 'unknown';

/** 槽位名。`missing` 用它，追问清单也用它 —— 一处定义，两处消费。 */
export type SlotKey =
  | 'title'      // 做什么（「数学建模备赛」）
  | 'when'       // 什么时候（起点/区间）
  | 'effort'     // 投入多少（总时长，或「每周 N 次 × 每次 M 分钟」）
  | 'target';    // 对哪一块动手（换/取消/替换时才需要）

/** 时间表达的结构化形状。**只描述听到什么，不做日期换算** —— 换算在 `resolveWhen`。 */
export interface WhenHint {
  /** 原话片段，用于回显核对 */
  text: string;
  kind: 'exact' | 'window' | 'relative' | 'vague';
  /** 月份 1–12 */
  month?: number;
  /** 日 1–31 */
  day?: number;
  /** 上旬 / 中旬 / 下旬 */
  decade?: 'early' | 'middle' | 'late';
  /** 相对天数偏移：明天 = 1、后天 = 2 */
  relativeDays?: number;
  /** 相对周偏移：下周 = 1、这周 = 0 */
  relativeWeeks?: number;
  /** 星期几（1=周一…7=周日），配合 `relativeWeeks` 表示「下周三」 */
  weekday?: number;
  /** 用户明说「时间没定」。与「没提到时间」是两回事 —— 前者要标注，后者要追问。 */
  unspecified?: boolean;
}

/** 时段窗（「只在晚上」）。分钟口径，与引擎一致。 */
export interface TimeWindow {
  fromMin: number;
  toMin: number;
  /** 原话（「晚上」），用于回显 */
  text: string;
}

/**
 * 解析产物：结构化槽位 + **自报缺口** + 歧义点。
 *
 * `missing` 由解析器自己给出，而不是让调用方去猜「哪个字段为空算缺」——
 * 追问逻辑于是变成「读 missing」，不必再写第二套判定（否则两处必然漂移）。
 */
export interface IntentSlots {
  intent: GoalIntent;
  /** 做什么。抽不到 = 空串，并进 `missing` */
  title: string;
  /** 听到的时间表达；没提到则为 undefined */
  when?: WhenHint;
  /** 明确到日的起始（ISO）。`resolveWhen` 填 —— 规则解析阶段为 undefined */
  dateFrom?: string;
  /** 结束（ISO）。未指定 = undefined，**不替用户补** */
  dateTo?: string;
  certainty: TimeCertainty;
  /** 每周几次（「每周三次」→ 3；「每天」→ 7） */
  perWeekCount?: number;
  /** 单次时长（分钟） */
  durationMin?: number;
  /** 总投入（小时）—— 备赛类诉求通常给的是总量而不是频次 */
  totalHours?: number;
  /** 地点（须能在校园图谱解析；解析不了时由上层标 est） */
  place?: string;
  /** 时段窗（「晚上」→ 18:00–23:00） */
  window?: TimeWindow;
  /** 是否必做（有交期或用户强调）→ 映射到 `UserTask.essential` */
  essential?: boolean;
  /** 可让步度：越高越不该被别的安排挤掉 */
  priorityHint: number;
  /** 「把高数复习挪到周四」→ 高数复习 */
  targetHint?: string;
  /** 自报缺口 —— 追问清单直接由它生成 */
  missing: SlotKey[];
  /** 有歧义但**不阻塞**的点，随草稿一起说明 */
  unclear: string[];
  /** 原话，用于回显 */
  raw: string;
}

/** 解析结果 + 它是怎么来的（便于归因：规则命中还是 LLM 补的） */
export interface ParseOutcome {
  /** 是否属于「要动日程」的句子。false = 交回 RAG 问答老路径 */
  action: boolean;
  slots: IntentSlots;
  source: 'rule' | 'rule+llm';
}

/** LLM 抽取器 —— 由调用方注入（后端 tool call / 本地模型皆可），本模块不关心实现 */
export type LlmExtractor = (raw: string, seed: IntentSlots) => Promise<Partial<IntentSlots> | null>;

/* ============================================================
 * 一、词表（全部显式列在这里，便于 review 与扩充）
 * ========================================================== */

/**
 * 目标名词 —— 既是「有没有目标」的判据，也是 `title` 的素材。
 * ⚠️ 含名义化动词（备赛/备考/复习…）：用户说「帮我规划备赛」时，
 *    「备赛」本身就是那个名词性目标，不该因为没有 `X比赛` 就判成抽不到。
 */
export const GOAL_NOUNS = [
  // 竞赛类
  '数学建模', '光电杯', '挑战杯', '大创', '创新创业', '电子设计', '程序设计',
  '比赛', '竞赛', '大赛', '杯赛',
  // 学业类
  '四六级', '六级', '四级', '期末考试', '期末', '期中', '考研', '保研',
  '雅思', '托福', '补考', '重修',
  '考试', '测验', '论文', '毕设', '课题', '项目', '实验报告', '作业',
  // 名义化动词（用户口中的「那件事」）
  '备赛', '备考', '复习', '刷题', '预习', '练习',
  // 其他
  '证书', '实习', '社团', '招新',
];

/**
 * 真正的**动作**动词（用户要我替他做的事）。
 * ⚠️ 刻意**不含** 备赛/备考/复习/刷题/练习 —— 那几个是「目标」不是「动作」。
 *    放进这里会让 `extractTitle` 的右向扩展把它们当停用词切掉
 *    （「期中复习」只能抽到「期中」）。
 */
const ACTION_VERBS = [
  '报名', '参加', '加入', '准备', '完成', '冲刺', '突击', '打卡', '坚持',
  '安排', '规划', '计划', '排',
];

/** 第一人称意愿 —— 命中即视为「要动日程」（用户已经在表达自己的事） */
const SELF_INTENT = ['我要', '我想', '我打算', '我准备', '帮我', '给我', '替我', '想要', '打算要'];

/** 纯事实问句 —— 这些是在「问信息」，该走 RAG，不该动日程 */
const PURE_FACT = [
  '什么时候', '何时', '几号', '哪里', '在哪', '多少', '几个', '是不是',
  '有没有', '是什么', '什么叫', '流程', '怎么申请', '怎么报名', '怎么预约',
  '怎么办理', '怎么注册', '怎么选课', '怎么缴费', '怎么请假',
];

/** 求建议 —— 与后端 `classify_intent` 的 advice 口径同源：问「怎么做」不等于「帮我做」 */
const ADVICE_MARK = ['怎么', '如何', '怎样', '咋', '值不值得', '要不要', '值得吗'];

/**
 * 「要不要做 X」式**征询意见** —— 用户是在问「你替我拿个主意」，
 * 而不是「替我把它排进日程」。按 core §4，这属于 L4（决策）：
 * 梨宝**绝不能替用户拍板**，所以必须挡在动作识别之外。
 *
 * ⚠️ 必须**先于** `SELF_INTENT` 判定：「我要」是「我要要不要」的前缀，
 *    若先看第一人称意愿，「我要不要报名四六级」会被当成指令去排程。
 *    这条也被回归测试守着（`快筛：求建议不命中`）。
 */
const ASK_OPINION = /(要不要|该不该|是不是应该|需不需要|是否要|是否应该|值不值得|值得吗|好不好)/;

/**
 * 与 `LbaoChat.tsx::isRecommendIntent` **逐字一致**的既有口径。
 * 保留它是为了满足纪律④：新入口必须是老行为的超集。
 */
const LEGACY_RECOMMEND = /(安排|规划|计划一下|怎么过|排一下|帮我排|给我排)/;
const LEGACY_RECOMMEND_DAY = /(这周|本周|今天|明天|后天|周末)/;
/**
 * ⚠️ 前六项与 `isRecommendIntent` **逐字一致**；末尾的 `干什么|干啥` 是**本层扩的**
 *    （老口径只认「干嘛/做啥/干点」，于是「明天干什么」明明是在求安排却漏掉）。
 *    扩在这里而不是新开一条规则，是因为它和其余几项是同一个「日 + 口语疑问」形态，
 *    拆开反而看不出这是一族。超集测试因此分成两组断言：
 *    「老形态一条不丢」与「新扩的形态确实被认了」。
 */
const LEGACY_RECOMMEND_ACT = /(怎么|干嘛|做啥|干点|过|安排|干什么|干啥)/;

/** 动作识别（决定 intent 枚举）。顺序敏感：取消 > 改时间 > 替换 > 只问 > 新增。 */
const INTENT_PATTERNS: Array<{ intent: GoalIntent; re: RegExp }> = [
  { intent: 'cancel', re: /(取消|删掉|不去了|不参加了|退掉|别排|不要了)/ },
  { intent: 'reschedule', re: /(挪到|挪一下|移到|改到|换个时间|换到|推迟|提前|调到)/ },
  { intent: 'replace', re: /(替换|顶掉|改成|换成|取代)/ },
  { intent: 'query', re: /(忙不忙|排得开|来不来得及|有没有空|有空吗|装得下|排得下)/ },
];

/** 时段词 → 分钟窗。与作息口径一致（早 7 点起、夜 23 点止）。 */
const PERIOD_WORDS: Array<{ re: RegExp; fromMin: number; toMin: number; text: string }> = [
  { re: /(早上|早晨|一早)/, fromMin: 7 * 60, toMin: 12 * 60, text: '早上' },
  { re: /(上午)/, fromMin: 8 * 60, toMin: 12 * 60, text: '上午' },
  { re: /(中午)/, fromMin: 11 * 60, toMin: 13 * 60 + 30, text: '中午' },
  { re: /(下午)/, fromMin: 13 * 60, toMin: 18 * 60, text: '下午' },
  { re: /(晚上|晚间|夜里|夜晚)/, fromMin: 18 * 60, toMin: 23 * 60, text: '晚上' },
  { re: /(白天)/, fromMin: 8 * 60, toMin: 18 * 60, text: '白天' },
];

/**
 * 标题抽取的停用词 —— 撞到它就**停止向两侧扩**。
 *
 * ⚠️ 这里有个踩过的坑：只想「试更短的窗口」是错的。
 * 对「报名参加数学建模」，`take=4` 得到「报名参加」（含动词，该停），
 * 若继续 `take=1` 会得到「加」—— 那是「参加」的碎片，会拼出「加数学建模」。
 * 所以撞到停用词必须 **break**，不是 continue。
 */
const TITLE_STOP: string[] = [
  ...ACTION_VERBS, ...SELF_INTENT,
  '打算', '主意', '想法', '一下', '一点', '一些', '时候',
  '的', '了', '着', '过', '把', '在', '和', '与', '跟', '为', '给', '到', '从',
  '我', '你', '他', '她', '它', '们', '这', '那', '是', '有', '要', '想', '能', '会',
  '请', '帮', '就', '还', '也', '都', '很', '最', '再', '又', '一次',
];

/** 中文数字 → 整数（覆盖 一~十二，够用于月份/次数） */
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  十一: 11, 十二: 12,
};

/** 星期字 → 数字 */
const WD_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

function cnToInt(s: string): number | undefined {
  const t = (s || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (CN_NUM[t] != null) return CN_NUM[t];
  const m = /^(十?)([一二三四五六七八九]?)(十?)$/.exec(t);
  if (m && (m[1] || m[3])) {
    const v = (m[1] ? 10 : 0) + (m[2] ? (CN_NUM[m[2]] ?? 0) : 0) + (m[3] ? 10 : 0);
    return v > 0 ? v : undefined;
  }
  return undefined;
}

/* ============================================================
 * 二、快筛：这句话要不要动日程
 * ========================================================== */

/**
 * 是不是「要动日程」的句子。
 *
 * 判定顺序**刻意如此**（顺序本身是设计的一部分）：
 *   1. 征询意见（「要不要…」）→ 否。**必须最优先** —— 它常常裹着「我要」出现，
 *      而 L4 决策不许梨宝替用户拍板。
 *   2. 有第一人称意愿 → 是。用户已经说「我要/帮我」了，不该再跟他辩论是不是在提问。
 *   3. 命中既有口径 → 是。保证是超集，老能力一条不丢。
 *   4. 纯事实问句 → 否。「四六级什么时候报名」是问信息，答它靠 RAG，排它没道理。
 *   5. 求建议 → 否。「怎么复习高数」问的是方法，排一块自习进去是答非所问。
 *   6. 否则：**动作动词 + 目标名词**同时出现才算。单有动词会把「学号怎么改」拽进来，
 *      单有名词会把「有什么比赛」拽进来。
 */
export function looksLikeAction(q: string): boolean {
  const s = (q || '').trim();
  if (!s) return false;

  if (ASK_OPINION.test(s)) return false;

  if (SELF_INTENT.some((t) => s.includes(t))) return true;

  if (LEGACY_RECOMMEND.test(s)) return true;
  if (LEGACY_RECOMMEND_DAY.test(s) && LEGACY_RECOMMEND_ACT.test(s)) return true;

  if (PURE_FACT.some((t) => s.includes(t))) return false;
  if (ADVICE_MARK.some((t) => s.includes(t))) return false;

  const hasGoal = GOAL_NOUNS.some((n) => s.includes(n));
  const hasVerb = ACTION_VERBS.some((v) => s.includes(v));
  return hasGoal && hasVerb;
}

/** 判断 intent。 */
export function detectIntent(q: string): GoalIntent {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(q)) return intent;
  }
  return 'create';
}

/* ============================================================
 * 三、逐槽位抽取（纯规则）
 * ========================================================== */

/** 能拼进标题的字符（中文、字母、数字） */
const TITLE_CHAR = /^[\u4e00-\u9fffA-Za-z0-9]+$/;

/**
 * 抽目标名。
 *
 * 策略（不追求 NLU 级准确，追求**可解释 + 抽不到就认**）：
 *   1. 命中词表里**最长**的目标词（「数学建模」优先于「比赛」——
 *      长的更具体，用「比赛」当标题等于没抽到）。
 *   2. 向**左右**各扩一点，把限定语带进来（「期中」+「复习」→「期中复习」），
 *      撞到停用词立刻停（见 `TITLE_STOP` 的注释：撞到只能 break，不能 continue）。
 *   3. 抽不到 → 空串。**这是有意的**：宁可追问，也不拿半个动词当目标。
 */
export function extractTitle(q: string): string {
  const s = q || '';

  let best = '';
  let at = -1;
  for (const noun of GOAL_NOUNS) {
    const i = s.indexOf(noun);
    if (i >= 0 && noun.length > best.length) {
      best = noun;
      at = i;
    }
  }
  if (!best) return '';

  // 向左扩：最多 4 字，撞到停用词就停
  let left = at;
  for (let take = Math.min(4, at); take >= 1; take--) {
    const cand = s.slice(at - take, at);
    if (TITLE_STOP.some((w) => cand.includes(w))) break;
    if (TITLE_CHAR.test(cand)) {
      left = at - take;
      break;
    }
  }

  // 向右扩：最多 4 字，撞到停用词就停
  let right = at + best.length;
  for (let take = Math.min(4, s.length - right); take >= 1; take--) {
    const cand = s.slice(right, right + take);
    if (TITLE_STOP.some((w) => cand.includes(w))) break;
    if (TITLE_CHAR.test(cand)) {
      right = right + take;
      break;
    }
  }

  return s.slice(left, right).trim();
}

/** 「时间没定」的判据（含各种口语说法）。 */
const VAGUE_WHEN = /(?:具体)?(?:时间|日期)[^，。！？,.]{0,4}?(?:没|未)(?:有)?(?:定|确定)|未定|待定|没定|不确定/;

/**
 * 抽一个**具体**的时间表达（不含「没定」判定）。
 * 优先级：月+日 > 月+旬 > 只有月 > 相对日 > 相对周 > 星期 > 学期词。
 */
function extractConcreteWhen(s: string): WhenHint | undefined {
  // 月 + 日
  const md = /(\d{1,2}|[一二三四五六七八九十]{1,3})月(\d{1,2}|[一二三四五六七八九十]{1,3})[日号]/.exec(s);
  if (md) {
    const month = /^\d+$/.test(md[1]) ? Number(md[1]) : cnToInt(md[1]);
    const day = /^\d+$/.test(md[2]) ? Number(md[2]) : cnToInt(md[2]);
    if (month && day) return { text: md[0], kind: 'exact', month, day };
  }

  // 月 + 旬
  const dec = /([一二三四五六七八九十\d]{1,2})月([上中下]旬)/.exec(s);
  if (dec) {
    const month = cnToInt(dec[1]);
    const decade = dec[2] === '上旬' ? 'early' : dec[2] === '中旬' ? 'middle' : 'late';
    if (month) return { text: dec[0], kind: 'window', month, decade };
  }

  // 只有月
  const mo = /([一二三四五六七八九十\d]{1,2})月/.exec(s);
  if (mo) {
    const month = cnToInt(mo[1]);
    if (month) return { text: mo[0], kind: 'window', month };
  }

  // 相对日
  const relDay = /(今天|明天|后天|大后天)/.exec(s);
  if (relDay) {
    const off = relDay[1] === '今天' ? 0 : relDay[1] === '明天' ? 1 : relDay[1] === '后天' ? 2 : 3;
    return { text: relDay[1], kind: 'relative', relativeDays: off };
  }

  // 相对周 + 星期
  const relWeek = /(下周|下星期|这周|本周|这星期|本星期)/.exec(s);
  const wd = /(周[一二三四五六日天]|星期[一二三四五六日天])/.exec(s);
  const wdNum = wd ? WD_NUM[wd[1].slice(1)] : undefined;
  if (relWeek) {
    const isNext = relWeek[1].startsWith('下');
    return {
      text: relWeek[0] + (wd ? wd[0] : ''),
      kind: 'relative',
      relativeWeeks: isNext ? 1 : 0,
      weekday: wdNum,
    };
  }
  if (wd && wdNum != null) return { text: wd[0], kind: 'relative', relativeWeeks: 0, weekday: wdNum };
  if (/周末/.test(s)) return { text: '周末', kind: 'relative', relativeWeeks: 0, weekday: 6 };

  // 学期词 —— 要靠校历换算，本层只记原话
  const term = /(期末|期中考试|开学|学期末|寒假|暑假|毕业前)/.exec(s);
  if (term) return { text: term[0], kind: 'window' };

  return undefined;
}

/**
 * 抽时间表达。
 *
 * ⚠️ **纪律③ 的落点**：这里刻意让「有锚点」与「说了没定」**共存**，
 * 而不是像第一版那样互相覆盖。用户说「大概是九月中旬开始，具体时间也没定」时，
 * 丢掉「九月中旬」等于丢掉唯一可用的排程依据；而把 `unspecified` 抹掉，
 * 又会让我们理直气壮地按一个假日期排。两者都要留下。
 *
 * @returns `undefined` = 用户**完全没提**时间（该追问，不是「没定」）
 */
export function extractWhen(q: string): WhenHint | undefined {
  const s = q || '';
  const unspecified = VAGUE_WHEN.test(s);
  const concrete = extractConcreteWhen(s);

  if (concrete) {
    if (unspecified) concrete.unspecified = true;
    return concrete;
  }
  if (unspecified) return { text: '时间待定', kind: 'vague', unspecified: true };
  return undefined;
}

/**
 * 抽投入量。总小时与单次时长**分开** —— 前者是「备赛总量」，
 * 后者是「单个块多长」，混在一起会把 20 小时的备赛排成一个 20 小时的块。
 */
export function extractEffort(q: string): { totalHours?: number; durationMin?: number } {
  const s = q || '';
  const out: { totalHours?: number; durationMin?: number } = {};
  const PER = /每(?:次|回|天|日)/;

  const perMin = /每(?:次|回|天|日)?\s*(\d+(?:\.\d+)?)\s*分钟/.exec(s);
  if (perMin) out.durationMin = Math.round(Number(perMin[1]));

  const perHour = /每(?:次|回|天|日)?\s*(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|h|H)/i.exec(s);
  if (perHour) out.durationMin = Math.round(Number(perHour[1]) * 60);

  const total = /(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|h|H)/i.exec(s);
  if (total) {
    const idx = total.index ?? 0;
    const before = s.slice(Math.max(0, idx - 4), idx);
    // 「每次 N 小时」已归入单次时长，不再重复计入总量
    if (!PER.test(before)) out.totalHours = Number(total[1]);
  }
  return out;
}

/** 抽频率（每周几次）。「每周」但没给次数 → `undefined`，由上层追问。 */
export function extractFrequency(q: string): number | undefined {
  const s = q || '';
  if (/每天|每日|天天/.test(s)) return 7;
  if (/(隔天|每两天|每2天)/.test(s)) return 4; // 近似：一周约 3–4 次，取 4
  const m = /每(?:周|星期|礼拜)\s*([一二三四五六七八九十\d]{1,3})\s*次/.exec(s);
  if (m) return cnToInt(m[1]);
  return undefined;
}

/** 抽地点。只认「在/去/到 + X楼/馆/厅/室/中心/食堂」这种可判定的形态。 */
export function extractPlace(q: string): string | undefined {
  const m = /(?:在|去|到|往|前往)\s*([\u4e00-\u9fff]{2,14}?(?:楼|馆|厅|室|中心|食堂|苑|广场))/.exec(q || '');
  return m ? m[1] : undefined;
}

/** 抽时段窗（「只在晚上」）。 */
export function extractWindow(q: string): TimeWindow | undefined {
  const s = q || '';
  for (const w of PERIOD_WORDS) {
    if (w.re.test(s)) return { fromMin: w.fromMin, toMin: w.toMin, text: w.text };
  }
  const m = /(\d{1,2}):(\d{2})\s*(?:之后|以后|开始)/.exec(s);
  if (m) {
    return { fromMin: Number(m[1]) * 60 + Number(m[2]), toMin: 23 * 60, text: m[0] };
  }
  return undefined;
}

/** 抽「对哪一块动手」（换时间 / 取消用）。 */
export function extractTarget(q: string): string | undefined {
  const s = q || '';
  const m = /把\s*([\u4e00-\u9fffA-Za-z0-9]{2,16}?)\s*(?:挪|移|改|调|取消|删|换)/.exec(s);
  if (m) return m[1];
  const m2 = /(?:取消|删掉|退掉)\s*([\u4e00-\u9fffA-Za-z0-9]{2,16})/.exec(s);
  if (m2) return m2[1];
  return undefined;
}

/** 抽是否「必做」+ 可让步度。有明确截止或强调词 → 更不该被挤掉。 */
export function extractPriority(q: string): { essential?: boolean; priorityHint: number } {
  const s = q || '';
  const hasDue = /(截止|deadline|之前|前交|前完成|必须交)/i.test(s);
  const strong = /(必须|一定要|务必|重要|关键|不可错过)/.test(s);
  const weak = /(尽量|最好|有空|顺便|闲了)/.test(s);
  const essential = hasDue || strong;
  return { essential: essential || undefined, priorityHint: essential ? 95 : weak ? 75 : 85 };
}

/* ============================================================
 * 四、日期换算（与「听」分开 —— 听到什么 vs 落到哪一天）
 * ========================================================== */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 时间表达 → ISO 区间。
 *
 * **为什么单独一层**：`extractWhen` 的产物是「原话的语义」（九月中旬），
 * 换算成日期要依赖「今天是几号」。把两者分开，规则层就能在不注入时钟的情况下
 * 被确定性测试 —— 与项目里 `buildPhases` / `events` 「纯函数、不读时钟」的纪律一致。
 *
 * @param today 基准日（ISO）。由调用方传，**不在这里读 `new Date()`**。
 */
export function resolveWhen(
  hint: WhenHint | undefined,
  today: string,
): { from?: string; to?: string; certainty: TimeCertainty } {
  if (!hint) return { certainty: 'unknown' };
  if (hint.kind === 'vague') return { certainty: 'unknown' };

  const base = new Date(`${today}T00:00:00`);
  if (Number.isNaN(base.getTime())) return { certainty: 'unknown' };

  if (hint.kind === 'exact' && hint.month && hint.day) {
    // 没写年份 → 取「不早于今天太久」的最近一次（3 月问「九月中旬」= 今年 9 月）
    let year = base.getFullYear();
    const mk = (y: number) => new Date(y, hint.month! - 1, hint.day!);
    if (mk(year).getTime() < base.getTime() - 90 * 864e5) year += 1;
    const iso = isoOf(mk(year));
    return { from: iso, to: iso, certainty: 'exact' };
  }

  if (hint.month) {
    let year = base.getFullYear();
    const span: [number, number] =
      hint.decade === 'early' ? [1, 10] :
      hint.decade === 'middle' ? [11, 20] :
      hint.decade === 'late' ? [21, 28] : [1, 28];
    if (new Date(year, hint.month - 1, span[0]).getTime() < base.getTime() - 90 * 864e5) year += 1;
    return {
      from: isoOf(new Date(year, hint.month - 1, span[0])),
      to: isoOf(new Date(year, hint.month - 1, span[1])),
      certainty: 'window',
    };
  }

  if (hint.kind === 'relative') {
    const d = new Date(base);
    if (hint.relativeDays != null) {
      d.setDate(d.getDate() + hint.relativeDays);
      return { from: isoOf(d), to: isoOf(d), certainty: 'exact' };
    }
    if (hint.relativeWeeks != null) {
      // 周一为一周之始 —— 与 `currentWeekNo` 的口径一致
      const monday = new Date(d);
      const dow = (monday.getDay() + 6) % 7; // 0 = 周一
      monday.setDate(monday.getDate() - dow + hint.relativeWeeks * 7);
      if (hint.weekday != null) {
        const one = new Date(monday);
        one.setDate(monday.getDate() + (hint.weekday - 1));
        return { from: isoOf(one), to: isoOf(one), certainty: 'exact' };
      }
      const sun = new Date(monday);
      sun.setDate(monday.getDate() + 6);
      return { from: isoOf(monday), to: isoOf(sun), certainty: 'window' };
    }
  }

  // 学期词 / 只有原话 → 交给上层用校历换算
  return { certainty: 'window' };
}

/* ============================================================
 * 五、缺口与追问
 * ========================================================== */

/** 每个动作**最少**要齐哪些槽位。缺了不许执行，只能追问。 */
const REQUIRED: Record<GoalIntent, SlotKey[]> = {
  create: ['title', 'when', 'effort'],
  replace: ['title', 'target', 'when', 'effort'],
  reschedule: ['target', 'when'],
  cancel: ['target'],
  query: [],
};

/** `effort` 的满足条件：给了总时长，**或**给了「每周几次 × 每次多久」。居其一即可。 */
function hasEffort(s: IntentSlots): boolean {
  if (s.totalHours != null && s.totalHours > 0) return true;
  return s.perWeekCount != null && s.durationMin != null;
}

/** 算缺口。这是**唯一**的完备性判定 —— 别在别处再写一份「算不算缺」。 */
export function missingSlots(s: IntentSlots): SlotKey[] {
  const out: SlotKey[] = [];
  for (const k of REQUIRED[s.intent]) {
    if (k === 'title' && !s.title) out.push(k);
    else if (k === 'when' && !s.when) out.push(k);
    else if (k === 'effort' && !hasEffort(s)) out.push(k);
    else if (k === 'target' && !s.targetHint) out.push(k);
  }
  return out;
}

/** 槽位 → 追问话术。**一次只问关键的 1–2 个**，不抛问卷（`topQuestions` 负责截断）。 */
const SLOT_QUESTION: Record<SlotKey, string> = {
  title: '你想让我排的是哪件事？（比如「数学建模备赛」「四六级真题」）',
  when: '大概什么时候开始？给个区间也行（比如「九月中旬」），没定的话我按待定处理。',
  effort: '打算投入多少？说总量（「一共 20 小时」）或节奏（「每周 3 次、每次 2 小时」）都行。',
  target: '你要动的是哪一块？说个名字我好找到它。',
};

export function clarifyQuestions(s: IntentSlots): Array<{ slot: SlotKey; question: string }> {
  return s.missing.map((slot) => ({ slot, question: SLOT_QUESTION[slot] }));
}

/** 只取最关键的 n 条追问（默认 2）—— 一次问太多，用户就不答了。 */
export function topQuestions(s: IntentSlots, n = 2): string[] {
  // 顺序即优先级：目标 > 对象 > 时间 > 投入。
  // 「做什么」都没弄清时先问时长，是浪费一轮对话。
  const order: SlotKey[] = ['title', 'target', 'when', 'effort'];
  return order
    .filter((k) => s.missing.includes(k))
    .slice(0, Math.max(0, n))
    .map((k) => SLOT_QUESTION[k]);
}

/* ============================================================
 * 五·半、追问接续（多轮对话的「下半句」）
 * ========================================================== */

/**
 * 把用户对**追问**的回应合并进原槽位。
 *
 * ── 为什么必须有这个函数 ──────────────────────────────────────
 * 追问「打算投入多少」之后，用户回「每周 3 次、每次 2 小时」——
 * 这句话单独看**不是**一个动作句（没有目标名词、没有第一人称），
 * `looksLikeAction` 判 false 是**对的**；错的是此前没人记得「上一句在等答案」，
 * 于是这句话掉进 RAG 问答，被记忆层里的别的内容带偏。
 *
 * 规则：
 *  ① **只填 `prev.missing` 里的槽位** —— 已听懂的字段不允许被一句碎片回答改写
 *     （与纪律①「规则抽到的不被覆盖」同源：已确认的槽位是规则的产物）。
 *  ② 回应里**没有任何缺口相关的内容** → `contributed=false`，调用方按普通消息分流。
 *     「图书馆几点开门」不是答案，别硬吃。
 *  ③ 合并后重算 `missing`（这是唯一的完备性判定，别处不许再写一份）。
 */
export function applyClarifyAnswer(
  q: string,
  prev: IntentSlots,
  today?: string,
): { slots: IntentSlots; contributed: boolean } {
  const reply = parseIntentSlots(q, today);
  const out: IntentSlots = { ...prev };
  let contributed = false;

  // title：回应里抽得到更具体的名字才收（「就叫高数吧」这种我们目前抽不到，不强求）
  if (prev.missing.includes('title') && reply.title) {
    out.title = reply.title;
    contributed = true;
  }

  // when：回应给了时间表达才收（「十月开始吧」「下周三」）
  if (prev.missing.includes('when') && reply.when) {
    out.when = reply.when;
    if (reply.dateFrom) out.dateFrom = reply.dateFrom;
    if (reply.dateTo) out.dateTo = reply.dateTo;
    out.certainty = reply.certainty;
    contributed = true;
  }

  // effort：节奏（每周 N 次 / 每次 M 分钟）或总量（一共 N 小时）居其一即算补了一块。
  // ⚠️ 补一半（只给了「每次 1 小时」没给次数）也算 contributed —— 剩下的缺口重新追问，
  //    而不是把用户给的半份信息扔掉再问一遍全量。
  if (prev.missing.includes('effort')) {
    if (reply.perWeekCount != null && out.perWeekCount == null) {
      out.perWeekCount = reply.perWeekCount;
      contributed = true;
    }
    if (reply.durationMin != null && out.durationMin == null) {
      out.durationMin = reply.durationMin;
      contributed = true;
    }
    if (reply.totalHours != null && out.totalHours == null) {
      out.totalHours = reply.totalHours;
      contributed = true;
    }
  }

  // target：换/取消场景下「就动高数复习那一块」
  if (prev.missing.includes('target') && reply.targetHint) {
    out.targetHint = reply.targetHint;
    contributed = true;
  }

  out.missing = missingSlots(out);
  return { slots: out, contributed };
}

/* ============================================================
 * 六、对外：解析一句话
 * ========================================================== */

function emptySlots(raw: string): IntentSlots {
  return {
    intent: 'create',
    title: '',
    certainty: 'unknown',
    priorityHint: 85,
    missing: [],
    unclear: [],
    raw,
  };
}

/**
 * 规则解析（不读时钟、不联网、同输入同输出）。
 *
 * @param today 给了才做日期换算（`dateFrom` / `dateTo`）；不给则只保留语义。
 */
export function parseIntentSlots(q: string, today?: string): IntentSlots {
  const raw = (q || '').trim();
  const s = emptySlots(raw);

  s.intent = detectIntent(raw);
  s.title = extractTitle(raw);

  const when = extractWhen(raw);
  if (when) s.when = when;

  const effort = extractEffort(raw);
  if (effort.totalHours != null) s.totalHours = effort.totalHours;
  if (effort.durationMin != null) s.durationMin = effort.durationMin;

  const freq = extractFrequency(raw);
  if (freq != null) s.perWeekCount = freq;

  const place = extractPlace(raw);
  if (place) s.place = place;

  const win = extractWindow(raw);
  if (win) s.window = win;

  const target = extractTarget(raw);
  if (target) s.targetHint = target;

  const pri = extractPriority(raw);
  if (pri.essential) s.essential = true;
  s.priorityHint = pri.priorityHint;

  if (today) {
    const r = resolveWhen(when, today);
    if (r.from) s.dateFrom = r.from;
    if (r.to) s.dateTo = r.to;
    s.certainty = r.certainty;
  } else {
    s.certainty = !when ? 'unknown'
      : when.kind === 'exact' ? 'exact'
      : when.kind === 'vague' ? 'unknown'
      : 'window';
  }

  // 纪律③：有锚点 + 明说没定 → 保留锚点，但如实把确定性降为 unknown
  if (when?.unspecified) s.certainty = 'unknown';

  // 歧义（不阻塞，随草稿一起说明）—— 备赛类诉求最常见的缺口就是「只有起点没有终点」
  if (s.when && s.when.kind !== 'vague' && !s.dateTo && s.intent === 'create') {
    s.unclear.push('没说到什么时候为止 —— 我先按一个默认窗口排，你可以再改。');
  }
  if (s.when && (s.when.kind === 'window' || s.when.kind === 'vague') && !s.dateFrom) {
    s.unclear.push('这个时间要靠校历才能落到具体哪一周，我先按当前周往后排。');
  }
  if (s.perWeekCount == null && s.totalHours != null) {
    s.unclear.push('没给每周几次 —— 我按「总量摊到窗口内」来排。');
  }

  s.missing = missingSlots(s);
  return s;
}

/**
 * LLM 补空后的合并。
 *
 * **规则抽到的字段一律不被覆盖**（纪律①）：LLM 只在空位上写。
 */
export function mergeSlots(rule: IntentSlots, llm: Partial<IntentSlots> | null): IntentSlots {
  if (!llm) return rule;
  // 收窄后落到 const：TS 不会把参数上的收窄带进嵌套函数体（参数是可变的）
  const src: Partial<IntentSlots> = llm;
  const out: IntentSlots = { ...rule };

  function fill<K extends keyof IntentSlots>(k: K): void {
    const next = src[k];
    if (next == null) return;
    const cur = out[k];
    if (cur == null || (typeof cur === 'string' && cur === '')) {
      out[k] = next as IntentSlots[K];
    }
  }
  fill('title');
  fill('when');
  fill('dateFrom');
  fill('dateTo');
  fill('perWeekCount');
  fill('durationMin');
  fill('totalHours');
  fill('place');
  fill('window');
  fill('targetHint');

  if (out.intent === 'create' && llm.intent && llm.intent !== 'create') out.intent = llm.intent;

  out.missing = missingSlots(out);
  return out;
}

/**
 * 对外唯一入口。
 *
 * 流程：快筛 → 规则解析 → （可选）LLM 补空 → 重算缺口。
 * `action === false` 时调用方应把问题交回 RAG 问答老路径 —— 这不是失败，
 * 是「这句不该动日程」的正常判定。
 */
export async function parseGoalIntent(
  q: string,
  opts: { today?: string; llm?: LlmExtractor } = {},
): Promise<ParseOutcome> {
  if (!looksLikeAction(q)) {
    return { action: false, slots: parseIntentSlots(q, opts.today), source: 'rule' };
  }

  let slots = parseIntentSlots(q, opts.today);
  let source: ParseOutcome['source'] = 'rule';

  // 只在**确有缺口**时打扰 LLM —— 规则抽全了的句子走 LLM 是白花钱
  if (opts.llm && slots.missing.length > 0) {
    try {
      const patch = await opts.llm(slots.raw, slots);
      if (patch) {
        slots = mergeSlots(slots, patch);
        source = 'rule+llm';
      }
    } catch {
      // LLM 失败**不降级成错误**：已经拿到的槽位仍然有效，
      // 剩下的缺口由追问补 —— 这正是「规则保底」的意义。
    }
  }

  return { action: true, slots, source };
}

/** 草稿卡回显用：把听懂的与没听懂的都说清楚，让用户一眼能核对。 */
export function describeSlots(s: IntentSlots): string[] {
  const verb: Record<GoalIntent, string> = {
    create: '新增',
    replace: '替换',
    reschedule: '改时间',
    cancel: '取消',
    query: '只看看',
  };
  const out: string[] = [`动作：${verb[s.intent]}`];
  out.push(`事情：${s.title || '（没听清）'}`);
  out.push(
    s.when
      ? `时间：${s.when.text}${s.when.unspecified ? '（你说还没定，我按待定排）' : ''}`
      : '时间：（你没提）',
  );
  if (s.totalHours != null) out.push(`总投入：约 ${s.totalHours} 小时`);
  if (s.perWeekCount != null) out.push(`频率：每周 ${s.perWeekCount} 次`);
  if (s.durationMin != null) out.push(`单次：${s.durationMin} 分钟`);
  if (s.place) out.push(`地点：${s.place}`);
  if (s.window) out.push(`只在：${s.window.text}`);
  if (s.targetHint) out.push(`对象：${s.targetHint}`);
  return out;
}
