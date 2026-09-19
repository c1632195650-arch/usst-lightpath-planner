/**
 * 排程引擎 v2 · 领域模型（Domain Model）
 * ============================================================
 * 依据：`排程引擎-v2-技术规格书.md` §4「关键数据结构与接口定义」。
 *
 * 本文件是 **v2 新增类型的归口**。
 *
 * 契约边界（2026-09-15 T1.0 落地后更新）：
 *   · `src/types.ts` 收「**要持久化 / UI 要读**」的那几项：`LockLevel`、`PlanIssueCode`、
 *     `RollingState`、`PlanPersistState`，以及 `TimeBlock.lockLevel?` / `PlanIssue.code?` /
 *     `AppState.planState`。
 *   · 其余 v2 新类型（Place / Commit / Weights / PlanRequest / PlanResult …）仍只在本文件定义。
 * 判据是「**有几个模块 import 它**」，不是「它重不重要」—— 被这个判据漏掉的
 * `LockLevel` / `RollingState` 本文件一律 **re-export**，不再本地重复定义。
 *   · 本文件**禁止**被 `src/types.ts` import（规格书 §3.3 反向依赖）。
 *
 * 设计纪律（与仓库其它纯函数模块一致）：
 *   · 纯类型 + 纯函数；不 fetch、不读时钟、不用随机数。
 *   · 本文件内所有函数都是**确定性**的（同输入同输出）。
 */
import type {
  BlockKind, CampusId, DayOfWeek, LockLevel, LockedPlacement, PhasePolicy, RollingState,
  Schedule, TimeBlock, WeekPlan, PersonaProfile, ScenarioFields,
} from '@/types';
// ⚠️ 依赖下沉：`campusLookup.ts` 不依赖任何 planner 模块，故此处不会成环
//    （若 import `./schedule.ts`，而 `schedule.ts` 又要 import `./construct.ts` → 环）
import type { TransferProvider } from './campusLookup.ts';
import type { DayLoadDecision } from './roll.ts';
import type { UserTask } from './templates.ts';

// 契约层已收归的类型：本文件只 re-export，不再本地定义（见头部「契约边界」）
export type { LockLevel, RollingState } from '@/types';

/* ============================================================
 * 一、基础扩充类型（规格书 §4.1）
 * ========================================================== */

/*
 * `LockLevel` 已上提至 `src/types.ts`（T1.0 契约层），本文件仅在上方 re-export。
 *   hard = 钉死（课程、用户固定块）；improve 邻域**必须**排除
 *   soft = 可动，但改动要付 churn 惩罚（尽量别动）
 *   free = 自由（引擎自排的软块）
 * 旧字段 `TimeBlock.locked` 保留，与新字段并存以兼容现有 UI。
 */

/** 可用时段窗（复刻 templates.ts 的 ActivityWindow 语义，避免跨模块依赖） */
export interface Window {
  startMin: number;
  endMin: number;
  /** 「早餐」「午餐」「全天」…… 展示用 */
  label?: string;
}

/**
 * 显式地点表条目 —— **取代 `campusOfName` 关键字猜测**（规格书 §4.1 / 旧问题 #9）。
 * `campus` 必须有确定值；无法确定的地点不应进入本表（用 `UNKNOWN` 视为数据缺口）。
 */
export interface Place {
  /** 稳定主键，如 'poi-图书馆-图文信息中心' */
  id: string;
  /** POI 名，如 '图书馆（图文信息中心）'，可直接喂给 route() */
  name: string;
  /** 显式校区（不再靠名字猜） */
  campus: CampusId;
  /** 营业/可用时段；空数组 = 不限 */
  hours: Window[];
  /** meal / study / sport / life / building ...（来自模块库或建筑表） */
  category?: string;
  /**
   * 同一地点的其它写法（课表/课表解析里可能写别名）。
   * 例：`逸兴楼` 的别名是 `第四教学楼` —— 教务课表用的是后者。
   * `buildPlaceIndex()` 会把别名一并注册，避免「同一个地方两种写法、只有一种能查到」。
   */
  alias?: string[];
}

/* ============================================================
 * 二、提交项与依赖（规格书 §4.2）
 * ========================================================== */

/**
 * 「需要被安排的事」——任务统一抽象，取代裸 `UserTask`。
 * 关键增量：`dueAt`（交期）、`deps`（依赖）、`minAcceptableMin`（时长下界）、`splittable`（可拆）。
 */
export interface Commit {
  id: string;
  title: string;
  emoji?: string;
  /** 映射到块类型；默认 'activity' */
  kind: BlockKind;
  /** 期望投入分钟（必填，用于产能核算） */
  effortMin: number;
  /** 最小可接受时长；缺省 = effortMin * 0.7（规格书 §4.2） */
  minAcceptableMin?: number;
  /** 是否可拆分到多个空档（如「本周累计复习 4 小时」） */
  splittable?: boolean;
  /** 交期：周次 + 星期 + 分钟；缺省 = 无硬交期 */
  dueAt?: { weekNo: number; dayOfWeek: DayOfWeek; min: number };
  /** 允许落点窗口（如「只在晚上」） */
  window?: { fromMin: number; toMin: number };
  /** 首选地点（Place.id） */
  placeId?: string;
  /** 基础优先级（缺省 90，用户意图优先于系统建议） */
  priority?: number;
  /** 依赖：这些 Commit.id 必须先完成 */
  deps?: string[];
  /** 生效周次；空/缺省 = 全学期 */
  weeks?: number[];
  /** 固定落点：给了就从浮动任务变成固定块 */
  pinned?: { dayOfWeek: DayOfWeek; startMin: number };
}

/** 前后依赖约束（由 `Commit.deps` 展开成边，便于拓扑处理） */
export interface Precedence {
  /** Commit.id：先完成者 */
  before: string;
  /** Commit.id：后完成者 */
  after: string;
  /** 两者之间的最小间隔（默认 0） */
  minGapMin?: number;
}

/* ============================================================
 * 三、权重与求解配置（规格书 §4.3 / §6.3）
 * ========================================================== */

/** 目标函数权重（全部非负） */
export interface Weights {
  /** 自习未达标惩罚（每分钟） */
  studyShortfall: number;
  /** 留白不足惩罚（每分钟） */
  blankDeficit: number;
  /** 认知切换惩罚（每次换科目/地点） */
  switchCost: number;
  /** 通勤风险惩罚（每次紧张/超时） */
  transferRisk: number;
  /** 交期违约惩罚 */
  dueOverdue: number;
  /** 计划扰动惩罚（每变动分钟） */
  churn: number;
  /** 跨校区/未登记地点惩罚 */
  placeMismatch: number;
}

/** 工程默认权重（规格书 §6.3）——可在 `PlanRequest.weights` 里覆盖 */
export const DEFAULT_WEIGHTS: Weights = {
  studyShortfall: 1.0,
  blankDeficit: 1.0,
  switchCost: 0.5,
  transferRisk: 2.0,
  dueOverdue: 8.0,
  churn: 0.8,
  placeMismatch: 3.0,
};

/** 求解器配置 */
export interface SolverConfig {
  /** 灰度开关：'greedy' 走旧引擎；'lns' 构造 + 改进 */
  solver: 'greedy' | 'lns';
  /** 随机种子；缺省 = 确定性纯爬山（不用随机数） */
  seed?: number;
  /** 最大迭代轮数（默认 2000） */
  maxIterations?: number;
  /** 时间预算上限，毫秒（默认 200） */
  budgetMs?: number;
  /** 是否允许接受劣解以跳出局部最优（默认 false） */
  acceptWorse?: boolean;
}

export const DEFAULT_SOLVER_CONFIG: Required<Omit<SolverConfig, 'seed'>> & { seed?: number } = {
  solver: 'lns',
  maxIterations: 2000,
  budgetMs: 200,
  acceptWorse: false,
};

/* ============================================================
 * 四、滚动状态（规格书 §4.4 / §5.8）
 * ========================================================== */

/*
 * `RollingState` 已上提至 `src/types.ts`（T1.0 契约层），本文件仅在顶部 re-export。
 * 上提理由：它要**持久化**（`PlanPersistState.rolling`），而契约层不能 import 本文件。
 * 语义 —— 周与周之间传递的状态：累积负荷 / 临近交期 / 疲劳。
 *   recentLoad  最近 N 天的实际负荷（分钟），用于疲劳建模
 *   upcoming    未来临近的交期项（供本周参考）
 *   loadByDow   每星期几的历史负荷均值（索引 1..7 使用，0 占位）
 */

/** 空滚动状态（第一周或上一周无数据时使用） */
export function emptyRollingState(): RollingState {
  return { recentLoad: [], upcoming: [], loadByDow: [0, 0, 0, 0, 0, 0, 0, 0] };
}

/* ============================================================
 * 五、求解请求 / 结果（规格书 §4.4）
 * ========================================================== */

/**
 * 用户声明的「不可时段」（R6.2）。
 *
 * 与 `features/week/userPlanStore.UnavailableSlot` 一一对应，这里是**引擎侧的最小形状**
 * —— 引擎不该知道它在 localStorage 里叫什么。
 */
export interface ReqUnavailableSlot {
  id?: string;
  days: number[];
  fromMin: number;
  toMin: number;
  /** 空 = 长期（自 `createdAtWeek` 起生效） */
  weeks?: number[];
  createdAtWeek?: number;
  title?: string;
}

export interface PlanRequest {
  // —— 必需 ——
  schedule: Schedule;
  /** 目标周次（1-based） */
  weekNo: number;
  /** 该周所属阶段策略 */
  policy: PhasePolicy;
  /** 需要被安排的事（含交期） */
  commits: Commit[];
  /**
   * 旧版「用户自定义模块」入口（P1 兼容层）。
   *
   * 为什么还在：现有 UI / `scripts/scheduler.test.ts` / golden 语料都走这条口，
   * 而 P1-T1.1 的验收是「`construct` 与旧引擎**逐块一致**」——把 `UserTask`
   * 硬映射成 `Commit` 会丢信息（`UserTask.durations` 是时长档位、`place` 是 POI 名
   * 而非 `Place.id`），反而破坏等价性。
   * ⚠️ P2 由 `commits` 完全取代后删除本字段（届时 UI 一起改）。
   */
  tasks?: UserTask[];

  // —— 可选 ——
  persona?: PersonaProfile | null;
  scenarios?: ScenarioFields | null;
  /** 地点表；缺省 = `BUILTIN_PLACES` */
  places?: Place[];
  /** 转场时间来源；缺省 = `campusFallbackTransfer` */
  transfer?: TransferProvider;
  /** 权重覆盖；缺省 = `DEFAULT_WEIGHTS` */
  weights?: Partial<Weights>;
  /** 求解器配置；缺省 = `DEFAULT_SOLVER_CONFIG` */
  config?: Partial<SolverConfig>;
  /** 一天的可排程区间，默认 07:00 */
  dayStart?: string;
  /** 一天的可排程区间，默认 23:00 */
  dayEnd?: string;
  /** 是否排三餐（默认 true） */
  withMeals?: boolean;

  // —— 增量 / 动态（P2，P0 仅预留字段）——
  /**
   * 上一版计划：用于 churn（最小扰动），也是增量重排算脏区域的输入。
   *
   * 为什么允许 `null`：调用方（UI）持有的就是 `WeekPlan | null`，
   * 让它每次调用前先判空再决定「传不传这个 key」是没必要的负担 ——
   * `null` 与 `undefined` 在这里语义相同，都是「没有上一版」。
   */
  previousPlan?: WeekPlan | null;
  /**
   * 上一版的提交项（P2-T2.1）。
   *
   * 为什么需要它：脏区域（§5.8）靠**对比「这次输入」与「上次输入」**算出来 ——
   * 「新增了什么 / 谁的改期了」。只给 `previousPlan` 只能知道「块原来在哪」，
   * 无法区分「用户新增了一个任务」与「引擎上次没排下它」。
   * 缺省 `undefined` → 退化为全量重排（真实场景：第一次排程）。
   */
  previousCommits?: Commit[] | null;
  /** 锁级别覆盖：blockId -> LockLevel */
  lockLevels?: Record<string, LockLevel>;
  /**
   * 被锁块的位置快照 —— `solver` 在构造之后据此把 hard 块**写回原位**。
   *
   * 为什么必须显式传：`construct` 不读 `lockLevels`（它每步都从头排），
   * `improve` 只保证「不主动移动 hard 块」。两者叠加的结果是 ——
   * **块一旦被构造阶段排到别处，就没人把它带回来**。
   * 少了这个字段，`lockLevels` 只是半个功能（UI 显示「已定住」但块照样跑）。
   */
  lockedPlacements?: Record<string, LockedPlacement>;
  /**
   * 当前分钟；给定则只排 [fromNow, dayEnd]。
   *
   * `null` 与 `undefined` 同义（都是「不启用」）—— 调用方手里常是
   * `number | null`（比如「开关没开」），没必要逼它先判空再决定传不传 key。
   */
  fromNow?: number | null;
  /**
   * `fromNow` 作用在哪一天（P2-T2.3）。
   *
   * 为什么必须有它：`fromNow` 是「现在几点」，而计划是**整周**的 ——
   * 今天剩下的时间要收紧，但明天、后天不该跟着被砍（否则下午三点才开始用，
   * 整周都排不满）。引擎**不读时钟**（纯函数纪律），所以「今天是周几」
   * 必须由调用方告知。
   * 缺省 `null` = 不在任何一天生效（等价于没传 `fromNow`）。
   */
  fromNowDay?: DayOfWeek | null;
  /** 上一周传来的滚动状态；`null` 与 `undefined` 同义（都是「还没积累」） */
  rolling?: RollingState | null;
  /**
   * 最近若干周的**实际**负荷（按星期几，下标 0 = 周一；P2-T2.2）。
   *
   * 为什么它是独立输入而不是塞进 `rolling`：两者的来源与新鲜度不同 ——
   * `rolling.loadByDow` 是**上次排程时的计划值**，而这个是**用户标记的实际执行量**。
   * 引擎里实际优先、计划兜底（见 `roll.ts::mergeLoad`），所以必须分开传。
   */
  actualLoadByDow?: number[] | null;

  // —— 用户干预（阶段 A/B，2026-09-19 新增，均为可选、向后兼容）——

  /**
   * 用户明确排除的块 id（「这块我不做」）。
   *
   * 为什么需要它：界面提供了「删掉这一块」，但引擎每次排程都会重新构造 ——
   * 不告诉引擎「用户不要它」，下一轮它又回来了（用户会觉得「删了没用」）。
   *
   * 语义：**构造阶段直接跳过**这些 id 对应的块；不报 issue（这是用户自己的选择，
   * 不是引擎的失误）。与 `lockLevels='hard'` 的区别：锁是「钉住位置」，
   * 这里是「根本不要」。
   */
  excludedBlockIds?: string[] | null;

  /**
   * R6.2：**用户声明的不可时段**（「周四下午别排自习」）。
   *
   * 引擎**：这些时段不许出现任何软事**（课程除外 —— 课是既成事实）。
   * 落在禁区里的软块会被挪到邻近空位；挪不开就从计划里去掉并记一条 info。
   *
   * ⚠️ 这是**可选**字段，不传就退回原有行为 —— 老调用方不受影响。
   * ⚠️ 它**不动 `src/types.ts`**（`PlanRequest` 属于 `lib/planner` 的内部契约）。
   */
  unavailable?: ReqUnavailableSlot[] | null;

  /**
   * 偏好校正层（阶段 B 落库；阶段 C 起真正被引擎消费）。
   *
   * 用户对排法的改进建议（「周四下午别排东西」「每天多学 1 小时」）的结构化载体。
   * 与 `weights` / `config` 的区别：那些是**开发者调参**，这个来自**用户本人**，
   * 且要能逐条撤销、能展示给用户看「引擎从你这里学到了什么」。
   *
   * ⚠️ 类型定义在 `./corrections.ts`（引擎侧）而不是 `features/**` ——
   *    否则 `lib/planner → features` 会成为反向依赖。
   * ⚠️ 与画像的关系：**永不回写** `persona` / `answers`（那是 35 题测评的纯函数产物，
   *    改了下一次重算就没了）。校正层是独立叠加层，见 `corrections.ts` 头部说明。
   */
  corrections?: import('./corrections.ts').CorrectionRule[] | null;

  /**
   * 用户指定的食堂（S4，2026-09-19）。
   *
   * 背景：T2 删掉了「引擎自动猜吃哪家」（依据不成立 —— 大部分人只去固定摊位），
   * 于是三餐只占时间、不指定地点。但用户**仍然想能自己设定**，这就是本字段。
   *
   * 语义：给了哪一餐就用哪个食堂，**留空的餐次保持「不指定」**（T2 行为）。
   * 值 = POI 名（与 `templates.ts` 里 `category:'meal'` 模板的 `place` 同名）。
   *
   * 为什么不放进 `corrections`：那会给 `CorrectionRule` 加字段 →
   * 触发「改引擎侧类型就要登记规格书」的额外动作。放在 `PlanRequest` 上更轻。
   */
  mealPlaces?: { breakfast?: string; lunch?: string; dinner?: string } | null;
}

/** 求解诊断（面向开发者与验收，不直接展示给用户） */
export interface Diagnostics {
  solver: 'greedy' | 'lns';
  iterations: number;
  elapsedMs: number;
  cost: { total: number; parts: Record<string, number> };
  /** 硬约束违反数（目标恒为 0） */
  hardViolations: number;
  /** 与上一版计划的差异分钟数 */
  churnMin: number;
}

export interface PlanResult {
  /** 结构兼容旧版 WeekPlan（只增字段） */
  plan: WeekPlan;
  /** 面向用户的生成说明 */
  notes: string[];
  diagnostics: Diagnostics;
  /** 传给下一周的滚动状态 */
  nextRolling: RollingState;

  /**
   * 本周逐日的跨周负荷判定（P2-T2.2）。
   *
   * 为什么不塞进 `diagnostics`：这不是「给开发者看的性能数」，而是
   * **用户可读的决策依据**（「周三上周太满，这周给你松了 10%」）。
   * 前端据此可以把「哪几天被降档」直接标在时间轴上，
   * 混进 `cost` 那些内部指标里反而不好用。
   *
   * 缺省/首次排程时是全 1.0 的 7 项（不是 undefined）—— 消费方无需判空。
   */
  loadDecisions?: DayLoadDecision[];

  /**
   * 转场收敛诊断（P2-T2.4 / AC-10）——由 `planWeek` 的收敛循环填写。
   *
   * `transferRounds`：实际求解轮数（首轮 + 每轮重算各计 1）。正常周程通常 2 轮。
   * `transferUncovered`：终版布局里**仍拿不到实测值**的相邻跨点对，
   *   形如 `['三教→国合楼']`。空数组 = 全部命中缓存（AC-10 达标）。
   *
   * 为什么放这里而不塞进 `diagnostics.cost`：`cost` 是「引擎内部的目标函数分解」，
   * 这是「取数质量」；两者受众不同。UI 可以据此如实提示
   * 「个别转场时间为估算」，而不是把估算值当实测值显示。
   * 单遍路径（没有收敛循环）时保持 `undefined`。
   */
  transferRounds?: number;
  transferUncovered?: string[];

  // —— 为未来留口，P1 不填（规格书 §4.4 / §12.3 D-2）——
  /** 多版本；P1 恒为 `undefined`（或长度 1 = 上面的 `plan`） */
  variants?: PlanVariant[];
  /** 每块的可替换项（blockId → 同类候选）。P1 不启用。 */
  blockCandidates?: Record<string, Array<{ title: string; placeId?: string }>>;
}

/** 计划变体（多版本）。P1 只产出 1 个，字段先占位，避免日后二次改契约 */
export interface PlanVariant {
  /** 变体标识，如 'balanced' / 'compact' / 'relaxed' */
  id: string;
  /** 该变体对应的权重（便于比较与复现） */
  weights: Weights;
  /** 该变体的成本分 */
  cost: number;
  plan: WeekPlan;
}

/* ============================================================
 * 六、锁与扰动（规格书 §4.1 / §5.5 / §9-T0.3）
 *
 * 说明：完整的目标函数 `evaluate()` 属 P1（T1.2）。P0 只做「预留」——
 *       把锁判定与 churn 计算这两个 evaluate 会用到的纯函数先落地。
 * ========================================================== */

/**
 * 判定一个块的锁级别（规格书 §9-T0.3 步骤 1）。
 * 优先级：显式 `lockLevels[id]` > `block.locked` > 来源推断 > 默认 free。
 */
export function resolveLockLevel(
  block: Pick<TimeBlock, 'id' | 'kind' | 'source' | 'locked'>,
  lockLevels: Record<string, LockLevel> = {},
): LockLevel {
  const explicit = lockLevels[block.id];
  if (explicit === 'hard' || explicit === 'soft' || explicit === 'free') return explicit;
  if (block.locked) return 'hard';
  if (block.source === 'course') return 'hard'; // 课程是既成事实
  if (block.source === 'user') return 'hard';   // 用户 pinned 的块
  return 'free';                                 // 引擎自排的软块
}

/**
 * 锁 → churn 权重系数（规格书 §5.5）。
 *   hard ×100 等价于「禁止移动」；soft ×1；free ×0。
 */
export function lockFactorOf(level: LockLevel): number {
  if (level === 'hard') return 100;
  if (level === 'soft') return 1;
  return 0;
}

/** 计划差异的**未加权**分钟数（供 Diagnostics.churnMin） */
export function churnMinutes(previousPlan: WeekPlan | undefined, plan: WeekPlan): number {
  if (!previousPlan) return 0;
  const prev = new Map(previousPlan.blocks.map((b) => [b.id, b]));
  const next = new Map(plan.blocks.map((b) => [b.id, b]));
  let total = 0;
  for (const [id, b] of next) {
    const p = prev.get(id);
    if (!p) {
      total += b.endMin - b.startMin; // 新增块
      continue;
    }
    if (moved(p, b)) total += Math.max(b.endMin - b.startMin, p.endMin - p.startMin);
  }
  for (const [id, p] of prev) {
    if (!next.has(id)) total += p.endMin - p.startMin; // 被删块
  }
  return total;
}

/**
 * 计划扰动代价（规格书 §5.5 的 churn 项）——P1 的 `evaluate()` 直接消费本函数。
 * `cost = w.churn * Σ lockFactor(block) * changedMinutes(block)`
 */
export function churnCost(
  previousPlan: WeekPlan | undefined,
  plan: WeekPlan,
  lockLevels: Record<string, LockLevel>,
  weights: Weights,
): number {
  if (!previousPlan) return 0;
  const prev = new Map(previousPlan.blocks.map((b) => [b.id, b]));
  const next = new Map(plan.blocks.map((b) => [b.id, b]));
  let cost = 0;
  for (const [id, b] of next) {
    const p = prev.get(id);
    const factor = lockFactorOf(resolveLockLevel(b, lockLevels));
    if (!p) {
      cost += weights.churn * factor * (b.endMin - b.startMin);
      continue;
    }
    if (moved(p, b)) {
      cost += weights.churn * factor * Math.max(b.endMin - b.startMin, p.endMin - p.startMin);
    }
  }
  for (const [id, p] of prev) {
    if (next.has(id)) continue;
    cost += weights.churn * lockFactorOf(resolveLockLevel(p, lockLevels)) * (p.endMin - p.startMin);
  }
  return cost;
}

/** 位置或时长是否变了（用于 churn 判定） */
function moved(a: TimeBlock, b: TimeBlock): boolean {
  return a.dayOfWeek !== b.dayOfWeek || a.startMin !== b.startMin || a.endMin !== b.endMin;
}

/* ============================================================
 * 七、确定性 id 规范（规格书 §6.4）
 *
 * 🔴 `blockId = w{weekNo}-d{dayOfWeek}-{kind}-{语义键}`，**语义键严禁含时间**。
 *
 * 为什么必须去掉 `startMin`（这是 P1 的前置条件，不是可选项）：
 *   `churn`（扰动代价）与 `lockLevels`（锁）都靠 **id 匹配「同一个块」**。
 *   若 id 含 `startMin`，块被平移 30 分钟后 id 就变了 → 引擎判成「删了一个 + 新增一个」：
 *     ① churn 虚高（只是平移却算成一次删除 + 一次新增）；
 *     ② **锁彻底失效**（id 一变就锁不住），三级锁从根上建不起来。
 * ========================================================== */

/** 生成语义键 block id（规格书 §6.4 的唯一实现点） */
export function blockId(
  weekNo: number,
  dayOfWeek: DayOfWeek,
  kind: string,
  semanticKey: string,
): string {
  return `w${weekNo}-d${dayOfWeek}-${kind}-${semanticKey}`;
}

/** 形状：`w3-d2-course-CS101p3` */
export const BLOCK_ID_RE = /^w\d+-d\d+-\w+-.+$/;

/**
 * 「3–4 位数字被连字符夹住」= 旧规则 `day-kind-startMin-seq` 的时间残留。
 * ⚠️ 理论上语义键自带 `-1234-` 这种写法会被误判，属可接受的假阳性
 *    （我们的语义键是 courseId/taskId/templateId/mealId，不带纯数字段）。
 */
export const BLOCK_ID_TIME_FRAGMENT_RE = /-\d{3,4}-/;

/** 是否为合规的语义键 id（T1.1 验收 2） */
export function isSemanticBlockId(id: string): boolean {
  return BLOCK_ID_RE.test(id) && !BLOCK_ID_TIME_FRAGMENT_RE.test(id);
}

/** 从 id 里取语义键（调试/测试用）；不匹配返回 null */
export function semanticKeyOf(id: string): string | null {
  const m = /^w\d+-d\d+-\w+-(.+)$/.exec(id);
  return m ? m[1] : null;
}
