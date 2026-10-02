/**
 * 生活事件词表（R批 P0-4 · R6.4 单一来源）
 * ============================================================
 * **为什么放在 `src/lib/` 而不是某个 features 里**：
 * 对话层（`features/libao`）要判「这句是不是生活事件」，反馈层
 * （`features/feedback`）要判「这个块是什么类型」—— 两侧都需要同一份词。
 * 若定义在任一 features 内，另一侧就得跨域 import，而
 * `tests/arch-guards.test.ts` 的 **AC-6·R5 明确禁止新增 features 跨域对**
 * （存量基线只许缩短）。所以下沉到中立层，两边各自 import，域对不增加。
 *
 * **为什么要有这份表**：此前两层各维护一份：
 *   · 对话层 `libaoIntent.ts` 的 GOAL_NOUNS（只到 大餐/聚餐/生日）
 *   · 反馈层 `planIntent.ts` 的写死正则（吃饭|午饭|晚饭|聚餐）
 * 于是「周六晚上要出去吃自助餐」在对话层是生活事件、在反馈层认不出块类型
 * —— 同一句话两处给出不同答案。这类漂移必须靠单一来源根除。
 *
 * 分类维度：meal（吃）/ social（聚）—— 对应 planIntent 的 meal / activity。
 * 词表**只收事名与高频生活动作**，不含「我要/准备」这类意图动词
 * （那属于 ACTION_VERBS 的职责）。
 */

/** 吃饭类：命中 → meal 块。 */
export const LIFE_MEAL_NOUNS: readonly string[] = [
  '大餐', '庆功', '生日', '生日会',
  '自助餐', '火锅', '烧烤', '日料', '西餐',
];

/**
 * 吃饭类的动作/餐次词：不在「事名」表里，但确实是 meal 的强信号。
 * ⚠️ 「吃饭/聚餐」等已在上表的**不重复列出** —— 词表重复会让
 * 「去重」类断言红，也会让后续维护者怀疑数据不一致。
 */
export const LIFE_MEAL_VERBS: readonly string[] = [
  '吃饭', '早饭', '早餐', '午饭', '晚饭', '夜宵',
];

/** 社交类：命中 → activity 块。 */
export const LIFE_SOCIAL_NOUNS: readonly string[] = [
  '聚会', '看电影', '逛街', '购物',
  '演出', '音乐会', '话剧', '观赛', '踢球',
  '露营', '野餐', '社团', '招新', '志愿者', '社会实践',
];

/** 两类合并（只读，供需要「生活事件大集合」的场景用）。 */
export const LIFE_EVENT_WORDS: readonly string[] = [
  ...LIFE_MEAL_NOUNS,
  ...LIFE_MEAL_VERBS,
  ...LIFE_SOCIAL_NOUNS,
];

/**
 * 文本是否命中给定词表之一。
 *
 * 纯函数、无副作用 —— 两个域共用，行为必然一致（这正是单一来源的意义）。
 */
export function hasLifeWord(text: string, words: readonly string[]): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return words.some((w) => t.includes(w));
}
