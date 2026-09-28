/**
 * 方法论 → 排程的纯消费层（Method params consumer）
 * ============================================================
 * 数据来源：`@/data/methodParams.generated`（由 scripts/compile_method_params.py
 * 从 data/method_kb.db **构建期**编译而来）。运行时**不查库、不 fetch、不读时钟** ——
 * 这是排程引擎「纯函数 + 确定性」铁律在知识侧的对应实现。
 *
 * 边界与归属：
 *   · 本文件是**新增的叶子模块**：不 import `templates.ts`，也不被它 import；
 *     想让排程真的用上这些档位，由 `planWeek` / UI 侧显式接入（见 docs/method-kb-plan.md）。
 *   · `lib/planner/` 目录当前属 B（Ray）所有；本文件为 CY 新增、内容只读数据，
 *     归属与命名请 B 复核（AGENTS.md 的文件红线）。
 *
 * 「知识」与「参数」的分工：
 *   - 解释为什么 → `method_kb.db`（梨宝对话走 study_ctx）
 *   - 决定排成什么样 → 本文件暴露的常量与纯函数
 */

import { METHOD_PARAMS } from '@/data/methodParams.generated';

export type MethodPhase = '适应期' | '常规' | '期末' | 'any';
export type MethodTask = 'mcm' | 'guangdianbei' | 'cet' | 'final-exam' | 'grad-school';

export interface MethodHint {
  slug: string;
  title: string;
  summary: string;
  /** A 元分析 | B 一致实证 | C 教科书共识 | D 专家经验 */
  tier: string;
  /** verified | contested（contested 的只能作提示，不可当定论） */
  status: string;
}

/** 编译自方法库的机器参数（含出处，见 generated 文件头部） */
export const METHOD = METHOD_PARAMS;

/** 自习块时长档位 —— 番茄工作法的 durations（25/50），替代拍脑袋的 [45,60,90] */
export const STUDY_DURATIONS: readonly number[] = METHOD.blocks.studyDurations;

/** 复习间隔（天）—— 间隔重复的 1/3/7/15/30，供展开复习类 Commit 的 deps */
export const REVIEW_INTERVALS: readonly number[] = METHOD.blocks.reviewIntervalsDays;

/** 应试冲刺参数：提前多少天进入冲刺、多久一次模考、至少几次 */
export const EXAM_SPRINT = {
  leadDays: METHOD.blocks.examSprintLeadDays,
  mockIntervalDays: METHOD.blocks.examMockIntervalDays,
  minMockCount: METHOD.blocks.examMinMockCount,
  errorTaxonomy: METHOD.blocks.examErrorTaxonomy,
} as const;

/** 作息红线：最少睡眠 / 午睡区间（来自睡眠巩固条目） */
export const SLEEP_GUARD = {
  minHours: METHOD.blocks.minSleepHours,
  napMin: METHOD.blocks.napMin,
  napMax: METHOD.blocks.napMaxMin,
} as const;

/** 深度工作块：单块分钟与每日上限（深度工作 + 超日节律） */
export const DEEP_WORK = {
  blockMin: METHOD.blocks.deepBlockMin,
  perDay: METHOD.blocks.maxDeepBlocksPerDay,
  cycleMin: METHOD.blocks.ultradianCycleMin,
  breakMin: METHOD.blocks.ultradianBreakMin,
} as const;

/** 番茄参数（⚠️ D 级证据，见 contraindications —— 仅作默认档，不强制） */
export const POMODORO = {
  focusMin: METHOD.blocks.focusMin,
  breakMin: METHOD.blocks.breakMin,
} as const;

const HINT_INDEX: ReadonlyMap<string, MethodHint> = new Map(
  METHOD_PARAMS.hints.map((h) => [h.slug, h]),
);

/* generated 文件用了 `as const`，键只在「实际出现过的阶段/任务」上；
 * 而调用方传入的是开放的 MethodPhase/MethodTask 字面量（可能尚无数据）。
 * 因此这里把映射放宽为 Record<string, readonly string[]>：缺键返回空数组，
 * 语义是「该阶段暂无方法建议」，而不是类型错误。 */
const PHASE_INDEX = METHOD_PARAMS.byPhase as unknown as Record<string, readonly string[]>;
const TASK_INDEX = METHOD_PARAMS.byTask as unknown as Record<string, readonly string[]>;

/** 按阶段取适用的方法条目（期末 → 应试三板斧 + 模考复盘 + 应激管理…） */
export function methodSlugsForPhase(phase: MethodPhase): readonly string[] {
  return PHASE_INDEX[phase] ?? [];
}

/** 按任务取适用的方法条目（mcm → 打法 + 72h 时间线 + 文献检索…） */
export function methodSlugsForTask(task: MethodTask): readonly string[] {
  return TASK_INDEX[task] ?? [];
}

/** 取某条目的展示信息（含证据等级与争议状态） */
export function methodHint(slug: string): MethodHint | undefined {
  return HINT_INDEX.get(slug);
}

/**
 * 某阶段建议展示的方法卡（排序：争议置底、证据等级高优先）。
 * 纯函数：同输入同输出；contested 恒排最后（守「懂分寸」——不当定论推给人）。
 */
export function methodCardsForPhase(phase: MethodPhase, limit = 6): MethodHint[] {
  const tierRank: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  return methodSlugsForPhase(phase)
    .map((s) => HINT_INDEX.get(s))
    .filter((h): h is MethodHint => !!h)
    .sort((a, b) => {
      const ca = (a.status === 'contested' ? 1 : 0) - (b.status === 'contested' ? 1 : 0);
      if (ca !== 0) return ca;
      return (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9);
    })
    .slice(0, limit);
}

/**
 * 考前第 n 天该做什么（供事件准备块/冲刺页用）。
 * 纯函数：不读时钟；n 由调用方传入（距考试的天数）。
 */
export function examSprintStep(daysLeft: number): { stage: string; action: string } {
  const { leadDays, mockIntervalDays, minMockCount } = EXAM_SPRINT;
  if (daysLeft > leadDays) {
    return { stage: '平时', action: '按间隔重复节奏推进，不需要进入冲刺模式' };
  }
  if (daysLeft > mockIntervalDays * minMockCount) {
    return { stage: '冲刺前期', action: `真题驱动定位薄弱点，每 ${mockIntervalDays} 天一次限时模考` };
  }
  if (daysLeft > 1) {
    return { stage: '冲刺后期', action: '只过错题本与高频考点，不再灌新知识' };
  }
  return { stage: '考前', action: '固定作息 + 简短回顾，把紧张解读为身体在备战' };
}
