/**
 * scenarioModes —— 场景模式（考试周/比赛周一键切换，F6·A4，2026-10-24）
 * ============================================================
 * 设计（技术方案 F6 行，路线已锁定）：
 *   · **零引擎改动**——模式是应用层对 `PhasePolicy` 的**安全档内补丁** +
 *     F4 的 `weights` 通道微调，`lib/planner/**` 一个字节不碰；
 *   · **安全档与 knowledge 接线同源**（不是另开一套数）：单块上限 90
 *     （DEEP_WORK 深度工作 + 超日节律）、留白比例 0.15–0.45（人群底线区间）、
 *     日自习目标 60–360 分钟（档位 25/50 的日累计合理域）——**任何模式不得越档**
 *     （钳制边界有测试守，RV：去掉钳制必红）；
 *   · **关闭 = 零漂移**：`'off'` 时 patchPolicy 原样返回（同一引用），weights
 *     补丁为空对象 → 引擎 merge 后与不传逐字段一致。
 *
 * 智能边界（L3/L4，与 prefLearn 同一纪律）：模式只改**排程的倾斜**，
 * 不替用户决定「要不要冲刺」——切换权在用户，卡上明说当前模式与生效条件。
 */
import type { PhasePolicy } from '@/types';
import type { Weights } from '@/lib/planner/model';

export type ScenarioMode = 'off' | 'exam-week' | 'competition-week';

export const SCENARIO_MODE_KEY = 'usst.scenario-mode';

export const SCENARIO_MODES: ReadonlyArray<{ id: ScenarioMode; label: string; hint: string }> = [
  { id: 'off', label: '日常', hint: '不干预——按你的课表与画像常规排' },
  { id: 'exam-week', label: '考试周', hint: '自习上调、留白压缩、交期优先（安全档内）' },
  { id: 'competition-week', label: '比赛周', hint: '赶路敏感度上调、节奏略紧（安全档内）' },
];

/** 安全档（与 knowledge 接线同源，见文件头） */
export const SAFE_RANGE = {
  /** 单块上限（DEEP_WORK.blockMin = 90） */
  maxBlockMin: 90,
  /** 留白比例区间（人群底线） */
  blankRatio: [0.15, 0.45] as const,
  /** 日自习目标区间（分钟） */
  dailyStudyMin: [60, 360] as const,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function loadScenarioMode(): ScenarioMode {
  try {
    const v = localStorage.getItem(SCENARIO_MODE_KEY);
    return v === 'exam-week' || v === 'competition-week' ? v : 'off';
  } catch {
    return 'off';
  }
}

export function saveScenarioMode(mode: ScenarioMode): void {
  try {
    localStorage.setItem(SCENARIO_MODE_KEY, mode);
  } catch { /* 私有模式写失败不致命 */ }
}

/**
 * 模式对阶段策略的补丁（在安全档内）。
 * `'off'` → **原样返回同一引用**（调用方零感知，零漂移的结构保证）。
 */
export function patchPolicy(policy: PhasePolicy, mode: ScenarioMode): PhasePolicy {
  if (mode === 'off') return policy;
  const [bLo, bHi] = SAFE_RANGE.blankRatio;
  const [dLo, dHi] = SAFE_RANGE.dailyStudyMin;
  if (mode === 'exam-week') {
    return {
      ...policy,
      dailyStudyMin: clamp(Math.round(policy.dailyStudyMin * 1.25), dLo, dHi),
      blankRatio: clamp(Number((policy.blankRatio * 0.65).toFixed(2)), bLo, bHi),
      maxBlockMin: Math.min(policy.maxBlockMin, SAFE_RANGE.maxBlockMin),
    };
  }
  // competition-week：目标微升、留白微压、单块照钳
  return {
    ...policy,
    dailyStudyMin: clamp(Math.round(policy.dailyStudyMin * 1.15), dLo, dHi),
    blankRatio: clamp(Number((policy.blankRatio * 0.8).toFixed(2)), bLo, bHi),
    maxBlockMin: Math.min(policy.maxBlockMin, SAFE_RANGE.maxBlockMin),
  };
}

/**
 * 模式对权重的补丁（走 F4 的 `PlanRequest.weights` 通道）。
 * 返回**只含被改键**的 Partial——空对象 = 引擎 merge 后与缺省逐字段一致。
 */
export function patchWeights(base: Weights, mode: ScenarioMode): Partial<Weights> {
  if (mode === 'off') return {};
  if (mode === 'exam-week') {
    // 交期优先（技术方案 F6 原文示例：dueOverdue ×1.3）
    return { dueOverdue: Number((base.dueOverdue * 1.3).toFixed(2)) };
  }
  // competition-week：赶路敏感（transferRisk ×1.5），少排紧张转场
  return { transferRisk: Number((base.transferRisk * 1.5).toFixed(2)) };
}

/** 模式生效时追加的说明（notes/横幅用；off 返回 null 不追加） */
export function modeNoteOf(mode: ScenarioMode): string | null {
  if (mode === 'exam-week') return '当前处于考试周模式：自习上调、留白压缩、交期优先（总览页可切回）';
  if (mode === 'competition-week') return '当前处于比赛周模式：赶路敏感、节奏略紧（总览页可切回）';
  return null;
}
