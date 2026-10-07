/**
 * 周计划时间轴换算（T3 七列时间轴 · 2026-10-07）
 * ============================================================
 * 「分钟 ↔ 像素」的唯一换算点 —— 纯函数、零依赖、可单测。
 *
 * 为什么独立成文件（而不是塞进 `timeScale.ts`）：
 *   `timeScale.ts` 是 09-19 双层时间视图**回退后**的残余（只剩空闲块计算）；
 *   本文件是 10-07 重新落地时间轴的新换算层 —— 两者的「日界口径」还不同：
 *   · `timeScale.DAY_START_MIN/END_MIN`（07:00–23:00）= **引擎可排区间**
 *     （拖拽落位合法性判定的口径，`dragTo` 的 dayStartMin/dayEndMin）；
 *   · 本文件 `AXIS_START_MIN/END_MIN`（06:00–24:00）= **画轴范围**
 *     （比可排区间宽，让 07:00 前 / 23:00 后的边界块也有完整留白）。
 *   混在一起迟早会有人拿错；分开且各自注明出处。
 */

/** 轴顶（06:00）—— 画轴口径，**不是**引擎可排区间（那是 timeScale 的 07:00） */
export const AXIS_START_MIN = 6 * 60;
/** 轴底（24:00） */
export const AXIS_END_MIN = 24 * 60;

/**
 * 每分钟像素（PPM）。1.25 是原型第三轮 RAY 复看过的值：
 * 30 分钟块 = 37.5px，正好放得下「标题 + 时间」两行。
 * 调大 → 页面更长；调小 → 短块更早要滚。改动要重新跑真机复验。
 */
export const PPM = 1.25;

/** 轴总高（px）：18 小时 × 1.25 = 1350 */
export const AXIS_HEIGHT = (AXIS_END_MIN - AXIS_START_MIN) * PPM;

/** 分钟 → 纵坐标（相对轴顶）。可为小数，浏览器像素级定位照收 */
export function minToY(min: number): number {
  return (min - AXIS_START_MIN) * PPM;
}

/**
 * 时长 → 块高（**严格守时**：块高 = 时长 × PPM，与内容多少无关）。
 * 内容装不下时不撑高，交给块内滚动（RAY 拍板口径）。
 */
export function spanToH(startMin: number, endMin: number): number {
  return Math.max(0, (endMin - startMin) * PPM);
}

/**
 * 纵坐标 → 分钟（拖拽落点反换算）。
 * 调用方自行 `snap10` / clamp —— 这里只做线性换算，保持纯粹。
 */
export function yToMin(y: number): number {
  return AXIS_START_MIN + y / PPM;
}

/** 刻度列步长：每 3 小时一个标签（原型 gutterStep = 180） */
export const GUTTER_STEP_MIN = 180;

/** 刻度标签（含轴底 24:00 —— 显示为「24」） */
export function gutterMarks(): Array<{ min: number; y: number; label: string }> {
  const out: Array<{ min: number; y: number; label: string }> = [];
  for (let m = AXIS_START_MIN; m <= AXIS_END_MIN; m += GUTTER_STEP_MIN) {
    out.push({ min: m, y: minToY(m), label: m >= 24 * 60 ? '24' : String(m / 60) });
  }
  return out;
}

/**
 * 横向网格线：整点一条；每 3 小时（刻度的位置）略深一档。
 * 七列各画自己的一份（同 min ⟹ 同 top），视觉上连成贯穿七列的基准线。
 */
export function hourRules(): Array<{ min: number; y: number; major: boolean }> {
  const out: Array<{ min: number; y: number; major: boolean }> = [];
  for (let m = AXIS_START_MIN; m <= AXIS_END_MIN; m += 60) {
    out.push({ min: m, y: minToY(m), major: m % GUTTER_STEP_MIN === 0 });
  }
  return out;
}
