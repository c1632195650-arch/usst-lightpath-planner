/**
 * 长目标优先级 · 纯函数（2026-10-07 RAY 拍板「优先级模块单独放出来，拖拽排序，左高右低」）
 * ============================================================
 * 取代旧的「每卡三档按钮」：优先级变成**显式顺序**——用户拖一次，整条优先级链重排。
 * 消费方不变（goalDecompose 既有链路）：
 *   · 注水权重（WEIGHT_BY_PRIORITY 0.7~1.3）—— 多目标争预算的分配比例；
 *   · 软上限排名 tiebreaker（临近度 desc, priority desc）—— >5 个目标降权谁先；
 *   · 分解块 priority（60 + (pr-1)×5）—— 引擎排不过来时先保谁。
 * 纯函数：排序与映射不读时钟、不碰存储。
 */
import { deadlineProximity } from './goalDecompose';
import type { Goal } from './goalStore';

/**
 * 顺序位 → 档位。左起第 0 位 = 5（最高），依次递减，第 4 位起 = 1。
 * （>5 个目标时后半段并列 1 档；显示顺序靠 proximity/id tie-break 保持稳定。）
 */
export function priorityForIndex(index: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, 5 - index) as 1 | 2 | 3 | 4 | 5;
}

/**
 * 默认顺序（用户还没拖过时的初始排列）：
 * 截止临近度 desc → 现有 priority desc → id 稳定序。
 * （最临急的排最左 —— 与「从左到右优先级减弱」的语义自洽。）
 */
export function orderGoalsByPriority(
  goals: readonly Goal[],
  weekNo: number,
  termStart: string,
): Goal[] {
  return [...goals].sort((a, b) =>
    deadlineProximity(b, weekNo, termStart) - deadlineProximity(a, weekNo, termStart)
    || (b.priority ?? 3) - (a.priority ?? 3)
    || a.id.localeCompare(b.id));
}

/** 拖拽落定：把一份 id 顺序写成各目标的 priority。返回补丁数组（调用方一次性落库）。 */
export function prioritiesFromOrder(
  orderedIds: readonly string[],
): Array<{ id: string; priority: 1 | 2 | 3 | 4 | 5 }> {
  const indexOf = new Map(orderedIds.map((id, i) => [id, i]));
  return orderedIds.map((id) => ({ id, priority: priorityForIndex(indexOf.get(id) ?? 4) }));
}
