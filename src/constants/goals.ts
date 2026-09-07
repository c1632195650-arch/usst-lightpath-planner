import type { GoalType, GoalWeights } from '@/types';

/**
 * 大学目标 → 课程优先级权重表
 *
 * 这是「个性化」的数学落点。问卷问出 goal，就查这张表。
 * 想调优先级？改这里，不要改算法。
 *
 * 权重含义：
 *   credit    学分贡献
 *   relevance 与目标的相关度（依赖 course.category）
 *   risk      挂科风险贡献
 *   mastery   掌握度（负向，掌握越差优先级越高）
 */
export const GOAL_WEIGHTS: Record<GoalType, GoalWeights> = {
  /** 保研：GPA 为王 */
  postgrad: { credit: 0.40, relevance: 0.30, risk: 0.20, mastery: 0.10 },
  /** 就业：实习/项目硬时间块优先，课程够用即可 */
  job:      { credit: 0.20, relevance: 0.30, risk: 0.10, mastery: 0.10 },
  /** 出国：GPA + 语言，兼顾专业核心 */
  abroad:   { credit: 0.35, relevance: 0.25, risk: 0.20, mastery: 0.10 },
  /** 竞赛/科研：与目标相关的课优先级最高 */
  contest:  { credit: 0.20, relevance: 0.35, risk: 0.10, mastery: 0.10 },
  /** 探索期：课业占比下调，兴趣与休息上调（本产品的差异化所在） */
  explore:  { credit: 0.15, relevance: 0.20, risk: 0.15, mastery: 0.10 },
};

/** 目标的人话描述 */
export const GOAL_LABEL: Record<GoalType, string> = {
  postgrad: '保研 / 考研',
  job: '就业 / 实习',
  abroad: '出国留学',
  contest: '竞赛 / 科研',
  explore: '探索期（还没想好）',
};

/**
 * 各目标下，不同课程类别的「相关度」基础分（0–1）
 * 用于 relevance 项计算。
 */
export const GOAL_RELEVANCE: Record<GoalType, Record<string, number>> = {
  postgrad: { 专业核心: 1.0, 公共基础: 0.8, 专业选修: 0.6, 通识选修: 0.2, 实践环节: 0.4, 其他: 0.3 },
  job:      { 专业核心: 0.8, 公共基础: 0.5, 专业选修: 0.7, 通识选修: 0.3, 实践环节: 1.0, 其他: 0.5 },
  abroad:   { 专业核心: 1.0, 公共基础: 0.9, 专业选修: 0.6, 通识选修: 0.3, 实践环节: 0.4, 其他: 0.3 },
  contest:  { 专业核心: 1.0, 公共基础: 0.4, 专业选修: 0.8, 通识选修: 0.2, 实践环节: 1.0, 其他: 0.6 },
  explore:  { 专业核心: 0.8, 公共基础: 0.7, 专业选修: 0.7, 通识选修: 0.8, 实践环节: 0.8, 其他: 0.5 },
};
