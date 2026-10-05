/**
 * 光溯移动端 · 执行力评估 · 数据模型（任务书 P0-2）
 * ============================================================
 * 依据 docs/任务二-执行力评估体系方案-交zcode-2026-10-06.md：
 *   · 评估结果**必须含可判度**：`value: null ⟺ confident: false`（铁律 3）；
 *   · `unknown` 绝不降级为 `gap`：数据不足时 UI 显示「数据累积中」，不给 0 分（铁律 2）；
 *   · 五维**各自独立**，不合成总分（铁律 1）。
 *
 * 三条铁律在类型层的落法：
 *   · DimResult 用可辨识联合：`confident: true` 分支里 value 是 number（不存在 null），
 *     `confident: false` 分支里 value 只能是 null —— 想造 `{confident:true, value:null}`
 *     在编译期就过不了 tsc（不靠运行时自觉，任务书 P0-2 验收项）；
 *   · 本模块与 compute.ts 全部纯数据 + 纯函数，不 fetch / 不读时钟 / 不碰 storage
 *     （时间一律 dayKey 字符串入参，"YYYY-MM-DD" 本地日历日）。
 */

/** 五个评估维度（任务书 §二 定死，不增不减） */
export type DimId = 'completion' | 'procrastination' | 'continuity' | 'timeDiscipline' | 'selfReport';

export const DIM_IDS: readonly DimId[] = ['completion', 'procrastination', 'continuity', 'timeDiscipline', 'selfReport'];

/** 维度的展示名（UI 与计算层共用一份，避免各写各的） */
export const DIM_LABELS: Record<DimId, string> = {
  completion: '任务完成率',
  procrastination: '拖延指数',
  continuity: '连续性',
  timeDiscipline: '时间纪律',
  selfReport: '自我报告',
};

/** 方法提示引用（数据源 = METHOD_PARAMS.hints，slug/title/summary 全部照抄编译产物，零编造） */
export interface MethodTipRef {
  slug: string;
  title: string;
  summary: string;
}

/** 评估依据：客观行为数据与自评答题分开记，供「可判度」追溯 */
export interface EvalBasis {
  objective: string[];
  selfReport: string[];
}

interface DimMeta {
  dim: DimId;
  /** 该维度的样本量（天数 / 条数，语义见各计算函数） */
  sampleSize: number;
  basis: EvalBasis;
}

/**
 * 单维评估结果 —— 可判度的类型强制：
 *   confident: true  → value 一定有数（number）；
 *   confident: false → value 只能是 null（「数据累积中」，不是 0 分）。
 */
export type DimResult = DimMeta &
  ({ confident: true; value: number } | { confident: false; value: null });

/** 可判（有数）分支的构造器 —— 集中一处，杜绝散落的字面量绕过类型 */
export function judged(dim: DimId, value: number, sampleSize: number, basis: EvalBasis): DimResult {
  return { dim, confident: true, value, sampleSize, basis };
}

/** 不可判（数据累积中）分支的构造器 —— value 恒 null，调用方没有「给个 0 吧」的口子 */
export function accumulating(dim: DimId, sampleSize: number, basis: EvalBasis): DimResult {
  return { dim, confident: false, value: null, sampleSize, basis };
}

/** 「本周最该改的一件事」（P3-1）：最弱且可改进的一维 + 指向习惯库方法的提示 */
export interface FocusSuggestion {
  dim: DimId;
  tip: MethodTipRef;
}

/** 一次完整的五维评估（无总分字段 —— 类型上就不存在「合成一个数」的位置） */
export interface ExecutionProfile {
  dims: Record<DimId, DimResult>;
  focus: FocusSuggestion | null;
}

/* ---------- 输入记录（全部由调用方注入；compute 层不读时钟不碰存储） ---------- */

/** 完成单元：一个「当天实例」的计划块/待办（key = dayKey + blockId），done 为最终状态 */
export interface CompletionUnit {
  dayKey: string;
  blockId: string;
  done: boolean;
}

/** 中长期待办的完成情况（任务三 todos[] 落地前，调用方传空数组 → 该维「累积中」） */
export interface LateTodoRecord {
  todoId: string;
  /** 中长期 = long；近期待办不进拖延指数（任务书 §二 维度 2） */
  horizon: 'long' | 'short';
  /** 计划完成日（本地日历日） */
  plannedDoneDayKey: string;
  /** 实际完成日；未完成 = null（不算拖延样本，是 unknown） */
  actualDoneDayKey: string | null;
}

/** 计划块的勾完成记录（时间纪律的原料；由 behaviorLog 在勾选时刻落一条） */
export interface BlockCheckRecord {
  blockId: string;
  /** 计划开始所在的本地日历日 */
  plannedDayKey: string;
  /** 计划开始时刻（当日 0 点起分钟数） */
  plannedStartMin: number;
  /** 实际勾完成所在的本地日历日（跨零点勾选时 ≠ plannedDayKey，是合法数据） */
  checkedDayKey: string;
  /** 实际勾完成时刻（勾选日 0 点起分钟数） */
  checkedMin: number;
  /** true = 后来又取消了勾选（不计入样本） */
  undone: boolean;
}

/** 一条自评答题（score 来自题目的行为锚定选项，0..4） */
export interface SelfReportAnswer {
  questionId: string;
  /** 题目来源条目 slug（可追溯，不存题目副本） */
  slug: string;
  dayKey: string;
  score: number;
}

/** 五维计算的统一输入 */
export interface EvalInput {
  units: CompletionUnit[];
  lateTodos: LateTodoRecord[];
  checks: BlockCheckRecord[];
  answers: SelfReportAnswer[];
}

export const EMPTY_EVAL_INPUT: EvalInput = { units: [], lateTodos: [], checks: [], answers: [] };
