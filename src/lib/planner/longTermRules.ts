/**
 * 长期规则的读法（计划书 §1.5-2「读法 A」）
 * ============================================================
 * **语义**：长期规则**只影响创建之后的周次**，后来创建的不回溯改写过去。
 *
 * 场景：第 5 周创建「每周四下午别排」；第 8 周创建「每周四下午要自习」
 *   → 第 5–7 周生效「别排」，第 8 周起生效「要自习」。
 *
 * **为什么不选「简单后覆盖前」**：那会让第 8 周说的话**改写第 5 周的安排** ——
 * 用户会看到「过去的计划被未来的话改掉」，与「长期 = 之后每周」的字面意思相悖。
 *
 * ── 唯一出处 ──────────────────────────────────────────────────
 * S1（长期锁）/ R3（长期调课停课）/ R4（长期不可时段）都调这里，
 * 不许各自实现一份「哪条规则现在有效」的判断 —— 那会出现同一句话在两个地方
 * 得出相反结论的分裂现象。
 */

/** 参与「长期判定」的规则的**最小形状**：一个可选的生效周起点 */
export interface WeeklyRule {
  /** `null` / `undefined` = 长期（自创建周起往后生效） */
  weekNo?: number | null;
  /** 创建时所处的周次 —— 长期规则的排序依据，缺它就无法分开「第 5 周说的」和「第 8 周说的」 */
  createdAtWeek?: number;
}

/** 一次性规则在这一周生效吗（长期规则不适用这条路） */
export function appliesThisWeek(rule: WeeklyRule, weekNo: number): boolean {
  if (rule.weekNo == null) return false;
  return rule.weekNo === weekNo;
}

/** 长期规则在这一周生效吗 —— 只看「创建周 ≤ 本周」 */
export function longRuleApplies(rule: WeeklyRule, weekNo: number): boolean {
  if (rule.weekNo != null) return false;
  const from = rule.createdAtWeek ?? 1;
  return weekNo >= from;
}

/**
 * 在**同一组**长期规则里，取某周生效的那一条。
 *
 * 规则：
 *   · 只考虑「创建周 ≤ 该周」的；
 *   · 取创建周最大的那条（后来的覆盖先前的）；
 *   · 同一周创建多条 → 取**数组里靠后**的那条（同一周才允许覆盖）。
 *
 * @returns 生效的那条；一条都没有 → `null`（调用方自行决定是否回落到别的行为）
 */
export function effectiveRuleAt<T extends WeeklyRule>(rules: readonly T[], weekNo: number): T | null {
  let best: T | null = null;
  let bestIndex = -1;
  rules.forEach((r, i) => {
    if (!longRuleApplies(r, weekNo)) return;
    const from = r.createdAtWeek ?? 1;
    if (best == null || from > (best.createdAtWeek ?? 1) || (from === (best.createdAtWeek ?? 1) && i > bestIndex)) {
      best = r;
      bestIndex = i;
    }
  });
  return best;
}

/**
 * 长期规则的最早生效周 —— 用于「这条规则从哪周开始」的界面说明。
 */
export function effectiveFromWeek(rule: WeeklyRule): number {
  if (rule.weekNo != null) return rule.weekNo;
  return rule.createdAtWeek ?? 1;
}
