/**
 * 目标偏好（2026-09-20，目标分解算法的输入）
 * ============================================================
 * 问卷末尾「目标偏好」附加组（4 题）的存储，**独立 key**：
 *   · 画像本体（PersonaProfile）在 types.ts 契约层 —— 这里零侵入，无需 CY 会签
 *   · 只服务目标分解（`goalDecompose.ts`），与画像数据流完全解耦
 */

const KEY = 'usst-goal-prefs-v1';

export interface GoalPrefs {
  /** 每周有空的大块时间：1=周一 … 7=周日 */
  freeDays: number[];
  /** 单次专注时长（分钟）—— 覆盖 40 分钟块长基准 */
  focusMinutes: number;
  /** 自主安排偏好时段 */
  timeOfDay: 'morning' | 'day' | 'evening';
  /** 习惯同时推进的目标数 */
  parallelCount: 1 | 2 | 3;
  /**
   * G3 精力预算表（周上限，分钟）：目标类任务按 kind 归类，
   * 合计超上限的部分不排（产出预警而非静默砍）。
   */
  weeklyCaps: { studyMin: number; activityMin: number };
}

/** 未答问卷时的默认值（块长基准 40min，用户定稿） */
export const DEFAULT_GOAL_PREFS: GoalPrefs = {
  freeDays: [1, 2, 3, 4, 5],
  focusMinutes: 40,
  timeOfDay: 'evening',
  parallelCount: 1,
  weeklyCaps: { studyMin: 600, activityMin: 300 },
};

/** 多目标并行折扣：同时推进越多，单目标预算越保守 */
export const PARALLEL_DISCOUNT: Record<number, number> = { 1: 1, 2: 0.85, 3: 0.75 };

export function loadGoalPrefs(): GoalPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_GOAL_PREFS };
    const parsed = JSON.parse(raw) as Partial<GoalPrefs>;
    // 坏数据逐字段兜底 —— 不因一条损坏丢掉整份偏好
    return {
      freeDays: Array.isArray(parsed.freeDays) && parsed.freeDays.length > 0
        ? parsed.freeDays.filter((d) => d >= 1 && d <= 7)
        : [...DEFAULT_GOAL_PREFS.freeDays],
      focusMinutes: typeof parsed.focusMinutes === 'number' && parsed.focusMinutes >= 25
        ? parsed.focusMinutes
        : DEFAULT_GOAL_PREFS.focusMinutes,
      timeOfDay: parsed.timeOfDay ?? DEFAULT_GOAL_PREFS.timeOfDay,
      parallelCount: parsed.parallelCount ?? DEFAULT_GOAL_PREFS.parallelCount,
      weeklyCaps: {
        studyMin: parsed.weeklyCaps?.studyMin ?? DEFAULT_GOAL_PREFS.weeklyCaps.studyMin,
        activityMin: parsed.weeklyCaps?.activityMin ?? DEFAULT_GOAL_PREFS.weeklyCaps.activityMin,
      },
    };
  } catch {
    return { ...DEFAULT_GOAL_PREFS };
  }
}

export function saveGoalPrefs(prefs: GoalPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[goal-prefs] 写入失败：', e);
  }
}

export const GOAL_PREFS_KEY = KEY;
