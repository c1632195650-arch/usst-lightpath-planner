/**
 * 光溯移动端 · 执行力评估 · 五维计算（任务书 P1-1 / P1-2）
 * ============================================================
 * 纯函数铁律：不 fetch、不读时钟、不改外部状态 —— 「今天」一律以 dayKey 入参注入，
 * 与排程引擎同一条纪律（sync.ts 顶部同款声明）。Node 单测直接可跑。
 *
 * 口径（任务书 §二 / P1-2，写死在这里而不是靠 UI 措辞）：
 *   · 所有「天」都是**本地日历日**（dayKey = "YYYY-MM-DD"），绝不用 24 小时窗口 ——
 *     23:59 与次日 00:01 是两天，连续性照常 +1（P1-3 变异体 ③ 守这条）；
 *   · 时间纪律：偏差 = 勾完成时刻 − 计划开始；**正向才算拖延，提前不计**；
 *   · 缺完成记录的块不计入任何样本（unknown，绝不降级成 0 / gap）；
 *   · 冷启动：样本 < 7 天时维度 1/3/4「累积中」；拖延指数需 ≥1 条已完成的中长期待办；
 *     自我报告需 ≥3 个答题日（任务书只规定了前三者，此阈值在此申报）。
 */
import { METHOD_PARAMS } from '@/data/methodParams.generated';
import { parseDate } from '../lib/sync.ts';
import {
  accumulating, judged,
  type DimId, type DimResult, DIM_IDS, type EvalBasis, type EvalInput, type ExecutionProfile,
  type FocusSuggestion, type LateTodoRecord, type MethodTipRef, type SelfReportAnswer, type CompletionUnit,
} from './model.ts';

/** 冷启动阈值：有记录以来的跨度 ≥7 天，维度 1/3/4 才可判（任务书 P0-2） */
export const COLD_START_DAYS = 7;
/** 自我报告的最低答题天数（低于则「累积中」；任务书未规定，此处申报为 3 天） */
export const SELF_REPORT_MIN_DAYS = 3;

/* ---------- 日期工具（全部走本地日历日，不碰 Date.now） ---------- */

/** dayKey 偏移 n 天；解析失败返回 null（调用方当作断点处理） */
export function offsetDayKey(dayKey: string, deltaDays: number): string | null {
  const t = parseDate(dayKey);
  if (t === null) return null;
  const d = new Date(t + deltaDays * 86_400_000);
  return localDayKeyOfUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function localDayKeyOfUtc(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** b − a 的天数；任一 dayKey 非法 → null */
export function dayDiff(a: string, b: string): number | null {
  const ta = parseDate(a);
  const tb = parseDate(b);
  if (ta === null || tb === null) return null;
  return Math.round((tb - ta) / 86_400_000);
}

/** 记录跨度（最早一条到 today 的天数，含当天）；空 / 全在未来 → 0 */
function spanDaysFrom(dayKeys: readonly string[], todayKey: string): number {
  const past = dayKeys.filter((k) => (dayDiff(k, todayKey) ?? Infinity) >= 0);
  if (past.length === 0) return 0;
  let earliest = past[0];
  for (const k of past) if ((dayDiff(k, earliest) ?? 0) > 0) earliest = k; // dayDiff(k,earliest)>0 ⇔ k 更早
  return Math.max(0, (dayDiff(earliest, todayKey) ?? -Infinity) + 1);
}

/* ---------- 维度 1 · 任务完成率 ---------- */

/** 近期（自最早一条记录起）计划块/待办的勾选比例，0..100 */
export function completionRate(units: readonly CompletionUnit[], todayKey: string): DimResult {
  const valid = units.filter((u) => (dayDiff(u.dayKey, todayKey) ?? Infinity) >= 0);
  const basis: EvalBasis = { objective: [], selfReport: [] };
  if (valid.length === 0) {
    return accumulating('completion', 0, basis);
  }
  const span = spanDaysFrom(valid.map((u) => u.dayKey), todayKey);
  if (span < COLD_START_DAYS) {
    return accumulating('completion', span, basis);
  }
  const done = valid.filter((u) => u.done).length;
  const value = Math.round((100 * done) / valid.length);
  basis.objective = [`${span} 天内勾选 ${done}/${valid.length}`];
  return judged('completion', value, valid.length, basis);
}

/* ---------- 维度 3 · 连续性 ---------- */

/** dayKeys 里「截至 asOf（含其前一天兜底）」的连续天数 */
function streakAt(doneDays: ReadonlySet<string>, asOf: string): number {
  let cursor = doneDays.has(asOf) ? asOf : offsetDayKey(asOf, -1);
  let streak = 0;
  while (cursor !== null && doneDays.has(cursor)) {
    streak += 1;
    cursor = offsetDayKey(cursor, -1);
  }
  return streak;
}

/**
 * 连续有完成记录的天数（截至今天；今天还没勾则从昨天起算 —— 今天没过完不算断）。
 * 本地日历日判定：跨零点的两次勾选是两天（P1-3 变异体 ③ 的靶子）。
 */
export function continuity(units: readonly CompletionUnit[], todayKey: string): DimResult {
  const valid = units.filter((u) => u.done && (dayDiff(u.dayKey, todayKey) ?? Infinity) >= 0);
  const basis: EvalBasis = { objective: [], selfReport: [] };
  if (valid.length === 0) {
    return accumulating('continuity', 0, basis);
  }
  const span = spanDaysFrom(valid.map((u) => u.dayKey), todayKey);
  if (span < COLD_START_DAYS) {
    return accumulating('continuity', span, basis);
  }
  const doneDays = new Set(valid.map((u) => u.dayKey));
  const streak = streakAt(doneDays, todayKey);
  basis.objective = [`近 ${span} 天中有完成记录的连续 ${streak} 天`];
  return judged('continuity', streak, doneDays.size, basis);
}

/* ---------- 维度 4 · 时间纪律（P1-2 口径） ---------- */

/** 单条勾完成的偏差（分钟）：正向 = 拖延，负向 = 提前（不算拖延，钳到 0 只在汇总时做） */
export function deviationMin(c: {
  plannedDayKey: string; plannedStartMin: number; checkedDayKey: string; checkedMin: number;
}): number | null {
  const d = dayDiff(c.plannedDayKey, c.checkedDayKey);
  if (d === null) return null;
  return d * 1440 + (c.checkedMin - c.plannedStartMin);
}

/**
 * 平均晚开始分钟数（只对「有勾完成记录」的块计算；缺记录 = unknown，不计入）。
 * 提前完成的块偏差为负，汇总时按 0 计 —— 它是守纪律，不是负资产。
 */
export function timeDiscipline(checks: EvalInput['checks'], todayKey: string): DimResult {
  const valid = checks.filter((c) => !c.undone && (dayDiff(c.checkedDayKey, todayKey) ?? Infinity) >= 0);
  const basis: EvalBasis = { objective: [], selfReport: [] };
  if (valid.length === 0) {
    return accumulating('timeDiscipline', 0, basis);
  }
  const span = spanDaysFrom(valid.map((c) => c.checkedDayKey), todayKey);
  if (span < COLD_START_DAYS) {
    return accumulating('timeDiscipline', span, basis);
  }
  const raw = valid
    .map(deviationMin)
    .filter((d): d is number => d !== null);
  const devs = raw.map((d) => Math.max(0, d));
  const value = Math.round(devs.reduce((s, d) => s + d, 0) / devs.length);
  const early = raw.filter((d) => d < 0).length;
  basis.objective = [`${valid.length} 条完成记录（含提前 ${early} 条），平均晚开始 ${value} 分钟`];
  return judged('timeDiscipline', value, valid.length, basis);
}

/* ---------- 维度 2 · 拖延指数 ---------- */

/**
 * 中长期待办平均晚完成天数。已完成 ≥1 条才可判（任务书 P0-2）；
 * 未完成的待办是 unknown，不是「拖延中」的 0 分样本。
 */
export function procrastinationIndex(todos: readonly LateTodoRecord[], todayKey: string): DimResult {
  const done = todos.filter((t) =>
    t.horizon === 'long'
    && t.actualDoneDayKey !== null
    && (dayDiff(t.actualDoneDayKey, todayKey) ?? Infinity) >= 0,
  );
  const basis: EvalBasis = { objective: [], selfReport: [] };
  if (done.length === 0) {
    return accumulating('procrastination', 0, basis);
  }
  const lates = done.map((t) => Math.max(0, dayDiff(t.plannedDoneDayKey, t.actualDoneDayKey!) ?? 0));
  const value = Math.round((lates.reduce((s, d) => s + d, 0) / lates.length) * 10) / 10;
  basis.objective = [`${done.length} 条中长期待办，平均晚完成 ${value} 天`];
  return judged('procrastination', value, done.length, basis);
}

/* ---------- 维度 5 · 自我报告 ---------- */

/** 行为锚定选项得分（0..4）的近期均值，折算 0..100；≥3 个答题日才可判 */
export function selfReportProfile(answers: readonly SelfReportAnswer[], todayKey: string): DimResult {
  const valid = answers.filter((a) =>
    a.score >= 0 && a.score <= 4 && (dayDiff(a.dayKey, todayKey) ?? Infinity) >= 0,
  );
  const basis: EvalBasis = { objective: [], selfReport: [] };
  if (valid.length === 0) {
    return accumulating('selfReport', 0, basis);
  }
  const days = new Set(valid.map((a) => a.dayKey));
  if (days.size < SELF_REPORT_MIN_DAYS) {
    return accumulating('selfReport', days.size, basis);
  }
  const value = Math.round((100 * valid.reduce((s, a) => s + a.score, 0)) / (valid.length * 4));
  basis.selfReport = [`${days.size} 个答题日共 ${valid.length} 题`];
  return judged('selfReport', value, valid.length, basis);
}

/* ---------- 五维独立曲线（每日一点，缺当天数据 = null，不是 0） ---------- */

export type DailySeries = Record<DimId, (number | null)[]>;

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * 最近 N 天（days 升序 dayKey）每个维度每天一个点：
 *   completion=当日勾选比例% / continuity=截至当日的连续天数 / procrastination=当日完成的
 *   中长期待办平均晚完成天 / timeDiscipline=当日完成块平均晚开始分钟 / selfReport=当日均分(0..100)。
 * 当天无样本 → null（曲线上断点，绝不补 0）。
 */
export function dailySeries(input: EvalInput, days: readonly string[]): DailySeries {
  const doneDaysAll = new Set(input.units.filter((u) => u.done).map((u) => u.dayKey));
  const completion = days.map((k) => {
    const us = input.units.filter((u) => u.dayKey === k);
    return us.length ? Math.round((100 * us.filter((u) => u.done).length) / us.length) : null;
  });
  const cont: (number | null)[] = days.map((k) => (doneDaysAll.size ? streakAt(doneDaysAll, k) : null));
  const procrastination = days.map((k) => {
    const ds = input.lateTodos.filter(
      (t) => t.horizon === 'long' && t.actualDoneDayKey === k,
    ).map((t) => Math.max(0, dayDiff(t.plannedDoneDayKey, k) ?? 0));
    return ds.length ? Math.round(mean(ds) * 10) / 10 : null;
  });
  const timeDisciplineS = days.map((k) => {
    const ds = input.checks.filter((c) => !c.undone && c.checkedDayKey === k)
      .map(deviationMin)
      .filter((d): d is number => d !== null)
      .map((d) => Math.max(0, d));
    return ds.length ? Math.round(mean(ds)) : null;
  });
  const selfReport = days.map((k) => {
    const as = input.answers.filter((a) => a.dayKey === k);
    return as.length ? Math.round((100 * mean(as.map((a) => a.score))) / 4) : null;
  });
  return {
    completion,
    continuity: cont,
    procrastination,
    timeDiscipline: timeDisciplineS,
    selfReport,
  };
}

/* ---------- 方法提示（数据源 = METHOD_PARAMS.hints 编译产物，零编造） ---------- */

/** 每维指向的习惯库条目（五条 slug 均已存在于 method_kb.db，tests/eval-tips.test.ts 守护） */
export const DIM_TIP_SLUGS: Record<DimId, string> = {
  completion: 'implementation-intentions',
  procrastination: 'procrastination-regulation',
  continuity: 'habit-formation-loop',
  timeDiscipline: 'time-blocking',
  selfReport: 'self-determination-theory',
};

/** 按维度取方法提示（找不到对应 hint 时返回 null，调用方降级，不造假引用） */
export function tipForDim(dim: DimId): MethodTipRef | null {
  const slug = DIM_TIP_SLUGS[dim];
  const h = METHOD_PARAMS.hints.find((x) => x.slug === slug);
  return h ? { slug: h.slug, title: h.title, summary: h.summary } : null;
}

/** slug → 提示（题目「看方法」用；找不到 = null） */
export function tipForSlug(slug: string): MethodTipRef | null {
  const h = METHOD_PARAMS.hints.find((x) => x.slug === slug);
  return h ? { slug: h.slug, title: h.title, summary: h.summary } : null;
}

/* ---------- 汇总：五维 + 本周最该改的一件事 ---------- */

/** 各维健康度归一到 0..1（仅用于挑「最弱」，绝不求和、不平均 —— 铁律 1） */
export function healthOf(dim: DimId, value: number): number {
  switch (dim) {
    case 'completion': return value / 100;
    case 'procrastination': return 1 / (1 + Math.max(0, value));
    case 'continuity': return Math.min(1, Math.max(0, value) / COLD_START_DAYS);
    case 'timeDiscipline': return Math.max(0, 1 - Math.max(0, value) / 60);
    case 'selfReport': return value / 100;
  }
}

/** 最弱且**可判**的一维；全不可判 → null（此时 UI 显示「累积中」，不给建议） */
export function pickFocus(dims: Record<DimId, DimResult>): FocusSuggestion | null {
  let best: { dim: DimId; health: number } | null = null;
  for (const dim of DIM_IDS) {
    const r = dims[dim];
    if (!r.confident) continue; // 数据累积中的维度不参与 —— null 不当 0 用（P1-3 变异体 ② 的靶子）
    const health = healthOf(dim, r.value);
    if (best === null || health < best.health) best = { dim, health };
  }
  if (best === null) return null;
  const tip = tipForDim(best.dim);
  return tip ? { dim: best.dim, tip } : null;
}

/** 一次完整评估：五个独立维度 + 焦点建议（结构上没有总分的位置） */
export function computeExecutionProfile(input: EvalInput, todayKey: string): ExecutionProfile {
  const dims: Record<DimId, DimResult> = {
    completion: completionRate(input.units, todayKey),
    procrastination: procrastinationIndex(input.lateTodos, todayKey),
    continuity: continuity(input.units, todayKey),
    timeDiscipline: timeDiscipline(input.checks, todayKey),
    selfReport: selfReportProfile(input.answers, todayKey),
  };
  return { dims, focus: pickFocus(dims) };
}
