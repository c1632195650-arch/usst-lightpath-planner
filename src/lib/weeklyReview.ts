/**
 * weeklyReview —— 周报复盘纯函数（F5·C2，2026-10-24）
 * ============================================================
 * 设计（技术方案 F5 行）：**规则模板句为主**，数据复用 behaviorLog 纯函数层
 * （summarizeWeek / goalDebtByGoal），零 LLM、离线可用。
 *   · 「最爱挪的时段」依赖 F3 的 `startMin` 字段——旧记录无字段时该行**省略**
 *     （诚实降级，不硬编）；
 *   · `rate: null` = 「数据累积中」口径（与 summarizeWeek 同一诚实纪律，
 *     不把没数据冒充 0%）；
 *   · 复盘只摆事实，调整决定权在用户（L3/L4 分寸）。
 */
import { summarizeWeek, goalDebtByGoal, type BehaviorRecord } from '@/lib/behaviorLog';
import { bucketOf, BUCKET_LABELS, type DayBucket } from '@/lib/prefLearn';

export interface WeeklyReview {
  /** 本周完成率；null = 无记录（数据累积中） */
  rate: number | null;
  /** 与上周的差（正 = 变好）；任一周无记录 = null */
  delta: number | null;
  /** 最常被跳过/挪开的时段（依赖 F3 startMin；无数据 = null，该行省略） */
  movedSlotTop: string | null;
  /** 本周出现欠账块的目标 */
  debtGoals: Array<{ id: string; skipped: number }>;
  /** 人话复盘行（直接可展示） */
  lines: string[];
}

export function weeklyReview(
  records: readonly BehaviorRecord[],
  weekNo: number,
  prevWeekNo: number,
  goalTitles?: ReadonlyMap<string, string>,
): WeeklyReview {
  const cur = summarizeWeek([...records], weekNo);
  const prev = summarizeWeek([...records], prevWeekNo);
  const delta = cur.rate != null && prev.rate != null ? cur.rate - prev.rate : null;

  // 最爱挪的时段：本周 skipped 且带 startMin 的记录分桶取 top（无字段 → null）
  const bucketCount = new Map<DayBucket, number>();
  for (const r of records) {
    if (r.weekNo !== weekNo || r.status !== 'skipped') continue;
    if (typeof r.startMin !== 'number' || !Number.isFinite(r.startMin)) continue;
    const b = bucketOf(r.startMin);
    bucketCount.set(b, (bucketCount.get(b) ?? 0) + 1);
  }
  let movedSlotTop: string | null = null;
  let topN = 0;
  for (const [b, n] of bucketCount) {
    if (n > topN) { topN = n; movedSlotTop = BUCKET_LABELS[b]; }
  }

  const debtGoals = [...goalDebtByGoal(records, weekNo).entries()]
    .map(([id, skipped]) => ({ id, skipped }))
    .sort((a, b) => b.skipped - a.skipped);

  // 人话行（规则模板句）
  const lines: string[] = [];
  if (cur.rate == null) {
    lines.push('这周还没有标记记录 —— 做完的块记得打个勾，复盘才有据可依');
  } else {
    const pct = Math.round(cur.rate * 100);
    lines.push(`完成率 ${pct}%（做了 ${cur.done} / 标记 ${cur.marked} 块）`);
    if (delta != null) {
      const dpct = Math.round(Math.abs(delta) * 100);
      lines.push(delta >= 0 ? `比上周多完成 ${dpct}%` : `比上周少完成 ${dpct}%`);
    } else {
      lines.push('上周没有标记记录，环比从这周开始算');
    }
  }
  if (movedSlotTop) lines.push(`${movedSlotTop}的块最常被你挪开或跳过`);
  if (debtGoals.length > 0) {
    const first = debtGoals[0];
    const name = goalTitles?.get(first.id) ?? '目标';
    lines.push(`有 ${debtGoals.length} 个目标出现欠账块（最多的是「${name}」，跳过 ${first.skipped} 次）`);
  }
  lines.push('复盘只把事实摆出来 —— 要不要调整节奏，由你决定');
  return { rate: cur.rate, delta, movedSlotTop, debtGoals, lines };
}
