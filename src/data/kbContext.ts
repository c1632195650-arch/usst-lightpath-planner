/**
 * 知识库参数的「语境」补充（设计书 §10.7.6 / §10.8）
 * ============================================================
 * CY 的 `methodParams.generated.ts` / `healthParams.generated.ts` 只给了参数值，
 * **没有给适用条件、证据等级和出处** —— 这导致参数会被无条件误用（§10.8.3）。
 *
 * 本文件补上这三样。**纯数据，零逻辑。**
 * 当 CY 的编译管道输出 `provenance` / `context` 时，本文件可退役。
 *
 * 纪律（§10.7.6 分级使用规则）：
 *   A/B → 硬默认 · C → 默认档可改 · D → 默认档 + 标等级 + 可覆盖
 */
import type { KbTier } from '@/lib/planner/kbParams';

export interface KbContext {
  /** 适用阶段（缺省 = 全部）；不在列表内 → 该参数不生效 */
  phase?: string[];
  /** 适用任务（缺省 = 全部）；不在列表内 → 该参数不生效 */
  task?: string[];
  /** 适用类别（缺省 = 全部） */
  category?: string[];
  /** 禁忌 / 反例 —— 有内容时 UI 必须展示 */
  contraindications?: string[];
}

export interface KbProvenance {
  slug: string;
  param: string;
  tier: KbTier;
}

export type KbContextMap = Record<string, KbContext>;
export type KbProvenanceMap = Record<string, KbProvenance>;

/* ── 方法库参数语境 ─────────────────────────────────────────── */

export const METHOD_CONTEXT: KbContextMap = {
  studyDurations:          { contraindications: ['注意力易断者不适合长番茄'] },
  focusMin:                {},
  breakMin:                {},
  deepBlockMin:            { contraindications: ['注意力易断者不宜超过 60 分钟'] },
  maxDeepBlocksPerDay:     {},
  maxConsecutiveBlockMin:  {},
  maxNewConceptsPerBlock:  {},
  reviewIntervalsDays:     {},
  dailyReviewCapMin:       {},
  minSleepHours:           {},
  napMin:                  {},
  napMaxMin:               {},
  ultradianCycleMin:       {},
  ultradianBreakMin:       {},
  examSprintLeadDays:      { phase: ['期末', '冲刺'], task: ['cet', 'final-exam', 'grad-school'] },
  examMockIntervalDays:    { phase: ['期末', '冲刺'], task: ['cet', 'final-exam', 'grad-school'] },
  examMinMockCount:        { phase: ['期末', '冲刺'], task: ['cet', 'final-exam', 'grad-school'] },
  examErrorTaxonomy:       { phase: ['期末'], task: ['cet', 'final-exam', 'grad-school'] },
  habitExpectDays:         { category: ['health'] },
  mcmTotalHours:           { task: ['mcm'], category: ['contest'] },
  mcmDecideTopicByHour:    { task: ['mcm'], category: ['contest'] },
  mcmWritingBlockHours:    { task: ['mcm'], category: ['contest'] },
  mcmSleepMinHours:        { task: ['mcm'], category: ['contest'] },
};

export const METHOD_PROVENANCE: KbProvenanceMap = {
  studyDurations:          { slug: 'pomodoro', param: 'durations', tier: 'D' },
  focusMin:                { slug: 'pomodoro', param: 'focusMin', tier: 'D' },
  breakMin:                { slug: 'pomodoro', param: 'breakMin', tier: 'D' },
  deepBlockMin:            { slug: 'deep-work', param: 'deepBlockMin', tier: 'D' },
  maxDeepBlocksPerDay:     { slug: 'deep-work', param: 'maxDeepBlocksPerDay', tier: 'D' },
  maxConsecutiveBlockMin:  { slug: 'ultradian-rhythm', param: 'maxConsecutiveBlockMin', tier: 'C' },
  maxNewConceptsPerBlock:  { slug: 'working-memory-limit', param: 'maxNewConceptsPerBlock', tier: 'C' },
  reviewIntervalsDays:     { slug: 'spacing-effect', param: 'intervals', tier: 'A' },
  dailyReviewCapMin:       { slug: 'spacing-effect', param: 'dailyCap', tier: 'A' },
  minSleepHours:           { slug: 'sleep-memory-consolidation', param: 'minHours', tier: 'B' },
  napMin:                  { slug: 'sleep-memory-consolidation', param: 'napMin', tier: 'B' },
  napMaxMin:               { slug: 'sleep-memory-consolidation', param: 'napMaxMin', tier: 'B' },
  ultradianCycleMin:       { slug: 'ultradian-rhythm', param: 'cycleMin', tier: 'C' },
  ultradianBreakMin:       { slug: 'ultradian-rhythm', param: 'breakMin', tier: 'C' },
  examSprintLeadDays:      { slug: 'exam-strategy', param: 'sprintLeadDays', tier: 'C' },
  examMockIntervalDays:    { slug: 'mock-exam-analysis', param: 'mockIntervalDays', tier: 'D' },
  examMinMockCount:        { slug: 'mock-exam-analysis', param: 'minMockCount', tier: 'D' },
  examErrorTaxonomy:       { slug: 'exam-strategy', param: 'errorTaxonomy', tier: 'C' },
  habitExpectDays:         { slug: 'habit-formation-loop', param: 'expectDays', tier: 'B' },
  mcmTotalHours:           { slug: 'mcm-playbook', param: 'totalHours', tier: 'D' },
  mcmDecideTopicByHour:    { slug: 'mcm-3day-timeline', param: 'decideTopicByHour', tier: 'D' },
  mcmWritingBlockHours:    { slug: 'mcm-3day-timeline', param: 'writingBlockHours', tier: 'D' },
  mcmSleepMinHours:        { slug: 'mcm-playbook', param: 'sleepMinHours', tier: 'D' },
};
