/**
 * 精力高峰微调存储（长计划增强计划书 §2.3）
 * ============================================================
 * 用户只微调一档：「精力高峰在哪个时段」（6 档预设，见 HardBoundaryCard）。
 * 曲线本体不存 —— 由 `energyCurve.inferEnergyCurve(作息, 轴, peakHour)` 现算，
 * 免得存一份 24 长度数组还要做迁移。
 *
 * 存储口径：**localOnly**（同 `usst.engine_mode.v1`）—— 高峰偏好是设备级微调，
 * 不进云同步（省 serve.py WRITABLE_KEYS 一条 + CY 侧改动）。
 * 本树存储为单机口径（裸 localStorage + try/catch，同 routineStore 移植先例）——
 * 上游的云双写（@/lib/persistence）不随本批接入。
 */

const KEY = 'usst-energy-curve-v1';

export const SCHEMA_VERSION = 1;

/** 6 档预设（HardBoundaryCard 的 chips 与这里共用一份真源） */
export const PEAK_PRESETS: Array<{ label: string; fromHour: number }> = [
  { label: '清晨', fromHour: 6 },
  { label: '上午', fromHour: 9 },
  { label: '午后', fromHour: 12 },
  { label: '下午', fromHour: 15 },
  { label: '傍晚', fromHour: 18 },
  { label: '夜间', fromHour: 21 },
];

export interface EnergyCurveState {
  schemaVersion: number;
  /** 高峰起始小时（6–23）；null = 未微调（走推断） */
  peakHour: number | null;
}

const DEFAULT_STATE: EnergyCurveState = { schemaVersion: SCHEMA_VERSION, peakHour: null };

export function loadEnergyPeak(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EnergyCurveState>;
    if (typeof parsed.peakHour === 'number' && parsed.peakHour >= 6 && parsed.peakHour <= 23) {
      return Math.floor(parsed.peakHour);
    }
    return null;
  } catch {
    return null;
  }
}

export function saveEnergyPeak(peakHour: number | null): void {
  try {
    if (peakHour == null) {
      localStorage.removeItem(KEY);
      return;
    }
    const state: EnergyCurveState = { schemaVersion: SCHEMA_VERSION, peakHour };
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[energy-curve] 写入失败：', e);
  }
}
