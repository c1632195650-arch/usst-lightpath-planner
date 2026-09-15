/**
 * 排程引擎 v2 · 解释层（Explain）
 * ============================================================
 * 依据：规格书 §9-T1.5、§5.1 步骤 6、§10.3 QL-2（**100% 软块有 `reason`**）。
 *
 * 这是「引擎为什么这么排」的**唯一出口**：
 *   · `reason*`  —— 逐块的一句话理由（面向用户，可质疑、可反驳）
 *   · `issue*`   —— 冲突/风险/提示（error / warn / info 分级）
 *   · `buildWeekNotes` —— 整周说明（面向用户）
 *   · `ensureReasons` / `reasonCoverage` —— QL-2 的**机械保证**与度量
 *
 * 设计纪律：纯函数。文案集中在此处，改文案不会波及排程逻辑（反之亦然）。
 * 与旧引擎的关系：本文件的字符串与 `schedule.ts` @ `31ddeb6` **逐字一致**，
 * 只是把它们从排程逻辑里搬了出来（AC-2 不比对 reason，但没必要制造无谓漂移）。
 */
import type { PhasePolicy, PlanIssue, ScenarioFields, TimeBlock, WeekPlan } from '@/types';
import { humanizeMinutes } from '../../constants/time.ts';
import type { ActivityTemplate, UserTask } from './templates.ts';
import { resolveLockLevel, type LockLevel } from './model.ts';

/* ============================================================
 * 一、逐块理由（reason）
 * ========================================================== */

/** 用户自己钉死的块 */
export function reasonForUserTask(): string {
  return '你自己指定的时间，重排时会锁定不动';
}

/** 模板块（运动/午休/取快递…） */
export function reasonForTemplate(tpl: ActivityTemplate): string {
  return tpl.note ?? '常用模块，按空档大小自动选了这个时长';
}

/** 自习块 —— 说明「为什么是这个长度」 */
export function reasonForStudy(policy: PhasePolicy, dur: number): string {
  return `阶段策略：单块不超过 ${policy.maxBlockMin} 分钟，这块用了 ${dur} 分钟`;
}

/** 用餐块的拼装参数（各段都是可选的，缺省不出现） */
export interface MealReasonArgs {
  /** 主理由（为什么选这家 / 为什么排在这个校区） */
  why: string;
  /** 模块自带的备注 */
  note?: string;
  /** 从上一处走过来的分钟数 */
  need: number;
  anchorPlace?: string;
  /** 吃完走到下一件事的分钟数 */
  tail: number;
  nextPlace?: string;
}

/** 用餐块的理由（与旧引擎逐字一致） */
export function reasonForMeal(a: MealReasonArgs): string {
  return a.why
    + (a.note ? `（${a.note}）` : '')
    + (a.need > 0 && a.anchorPlace ? `；从${a.anchorPlace}走过去约 ${a.need} 分钟` : '')
    + (a.tail > 0 && a.nextPlace ? `；吃完走到${a.nextPlace}约 ${a.tail} 分钟` : '');
}

/** 兜底理由（软块确实没理由时用，保证 QL-2 不为假） */
export function reasonFallback(block: TimeBlock): string {
  const where = block.place ? `（${block.place}）` : '';
  return `按空档自动排入${where}`;
}

/** 提交项（有交期的任务）被排入时的理由 —— 让「为什么先做这个」可解释 */
export function reasonForCommit(
  title: string,
  dueAtWeek: number | null,
  weekNo: number,
): string {
  if (dueAtWeek == null) return '你列出来的事，按优先级排进了空档';
  const left = dueAtWeek - weekNo;
  if (left < 0) return `交期已过（第 ${dueAtWeek} 周）—— 优先补上`;
  if (left === 0) return `本周就是交期（第 ${dueAtWeek} 周）—— 先把它排上`;
  return `交期在第 ${dueAtWeek} 周（还剩 ${left} 周）—— 提前铺开，后期不至于挤成一团`;
}

/** 拆分后的续块理由 */
export function reasonForCommitPart(title: string): string {
  return `「${title}」的第二段 —— 一次做太久反而效率低，拆到两个空档`;
}

/** 因为依赖关系被排在前驱之后的理由 */
export function reasonForCommitDeps(title: string, after: string[]): string {
  return `「${title}」要等 ${after.join('、')} 做完，所以排在其后`;
}

/* ============================================================
 * 二、问题（issues）—— 分级与文案
 * ========================================================== */

/** 同一天两门课时间撞了 */
export function issueCourseConflict(
  dayName: string, a: TimeBlock, b: TimeBlock,
): PlanIssue {
  return {
    level: 'error',
    blockId: b.id,
    message: `${dayName}「${a.title}」与「${b.title}」时间冲突`,
  };
}

/** 课程没地点 → 转场算不出来（旧问题 #17：**不按 0 分钟糊过去**） */
export function issueCourseNoPlace(dayName: string, courseName: string): PlanIssue {
  return {
    level: 'info',
    message: `「${courseName}」还没有上课地点，${dayName}的转场时间无法计算（记得补上）`,
  };
}

/** 某一餐没排上 */
export function issueMealSkipped(dayName: string, reason: string): PlanIssue {
  return { level: 'info', message: `${dayName}：${reason}` };
}

/** 本周自习没达标 */
export function issueStudyShortfall(studyMin: number, wantMin: number): PlanIssue {
  return {
    level: 'info',
    message: `本周自习 ${humanizeMinutes(studyMin)}，低于目标 ${humanizeMinutes(wantMin)}`
      + '（课太满或留白比例偏高，可以把「留白」调低一点）',
  };
}

/** 有环节缺地点 → 该段转场是盲区（汇总成一条，不逐对刷屏） */
export function issueTransferMissingPlace(dayName: string, names: string[]): PlanIssue {
  return {
    level: 'info',
    message: `${dayName}：有环节缺地点（${names.join('、')}），这几段转场时间算不出来，别按「刚好来得及」安排`,
  };
}

/** 通勤来不及 */
export function issueTransferLate(
  dayName: string, prev: TimeBlock, next: TimeBlock, minutes: number, gap: number, slackMin: number,
): PlanIssue {
  return {
    level: 'error',
    blockId: next.id,
    message: `${dayName}：${prev.title} → ${next.title} 要走 ${Math.round(minutes)} 分钟，`
      + `但中间只有 ${gap} 分钟 —— 会迟到 ${Math.abs(slackMin)} 分钟，建议提前出发或换个安排`,
  };
}

/** 通勤偏紧 */
export function issueTransferTight(
  dayName: string, prev: TimeBlock, next: TimeBlock, minutes: number, slackMin: number,
): PlanIssue {
  return {
    level: 'warn',
    blockId: next.id,
    message: `${dayName}：${prev.title} → ${next.title} 走 ${Math.round(minutes)} 分钟，`
      + `只剩 ${slackMin} 分钟余量，偏紧`,
  };
}

/* ============================================================
 * 三、整周说明（notes）
 * ========================================================== */

export interface WeekNotesInput {
  weekNo: number;
  policy: PhasePolicy;
  /** 该周有效课程数（已按周次过滤） */
  effectiveCourseCount: number;
  scenarios: ScenarioFields | null;
  /** 排到「未核实」食堂的顿数 */
  unverifiedMeals: number;
}

/**
 * 组装整周 notes。**顺序与旧引擎一致**（课数 → 运动解释 → 目标 → 晚间 → 周末 → 未核实）。
 */
export function buildWeekNotes(input: WeekNotesInput): string[] {
  const { weekNo, policy, effectiveCourseCount, scenarios, unverifiedMeals } = input;
  const notes: string[] = [];

  if (effectiveCourseCount === 0) {
    notes.push(`第 ${weekNo} 周没有课（已结课或处在考试周），整天都可以自己安排`);
  } else {
    notes.push(`第 ${weekNo} 周有 ${effectiveCourseCount} 门课（已按周次过滤，不是照搬整学期课表）`);
  }

  // 「有人约才去运动」——不主动排，但留一句话（旧引擎在 day===1 时推一次）
  if (scenarios?.exercise_trigger === 'with_others') {
    notes.push('你运动是「有人约才去」，所以没主动给你排运动块 —— 有人约时现成用空档就行');
  }

  notes.push(
    `每天自习目标 ${policy.dailyStudyMin} 分钟｜单块上限 ${policy.maxBlockMin} 分钟`
    + `｜刻意留白 ${Math.round(policy.blankRatio * 100)}%`,
  );

  // ⚠️ 措辞讲究：晚间**可能有课程**（11-13 节是既成事实，不归 policy 管）。
  //    旧文案「这个阶段不占用晚间」会与课表上的晚课自相矛盾（旧问题 #18 / 规格书 §8.2）。
  if (!policy.eveningAllowed) {
    notes.push('这个阶段不主动占用晚间（18:00 之后）—— 晚课照常显示，剩下的晚上留给你自己');
  }
  if (!policy.weekendWork) notes.push('这个阶段不占周末');

  // 数据治理：排到未核实的食堂要如实标注，不能当既成事实
  if (unverifiedMeals > 0) {
    notes.push(
      `本周有 ${unverifiedMeals} 顿排在南校食堂 —— 那边的营业时段是按常规饭点推算的（未核实），`
      + '出发前最好确认一下',
    );
  }
  return notes;
}

/** 「本周自习未达标」这一条（依赖统计结果，故单独一个函数） */
export function summaryStudyIssue(
  studyMin: number, policy: PhasePolicy, weekNo: number,
): PlanIssue | null {
  // weekNo 保留在签名里便于将来按周差异化阈值；当前阈值：
  const studyDays = policy.weekendWork ? 7 : 5;
  const wantMin = policy.dailyStudyMin * studyDays;
  if (studyMin >= wantMin * 0.8) return null;
  void weekNo;
  return issueStudyShortfall(studyMin, wantMin);
}

/* ============================================================
 * 四、QL-2：软块必须 100% 有理由
 * ========================================================== */

/** 软块 = 非 `hard` 的块（课程/用户钉死的是硬块，不需要解释） */
export function isSoftBlock(
  block: TimeBlock,
  lockLevels: Record<string, LockLevel> = {},
): boolean {
  return resolveLockLevel(block, lockLevels) !== 'hard';
}

export function softBlocksOf(plan: WeekPlan): TimeBlock[] {
  return plan.blocks.filter((b) => isSoftBlock(b));
}

/** 给缺理由的软块补上兜底理由（**原地**补，返回补了几条） */
export function ensureReasons(plan: WeekPlan): number {
  let patched = 0;
  for (const b of plan.blocks) {
    if (!isSoftBlock(b)) continue;
    if (typeof b.reason === 'string' && b.reason.trim().length > 0) continue;
    b.reason = reasonFallback(b);
    patched += 1;
  }
  return patched;
}

/** QL-2 度量：软块总数 / 其中有非空 reason 的条数 */
export function reasonCoverage(plan: WeekPlan): { total: number; withReason: number } {
  const soft = softBlocksOf(plan);
  return {
    total: soft.length,
    withReason: soft.filter((b) => typeof b.reason === 'string' && b.reason.trim().length > 0).length,
  };
}

/* ============================================================
 * 五、统一出口（solver 第 6 步调用）
 * ========================================================== */

export interface ExplainInput {
  plan: WeekPlan;
  notes: string[];
  /** 用户自定义模块的原始条目（用于把「浮动任务」也补上理由） */
  tasks?: UserTask[];
}

export interface ExplainResult {
  plan: WeekPlan;
  notes: string[];
  /** 本次补了多少条兜底理由（进 diagnostics 便于发现「哪里漏了」） */
  patchedReasons: number;
}

/**
 * 解释层总入口：保证软块都有理由，并原样带回 notes。
 * 不改块的位置与时长（`improve` 的产物就是最终布局）。
 */
export function explain(input: ExplainInput): ExplainResult {
  const patchedReasons = ensureReasons(input.plan);
  return { plan: input.plan, notes: input.notes, patchedReasons };
}
