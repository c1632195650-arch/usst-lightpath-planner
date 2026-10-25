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

/**
 * ── 时间解析域已拆出（2026-10-24，D1-批1）──────────────────────
 * 本文件的时间表达式解析族（extract* / resolveWhen / termAnchorsFrom /
 * spanDurationMin / clockChannelOn 及其类型与私有助手）已**逐字节搬运**至
 * 「./timeParse.ts」（行为不变，仅文件组织变化）。本文件按原名 re-export，
 * 既有 import 面（LbaoChat / weekPlanForChat / 测试）零变化；内部改从 timeParse 引入。
 */
import {
  clockChannelOn,
  cnAmount,
  cnToInt,
  extractClockRange,
  extractConcreteWhen,
  extractEffort,
  extractFrequency,
  extractPlace,
  extractReplanDays,
  extractTarget,
  extractTargetWhen,
  extractWhen,
  extractWindow,
  resolveWhen,
  spanDurationMin,
  termAnchorsFrom,
  WD_NUM,
  type ClockHint,
  type ResolveTermOpts,
  type TermCalendarLike,
  type TimeCertainty,
  type TimeWindow,
  type WhenHint,
} from './timeParse';

export {
  clockChannelOn,
  extractClockRange,
  extractEffort,
  extractFrequency,
  extractPlace,
  extractReplanDays,
  extractTarget,
  extractTargetWhen,
  extractWhen,
  extractWindow,
  resolveWhen,
  spanDurationMin,
  termAnchorsFrom,
} from './timeParse';
export type {
  ClockHint,
  ResolveTermOpts,
  TermCalendarLike,
  TimeCertainty,
  TimeWindow,
  WhenHint,
} from './timeParse';

/** 用户想对日程做的动作。 */
export type GoalIntent =
  | 'create'      // 新增一件事
  | 'replace'     // 用新安排顶掉已排的某块
  | 'reschedule'  // 同一件事换时间
  | 'cancel'      // 取消已排的事
  | 'query'       // 只问不建议（「我这周忙不忙」）
  | 'add_deadline' // WP11：记一条重要日/截止日（要比赛/要考/截止/备赛/重要日子）
  | 'hold'        // V2-2：这段时间别排（写 unavailableSlots —— 与调课语义不同，见 weekPlanForChat 注释）
  | 'watch';      // W11：半代办「盯一件事」（盯着/提醒我/别让我忘 → 建 deadline，每步确认）

/** 槽位名。`missing` 用它，追问清单也用它 —— 一处定义，两处消费。 */
export type SlotKey =
  | 'title'      // 做什么（「数学建模备赛」）
  | 'when'       // 什么时候（起点/区间）
  | 'effort'     // 投入多少（总时长，或「每周 N 次 × 每次 M 分钟」）
  | 'target';    // 对哪一块动手（换/取消/替换时才需要）

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
  /** 钟点起止（批次 1）：「晚上6点到8点」→ 1080/1200。加法通道：句中无钟点词 = undefined */
  clock?: ClockHint;
  /** 是否必做（有交期或用户强调）→ 映射到 `UserTask.essential` */
  essential?: boolean;
  /** 可让步度：越高越不该被别的安排挤掉 */
  priorityHint: number;
  /** 「把高数复习挪到周四」→ 高数复习 */
  targetHint?: string;
  /**
   * 「要动的那块」的定位时间（2026-10-07，按确切时间定位）：与 `when`/`clock`（新时间）分开。
   * 「把周三 14:00 的自习换成周五 15:00」→ targetDay=3 + targetClock{840}，when.weekday=5 + clock{900}。
   * 「删掉周三下午两点那个自习」→ 只有 target*，没有新时间。
   */
  targetDay?: number;
  targetClock?: ClockHint;
  /** 单日重排的目标天（批 3，5A-②）：「重排周四」→ [4]。与 targetHint 互斥路由：
   *  有块名 = 单块挪动；只有天 = 整日重排（执行层分流） */
  replanDays?: number[];
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
  /** `llm+rule` = LLM 主理解（T 批换向）；`rule+llm` = 规则先行 LLM 补空；`rule` = 纯规则 */
  source: 'rule' | 'rule+llm' | 'llm+rule';
}

/** LLM 抽取器 —— 由调用方注入（后端 tool call / 本地模型皆可），本模块不关心实现 */
export type LlmExtractor = (raw: string, seed: IntentSlots) => Promise<Partial<IntentSlots> | null>;

/**
 * LLM 裁决（T 批换向 · 「LLM 先看一眼」）。
 *
 * 与 `LlmExtractor`（只补空）的区别：这是**主理解层**的 verdict ——
 * LLM 先于关键词闸门看到每一句话，独立判断「要不要动日程」并给出槽位
 * patch；规则层退到结构化校验位（mergeLlmPrimary）与离线兜底位。
 *
 * CY 真机翻车（2026-09-27 晚）：「周二晚上；6点到7点」这类无名词无动词的
 * 续答句，关键词闸门数学上不可能穷尽 —— 只有让 LLM 先看才关得掉这个洞。
 */
export interface LlmVerdict {
  action: boolean;
  intent?: GoalIntent;
  patch: Partial<IntentSlots>;
  /** 0–1。action=false 且置信 < 0.6 → 调用方落回规则链路（不信 LLM 的含糊否决） */
  confidence: number;
}

/** 返回 null = 端点挂/离线/解析坏 → 调用方整体落回规则链路（不是「判非动作」）。 */
export type LlmJudge = (raw: string, seed: IntentSlots, history?: string[]) => Promise<LlmVerdict | null>;

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
  // 名义化动词（用户口中的「那件事」）+ 引擎块名（改期/取消的目标常是「自习」——W5 验收抓到）
  '备赛', '备考', '复习', '刷题', '预习', '练习', '自习', '晚自习',
  // 其他
  '证书', '实习', '社团', '招新',
  // 生活事件（「周四我要吃大餐」这类单日安排 —— 2026-09-20 CY 真实使用翻车）
  '大餐', '聚餐', '庆功', '生日',
  // S2a（2026-10-07）：休闲事件 —— 「周末想去看电影」的自然陈述族要有落点
  '电影',
  // 事务性事件（2026-09-27 CY 真机三连翻车：「我明天有一个学生会面试」——
  // 「面试」不在词表 → 标题抽空 → 要么掉进 RAG 聊天，要么被当成泛泛一周建议）
  '面试', '答辩', '宣讲', '讲座', '体检', '例会', '班会', '团建',
  // 组织/事务补充 + 习惯目标（批 1.1，金标 i02/i29/i30）：「学生会」让 title 能
  // 扩出「学生会面试」；晨跑/健身族是习惯陈述句（「隔天去一次健身房」）的目标名词
  '学生会', '开题报告', '晨跑', '跑步', '健身', '健身房', '背单词', '晨读',
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
  // WP9 收口（2026-09-27 真机 W5 验收抓到）：改期/取消语族的动词不在词表 →
  // detectIntent 认得 reschedule，但 looksLikeAction 拦下 → 整句漏判成 RAG。
  '挪', '换到', '改到', '调到', '取消',
  // 完成语族（批 1.1，金标 i25）：「期末周之前把实验报告写完」——
  // 「写完」本身就是要排的事，且不在标题词里（TITLE_STOP 同步拦截）。
  '写完', '做完', '弄完',
];

/** 第一人称意愿 —— 命中即视为「要动日程」（用户已经在表达自己的事） */
const SELF_INTENT = ['我要', '我想', '我打算', '我准备', '帮我', '给我', '替我', '想要', '打算要'];

/** WP11：重要日触发词 —— 说的是「有件带截止日的事」，不一定是「排一块」 */
const DEADLINE_MARK = ['要比赛', '要考', '截止', '备赛', '重要日子'];

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
 * 疑问词守卫（批 1.1）：陈述句兜底只认「无疑问词」的句子 —— 问句一律留给 RAG。
 * 金标 b03「今天校园里有什么讲座」、b06「学校有什么社团」都是
 * 「时间词 + 目标名词」的问句形态，没有这道守卫就会被新兜底误拽进排程。
 */
const QUESTIONISH_RE = /(什么时候|何时|几号|几点|哪|多少|几个|什么|怎么|如何|怎样|咋|吗)/;

/** 频率约定词（批 1.1）：「隔天去一次健身房」这类习惯陈述的判据之一；
 *  批 1.5 起兼作 mergeLlmPrimary 的 perWeek 证据词（「每周3次」也是频率证据） */
const FREQ_RE = /(每天|每日|天天|隔天|每两天|每周|每星期|每礼拜|每[一二三四五六七八九十\d]+\s*次)/;

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

/**
 * S2a（2026-10-07）：自然计划陈述族 —— 「我明天打算去吃大餐」「周末想去看电影」
 * 这类口语陈述。真实用户不总说「帮我排一下」（LEGACY_RECOMMEND 的命令式口径），
 * 「打算/想去/要去/想吃」是同一诉求的自然说法。
 * ⚠️ 只是**补充证据**（与 LEGACY_RECOMMEND 并列），不改老口径 —— 纪律④。
 */
export const NATURAL_PLAN_RE = /(打算|准备|计划|想去|要去|约了|想去看|想去吃|想吃|想喝|要去吃|要去玩)/;

/**
 * S2a：动词性「打算/准备/计划」**紧跟去/要**时是动词不是名词（「我打算去吃大餐」），
 * 抽标题时不能让它把左扩切断在半截（「吃」带不上）。extractTitle 先把「动词+去/要」
 * 整体掩成占位符（与 TERM_ANCHOR_USAGE 同法）：占位符不是 TITLE_CHAR，左扩到它自然停
 * —— 标题干净地落在动词之后（「吃大餐」）。名词性的「我的打算」不紧跟去/要 → 不受影响，仍停。
 */
const PLAN_VERB_MASK_RE = /(打算|准备|计划)(去|要)/;

/** 动作识别（决定 intent 枚举）。顺序敏感：取消 > 改时间 > 替换 > 只问 > 新增。 */
const INTENT_PATTERNS: Array<{ intent: GoalIntent; re: RegExp }> = [
  // V2-2：hold 在 cancel 之前 —— 「周三下午别排东西」是「留空一段时间」，
  // 不是「取消某块」；cancel 的「别排」让位给 hold（台账申报）。
  { intent: 'hold', re: /(别排|不要排|留出来|空出来|这段时间有空|没空)/ },
  { intent: 'cancel', re: /(取消|删掉|不去了|不参加了|退掉|不要了)/ },
  { intent: 'reschedule', re: /(挪到|挪一下|移到|改到|换个时间|换到|推迟|提前|调到|重排|重新排)/ },
  { intent: 'replace', re: /(替换|顶掉|改成|换成|取代)/ },
  { intent: 'query', re: /(忙不忙|排得开|来不来得及|有没有空|有空吗|装得下|排得下)/ },
  // WP11：重要日。**放最后** —— 「取消备赛」「把备赛挪到周五」得先被既有意图接住
  { intent: 'add_deadline', re: /(要比赛|要考|截止|备赛|重要日子)/ },
  // W11（2026-10-25）：半代办「盯一件事」——盯/提醒我/别让我忘。放 add_deadline 之后：
  // 「要盯着六级报名」的「报名」不抢；「取消提醒」先被 cancel 接住。
  { intent: 'watch', re: /(盯着|盯一下|提醒我|别让我忘|帮我盯|盯紧)/ },
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
  '打算', '主意', '想法', '一下', '一点', '一些', '一次', '一个', '一段', '个',
  '时间', '时候',
  '出',
  '的', '了', '着', '过', '把', '在', '和', '与', '跟', '为', '给', '到', '从',
  '我', '你', '他', '她', '它', '们', '这', '那', '是', '有', '要', '想', '能', '会',
  '请', '帮', '就', '还', '也', '都', '很', '最', '再', '又',
  '交',
  // 批 1.1（金标 title 对齐）：时段词不是目标的一部分（「周五晚上班级聚餐」→ 聚餐）；
  // 「次」不是（「去一次健身房」→ 健身房）；完成词族与「完」不是（「实验报告写完」→ 实验报告）
  '早上', '早晨', '上午', '中午', '下午', '晚上', '晚间', '次', '写完', '做完', '弄完', '完',
];

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

  // 批 1.1（金标 i02/i29）：「我周五下午要在学生会面试」「我每天要晨跑」——
  // 意愿词被时间词隔开，连续匹配抓不到。放宽为「我 + ≤6 个非标点字符 + 意愿词」，
  // 但间隔里不许含疑问/建议词（「我什么时候要交作业」是问句，得留给下面的 PURE_FACT）。
  const selfGap = /我([^，。！？,.；;?？!！\s]{1,6}?)(要|想|打算|准备)/.exec(s);
  if (selfGap && !PURE_FACT.some((t) => selfGap[1].includes(t))
    && !ADVICE_MARK.some((t) => selfGap[1].includes(t))) return true;

  if (LEGACY_RECOMMEND.test(s)) return true;
  if (LEGACY_RECOMMEND_DAY.test(s) && LEGACY_RECOMMEND_ACT.test(s)) return true;

  if (PURE_FACT.some((t) => s.includes(t))) return false;
  if (ADVICE_MARK.some((t) => s.includes(t))) return false;

  // S2a（2026-10-07）：自然计划陈述 —— 计划词 +（时间/地点/事由任一线索），无疑问词。
  // 疑问词守卫是硬前提：「打算去哪里玩」是问句，留给 RAG。
  if (NATURAL_PLAN_RE.test(s) && !QUESTIONISH_RE.test(s)
    && (extractConcreteWhen(s) != null || extractPlace(s) != null
      || GOAL_NOUNS.some((n) => s.includes(n)))) return true;

  // 批 1.1（金标 i21）：「我这周忙不忙」是 query 意图的排程语境 —— detectIntent
  // 早就认得，快筛却把它拦成 RAG。放在 ADVICE 之后：「忙不忙是怎么算的」这类
  // 求解释的句子已在上一步被拦，走不到这里。（「有没有空」与 PURE_FACT 的
  // 「有没有」相抵，维持现状不在此放行。）
  if (/(忙不忙|排得开|来不来得及|排得下|装得下)/.test(s)) return true;

  // WP11：重要日/截止类诉求 —— 说的是「有件带截止日的事」。
  // 刻意放在 ADVICE 门**之后**：「怎么备赛」是求方法，不该被拽进来。
  if (DEADLINE_MARK.some((t) => s.includes(t))) return true;

  // V2-2（2026-09-27 E2E 走查抓到）：「这段时间别排」族 —— hold 也是**动日程**的
  // 动作（留白），但动词不在 ACTION_VERBS、名词不在 GOAL_NOUNS → 整句漏成 RAG。
  // 触发词与 INTENT_PATTERNS 的 hold 条目同源（别排/不要排/留出来/空出来/这段时间有空/没空）。
  if (/(别排|不要排|留出来|空出来|这段时间有空|没空)/.test(s)) return true;

  // 批 3：显式重排诉求 —— 「重排周四」没有目标名词（对象是「那天」本身），
  // 词表扫不出，必须显式放行。
  if (/(重新?排|重排)/.test(s)) return true;

  const hasGoal = GOAL_NOUNS.some((n) => s.includes(n));
  const hasVerb = ACTION_VERBS.some((v) => s.includes(v));
  if (hasGoal && hasVerb) return true;

  // 批 1.1（金标 i23/i29/i30）：习惯/日程**陈述句**兜底 —— 目标名词 +（频率约定
  // 或具体时间表达）+ 无疑问词。「周五晚上班级聚餐」「隔天去一次健身房」没有
  // 「我要」也没有动作动词，但说话人分明在交代日程素材。疑问词守卫是硬前提：
  // b03「今天校园里有什么讲座」同属「时间 + 名词」，必须留在 RAG。
  if (hasGoal && !QUESTIONISH_RE.test(s)
    && (FREQ_RE.test(s) || extractConcreteWhen(s) != null)) return true;

  // 陈述句兜底（2026-09-27 CY 真机翻车）：「我明天有一个学生会面试」——
  // 说话人在**交代日程素材**，却没有动作动词也没有「我要」字面，
  // 此前整句漏判 → 掉进 RAG 聊天，日程一块不排。
  // 判据收紧为「我 … 有 + 目标名词」：纯问句（「有什么比赛」）已被上面 PURE_FACT 拦住，
  // 走不到这里；「明天有雨」这类没有目标名词的也不命中。
  return hasGoal && /我[^，。！？]{0,8}有/.test(s);
}

/** 判断 intent。 */
export function detectIntent(q: string): GoalIntent {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(q)) {
      // WP11 口径：带排程动词或投入信号的「备赛」等是「排准备块」的 create ——
      // 「帮我规划备赛」要排块，「快截止了」才是记节点。
      if (intent === 'add_deadline' && /安排|规划|排|每周|每天|小时|分钟/.test(q)) return 'create';
      return intent;
    }
  }
  return 'create';
}

/* ============================================================
 * 二·五、重要日提案（WP11）—— 纯函数，LbaoChat 消费
 * ========================================================== */

export interface DeadlineProposal {
  title: string;
  /** 截止日（ISO），来自 resolveWhen 的 dateFrom */
  date: string;
  /** 提前几天开始准备（缺省 7；给了总投入按 每 2 小时提前 1 天 估，夹在 3–14） */
  prepDays: number;
  /** 建议卡文案（过风格口径：不替用户拍板，先问） */
  message: string;
}

/**
 * W11（2026-10-25）：watch 意图 → 半代办提案（盯一件事 = 记一条无 prep 的重要日）。
 * 复用 add_deadline 的确认卡片机制；每步确认（建前展示卡片、可一键撤销）——
 * L3 边界：替用户记事可以，替用户决定不行。
 * 缺日期 → `{ needDate: true }`（追问「盯到什么时候」），不许猜。
 */
export function watchProposal(slots: IntentSlots): DeadlineProposal | { needDate: true } {
  if (!slots.dateFrom || slots.certainty === 'unknown') return { needDate: true };
  const title = slots.title || '要盯的事';
  const date = slots.dateFrom;
  const md = date.slice(5).replace('-', '.');
  return {
    title,
    date,
    prepDays: 0, // 盯事不产准备块——只提醒
    message: `要不要盯「${title}」？我会在 ${md} 截止前提醒你（重要日里可随时取消）`,
  };
}

/**
 * add_deadline 槽位 → 重要日提案。
 * 缺日期（没说到 / 明说没定）→ `{ needDate: true }`，调用方**必须追问**，不许猜。
 */
export function deadlineProposal(slots: IntentSlots): DeadlineProposal | { needDate: true } {
  if (!slots.dateFrom || slots.certainty === 'unknown') return { needDate: true };
  const title = slots.title || '重要日子';
  const date = slots.dateFrom;
  const prepDays = Math.max(3, Math.min(14, slots.totalHours ? Math.ceil(slots.totalHours / 2) : 7));
  const md = date.slice(5).replace('-', '.');
  return {
    title,
    date,
    prepDays,
    message: `要不要按 ${md} 建立「${title}」重要日？我会提前 ${prepDays} 天开始帮你安排准备`,
  };
}

/* ============================================================
 * 三、逐槽位抽取（纯规则）
 * ========================================================== */

/** 能拼进标题的字符（中文、字母、数字） */
const TITLE_CHAR = /^[\u4e00-\u9fffA-Za-z0-9]+$/;

/** 学期词作**时间锚**的形态（批 1.4）：后面紧跟「之前/以前/前」——
 *  此时它是修饰语不是目标（「期末考试前我要把高数复习完」要排的是高数复习） */
const TERM_ANCHOR_USAGE = /(期末考试周?|期末周?|期中考试周?|期中|开学|学期末|考试周)(之前|以前|前)/;

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
  let s = q || '';

  // 批 1.4：学期词作时间锚不参与 title —— 等长占位掩码保住 indexOf 的位置映射，
  // 左右扩展撞到占位符（非 TITLE_CHAR）自然停。
  const anchor = TERM_ANCHOR_USAGE.exec(s);
  if (anchor) {
    s = s.slice(0, anchor.index) + '○'.repeat(anchor[0].length) + s.slice(anchor.index + anchor[0].length);
  }

  // S2a：动词性「打算/准备/计划 + 去/要」掩成占位符 —— 左扩撞到它就停，
  // 标题不带动词残渣（「我打算去吃大餐」→「吃大餐」）。名词性「打算」不匹配，仍走停用词。
  const planVerb = PLAN_VERB_MASK_RE.exec(s);
  if (planVerb) {
    s = s.slice(0, planVerb.index) + '○'.repeat(planVerb[0].length) + s.slice(planVerb.index + planVerb[0].length);
  }

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

/** 时段词回看：返回 'pm'（下午/晚上族）| 'am'（上午/早上/中午族）| undefined。 */
function getLatestPeriodWord(s: string): 'pm' | 'am' | undefined {
  const PM = /(晚上|晚间|夜里|夜晚|傍晚|下午)/;
  const AM = /(早上|早晨|上午|中午)/;
  const pm = PM.exec(s);
  const am = AM.exec(s);
  if (pm && (!am || pm.index > am.index)) return 'pm';
  if (am) return 'am';
  return undefined;
}

/**
 * clock 落位（parseIntentSlots 与 mergeLlmPrimary 共用的收尾三步，批次 1）：
 *   ① clock 与 window 并存取**交集**；交集为空（钟点在时段窗外）→ 以 clock 为准、
 *      window 让位，并如实注记（不静默改口径）；
 *   ② 24 小时歧义注记（`ambig`）；
 *   ③ 时长推导：双端点齐且用户没给时长/总量 → durationMin = endMin − startMin
 *      （「6点到8点」= 120 分钟 —— 消灭「大概占多久？」重问的钥匙，方案 4.2）。
 * 三步全是空值短路：clock 不存在时一个字段都不碰。
 */
function reconcileClock(s: IntentSlots): void {
  const clock = s.clock;
  if (!clock) return;
  const win = s.window;
  if (clock.startMin != null && clock.endMin != null && win) {
    if (clock.startMin >= win.toMin || clock.endMin <= win.fromMin) {
      s.window = undefined;
      s.clock = { ...clock, conflicted: win.text };
      s.unclear.push(`你说的${clock.text}与「${win.text}」对不上 —— 按你说的钟点排。`);
    } else {
      s.clock = {
        ...clock,
        startMin: Math.max(clock.startMin, win.fromMin),
        endMin: Math.min(clock.endMin, win.toMin),
      };
    }
  }
  if (s.clock?.ambig) {
    s.unclear.push(`「${s.clock.text}」没说上下午 —— 我先按上午的钟点理解，不对的话告诉我。`);
  }
  if (s.clock?.startMin != null && s.clock.endMin != null
    && s.durationMin == null && s.totalHours == null) {
    s.durationMin = s.clock.endMin - s.clock.startMin;
  }
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
 * 五、缺口与追问
 * ========================================================== */

/** 每个动作**最少**要齐哪些槽位。缺了不许执行，只能追问。 */
const REQUIRED: Record<GoalIntent, SlotKey[]> = {
  create: ['title', 'when', 'effort'],
  replace: ['title', 'target', 'when', 'effort'],
  reschedule: ['target', 'when'],
  cancel: ['target'],
  query: [],
  // 重要日只要「什么事 + 哪天截止」；准备量缺省（deadlineStore 有默认值）
  add_deadline: ['title', 'when'],
  // hold 只要「哪段时间」（哪天 + 起止）；没说窗就整天
  hold: ['when'],
  // W11：盯一件事只要「盯什么 + 盯到什么时候」（同重要日；不产准备块）
  watch: ['title', 'when'],
};

/**
 * 单日事件：只占**一个**块，所以「每次多久」就是全部投入 —— 不该再追问频率或总量。
 * 「周四吃大餐」「明天体检 1 小时」vs「备赛 20 小时」「每周 3 次」是两类诉求。
 * ⚠️ `recurring`（每周三）不算单日 —— 循环约定没有「一共占多久」的天然上限。
 */
export function isSingleDayEvent(s: IntentSlots): boolean {
  if (s.when?.recurring) return false;
  // 解析过日期（传了 today）：起止同一天 = 单日
  if (s.dateFrom && s.dateTo && s.dateFrom === s.dateTo) return true;
  const w = s.when;
  if (!w) return false;
  if (w.kind === 'exact') return true;
  // 没传 today 的语义层：明天/大后天、这周内的星期几
  if (w.kind === 'relative' && w.relativeDays != null) return true;
  if (w.kind === 'relative' && w.relativeWeeks === 0 && w.weekday != null) return true;
  return false;
}

/** `effort` 的满足条件：给了总时长，**或**给了「每周几次 × 每次多久」；
 *  单日事件给了单次时长即可（就一块，没有「几次」可言）。居其一即可。 */
function hasEffort(s: IntentSlots): boolean {
  if (s.totalHours != null && s.totalHours > 0) return true;
  if (s.perWeekCount != null && s.durationMin != null) return true;
  if (s.durationMin != null && s.durationMin > 0 && isSingleDayEvent(s)) return true;
  return false;
}

/** 算缺口。这是**唯一**的完备性判定 —— 别在别处再写一份「算不算缺」。 */
export function missingSlots(s: IntentSlots): SlotKey[] {
  const out: SlotKey[] = [];
  for (const k of REQUIRED[s.intent]) {
    if (k === 'title' && !s.title) out.push(k);
    else if (k === 'when' && !s.when) out.push(k);
    else if (k === 'effort' && !hasEffort(s)) out.push(k);
    // target：块名**或**定位时间（targetDay/targetClock）任一在即可 ——
    // 「删掉周三下午两点那个自习」没说名字但说清了时间，不该被追问
    else if (k === 'target' && !s.targetHint && s.targetDay == null && !s.targetClock) out.push(k);
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

/** 单槽追问话术。effort 对**单日事件**换问法 —— 问「投入多少」吃顿饭的人听不懂；
 *  例子带「每次」是为了把回答引向 `durationMin`（单日豁免认的就是它）。 */
function questionFor(s: IntentSlots, slot: SlotKey): string {
  if (slot === 'effort' && isSingleDayEvent(s)) return '大概占多久？（比如「每次 2 小时」）';
  return SLOT_QUESTION[slot];
}

export function clarifyQuestions(s: IntentSlots): Array<{ slot: SlotKey; question: string }> {
  return s.missing.map((slot) => ({ slot, question: questionFor(s, slot) }));
}

/** 只取最关键的 n 条追问（默认 2）—— 一次问太多，用户就不答了。 */
export function topQuestions(s: IntentSlots, n = 2): string[] {
  return topQuestionPairs(s, n).map((p) => p.question);
}

/**
 * `topQuestions` 的带槽位版：问出去的同时**记下问了哪些槽位**。
 *
 * 为什么必须有它（S 批 P5）：此前追问话术由 `topQuestions` 生成、应答由
 * `applyClarifyAnswer` 解析，两边各管各的 —— 应答方根本不知道当时问了什么，
 * 「第几问 ↔ 第几段答案」的位置对应无从谈起。现在追问出口统一用本函数，
 * 把 `slot` 清单存进会话态，`applyClarifyAnswers` 按位置消费。
 */
export function topQuestionPairs(s: IntentSlots, n = 2): Array<{ slot: SlotKey; question: string }> {
  // 顺序即优先级：目标 > 对象 > 时间 > 投入。
  // 「做什么」都没弄清时先问时长，是浪费一轮对话。
  const order: SlotKey[] = ['title', 'target', 'when', 'effort'];
  return order
    .filter((k) => s.missing.includes(k))
    .slice(0, Math.max(0, n))
    .map((k) => ({ slot: k, question: questionFor(s, k) }));
}

/** 指定槽位清单 → 对应话术（failed 只重问失败槽位时用，不走 topQuestions 的截断排序）。 */
export function questionsForSlots(s: IntentSlots, slots: SlotKey[]): Array<{ slot: SlotKey; question: string }> {
  return slots.map((slot) => ({ slot, question: questionFor(s, slot) }));
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
 * 五·六、分号批量应答协议（S 批 · 一次多问、一句多答）
 * ========================================================== */

/**
 * 剥离回答开头的编号前缀（`1.` `1、` `1．` `（1）` `(1)` `1️⃣` `①` `第一问`…）。
 *
 * 为什么单列一个函数：追问带编号渲染后，用户照着编号答（「1. 周五下午 2. 每天两小时」）
 * —— 编号是**我们的渲染**带进去的，解析时必须剥掉，否则 `extractWhen('1. 周五下午')`
 * 什么都抽不到。循环剥离最多 3 层，处理「（一）1.」这类嵌套编号。
 * ⚠️ `[0-9]+[.．]` 带 `(?!\d)` 守卫：「1.5小时」的「1.」是数字的一部分，不是编号。
 */
const ANSWER_NUM_RE =
  /(?:[①②③④⑤⑥⑦⑧⑨⑩]|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|[（(]\s*[0-9一二三四五六七八九十]{1,3}\s*[)）]|第\s*[0-9一二三四五六七八九十]{1,3}\s*[问条题]|[0-9]{1,3}\s*[.、．](?!\d)|[一二三四五六七八九十]\s*[、.．])/;

export function stripAnswerNumbering(s: string): string {
  let t = (s || '').trim();
  for (let i = 0; i < 3; i++) {
    const next = t.replace(new RegExp(`^\\s*${ANSWER_NUM_RE.source}\\s*`), '');
    if (next === t) break;
    t = next;
  }
  // 「第一问：十月中旬」剥完编号会残留冒号 —— 顺带剥掉编号后的引导标点
  return t.replace(/^[:：、,，.．\s]+/, '').trim();
}

/**
 * 把一句可能含多段回答的话切开。
 *
 * 规则（S 批 §3.2）：按 `；` / `;` / 换行切分；每段剥编号前缀；空段丢弃。
 * 没有任何分隔符 → 原样单段返回（单段回答走旧协议也成立 —— 本函数是兼容层，不是闸门）。
 */
/**
 * 把一句可能含多段回答的话切开。
 *
 * 规则（S 批 §3.2）：按 `；` / `;` / 换行切分；每段剥编号前缀；空段丢弃。
 * 没有任何分隔符 → 原样单段返回（单段回答走旧协议也成立 —— 本函数是兼容层，不是闸门）。
 *
 * 编号即分隔：追问是带编号渲染的，用户很可能照编号连写（「1. 十月中旬 2. 一共20小时」，
 * 中间只有空格没有分号）。这类**行内编号**也按切段处理 —— 但只有「空白后的数字编号」
 * 才切（防「1.5小时」「20.30」被腰斩）；圈号/emoji 编号自身就是边界，直接切。
 */
const INLINE_NUM_SPLIT =
  /(?:^|(?<=\s))(?:[（(]\s*[0-9]{1,2}\s*[)）]|[（(]?\s*[0-9]{1,2}\s*[.、．](?!\d)|[①②③④⑤⑥⑦⑧⑨⑩]|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|第[0-9一二三四五六七八九十]{1,3}[问条题])\s*/;

export function splitAnswers(q: string): string[] {
  const s = (q || '').replace(/\r\n?/g, '\n');
  if (!s.trim()) return [];
  const out: string[] = [];
  for (const seg of s.split(/[；;\n]+/)) {
    for (const piece of seg.split(INLINE_NUM_SPLIT)) {
      const t = stripAnswerNumbering(piece);
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * 时间表达的「具体度」—— 回答语境下判断新听到的时间要不要替换旧值。
 * 「周二晚上」（relative+weekday=3）应当替换「这周」（relative 周级=2）；
 * 反过来「十月中旬吧」（window+month=2）不该顶掉已听到的「下周三」（3）。
 * 纯比较函数，不决定「谁权威」—— 权威性由调用语境（是不是在被问 when）定。
 */
function whenScore(w: WhenHint): number {
  if (w.kind === 'vague') return 0;
  if (w.kind === 'exact') return 4;
  if (w.kind === 'relative') return w.relativeDays != null || w.weekday != null ? 3 : 2;
  // window：落到月份的 > 学期词 / 循环约定
  return w.month != null ? 2 : 1;
}

/** 把一次规则解析的产物按「只填空位」纪律并进 `out`。有任一字段写进 → true。
 *  `refineWhen` = 回答语境的跨槽收编：when 已有时，只在**更具体**时替换
 *  （问的是投入、用户顺口答了「周二晚上」—— 比「这周」具体，该收）。
 *  `rawText` = 原话（回答语境传入）：规则数词抽不到时长时，再试「6点到7点」
 *  这类时间段口语（spanDurationMin 只在回答语境生效，不进全局 parseIntentSlots）。 */
function mergeReplyIntoEmpties(out: IntentSlots, reply: IntentSlots, refineWhen = false, rawText?: string): boolean {
  let ok = false;
  if (!out.title && reply.title) { out.title = reply.title; ok = true; }
  if (reply.when) {
    if (!out.when) {
      out.when = reply.when;
      if (reply.dateFrom) out.dateFrom = reply.dateFrom;
      if (reply.dateTo) out.dateTo = reply.dateTo;
      out.certainty = reply.certainty;
      ok = true;
    } else if (refineWhen && whenScore(reply.when) > whenScore(out.when)) {
      out.when = reply.when;
      out.dateFrom = reply.dateFrom;
      out.dateTo = reply.dateTo;
      out.certainty = reply.certainty;
      ok = true;
    }
  }
  if (reply.perWeekCount != null && out.perWeekCount == null) { out.perWeekCount = reply.perWeekCount; ok = true; }
  if (reply.durationMin != null && out.durationMin == null) { out.durationMin = reply.durationMin; ok = true; }
  if (reply.totalHours != null && out.totalHours == null) { out.totalHours = reply.totalHours; ok = true; }
  if (!out.targetHint && reply.targetHint) { out.targetHint = reply.targetHint; ok = true; }
  if (!ok && rawText && out.durationMin == null) {
    const span = spanDurationMin(rawText);
    if (span != null) { out.durationMin = span; ok = true; }
  }
  return ok;
}

/**
 * 单段文本按指定槽位解析并写入 `out`。
 *  `answer` 模式（用户**直接回答这个槽位**的追问）：when 权威替换 ——
 *  问「什么时候」用户答「改到十月中旬吧」，哪怕旧值更具体也是用户改了主意。
 */
function fillOneSlot(out: IntentSlots, slot: SlotKey, text: string, today?: string, mode: 'fill' | 'answer' = 'fill'): boolean {
  const reply = parseIntentSlots(text, today);
  switch (slot) {
    case 'title':
      if (out.title || !reply.title) return false;
      out.title = reply.title;
      return true;
    case 'when':
      if (!reply.when) return false;
      // answer 模式 = 用户**直接回答 when 追问** → 权威替换（「改到十月中旬吧」
      // 哪怕比旧值模糊也是用户改了主意）；fill 模式只填空位。
      if (!out.when || mode === 'answer') {
        out.when = reply.when;
        if (reply.dateFrom) out.dateFrom = reply.dateFrom;
        if (reply.dateTo) out.dateTo = reply.dateTo;
        out.certainty = reply.certainty;
        return true;
      }
      return false;
    case 'effort': {
      let ok = false;
      if (reply.perWeekCount != null && out.perWeekCount == null) { out.perWeekCount = reply.perWeekCount; ok = true; }
      if (reply.durationMin != null && out.durationMin == null) { out.durationMin = reply.durationMin; ok = true; }
      if (reply.totalHours != null && out.totalHours == null) { out.totalHours = reply.totalHours; ok = true; }
      // 回答「占多久」的高频口语：用时间段表达时长（「6点到7点」= 1 小时）
      if (!ok && out.durationMin == null) {
        const span = spanDurationMin(text);
        if (span != null) { out.durationMin = span; ok = true; }
      }
      return ok;
    }
    case 'target':
      if (out.targetHint || !reply.targetHint) return false;
      out.targetHint = reply.targetHint;
      return true;
  }
}

export interface ClarifyAnswersResult {
  slots: IntentSlots;
  contributed: boolean;
  /** 没被答上（或答了但解析不出）的槽位 —— 调用方**只重问这些**。 */
  failed: SlotKey[];
}

/**
 * 分号批量应答：第 i 段回答 ↔ `asked[i]` 第 i 问。
 *
 * ── 为什么不沿用 `applyClarifyAnswer` ─────────────────────────
 * 旧协议把整句重新过一遍解析器，没有位置对应：问了两条、用户用分号分开答
 * （「周五下午；每天两小时」）时，全句解析的抽取器会跨段乱配。本函数把
 * 「问过什么」（调用方在提问时用 `topQuestionPairs` 记下的 `asked` 清单）
 * 与「答了什么」按序对上，段内用同一套单槽抽取器。
 *
 * ── T 批换向（CY 真机翻车 2026-09-27 晚）───────────────────────
 * `asked` 是**位置提示，不是过滤器**：问投入、用户答「周二晚上；正好是操场
 * 跑步的时间」—— 对位解析失败就把整段丢掉，等于把有效信息当无关消息，
 * missStreak 连累会话作废。改为：每段先试对位槽位，失败再按「剩余空位 +
 * when 细化」收进任何槽位；`failed` = 问了**仍然缺**的（只重问这些）。
 *
 * 纪律：
 *  · `asked` 为空（v1 兼容 / 未接线的出口）→ 整体退回 `applyClarifyAnswer`
 *    旧协议 —— 本函数必须是旧路径的**超集**，不允许比它懂得更少。
 *  · 段数 > 问数 → 多余段拼回全句按「剩余空位」兜底再试一次（用户多说了不丢）。
 */
export function applyClarifyAnswers(
  q: string,
  prev: IntentSlots,
  asked: SlotKey[],
  today?: string,
): ClarifyAnswersResult {
  const askedList: SlotKey[] = [];
  for (const k of asked) if (!askedList.includes(k)) askedList.push(k);

  if (askedList.length === 0) {
    const r = applyClarifyAnswer(q, prev, today);
    return { slots: r.slots, contributed: r.contributed, failed: [...r.slots.missing] };
  }

  const out: IntentSlots = { ...prev };
  const segs = splitAnswers(q);
  let contributed = false;

  const n = Math.min(segs.length, askedList.length);
  for (let i = 0; i < n; i++) {
    // 对位：直接答这个槽位 → answer 模式（when 权威替换）
    if (fillOneSlot(out, askedList[i], segs[i], today, 'answer')) { contributed = true; continue; }
    // 对位不上 → 本段可能答的是**别的**槽位（或顺带给了更具体的时间）——按空位收编
    if (mergeReplyIntoEmpties(out, parseIntentSlots(segs[i], today), true, segs[i])) contributed = true;
  }
  // 段多于问：多余的话按全句兜底，只往仍空着的槽位收
  if (segs.length > askedList.length) {
    const rest = segs.slice(askedList.length).join('；');
    if (mergeReplyIntoEmpties(out, parseIntentSlots(rest, today), true, rest)) contributed = true;
  }

  // failed = 问了**仍然缺**的（对位失败但被别的段/别的槽补上的不算）
  out.missing = missingSlots(out);
  const failed = askedList.filter((k) => out.missing.includes(k));
  return { slots: out, contributed, failed };
}

/**
 * LLM 定位片段 → 槽位（S 批 S3 的应答通路；T 批升级为「asked 只是提示」）。
 *
 * `understand` 端点（scene=answer）只做**语义定位**：把用户的回答拆成
 * 「槽位 → 原话片段」；结构化仍由本层规则抽取器完成 —— 片段可审计、
 * 数值可复现。
 *
 * T 批：端点被要求把回答里**任何**槽位信息都归位（不只 asked）——
 * 问投入、用户答了时间，时间也要收。所以这里处理 asked ∪ 碎片键的并集：
 * asked 槽位走 answer 模式（权威），多余碎片走跨槽收编（when 仅更具体才替换）。
 * `failed` = asked 里仍然缺的。
 */
export function applyClarifyFragments(
  fragments: Partial<Record<SlotKey, string>>,
  prev: IntentSlots,
  asked: SlotKey[],
  today?: string,
): ClarifyAnswersResult {
  const askedList: SlotKey[] = [];
  for (const k of asked) if (!askedList.includes(k)) askedList.push(k);

  const out: IntentSlots = { ...prev };
  let contributed = false;

  for (const slot of askedList) {
    const frag = fragments[slot];
    if (typeof frag !== 'string' || !frag.trim()) continue;
    if (fillOneSlot(out, slot, frag, today, 'answer')) contributed = true;
  }
  // asked 之外的碎片（LLM 归位出的跨槽信息）→ 跨槽收编
  const EXTRA = ['title', 'when', 'effort', 'target'] as const;
  for (const k of EXTRA) {
    if (askedList.includes(k)) continue;
    const frag = fragments[k];
    if (typeof frag !== 'string' || !frag.trim()) continue;
    if (fillOneSlot(out, k, frag, today)) contributed = true;
  }

  out.missing = missingSlots(out);
  const failed = askedList.filter((k) => out.missing.includes(k));
  return { slots: out, contributed, failed };
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
export function parseIntentSlots(q: string, today?: string, whenOpts?: ResolveTermOpts): IntentSlots {
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

  // 批次 1：钟点通道（加法）。逃生门 LIBAO_CLOCK=0 → 整体跳过，回引入前行为。
  if (clockChannelOn()) {
    const clock = extractClockRange(raw);
    if (clock) s.clock = clock;
  }

  const target = extractTarget(raw);
  if (target) s.targetHint = target;

  // 按确切时间定位（2026-10-07）：move/replace 旧时间在动词前（「把周三14:00的自习换成…」），
  // cancel 在动词后（「删掉周三下午两点那个自习」）。抽到即记 target*，与 targetHint 正交。
  const targetWhen = extractTargetWhen(raw, s.intent === 'cancel' ? 'after-verb' : 'before-verb');
  if (targetWhen) {
    if (targetWhen.day != null) s.targetDay = targetWhen.day;
    if (targetWhen.clock) s.targetClock = targetWhen.clock;
  }

  // replace/reschedule 的方向修正：extractWhen/extractClockRange 是整句扫描，
  // 会把「旧时间」当成新时间抓进 when/clock（「把周三14:00的自习换成周五15:00」
  // 的 when.weekday 抓到 3）。定位时间已在场时，与 target* 相同的那份就是抓错的
  // —— 改从动词后段重取新时间；动词后没有就清掉，不许旧时间冒充新时间。
  if (s.intent === 'replace' || s.intent === 'reschedule') {
    if (s.targetDay != null && s.when?.weekday === s.targetDay) {
      const after = extractTargetWhen(raw, 'after-verb');
      if (after?.day != null && after.day !== s.targetDay) s.when = { ...s.when, weekday: after.day };
    }
    if (s.targetClock?.startMin != null && s.clock?.startMin === s.targetClock.startMin) {
      const after = extractTargetWhen(raw, 'after-verb');
      s.clock = after?.clock;
    }
  }

  // 批 3：单日重排的目标天（与 targetHint 分属两条路由，互不覆盖）
  const replanDays = extractReplanDays(raw);
  if (replanDays) s.replanDays = replanDays;

  const pri = extractPriority(raw);
  if (pri.essential) s.essential = true;
  s.priorityHint = pri.priorityHint;

  // 批次 1 收尾三步（交集/歧义注记/时长推导）—— clock 不存在时全部空短路
  reconcileClock(s);

  if (today) {
    const r = resolveWhen(when, today, whenOpts);
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
  // 批 1.2：「第N周」没换算出来（调用方没给 termStart）→ 如实说，不编日期
  if (s.when?.weekNo != null && !s.dateFrom) {
    s.unclear.push('「第N周」要知道学期第一天才能落到具体日期 —— 导入课表后我就能对上。');
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
  fill('clock');
  fill('targetHint');
  // 按时间定位（2026-10-07）：LLM patch 的 target* 只在规则层没抽到时补
  fill('targetDay');
  fill('targetClock');

  if (out.intent === 'create' && llm.intent && llm.intent !== 'create') out.intent = llm.intent;

  out.missing = missingSlots(out);
  return out;
}

/**
 * T 批换向：LLM 主理解后的合并 —— **LLM 槽位为主，规则层只兜底**。
 *
 * 与 `mergeSlots`（规则字段永不被覆盖）方向相反：LLM 先看懂了整句话，
 * 规则的词表/正则只是便宜但残缺的初筛，不该压住 LLM 的判断。
 * 时间结构化（WhenHint → dateFrom/dateTo）仍在本层完成 —— LLM 给的是
 * 结构化数字（month/day/relativeDays/…），日期换算走 `resolveWhen`，
 * 防止 LLM 直接编 ISO 日期。
 */
export function mergeLlmPrimary(rule: IntentSlots, patch: Partial<IntentSlots> | null, today?: string, whenOpts?: ResolveTermOpts): IntentSlots {
  if (!patch) return rule;
  const out: IntentSlots = { ...rule };

  if (patch.title) out.title = patch.title;
  if (patch.when) {
    // 批 1.2：weekNo 越界（规约 1–30）→ 从 patch 里剥掉，同 patch 其余字段保留
    let pw: WhenHint = patch.when;
    if (pw.weekNo != null && (!Number.isFinite(pw.weekNo) || pw.weekNo < 1 || pw.weekNo > 30)) {
      const { weekNo: _drop, ...rest } = pw;
      pw = rest as WhenHint;
    }
    // 强化计划 D（2026-10-02）· 劣质覆盖防护：patch 只有**一句原话**（window 型、
    // 无任何结构化字段）而规则层已有结构化 when（点名了星期/相对天数/日期）时，
    // 不整体覆盖 —— 否则「下周一开始」会被 LLM 的劣质转写抹掉（真机实录：
    // 用户答了时间，梨宝反问「大概什么时候开始」= 答非所问）。
    const structured = (w?: { weekday?: number | null; relativeDays?: number | null; relativeWeeks?: number | null; relativeMonths?: number | null; month?: number | null; day?: number | null; weekNo?: number | null; kind?: string } | null) =>
      !!w && (w.weekday != null || w.relativeDays != null || w.relativeWeeks != null
        || w.relativeMonths != null || w.month != null || w.day != null || w.weekNo != null || w.kind === 'exact');
    const patchIsBareWindow = !structured(pw) && pw.kind === 'window' && !!pw.text;
    const ruleHasStructure = structured(out.when);
    if (!(patchIsBareWindow && ruleHasStructure)) {
      out.when = pw;
      if (today) {
        const r = resolveWhen(pw, today, whenOpts);
        out.dateFrom = r.from;
        out.dateTo = r.to;
        out.certainty = r.certainty;
      } else {
        out.dateFrom = patch.dateFrom;
        out.dateTo = patch.dateTo;
        out.certainty = patch.certainty ?? out.certainty;
      }
      if (pw.unspecified) out.certainty = 'unknown';
    }
  }
  if (!patch.when && patch.dateFrom) out.dateFrom = patch.dateFrom;
  if (!patch.when && patch.dateTo) out.dateTo = patch.dateTo;
  if (patch.perWeekCount != null) {
    // 批 1.5 幻觉防护：LLM 会从「养成晨跑的习惯」脑补出每天一次（探针实录：
    // 21 天 × 每天 = 21 块，静默压缩「一学期」意图）。只在**规则层已有**或
    // **原话真有频率词**时采纳；拒了要如实标注，不静默。
    if (rule.perWeekCount != null || FREQ_RE.test(rule.raw || '')) {
      out.perWeekCount = patch.perWeekCount;
    } else if (!out.unclear.includes('没听到明确的频率，「每周几次」我先不按猜的算 —— 想固定节奏的话补一句（比如「每周三次」）。')) {
      out.unclear.push('没听到明确的频率，「每周几次」我先不按猜的算 —— 想固定节奏的话补一句（比如「每周三次」）。');
    }
  }
  if (patch.durationMin != null) out.durationMin = patch.durationMin;
  if (patch.totalHours != null) out.totalHours = patch.totalHours;
  if (patch.place) out.place = patch.place;
  if (patch.window) out.window = patch.window;
  // 批次 1：clock 走 fill-if-empty —— 规则层从原话抽到的钟点是确定性正则产物，
  // 不被 LLM 转写覆盖；LLM 只兜规则抓不到的形态（「晚上六点左右」之外的说法）。
  if (patch.clock && !out.clock) out.clock = patch.clock;
  if (patch.targetHint) out.targetHint = patch.targetHint;
  // 按时间定位（2026-10-07）：target* 走 fill-if-empty —— 规则层从原话抽到的
  // 定位时间是确定性正则产物，不被 LLM 转写覆盖
  if (patch.targetDay != null && out.targetDay == null) out.targetDay = patch.targetDay;
  if (patch.targetClock && !out.targetClock) out.targetClock = patch.targetClock;

  // 批次 1 收尾三步（交集/歧义注记/时长推导）—— patch 里的钟点同样吃推导
  reconcileClock(out);

  out.missing = missingSlots(out);
  return out;
}

/**
 * 对外唯一入口（T 批换向后）。
 *
 * 流程：**LLM 先看**（在线时所有消息都过理解层，含关键词闸判 false 的句子）
 * → 要动日程则 LLM 槽位为主 + 规则结构化校验；明确不动且置信够 → 交回 RAG；
 * 端点挂/超时/低置信 → 落回原规则链路（`looksLikeAction` 闸 + LLM 补空），
 * 离线可用性不变。`action === false` 时调用方把问题交回 RAG 问答老路径。
 */
export async function parseGoalIntent(
  q: string,
  opts: { today?: string; llm?: LlmExtractor; llmJudge?: LlmJudge; history?: string[]; whenOpts?: ResolveTermOpts } = {},
): Promise<ParseOutcome> {
  const ruleSlots = parseIntentSlots(q, opts.today, opts.whenOpts);

  // ── T 批换向：LLM 先看一眼（CY 2026-09-27 晚拍板「不能每次都靠找关键词」）──
  if (opts.llmJudge) {
    try {
      const verdict = await opts.llmJudge(q, ruleSlots, opts.history);
      if (verdict) {
        if (verdict.action) {
          let slots = mergeLlmPrimary(ruleSlots, verdict.patch ?? null, opts.today, opts.whenOpts);
          if (verdict.intent) slots = { ...slots, intent: verdict.intent };
          // WP9 同族：改/取消/替换的目标块名在 targetHint —— send 门要 title
          if (!slots.title && slots.targetHint
            && (slots.intent === 'reschedule' || slots.intent === 'cancel' || slots.intent === 'replace')) {
            slots = { ...slots, title: slots.targetHint };
          }
          slots.missing = missingSlots(slots);
          return { action: true, slots, source: 'llm+rule' };
        }
        // LLM 明确说不动日程且置信够 → 信它（关键词闸可能误判的句子被纠偏）。
        // 低置信的否决不可信（LLM 自己也没底）→ 落回规则链路。
        if (verdict.confidence >= 0.6) {
          return { action: false, slots: ruleSlots, source: 'llm+rule' };
        }
      }
    } catch {
      // 端点异常 → 规则链路兜底，不算错误
    }
  }

  if (!looksLikeAction(q)) {
    return { action: false, slots: ruleSlots, source: 'rule' };
  }

  let slots = ruleSlots;
  // WP9 收口（2026-09-27 真机 W5 验收抓到）：改/取消/替换类的「目标块名」抽在
  // targetHint 里，而 send 门槛是 `action && slots.title` —— 不补上，整句会
  // 漏判成 RAG 问答（草稿卡永远出不来）。
  if (!slots.title && slots.targetHint
    && (slots.intent === 'reschedule' || slots.intent === 'cancel' || slots.intent === 'replace')) {
    slots = { ...slots, title: slots.targetHint };
  }
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
    add_deadline: '记重要日',
    hold: '留空',
    watch: '盯着', // W11：半代办「盯一件事」
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

/**
 * 解析协商态的**编号回答**（强化计划 D，2026-10-02）。
 *
 * 为什么必须有它：blocked 文案承诺「回 ①②③」，但此前编号回答不匹配任何意图，
 * 会被 LLM 裁成闲聊掉进 RAG —— 用户按提示回答却得到「校园资料服务未连接」。
 * 这是规则层的确定性兜底，不依赖 LLM 是否听懂。
 *
 * 认得的形态：`1` / `①` / `方案1` / `第一个` / `第 1 个` / `2 吧` / `就 3`。
 * 不当编号处理（返回 null）：无数字、数字越界、或句子里有别的意图信号
 * （比如「四六级什么时候报名」里也有数字，但它是个问答）。
 */
export function parseOptionChoice(q: string, optionCount: number): number | null {
  const s = (q || '').trim();
  if (!s || optionCount <= 0) return null;
  // 句子太长或有问句/疑问信号 → 当普通话处理（编号回答是短促的选择动作）
  if (s.length > 12 || /[?？]|什么|怎么|多少|为什么/.test(s)) return null;

  const CIRCLED: Record<string, number> = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6 };
  if (CIRCLED[s]) {
    const n = CIRCLED[s];
    return n <= optionCount ? n : null;
  }

  const m = /^(?:方案|选项|第|就|选)?\s*([0-9一二两三四五六七八九十]+)\s*(?:号|个|吧|嘛|啊|呀)?$/.exec(s);
  if (!m) return null;
  const digits = m[1];
  let n: number;
  if (/^[0-9]+$/.test(digits)) {
    n = parseInt(digits, 10);
  } else {
    const CN: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    n = CN[digits] ?? NaN;
  }
  if (!Number.isFinite(n) || n < 1 || n > optionCount) return null;
  return n;
}
