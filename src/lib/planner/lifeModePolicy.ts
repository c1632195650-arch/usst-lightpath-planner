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
import type { PhasePolicy } from '@/types';

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
}

/**
 * 六个模式的因子表。
 *
 * 数值不是拍脑袋：以 `balance` 为 1.0 基准，
 * `slack` 与 `grind` 对称（0.6 / 1.3，即「少四成」与「多三成」），
 * 其余模式只做小幅让步（它们的主要意图不是调学习强度，而是**腾时间**）。
 */
const FACTORS: Record<string, LifeModeFactor> = {
  balance: { studyMul: 1.00, blankDelta: 0.00, note: '平衡节奏：学习与休息都留出来' },
  slack:   { studyMul: 0.60, blankDelta: 0.15, note: '摸鱼模式：目标降到六成，留白再多一成半' },
  grind:   { studyMul: 1.30, blankDelta: -0.05, note: '猛攻模式：目标上调三成，压缩留白' },
  food:    { studyMul: 1.00, blankDelta: 0.05, note: '吃饭模式：多留一点，好好吃饭' },
  health:  { studyMul: 0.90, blankDelta: 0.05, note: '健康模式：略降强度，把运动的时间腾出来' },
  social:  { studyMul: 0.85, blankDelta: 0.10, note: '社交模式：降一点强度，留出约饭与活动的时间' },
};

/** 未识别的模式 id 一律视为「不做调整」（不猜） */
export function lifeModeFactorOf(lifeModeId: string | null | undefined): LifeModeFactor | null {
  if (!lifeModeId) return null;
  return FACTORS[lifeModeId] ?? null;
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
