/**
 * 执行回流估时 · 组装层胶水（长计划增强计划书 §2.2）
 * ============================================================
 * 纯数学在 `lib/planner/corrections.refinedDurationMin`（可单测、无依赖）；
 * 样本提取在 `behaviorLog.durationSamplesByTitle`；这里只做「任务 × 样本」的装配：
 *   · 按**标题精确匹配**（目标块标题「目标 · 槽位」跨周稳定）；
 *   · 无 durationMin 的任务不动；无样本的任务不动；
 *   · 用户显式编辑（planEdits/locks）在构造**之后**覆盖 —— 「显式恒胜」由管线顺序保证。
 * 引擎纯函数纪律不受影响：本文件属 features 层，只调纯函数 + 读记录。
 */
import type { UserTask } from '@/lib/planner/templates';
import { refinedDurationMin } from '@/lib/planner/corrections';
import { durationSamplesByTitle, type BehaviorRecord } from './behaviorLog';

export function refineTaskDurations(
  tasks: readonly UserTask[],
  records: readonly BehaviorRecord[],
): UserTask[] {
  return tasks.map((t) => {
    if (t.durationMin == null) return t;
    const samples = durationSamplesByTitle(records, t.title);
    if (samples.length === 0) return t;
    const refined = refinedDurationMin(t.durationMin, samples);
    return refined != null ? { ...t, durationMin: refined } : t;
  });
}
