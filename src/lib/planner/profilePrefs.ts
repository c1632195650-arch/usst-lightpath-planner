/**
 * 画像 → 引擎**块级**偏好（E 批 E3 · 2026-09-28 · 纯函数）
 * ============================================================
 * 为什么要有这个文件：画像此前只影响**阶段策略**（`buildPhases.applyPersona`：一天学多久、
 * 单块多长）与**活动模板触发**（`construct` 的 `scenarios[t.trigger.field]`），
 * 却管不到「**这一块放在哪个时段**」。于是「作息规律的人被排到 22:00 自习」
 * 「愿意走远探店的人三餐全在楼下」这类事照旧会发生。
 *
 * 懂分寸（L3/L4 边界，`docs/project-core.md` §4）：
 *   本文件只产出**偏好序与预算**（"更倾向"、"最多走多久"），
 *   **绝不产出"必须"**；且每条偏好都能说出依据（`reasons`），可被用户一键推翻。
 *
 * 可辩护性纪律：
 *   · 依据只取**画像里真实存在**的轴与场景字段，映射写在 `_MAPPING_DOC` 里逐条说明；
 *   · 没有可辩护依据的（如"夜猫子"——`night_supply` 说的是**夜间补给方式**，
 *     不是作息倾向）**不猜**，登记在 `PROFILE_PARTIALS` 里等数据支持；
 *   · 与本文件同构的开关 `prefsWired()` 缺省开启（G 批 2026-10-01 拍板全开）；
 *     env 显式置 `'0'`/`'false'` 可关闭回退。
 */
import type { AxisKey, PersonaProfile, ScenarioFields } from '@/types';

/* ============================================================
 * 一、总开关（缺省开启；G 批 2026-10-01 起，golden 已按开启态重拍）
 * ========================================================== */

/**
 * 画像偏好开关。双路读取（Node 测试 / Vite 浏览器）。**缺省 true**（E 批灰度期
 * 已结束，G 批拍板全开）；env 显式置 `'0'`/`'false'` 关闭 —— 逃生门。
 * 每次调用都读 —— 用例内可翻开关再复原，不在 import 期定死。
 */
export function prefsWired(): boolean {
  const on = (v: string | undefined) => v == null || (v !== '0' && v !== 'false');
  let v: string | undefined;
  try {
    v = typeof process !== 'undefined'
      ? (process as unknown as { env?: Record<string, string | undefined> }).env?.PROFILE_PREFS_WIRED
      : undefined;
  } catch {
    v = undefined;
  }
  if (v != null) return on(v);
  try {
    v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_PROFILE_PREFS_WIRED;
  } catch {
    v = undefined;
  }
  return on(v);
}

/* ============================================================
 * 二、形状
 * ========================================================== */

/** 时段（分钟，[起, 止)，左闭右开以免两段在整点上重叠） */
export interface TimeWindow { startMin: number; endMin: number }

export interface BlockPrefs {
  /** 自习/深度工作的**偏好**时段（按倾向从强到弱；空数组 = 无偏好，走引擎默认「大空档优先」） */
  deepWorkWindows: TimeWindow[];
  /** 三餐步行预算（分钟）—— 与 `placesPolicy.DEFAULT_WALK_BUDGET_MIN` 同口径 */
  mealWalkBudgetMin: number;
  /** 是否接受 <60 分钟的碎片自习档（随性的人比"提前排满"的人更能用碎片） */
  allowFragmentedStudy: boolean;
  /** 逐条依据（面向用户，可质疑；与 `Phase.reasons` 同一纪律） */
  reasons: string[];
}

/** 常量（可被测试与 UI 引用，不写死在逻辑里） */
export const PREFS = {
  /** 上午窗口（作息规律者优先） */
  MORNING: { startMin: 8 * 60, endMin: 12 * 60 } as TimeWindow,
  /** 下午窗口 */
  AFTERNOON: { startMin: 13 * 60, endMin: 17 * 60 } as TimeWindow,
  /** 晚间窗口（18:00 起） */
  EVENING: { startMin: 18 * 60, endMin: 22 * 60 } as TimeWindow,
  /** 三餐步行预算：就近 / 默认 / 愿意走远 */
  MEAL_WALK_NEAR: 10,
  MEAL_WALK_DEFAULT: 15,
  MEAL_WALK_FAR: 25,
  /** 阈值（与 buildPhases.applyPersona 的 70/35 保持同一口径，避免"同一个数字两处不同说法"） */
  HIGH: 70,
  LOW: 35,
} as const;

/* ============================================================
 * 三、映射（每条都写清"哪个字段 → 哪个偏好"）
 * ========================================================== */

const _MAPPING_DOC: readonly string[] = [
  'HEA ≥ 70（作息运动自律）→ 上午优先：规律作息者的上午专注更稳（启发式，可被一键推翻）',
  'HEA ≤ 35（自律偏低）→ **不排上午偏好**：早起专注不可靠，改由引擎按大空档排',
  'scenarios.planning === "flexible"（随性而动）→ 允许 <60 分钟碎片自习档',
  'scenarios.planning === "planned"（提前排满）→ 只接受 ≥60 分钟整块',
  'scenarios.meal_radius：near → 步行预算 10 分钟；far → 25 分钟；缺省 15 分钟',
];

/** 时段亲和度：落在偏好窗口内 → 按窗口序给分（越靠前越强），窗口外 0 */
export function gapAffinity(prefs: BlockPrefs | null, gap: TimeWindow): number {
  if (!prefs || prefs.deepWorkWindows.length === 0) return 0;
  const n = prefs.deepWorkWindows.length;
  for (let i = 0; i < n; i++) {
    const w = prefs.deepWorkWindows[i];
    // 空档与偏好窗口有实质重叠（≥30 分钟）才算命中，避免"擦边"就抢优先
    const overlap = Math.min(gap.endMin, w.endMin) - Math.max(gap.startMin, w.startMin);
    if (overlap >= 30) return n - i;
  }
  return 0;
}

/**
 * 画像 → 块级偏好。`profile` 与 `scenarios` 都可为 null（未做画像 / 旧快照）。
 * 任何一项没有依据就不产出该项（空 means 无偏好，而不是"默认偏好早上"）。
 */
export function blockPrefs(
  profile: PersonaProfile | null,
  scenarios: ScenarioFields | null,
): BlockPrefs {
  const reasons: string[] = [];
  const windows: TimeWindow[] = [];

  const ax = (k: AxisKey): number | null => profile?.axes?.[k] ?? null;
  const hea = ax('HEA');
  if (hea != null && hea >= PREFS.HIGH) {
    windows.push(PREFS.MORNING, PREFS.AFTERNOON);
    reasons.push(`健康自律偏高（${hea}）→ 自习优先排在上午，其次下午（作息规律者上午更稳）`);
  } else if (hea != null && hea <= PREFS.LOW) {
    // 刻意**不加**上午偏好；同时也不臆造"晚上更好"
    reasons.push(`健康自律偏低（${hea}）→ 不指定时段偏好，由大空档决定（避免把早起专注当默认）`);
  }

  const planning = scenarios?.planning ?? null;
  const allowFragmentedStudy = planning === 'flexible';
  if (planning === 'flexible') reasons.push('计划习惯：随性而动 → 接受 30–59 分钟的碎片自习档');
  else if (planning === 'planned') reasons.push('计划习惯：提前排满 → 只用 60 分钟以上的整块');

  const radius = scenarios?.meal_radius ?? null;
  const mealWalkBudgetMin = radius === 'far'
    ? PREFS.MEAL_WALK_FAR
    : radius === 'near' ? PREFS.MEAL_WALK_NEAR : PREFS.MEAL_WALK_DEFAULT;
  if (radius === 'far') reasons.push(`就餐半径：愿意走远探店 → 三餐步行预算放宽到 ${PREFS.MEAL_WALK_FAR} 分钟`);
  else if (radius === 'near') reasons.push(`就餐半径：就近快吃 → 三餐步行预算收紧到 ${PREFS.MEAL_WALK_NEAR} 分钟`);

  return { deepWorkWindows: windows, mealWalkBudgetMin, allowFragmentedStudy, reasons };
}

/* ============================================================
 * 四、画像指纹（"画像变了 → 只重排受影响天"的判据）
 * ========================================================== */

/**
 * 四·五、画像 → 排程的逐元素解释（批 5，7A）
 * ----------------------------------------------------------
 * 画像页「这会如何影响你的排程」面板的数据源：把**当前画像命中**的规则
 * 逐条列出来，让 35 题问卷从「测着玩」变成「可解释的输入」。
 * ⚠️ phase 组的阈值与 `buildPhases.applyPersona` 逐条对齐 —— 两处必须同步改
 * （第一版独立实现 + 注释互锚，合表 TODO 见 PROFILE_PARTIALS 后续批次）。
 */
export interface ProfileExplainItem {
  /** 画像元素（轴名或场景字段名） */
  element: string;
  /** 当前值（如「HEA=80」「planning=flexible」） */
  value: string;
  /** 对排程的实际影响（人话） */
  effect: string;
  /** 规则出处：phase=阶段策略 / prefs=块级偏好 / template=模块触发 */
  source: 'phase' | 'prefs' | 'template';
}

export function explainProfile(
  profile: PersonaProfile | null,
  scenarios: ScenarioFields | null,
): ProfileExplainItem[] {
  const out: ProfileExplainItem[] = [];
  const ax = (k: AxisKey): number | null => profile?.axes?.[k] ?? null;

  // ── phase：与 buildPhases.applyPersona 的阈值逐条对齐（两处必须同步改）──
  const ach = ax('ACH');
  if (ach != null && ach >= 70) out.push({ element: 'ACH 成就驱动', value: `ACH=${ach}`, effect: '每天自习目标上调两成', source: 'phase' });
  else if (ach != null && ach <= 35) out.push({ element: 'ACH 成就驱动', value: `ACH=${ach}`, effect: '每天自习目标下调两成，先保住节奏', source: 'phase' });
  const plan = ax('PLAN');
  if (plan != null && plan >= 70) out.push({ element: 'PLAN 计划性', value: `PLAN=${plan}`, effect: '单块上限 +30 分钟，可以放长专注', source: 'phase' });
  else if (plan != null && plan <= 35) out.push({ element: 'PLAN 计划性', value: `PLAN=${plan}`, effect: '单块压到 45 分钟以内，靠短块推进', source: 'phase' });
  const hea = ax('HEA');
  if (hea != null && hea <= 35) out.push({ element: 'HEA 健康自律', value: `HEA=${hea}`, effect: '留白率上调 10%，别把自己排满', source: 'phase' });
  else if (hea != null && hea >= 70) out.push({ element: 'HEA 健康自律', value: `HEA=${hea}`, effect: '留白率下调 5%，可以承受更密的安排', source: 'phase' });
  const res = ax('RES');
  if (res != null && res <= 35) out.push({ element: 'RES 稳定恢复', value: `RES=${res}`, effect: '留白率再上调 5%，多留恢复时间', source: 'phase' });

  // ── prefs：与 blockPrefs 同源 ──
  if (hea != null && hea >= PREFS.HIGH) out.push({ element: 'HEA 健康自律', value: `HEA=${hea}`, effect: '自习优先排在上午（8:00–12:00），其次下午（13:00–17:00）', source: 'prefs' });
  else if (hea != null && hea <= PREFS.LOW) out.push({ element: 'HEA 健康自律', value: `HEA=${hea}`, effect: '不指定自习时段偏好，由大空档决定（不把早起专注当默认）', source: 'prefs' });
  const planning = scenarios?.planning ?? null;
  if (planning === 'flexible') out.push({ element: 'planning 计划习惯', value: 'planning=flexible', effect: '接受 30–59 分钟的碎片自习档', source: 'prefs' });
  else if (planning === 'planned') out.push({ element: 'planning 计划习惯', value: 'planning=planned', effect: '只用 60 分钟以上的整块自习', source: 'prefs' });
  const radius = scenarios?.meal_radius ?? null;
  if (radius === 'far') out.push({ element: 'meal_radius 就餐半径', value: 'meal_radius=far', effect: '三餐按最多步行 25 分钟推荐食堂（排程约束接线中）', source: 'prefs' });
  else if (radius === 'near') out.push({ element: 'meal_radius 就餐半径', value: 'meal_radius=near', effect: '三餐按最多步行 10 分钟就近推荐（排程约束接线中）', source: 'prefs' });

  // ── template：模块触发（construct 按场景字段决定要不要排）──
  if (scenarios?.exercise_trigger === 'self_plan') out.push({ element: 'exercise_trigger 运动方式', value: 'self_plan', effect: '排程会加入自主运动块', source: 'template' });
  if (scenarios?.night_supply === 'convenience') out.push({ element: 'night_supply 夜间补给', value: 'convenience', effect: '晚间会排便利店夜宵补给块', source: 'template' });
  if (scenarios?.social_radius === 'wide') out.push({ element: 'social_radius 社交半径', value: 'wide', effect: '会安排「搭子自习」这类社交学习块', source: 'template' });
  if (scenarios?.event_breadth === 'broad') out.push({ element: 'event_breadth 活动广度', value: 'broad', effect: '会安排社团活动块', source: 'template' });

  return out;
}

/**
 * 稳定指纹：轴值 + 场景字段 + 画像版本。用途是**变更检测**（增量重排的触发条件），
 * 不是安全哈希 —— 明文拼接、可读、可断言，同输入必得同串。
 * 轴值四舍五入到整数：浮点尾差不该导致"整周重排"。
 */
export function profileFingerprint(
  profile: PersonaProfile | null,
  scenarios: ScenarioFields | null,
): string {
  const axes = profile
    ? (Object.keys(profile.axes) as AxisKey[])
      .sort()
      .map((k) => `${k}${Math.round(profile.axes[k] ?? 0)}`)
      .join(',')
    : '-';
  const sc = scenarios
    ? (Object.keys(scenarios) as Array<keyof ScenarioFields>)
      .sort()
      .map((k) => `${k}=${String(scenarios[k] ?? '')}`)
      .join(',')
    : '-';
  return `v${profile?.version ?? '-'}|${axes}|${sc}`;
}

/* ============================================================
 * 五、本批**未接线**的画像能力（如实登记）
 * ========================================================== */

export const PROFILE_PARTIALS: readonly string[] = [
  '"夜猫子时段"未接线：night_supply 说的是**夜间补给方式**（外卖/便利店/忍着），不是作息倾向'
    + ' —— 无可辩护依据前不臆造，等基础信息里的 sleepMin/作息字段进 PlanRequest 再接',
  // 结项注记（2026-10-06 收官批次 P1-6/P1-7 部分，裁决 R3）：mealWalkBudgetMin 已被
  // pickCanteen 消费（显式 PlanRequest.mealWalkBudgetMin 优先，回落本函数推导值）。
  '画像变更的"受影响天"集：overrideAffectedDays 已在 WeekPlanView 真实消费'
    + '（useWeekPlan/WeekPlanView 接线，E5 完成）—— 原「未接线」登记过期，2026-10-06 复核结项',
];
