/**
 * 右键空档加一件事 —— 纯函数层（2026-10-07 RAY 拍板）
 * ============================================================
 * 三个判定都在这里，node --test 直跑：
 *
 * · `resolveGapStart`：右键点吸附 10 分钟档后，若贴在前一块后面太近，
 *   自动后撤 **20 分钟转场/休整缓冲**（RAY：「前面有吃饭跑步上课就需要
 *   空出 20 分钟休整和转场的时间」）。前一块的结束时刻不用另查 ——
 *   `freeGapsOf` 的构造保证 `gap.startMin` 就是前一块的结束（首段则是
 *   日界 7:00，没有前块，不缓冲）。
 * · `gapCapacityMin`：从确定开始时间起最多还能占多少分钟 —— 时长选项的封顶。
 *   **末尾也要留 20 分钟转场缓冲**（RAY 2026-10-07：前块后撤 20 + 末块预留 20，
 *   两小时空档 ⟹ 80 分钟可选 = 120 − 20×2，四小时 ⟹ 200 = 240 − 40，以此类推）。
 * · `guessTaskKind`：事件名 → 类型自动判断（决定块的颜色）。关键词命中
 *   用餐/自习，其余归活动。用户可在弹窗里改（自动是默认值，不是结论）。
 */
import { DAY_START_MIN, snap10, type TimeGap } from './timeScale';

/** 前一块之后的最小转场/休整缓冲（RAY 2026-10-07 拍板：不管什么前块，都留 20 分钟） */
export const GAP_ADD_BUFFER_MIN = 20;

/** 时长备选项（分钟）；按空档容量过滤后作为弹窗下拉 */
export const GAP_ADD_DURATIONS: number[] = [15, 30, 45, 60, 90, 120];

/**
 * 右键位置 → 合理的确定开始时间。
 * @param clickedMin 右键点的分钟（未吸附；函数内 snap10）
 */
export function resolveGapStart(gap: TimeGap, clickedMin: number): number {
  const hasPrevBlock = gap.startMin > DAY_START_MIN;
  const earliest = hasPrevBlock ? gap.startMin + GAP_ADD_BUFFER_MIN : gap.startMin;
  return Math.min(Math.max(snap10(clickedMin), earliest), gap.endMin);
}

/** 从 startMin 起最多可占的分钟（末尾再留 20 分钟转场缓冲；≤0 = 放不下任何事） */
export function gapCapacityMin(gap: TimeGap, startMin: number): number {
  return Math.max(0, gap.endMin - GAP_ADD_BUFFER_MIN - startMin);
}

/** 容量内可选的时长（从小到大；空数组 = 连 15 分钟都塞不下）。
 *  档位之外**追加容量本身**（RAY 2026-10-07：要能选满当前空档的全部时间）。 */
export function durationChoices(capacityMin: number): number[] {
  const base = GAP_ADD_DURATIONS.filter((d) => d <= capacityMin);
  if (capacityMin >= 15 && !base.includes(capacityMin)) base.push(capacityMin);
  return base;
}

const MEAL_RE = /早餐|早饭|午餐|午饭|晚餐|晚饭|吃饭|加餐|食堂|聚餐|外卖/;
const STUDY_RE = /自习|学习|复习|预习|作业|背书|背词|单词|看书|读书|刷题|备考|论文|报告|网课|听力/;

/**
 * 事件名 → 类型自动判断。
 * 命中顺序：用餐 → 自习 → 活动（兜底）。改词表注意别互相抢：
 * 「午饭后背单词」meal 先命中 ⟹ 归用餐 —— 对误差不追求完美，用户可改。
 */
export function guessTaskKind(title: string): 'meal' | 'study' | 'activity' {
  const t = title.trim();
  if (MEAL_RE.test(t)) return 'meal';
  if (STUDY_RE.test(t)) return 'study';
  return 'activity';
}
