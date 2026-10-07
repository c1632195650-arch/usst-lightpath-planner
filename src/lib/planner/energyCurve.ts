/**
 * 日内精力曲线（长计划增强计划书-2026-10-07 §2.3）
 * ============================================================
 * RAY 拍板：「默认曲线推断 + 画像页微调」—— 不加采集步。
 *   · 推断 = 作息（起床/入睡，`usst-routine-v1`）+ HEA/RES 轴 → 24 个小时锚点值；
 *   · 微调 = 用户只选「精力高峰时段」一档（`usst-energy-curve-v1`，localOnly）；
 *   · 未采集作息 → 引擎缺省曲线（07:00–23:00，峰在 10:00）—— 与既有缺省口径一致。
 *
 * 形状（启发式 v1，可测）：
 *   醒前 0.3 → 起床后线性爬升 → 高峰 1.0（缺省 = 起床 + 3h，夹在起床+1h 与入睡−2h 之间）
 *   → 线性下降到入睡−1h 的 0.4 → 醒后/睡后 0.3。
 *   RES ≤ 35 → 午后（13–16 点）额外 ×0.9（恢复力弱，午后更塌）；
 *   HEA ≥ 70 → 全曲线 ×1.05（封顶 1）—— 自律高的人全天更平。
 *
 * 纯函数：不读时钟、不用随机；作息由调用方注入。
 */

export interface CurveInput {
  /** 起床（分钟，自 00:00）；null = 未采集 → 用缺省 07:00 */
  wakeMin?: number | null;
  /** 入睡（分钟）；null = 未采集 → 用缺省 23:00 */
  sleepMin?: number | null;
  /** 用户微调的高峰时刻（小时 6–23）；null/undefined = 推断（起床 + 3h） */
  peakHour?: number | null;
  /** 画像轴（HEA / RES）；缺省不调幅 */
  axes?: Record<string, number> | null;
}

const WAKE_DEFAULT = 7 * 60;
const SLEEP_DEFAULT = 23 * 60;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 24 个小时锚点（下标 h = 该小时的代表时刻 h*60 + 30） */
export function inferEnergyCurve(input: CurveInput = {}): number[] {
  const wake = input.wakeMin ?? WAKE_DEFAULT;
  const sleep = Math.max(input.sleepMin ?? SLEEP_DEFAULT, wake + 4 * 60); // 防呆：醒着至少 4h
  const peakDefault = Math.min(sleep - 2 * 60, wake + 3 * 60);
  const peak = Math.max(wake + 1 * 60, Math.min(sleep - 2 * 60, (input.peakHour ?? Math.floor(peakDefault / 60)) * 60 + 30));

  // HEA / RES 调幅（启发式 v1）
  const hea = input.axes?.HEA ?? 50;
  const res = input.axes?.RES ?? 50;
  const globalGain = hea >= 70 ? 1.05 : 1;
  const afternoonDip = res <= 35 ? 0.9 : 1;

  const anchors: Array<[number, number]> = [
    [0, 0.3],
    [wake, 0.35],
    [peak, 1.0],
    [sleep - 1 * 60, 0.4],
    [sleep, 0.3],
    [24 * 60, 0.3],
  ];

  const valueAt = (min: number): number => {
    if (min <= anchors[0][0]) return anchors[0][1];
    for (let i = 1; i < anchors.length; i++) {
      const [x1, y1] = anchors[i];
      if (min <= x1) {
        const [x0, y0] = anchors[i - 1];
        return lerp(y0, y1, (min - x0) / Math.max(1, x1 - x0));
      }
    }
    return anchors[anchors.length - 1][1];
  };

  return Array.from({ length: 24 }, (_, h) => {
    const mid = h * 60 + 30;
    let v = valueAt(mid);
    if (mid >= 13 * 60 && mid <= 16 * 60) v *= afternoonDip;
    return clamp01(Math.round(v * globalGain * 100) / 100);
  });
}

/** 曲线取值：startMin 所在小时与相邻小时线性插值（curve 缺省返回 null → 调用方走缺省） */
export function curveAt(curve: readonly number[] | undefined | null, startMin: number): number | null {
  if (!curve || curve.length !== 24) return null;
  const t = startMin / 60;
  const i = Math.max(0, Math.min(23, Math.floor(t)));
  const j = Math.min(23, i + 1);
  const frac = Math.min(1, Math.max(0, t - i));
  return clamp01(lerp(curve[i], curve[j], frac));
}
