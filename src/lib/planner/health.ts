/**
 * 健康库 → 排程侧的消费层（纯函数，无 fetch、无时钟、无随机）
 * ============================================================
 * 数据来源：`src/data/healthParams.generated.ts`（由 scripts/compile_health_params.py
 * 从 data/health_kb.db 编译而来）。本文件只做**读取与换算**，不新增知识。
 *
 * ⚠️ 边界（与方法库 methods.ts 同构，但更严）：
 *   · 这里只有**通用人群区间**，不是给具体某个人的处方 —— 任何面向用户的输出
 *     必须带上 HEALTH_DISCLAIMER；
 *   · 医疗判断（诊断、用药、红旗症状处理）**不在这里**，那些走 health_rag.guard()
 *     的对话层口径，永远不进引擎；
 *   · 本目录归属 Ray，此处只新增叶子文件，未修改引擎既有文件。
 */
import { HEALTH_PARAMS } from '@/data/healthParams.generated';

export const HEALTH = HEALTH_PARAMS;
export const HEALTH_DISCLAIMER: string = HEALTH_PARAMS._meta.disclaimer;

const B = HEALTH_PARAMS.blocks;

/** 睡眠保底：每晚最少小时数 / 推荐在床窗口 */
export const SLEEP_GUARD = {
  minHours: B.sleepMinHours,
  windowHours: B.sleepWindowHours,
} as const;

/** 每周活动量：中等强度 / 高强度下限，单次最小有效时长，力量训练天数 */
export const ACTIVITY = {
  weeklyModerateMin: B.weeklyModerateMin,
  weeklyVigorousMin: B.weeklyVigorousMin,
  minimumSessionMin: B.minimumSessionMin,
  strengthDaysPerWeek: B.strengthDaysPerWeek,
  weeklyLoadIncreasePct: B.weeklyLoadIncreasePct,
} as const;

/** 久坐打断与日常步数 */
export const SEDENTARY = {
  breakEveryMin: B.sedentaryBreakMin,
  dailyStepsTarget: B.dailyStepsTarget,
} as const;

/** 小睡区间 */
export const NAP = { minMin: B.napMin, maxMin: B.napMaxMin } as const;

/** 饮食侧（人群参考值，非个体处方） */
export const NUTRITION = {
  mealsPerDay: B.mealsPerDay,
  saltMaxG: B.saltMaxG,
  addedSugarMaxG: B.addedSugarMaxG,
  waterMlMale: B.waterMlMale,
  waterMlFemale: B.waterMlFemale,
  vegetableMinG: B.vegetableMinG,
  dairyMinMl: B.dairyMinMl,
  proteinGPerKgSedentary: B.proteinGPerKgSedentary,
} as const;

export type HealthDomain = 'sleep' | 'exercise' | 'nutrition' | 'mental';

/**
 * 把每周活动量均摊到若干天 —— 排程侧用（纯函数）。
 * 天数被夹到 1..7；不足单次最小时长时向上取到单次下限。
 */
export function activityMinutesPerDay(daysPerWeek: number): number {
  const d = Math.min(7, Math.max(1, Math.round(daysPerWeek || 1)));
  const per = ACTIVITY.weeklyModerateMin / d;
  return Math.max(ACTIVITY.minimumSessionMin, Math.round(per));
}

/** 每日饮水参考（按性别；未知按男性值兜底 —— 仅用于展示，不做医学建议） */
export function dailyWaterMl(sex: 'male' | 'female' | 'unknown'): number {
  if (sex === 'female') return NUTRITION.waterMlFemale;
  return NUTRITION.waterMlMale;
}

/** 某域的提示卡片（争议条目排到末尾） */
export function healthHintsForDomain(domain: HealthDomain, limit = 3) {
  const rank: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  return HEALTH_PARAMS.hints
    .filter((h) => h.domain === domain)
    .slice()
    .sort((a, b) => {
      const ra = (rank[a.tier] ?? 9) + (a.status === 'contested' ? 10 : 0);
      const rb = (rank[b.tier] ?? 9) + (b.status === 'contested' ? 10 : 0);
      return ra - rb;
    })
    .slice(0, Math.max(1, limit));
}

/**
 * 排程时给用户的健康底线提示（确定性文案，不含个人数据）。
 * 只给「可执行的常识」，不给任何医疗判断。
 */
export function healthFloorNotes(): string[] {
  return [
    `睡眠保底 ${SLEEP_GUARD.minHours} 小时（推荐窗口 ${SLEEP_GUARD.windowHours[0]}–${SLEEP_GUARD.windowHours[1]} 小时）`,
    `每周中等强度活动 ${ACTIVITY.weeklyModerateMin} 分钟以上，力量训练 ${ACTIVITY.strengthDaysPerWeek} 天`,
    `每坐 ${SEDENTARY.breakEveryMin} 分钟起身活动一下，日行 ${SEDENTARY.dailyStepsTarget} 步`,
    `一天 ${NUTRITION.mealsPerDay} 餐定时定量，食盐不超过 ${NUTRITION.saltMaxG} g`,
  ];
}
