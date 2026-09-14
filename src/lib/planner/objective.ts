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
import type { Course } from '@/types';
import type { Commit } from './model.ts';

const DAY_MS = 86_400_000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function parseIsoUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/* ============================================================
 * 一、日期 → 周次（交期换算的基础）
 * ========================================================== */

/** ISO 日期 → 学期第几周（1-based）；解析失败返回 null（不猜） */
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
