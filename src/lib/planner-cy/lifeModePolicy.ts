/**
 * 生活模式 → 阶段策略 的映射（阶段 D）
 * ============================================================
 * 补的是什么：`AppState.lifeMode`（平衡 / 摸鱼 / 猛攻 / 吃饭 / 健康 / 社交）
 * 此前**只换配色和文案，完全不改排程**（`weekPlanAdapter.ts` 注释自认
 * 「只影响展示的配色与名称」）。于是用户点「🚀 猛攻模式」却发现排得一样松 ——
 * 这比「没有这个功能」更伤信任。
 *
 * ── 三条设计约束 ──────────────────────────────────────────────
 * 1. **纯函数**：不读时钟、不 fetch、不用随机；同输入必得同输出。
 * 2. **只调「强度」类参数**：`dailyStudyMin` / `blankRatio` / `eveningAllowed`。
 *    不动 `studyPlaces`（那是画像的偏好）、不动 `maxBlockMin`（那是人格特征）。
 * 3. **clamp 与 `applyPersona` 用同一套边界**（blankRatio 0.1–0.6）——
 *    两处各定一套边界会出现「画像调完 0.6、模式又加回 0.75」这种叠加失控。
 *
 * ── 与校正层（`corrections.ts`）的先后 ────────────────────────
 * 顺序是「画像 → 生活模式 → 用户校正」。
 * 理由：校正层是用户**明确说出来的要求**（更具体、更近期），应当最后生效、
 * 不被模式覆盖；而生活模式是「当下这轮想怎么过」的临时选择，影响面更粗。
 */
import type { PhasePolicy } from './cy-types.ts';

/** 一个模式对策略的调整因子 */
export interface LifeModeFactor {
  /** 目标自习时长的乘数 */
  studyMul: number;
  /** 留白比例的**增量**（与画像同一套 clamp 边界） */
  blankDelta: number;
  /** 可选：直接改写「是否允许晚间」 */
  eveningAllowed?: boolean;
  /** 给用户看的一句话（写进 reasons） */
  note: string;
  /**
   * WP5（2026-09-27）：每周运动次数（0-7）。给了就按「每天最多 1 次」铺满 N 次，
   * 且**绕过画像触发**（模式本身就是用户对运动的显式表达，不再要 exercise_trigger 背书）。
   */
  sportSessions?: number;
  /** WP5：加餐窗口数（0-2）：1 = 下午茶、2 = 下午茶 + 夜宵 */
  extraMeals?: number;
  /** WP5：每周「自由格」（blank 块）数量（0-3）—— 远方模式把空闲时段实体化成留白 */
  blankBlocks?: number;
}

/** 引擎消费的模式附加参数（随 PlanRequest.lifeModeExtras 下发，见 construct） */
export interface LifeModeExtras {
  sportSessions?: number;
  extraMeals?: number;
  blankBlocks?: number;
}

/**
 * 六个模式的因子表（WP5 重命名 + 参数化）。
 *
 * 数值不是拍脑袋：以 `balance` 为 1.0 基准，`faraway` 与 `grind` 对称（0.6 / 1.3）。
 * 三个新参数只在 `PlanRequest.lifeModeExtras` 显式下发时生效 —— golden 语料不带
 * lifeMode，因此**默认路径零改动**（与 WP10 compliance 的 opt-in 手法同一纪律）。
 */
const FACTORS: Record<string, LifeModeFactor> = {
  balance: { studyMul: 1.00, blankDelta: 0.00, note: '均衡模式：学习与休息都留出来', sportSessions: 2 },
  grind:   { studyMul: 1.30, blankDelta: -0.05, note: '内卷模式：目标上调三成，压缩留白', sportSessions: 1 },
  faraway: { studyMul: 0.60, blankDelta: 0.15, note: '远方模式：少排一点，把大片空白还给你', blankBlocks: 2 },
  sport:   { studyMul: 0.90, blankDelta: 0.05, note: '运动模式：隔天一次锻炼，科学安排', sportSessions: 4 },
  snack:   { studyMul: 0.90, blankDelta: 0.05, note: '小馋猫模式：下午茶与夜宵都给你留好', extraMeals: 2 },
  mine:    { studyMul: 1.00, blankDelta: 0.00, note: '我的模式：按你的画像与校正定制，不额外加戏' },
};

/**
 * 旧模式 id → 新模式 id（WP5 重命名的迁移表）。
 * 旧 id 来自用户 localStorage（AppState.lifeMode）—— 读到时归一，不让老数据失效。
 * 数值变化（food 1.0→0.9、social 0.85→1.0）属模式重定义的行为级变更，已在台账申报。
 */
const LEGACY_MODE_MAP: Record<string, string> = {
  balance: 'balance',
  grind: 'grind',
  slack: 'faraway',
  food: 'snack',
  health: 'sport',
  social: 'balance',
};

/** 旧 id 归一：不认识的 id 原样返回（lifeModeFactorOf 里仍按「不猜」处理） */
export function normalizeLifeModeId(id: string | null | undefined): string | null {
  if (!id) return null;
  return LEGACY_MODE_MAP[id] ?? id;
}

/** 未识别的模式 id 一律视为「不做调整」（不猜） */
export function lifeModeFactorOf(lifeModeId: string | null | undefined): LifeModeFactor | null {
  if (!lifeModeId) return null;
  const id = normalizeLifeModeId(lifeModeId);
  return (id != null ? FACTORS[id] : undefined) ?? null;
}

/** WP5：模式的引擎附加参数（sportSessions/extraMeals/blankBlocks）；没有就是 undefined */
export function lifeModeExtrasOf(lifeModeId: string | null | undefined): LifeModeExtras | undefined {
  const f = lifeModeFactorOf(lifeModeId);
  if (!f) return undefined;
  const extras: LifeModeExtras = {};
  if (f.sportSessions != null) extras.sportSessions = f.sportSessions;
  if (f.extraMeals != null) extras.extraMeals = f.extraMeals;
  if (f.blankBlocks != null) extras.blankBlocks = f.blankBlocks;
  return Object.keys(extras).length ? extras : undefined;
}

/**
 * 把生活模式叠加到阶段策略上。
 *
 * @returns `policy` 调整后的策略；`note` 给用户看的说明（`null` = 没生效）。
 *          两者都不为 `null` 时，调用方**必须**把 `note` 写进 `reasons` ——
 *          用户主动切了模式却看不到任何痕迹，会以为按钮坏了。
 */
export function applyLifeMode(
  base: PhasePolicy,
  lifeModeId: string | null | undefined,
): { policy: PhasePolicy; note: string | null } {
  const f = lifeModeFactorOf(lifeModeId);
  if (!f) return { policy: base, note: null };

  const policy: PhasePolicy = {
    ...base,
    dailyStudyMin: Math.max(0, Math.round(base.dailyStudyMin * f.studyMul)),
    // 与 applyPersona 同一套边界：下限 0.1、上限 0.6
    blankRatio: Math.min(0.6, Math.max(0.1, Math.round((base.blankRatio + f.blankDelta) * 100) / 100)),
    ...(f.eveningAllowed != null ? { eveningAllowed: f.eveningAllowed } : {}),
  };
  return { policy, note: f.note };
}
