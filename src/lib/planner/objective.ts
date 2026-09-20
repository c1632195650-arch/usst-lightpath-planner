/**
 * 排程引擎 v2 · 目标函数与紧迫度（objective）
 * ============================================================
 * 依据：`排程引擎-v2-技术规格书.md` §5.2（紧迫度函数）/ §5.6（交期违约）/ §9-T0.2。
 *
 * P0 范围：只落地「交期 → 紧迫度 → 排序键」这条链，以及把
 *          `Course.examDate` 与校园时间节点（DEADLINES）转成 urgency 加成。
 * P1 范围（本文件后续扩展）：§5.3 产能 / §5.4 切换成本 / §5.5 目标函数装配。
 *
 * ⚠️ 本文件是**纯函数**：不 fetch、不读时钟（时间基准由 `termStart` 注入）、不用随机数。
 *    `DEADLINES` 由**调用方注入**（不 import mock 数据模块），保持可测与可替换。
 *    锁与 churn 的工具函数在 `model.ts`（P1 的 evaluate 会消费它们）。
 */
import type { CampusId, Course, PhasePolicy, RollingState, TimeBlock, WeekPlan } from '@/types';
import type { Commit, LockLevel, Place, ScoringMode, Weights } from './model.ts';
import { ESTIMATE_TRUST, TRANSFER_TRUST, churnCost, churnMinutes, resolveLockLevel } from './model.ts';
import { effectiveStudyMin, fatigueAdjustment } from './fatigue.ts';
import { BUILTIN_PLACE_INDEX, campusOfPlace } from './places.ts';

const DAY_MS = 86_400_000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function parseIsoUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/* ============================================================
 * 一、日期 → 周次（交期换算的基础）
 * ============================================================
 * 🔴 2026-09-20 复核结论（**不要**把它们接进 `evaluate`）：
 *   本节的 `weekNoOfDate` / `collectDeadlineBoosts` / `urgencyBoostForWeek`
 *   在 `src/` 里**没有生产调用者**，因为它们的设计已被
 *   `src/lib/planner/events.ts` **取代**：
 *
 *     交期 → 决策 的真实链路 = `expandDeadlines`（+ `expandExamPrep`）
 *       DEADLINES / Course.examDate ──► UserTask ──► req.tasks
 *       ──► construct（按 EDF/priority 选位）──► 块 ──► §5.6 的 dueOverdue 计分
 *
 *   也就是说「交期进入决策」这条支柱是**活的**，只是走 `tasks` 通道而不是
 *   「给评分加一个 urgency 加成项」。
 *
 *   ⚠️ **若把它们再接进 `evaluate`，同一份 DEADLINES 会变成「既生成块、又加成」
 *   的双重计权**，而且会给 `CostBreakdown` 引入第 8 项 —— 破坏
 *   「7 项之和 === total」这个被验收断言钉住的恒等式（见本文件 §5.5 注释）。
 *   要改变口径，先改 `events.ts`（唯一实现）并同步周页 / 对话页两处调用。
 *
 *   处置：**保留导出、标注 superseded**（删除属引擎实现域，由 B/Ray 决定）。
 * ========================================================== */

/** ISO 日期 → 学期第几周（1-based）；解析失败返回 null（不猜）
 *
 * ⚠️ 只接受**纯日期** `YYYY-MM-DD`（函数内部自己拼 `T00:00:00Z`）。
 *    传完整 ISO（含时间）会二次拼接 → NaN → 返回 null。
 *    生产链路已改用 `src/lib/date.ts::currentWeekNo`（`events.ts` 在用）。
 * @deprecated superseded by `planner/events.ts` + `lib/date.ts::currentWeekNo`（无生产调用者）
 */
export function weekNoOfDate(dateIso: string, termStart: string): number | null {
  const a = parseIsoUtc(termStart);
  const b = parseIsoUtc(dateIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / (7 * DAY_MS)) + 1;
}

/* ============================================================
 * 二、紧迫度（规格书 §5.2）
 * ========================================================== */

/**
 * 一个提交项的紧迫度（0–1）。
 *   · 无交期            → 0
 *   · 交期已过          → 1.0（最高）
 *   · 剩余产能不够覆盖  → 0.9
 *   · 否则按剩余天数衰减 → clamp(1 - daysLeft/14, 0.05, 1.0)
 */
export function urgency(commit: Commit, weekNo: number, capacityRemain: number): number {
  if (!commit.dueAt) return 0;
  const daysLeft =
    (commit.dueAt.weekNo - weekNo) * 7 + (commit.dueAt.dayOfWeek - 1);
  if (daysLeft < 0) return 1.0;
  if (capacityRemain < commit.effortMin) return 0.9;
  return clamp(1 - daysLeft / 14, 0.05, 1.0);
}

/**
 * 构造阶段的排序键（规格书 §5.2）：`urgency` 为主导，`priority` 作同紧迫度下的次序。
 * `boost`（0–1）来自交期加成（见 §四），叠加后封顶 1。
 */
export function sortKey(
  commit: Commit,
  weekNo: number,
  capacityRemain: number,
  boost = 0,
): number {
  const u = Math.min(1, urgency(commit, weekNo, capacityRemain) + boost);
  return u * 1000 + (commit.priority ?? 90);
}

/** 按排序键降序排（不修改入参） */
export function sortCommits(
  commits: Commit[],
  weekNo: number,
  capacityRemain: number,
  boostOf: (c: Commit) => number = () => 0,
): Commit[] {
  return [...commits].sort(
    (a, b) => sortKey(b, weekNo, capacityRemain, boostOf(b))
      - sortKey(a, weekNo, capacityRemain, boostOf(a)),
  );
}

/** 期望投入时长的兜底下界（规格书 §4.2）：缺省 = effortMin * 0.7，向下取整到 5 的倍数 */
export function effectiveEffortMin(commit: Commit): number {
  if (commit.minAcceptableMin != null) return commit.minAcceptableMin;
  return Math.floor((commit.effortMin * 0.7) / 5) * 5;
}

/* ============================================================
 * 三、交期加成来源（规格书 §9-T0.2 步骤 3）
 *
 * 采用「urgency 加成来源」而非「造隐式 Commit」——避免虚增任务、污染产能核算。
 * ========================================================== */

/** 与 `data/usst.ts` 的 `Deadline` 结构兼容的最小接口（注入用，不 import mock 数据） */
export interface DeadlineLike {
  id?: string;
  /** ISO 日期 'YYYY-MM-DD' */
  date: string;
  title: string;
  /** '考试' / '竞赛' / '报名' / '校庆' ... */
  tag?: string;
}

/** 一个时间节点映射到学期周次后的加成条目 */
export interface DeadlineBoost {
  id: string;
  title: string;
  /** 落在第几周 */
  weekNo: number;
  /** 基础权重 0–1 */
  weight: number;
  /** 数据来源：校园节点 / 课程考试 */
  source: 'campus' | 'course';
}

/** tag → 基础权重（考试最重，报名/竞赛次之，其余最轻） */
function weightOfTag(tag: string | undefined): number {
  if (!tag) return 0.5;
  if (tag.includes('考试')) return 1.0;
  if (tag.includes('竞赛')) return 0.7;
  if (tag.includes('报名')) return 0.7;
  return 0.5;
}

export interface DeadlineBoostInput {
  /** 学期第一周周一（校历解析得出） */
  termStart: string;
  totalWeeks: number;
  /** 校园时间节点（调用方传 `DEADLINES`） */
  deadlines?: DeadlineLike[];
  /** 课程（用 `Course.examDate`） */
  courses?: Course[];
}

/**
 * 把校园时间节点与课程考试日期统一转成「周次 + 权重」的加成条目。
 * 落在学期范围外的节点会被丢弃（无意义的交期不应影响排程）。
 *
 * @deprecated superseded by `planner/events.ts`（`expandDeadlines` / `expandExamPrep`）——
 *   交期已通过 `req.tasks` 进入决策；本函数无生产调用者，**不要**接进 `evaluate`
 *   （会和 tasks 通道双重计权，理由见本文件「一、日期 → 周次」上方红字）。
 */
export function collectDeadlineBoosts(input: DeadlineBoostInput): DeadlineBoost[] {
  const { termStart, totalWeeks, deadlines = [], courses = [] } = input;
  const out: DeadlineBoost[] = [];

  for (const d of deadlines) {
    const weekNo = weekNoOfDate(d.date, termStart);
    if (weekNo == null || weekNo < 1 || weekNo > totalWeeks) continue;
    out.push({
      id: d.id ?? `campus-${d.date}`,
      title: d.title,
      weekNo,
      weight: weightOfTag(d.tag),
      source: 'campus',
    });
  }

  for (const c of courses) {
    if (!c.examDate) continue;
    const weekNo = weekNoOfDate(c.examDate, termStart);
    if (weekNo == null || weekNo < 1 || weekNo > totalWeeks) continue;
    out.push({
      id: `exam-${c.id}`,
      title: `${c.name} 考试`,
      weekNo,
      weight: 1.0,
      source: 'course',
    });
  }

  return out.sort((a, b) => a.weekNo - b.weekNo);
}

/**
 * 某一周能拿到的交期加成（0–1）：节点越近加成越大。
 * 只看**本周及未来 `lookahead` 周**内的节点；过期节点不再加成（已由 urgency 兜）。
 *
 * ⚠️ 语义是**取最大**（`if (cand > best) best = cand`），不是求和 —— 若将来要接进评分，
 *    这一点必须被测试钉住（多节点时求和会把加成抬到 1.0，抹掉远近差异）。
 *
 * @deprecated superseded by `planner/events.ts`（无生产调用者；不要接进 `evaluate`）
 */
export function urgencyBoostForWeek(
  boosts: DeadlineBoost[],
  weekNo: number,
  lookahead = 2,
): number {
  let best = 0;
  for (const b of boosts) {
    const d = b.weekNo - weekNo;
    if (d < 0 || d > lookahead) continue;
    const cand = b.weight * (1 - d / (lookahead + 1));
    if (cand > best) best = cand;
  }
  return clamp(best, 0, 1);
}

/** 把加成按「周」聚合，便于查看（验收/展示用） */
export function boostsByWeek(boosts: DeadlineBoost[]): Map<number, DeadlineBoost[]> {
  const m = new Map<number, DeadlineBoost[]>();
  for (const b of boosts) {
    const list = m.get(b.weekNo) ?? [];
    list.push(b);
    m.set(b.weekNo, list);
  }
  return m;
}

/* ============================================================
 * 四、目标函数装配（规格书 §5.3 产能 / §5.4 切换成本 / §5.5 装配 / §5.6 交期违约）
 *
 * 设计要点：
 *   · **纯函数**：不读时钟、不用随机、不发请求；时间基准与策略全部由 `EvalContext` 注入。
 *   · **分项即贡献**：`CostBreakdown` 的 7 个字段**都已乘过权重**，
 *     故「7 项之和 === total」是恒等式（验收断言，见规格书 §9-T1.2）。
 *     未加权的原始量另放 `raw`，供 diagnostics / explain 使用。
 *   · **§12.5.8 全局口径**：校区查不出来（`campusOfPlace` 返回 `null`）时
 *     **既不排除也不惩罚** —— 见 `placeMismatch` 与 `dayCampusOf` 的实现。
 * ========================================================== */

/** 一天的时间窗缺省（与 `PlanRequest.dayStart/dayEnd` 默认一致） */
const DAY_START_DEFAULT = 7 * 60;   // 07:00
const DAY_END_DEFAULT = 23 * 60;    // 23:00

/** 目标函数分项 —— **每一项都已乘权重**，因此 7 项之和恒等于 `total` */
export interface CostBreakdown {
  studyShortfall: number;
  blankDeficit: number;
  switchCost: number;
  transferRisk: number;
  dueOverdue: number;
  churn: number;
  placeMismatch: number;
  /** === 上列 7 项之和（构造上保证，无浮点误差） */
  total: number;
  /** 未加权的原始量（诊断/解释用，不参与 total） */
  raw: {
    studyMin: number;
    targetStudyMin: number;
    blankMin: number;
    requiredBlankMin: number;
    /** Σ overdue(commit) 的原始单位数（§5.6 的 10/5/0 之和） */
    overdueUnits: number;
    /** churn 的未加权分钟数（`churnMinutes` 口径） */
    churnMin: number;
    /** 被判为地点错配的块数 */
    mismatchedBlocks: number;
    /** 因「校区未知」而**未**计入惩罚的块数（观察用，恒不产生 cost） */
    unknownCampusBlocks: number;
  };
}

/** `evaluate()` 的输入上下文（除计划本身以外的一切） */
export interface EvalContext {
  weekNo: number;
  policy: PhasePolicy;
  weights: Weights;
  /** 需要考核交期的提交项；缺省不产生 `dueOverdue` */
  commits?: Commit[];
  /** 地点索引；缺省用内置表 */
  places?: Map<string, Place>;
  dayStartMin?: number;
  dayEndMin?: number;
  /** 上一版计划：给了才启用 churn（最小扰动） */
  previousPlan?: WeekPlan;
  /** 锁级别覆盖：blockId → LockLevel */
  lockLevels?: Record<string, LockLevel>;
  /**
   * 跨周滚动状态。给了就启用**疲劳 / 逐日可行性**调节，
   * 且「自习缺口」的目标值必须随之调整 —— 否则把目标主动调低之后，
   * 评分仍按原目标扣分，引擎会把一份合理计划判成差计划。
   */
  rolling?: RollingState;
  /**
   * 评分口径（2026-09-19，PR-A）：缺省 `legacy`。
   * `transfer-aware` 才用真实转场分钟 —— 详见 `ScoringMode` 与 `transferPenalty`。
   */
  scoring?: ScoringMode;
  /** 转场数据可信度折扣（`transfer-aware` 用）；缺省 `TRANSFER_TRUST` */
  transferTrust?: number;
  /**
   * 转场数据源（PR-D）。**给了它就用它现算**，不再读块上的 `block.transfer` 提示 ——
   * 这样彻底消灭「移动块后提示过期」这类问题（搜索过程中提示没人重挂，
   * 度量就会拿着旧位置的分钟数打分）。缺省时退回提示/固定档，legacy 行为不变。
   */
  transfer?: import('./campusLookup.ts').TransferProvider;
}

/** 一个块是否「硬」（不可移动）：显式锁 `hard`，或来源为课程 */
export function isHardBlock(
  block: TimeBlock,
  lockLevels: Record<string, LockLevel> = {},
): boolean {
  return resolveLockLevel(block, lockLevels) === 'hard';
}

/** 认知主体键：优先 `courseId`，退回标题 */
function subjectKey(b: TimeBlock): string {
  return b.courseId ?? b.title;
}

/** 「学习族」：认知切换只在学习类块之间计价（避免误伤三餐，规格书 §5.4 说明） */
function isStudyFamily(b: TimeBlock): boolean {
  return b.kind === 'study' || b.kind === 'course';
}

/**
 * 通勤风险惩罚（规格书 §5.4）。
 * 只依赖时间算术，不需要路网 —— 同地点 0；会迟到 10；偏紧 3；正常 1。
 */
/**
 * 「地点变了」的固定罚分 —— **只在拿不到真实转场分钟时使用**（legacy 口径 / 数据缺失）。
 *
 * ⚠️ 2026-09-19 复核：此前**所有**相邻对都走这里，于是 transferRisk 占了总代价 90%，
 *    且实测 170/170 个"地点变化对"全是固定罚 1 —— 与距离、校区、真实步行时间**全都无关**。
 *    换句话说：它罚的是"换了几次地点"，不是"这段路赶不赶得上"。
 *    真正危险的跨校区排布会被淹没（1km 与 100m 同价）。
 */
export function transferPenalty(prev: TimeBlock, next: TimeBlock, minutes?: number | null): number {
  if ((prev.place ?? '') === (next.place ?? '')) return 0;
  const slackMin = next.startMin - prev.endMin;

  // —— 有真实分钟数（transfer-aware）→ 按"赶不赶得上"分级，距离越远越贵 ——
  if (typeof minutes === 'number' && minutes > 0) {
    if (slackMin < minutes) return 10;            // 走不到：必须避免
    if (slackMin < minutes + 5) return 3;         // 踩点（铁律②的 5min 缓冲）
    if (minutes > 12) return 2;                   // 路程本身长：仍不如就近换点
    return 1;                                     // 短距离、余量足：保留一个下限，
  }                                               //   避免优化器为了省 0.0 分把日程切碎

  // —— 无数据 → 退回旧的固定档（保证离线/单测/legacy 行为完全不变）——
  if (slackMin < 0) return 10;
  if (slackMin < 5) return 3;
  return 1;
}

/**
 * 从 provider 现算这一对的**有效转场分钟**（含可信度折扣）。
 * 拿不到数据（provider 返回 null）时返回 null → 调用方退回固定档（不猜、不罚）。
 */
export function transferMinutesFromProvider(
  provider: import('./campusLookup.ts').TransferProvider,
  from: string | undefined,
  to: string | undefined,
  trust = 1,
): number | null {
  if (!from || !to || from === to) return null;
  const info = provider(from, to);
  if (!info || typeof info.minutes !== 'number' || info.minutes <= 0) return null;
  return info.reliable === false ? info.minutes * trust * ESTIMATE_TRUST : info.minutes * trust;
}

/**
 * 取出这一对相邻块可用的**有效转场分钟**（已含可信度折扣）。
 *
 * 语义（2026-09-18 核对过）：`block.transfer` 描述的是**进入本块**的转场
 * （`fromPlace` = 上一处、`toPlace` = 本块），所以只看 `next.transfer`，不能回退到 `prev`。
 */
export function effectiveTransferMinutes(
  next: TimeBlock | undefined,
  trust = 1,
): number | null {
  const t = next?.transfer;
  if (!t || typeof t.minutes !== 'number' || t.minutes <= 0) return null;
  if (t.tight === true) return t.minutes;          // 已被判紧张：不再打折，保持警示
  return t.reliable === false ? t.minutes * trust * ESTIMATE_TRUST : t.minutes * trust;
}

/** 多数票校区；**投不出票（全为未知）→ null**（§12.5.8：不猜、不罚） */
function majorityCampus(
  blocks: TimeBlock[],
  index: Map<string, Place>,
): CampusId | null {
  const tally = new Map<CampusId, number>();
  for (const b of blocks) {
    if (!b.place) continue;
    const c = campusOfPlace(b.place, index);
    if (c == null) continue; // 未知校区不投票
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  let best: CampusId | null = null;
  let bestN = 0;
  for (const [c, n] of tally) {
    if (n > bestN || (n === bestN && best != null && c < best)) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/**
 * 每天的主校区：优先进当天的**课程块**（教室唯一确定校区），
 * 推不出时退回当天全部有地点的块。**推不出 → null**（该天不参与 placeMismatch）。
 */
export function dayCampusOf(
  plan: WeekPlan,
  index: Map<string, Place> = BUILTIN_PLACE_INDEX,
): Map<number, CampusId | null> {
  const out = new Map<number, CampusId | null>();
  const days = new Set(plan.blocks.map((b) => b.dayOfWeek));
  for (const day of days) {
    const blocks = plan.blocks.filter((b) => b.dayOfWeek === day);
    const campus = majorityCampus(blocks.filter((b) => b.kind === 'course'), index)
      ?? majorityCampus(blocks, index);
    out.set(day, campus);
  }
  return out;
}

/** 该提交项是否已排入本计划（P1 启发式：按 block id 的语义键匹配） */
function blockOfCommit(plan: WeekPlan, commitId: string): TimeBlock | undefined {
  return plan.blocks.find(
    (b) => b.id.endsWith(`-${commitId}`) || b.id.includes(`-${commitId}-`),
  );
}

/**
 * 交期违约惩罚（规格书 §5.6）：
 *   · 未排入且交期已过 → `10 + 逾期天数`
 *   · 已排入但在交期之后 → `5`
 *   · 已排入且未逾期 / 未排入但还没到期 → `0`
 */
export function commitOverdue(
  commit: Commit,
  plan: WeekPlan,
  weekNo: number,
): number {
  if (!commit.dueAt) return 0;
  const dueOffset = (commit.dueAt.weekNo - weekNo) * 7 + (commit.dueAt.dayOfWeek - 1);
  const block = blockOfCommit(plan, commit.id);
  if (!block) return dueOffset < 0 ? 10 + -dueOffset : 0;
  return block.dayOfWeek - 1 > dueOffset ? 5 : 0;
}

/**
 * 装配目标函数（规格书 §5.5）。**纯函数**，同输入必同输出。
 *
 * ```
 * total =  w.studyShortfall · max(0, targetStudy − actualStudy)
 *        + w.blankDeficit   · max(0, requiredBlank − actualBlank)
 *        + Σ switchCost(相邻软块对)
 *        + Σ transferRisk(所有相邻块对，含硬块)
 *        + w.dueOverdue     · Σ overdue(commit)
 *        + churn            (已含 w.churn × lockFactor)
 *        + w.placeMismatch  · #跨校区块
 * ```
 */
export function evaluate(plan: WeekPlan, ctx: EvalContext): CostBreakdown {
  const w = ctx.weights;
  const lockLevels = ctx.lockLevels ?? {};
  const index = ctx.places ?? BUILTIN_PLACE_INDEX;
  const dayStart = ctx.dayStartMin ?? DAY_START_DEFAULT;
  const dayEnd = ctx.dayEndMin ?? DAY_END_DEFAULT;
  const { policy } = ctx;
  // 评分口径：legacy 逐位保持旧行为（冻结快照依赖它）；transfer-aware 才花力气取真实分钟
  const scoring: ScoringMode = ctx.scoring ?? 'legacy';
  const trust = ctx.transferTrust ?? TRANSFER_TRUST;

  // —— 按天分组并按时间排序（相邻对判定用）——
  const byDay = new Map<number, TimeBlock[]>();
  for (const b of plan.blocks) {
    const list = byDay.get(b.dayOfWeek);
    if (list) list.push(b); else byDay.set(b.dayOfWeek, [b]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id));
  }

  const countableDays: number[] = [1, 2, 3, 4, 5];
  if (policy.weekendWork) countableDays.push(6, 7);
  const countable = new Set(countableDays);

  // —— ① 自习缺口 ——
  const studyMin = plan.blocks
    .filter((b) => b.kind === 'study')
    .reduce((s, b) => s + (b.endMin - b.startMin), 0);
  // 目标值与 `construct` **同口径**：逐日累加「有效自习目标」而不是 policy 的基准值
  // （原因是这两个数字必须一致，否则调低目标会让「自习缺口」凭空变大）
  const adj = fatigueAdjustment(policy, ctx.rolling);
  const targetStudyMin = countableDays.reduce((n, d) => n + effectiveStudyMin(adj, d), 0);
  const studyShortfallRaw = Math.max(0, targetStudyMin - studyMin);

  // —— ② 留白缺口 ——
  const freeTotal = countableDays.length * (dayEnd - dayStart);
  const busy = plan.blocks
    .filter((b) => countable.has(b.dayOfWeek))
    .reduce((s, b) => s + (b.endMin - b.startMin), 0);
  const blankMin = Math.max(0, freeTotal - busy);
  const requiredBlankMin = Math.round(freeTotal * policy.blankRatio);
  const blankDeficitRaw = Math.max(0, requiredBlankMin - blankMin);

  // —— ③ 切换成本 + ④ 通勤风险 ——
  let switchCost = 0;
  let transferRisk = 0;
  for (const list of byDay.values()) {
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const next = list[i];
      const placeChanged = (prev.place ?? '') !== (next.place ?? '');
      const bothSoft = !isHardBlock(prev, lockLevels) && !isHardBlock(next, lockLevels);
      if (bothSoft) {
        let c = 0;
        if (isStudyFamily(prev) && isStudyFamily(next) && subjectKey(prev) !== subjectKey(next)) {
          c += w.switchCost;
        }
        if (placeChanged) c += w.switchCost * 0.5;
        switchCost += c;
      }
      // 优先现算（provider 在 → 永远是最新位置的数据）；否则退回块上的提示；再否则固定档
      const minutes = scoring === 'transfer-aware'
        ? (ctx.transfer
            ? transferMinutesFromProvider(ctx.transfer, prev.place, next.place, trust)
            : effectiveTransferMinutes(next, trust))
        : null;
      transferRisk += w.transferRisk * transferPenalty(prev, next, minutes);
    }
  }

  // —— ⑤ 交期违约 ——
  let overdueUnits = 0;
  for (const c of ctx.commits ?? []) overdueUnits += commitOverdue(c, plan, ctx.weekNo);

  // —— ⑥ churn（最小扰动；已含 w.churn 与 lockFactor）——
  const churn = ctx.previousPlan ? churnCost(ctx.previousPlan, plan, lockLevels, w) : 0;

  // —— ⑦ 地点错配（§12.5.8：校区未知不罚）——
  const dayCampus = dayCampusOf(plan, index);
  let mismatchedBlocks = 0;
  let unknownCampusBlocks = 0;
  for (const b of plan.blocks) {
    if (!b.place) continue;
    const c = campusOfPlace(b.place, index);
    if (c == null) { unknownCampusBlocks += 1; continue; }   // ← 未知：不罚
    const main = dayCampus.get(b.dayOfWeek) ?? null;
    if (main == null) continue;                              // ← 当天主校区未知：不罚
    if (c !== main) mismatchedBlocks += 1;
  }

  // —— 分项（已乘权重）与 total：total 由分项相加得到，保证「分项之和 === total」——
  const a = w.studyShortfall * studyShortfallRaw;
  const b2 = w.blankDeficit * blankDeficitRaw;
  const d = transferRisk;
  const e = w.dueOverdue * overdueUnits;
  const g = w.placeMismatch * mismatchedBlocks;
  const c2 = switchCost;
  const f = churn;
  const total = a + b2 + c2 + d + e + f + g;

  return {
    studyShortfall: a,
    blankDeficit: b2,
    switchCost: c2,
    transferRisk: d,
    dueOverdue: e,
    churn: f,
    placeMismatch: g,
    total,
    raw: {
      studyMin,
      targetStudyMin,
      blankMin,
      requiredBlankMin,
      overdueUnits,
      churnMin: ctx.previousPlan ? churnMinutes(ctx.previousPlan, plan) : 0,
      mismatchedBlocks,
      unknownCampusBlocks,
    },
  };
}

/**
 * 增量目标差（improve 的接受准则用）：`evaluate(to) − evaluate(from)`。
 * 负值 = 变好。`ctx.previousPlan` 对两者一致，因此 churn 项衡量的是「相对同一基线」。
 */
export function evaluateDelta(from: WeekPlan, to: WeekPlan, ctx: EvalContext): number {
  return evaluate(to, ctx).total - evaluate(from, ctx).total;
}
