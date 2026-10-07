/**
 * 逐块排程置信度（长计划增强计划书-2026-10-07 §1.2）
 * ============================================================
 * 回答用户一个问题：「这个块排在这儿有多顺势？」
 * 外部参照：FluidCalendar 的 scheduleScore（置信度展示，0–1）——确定性加权评分，
 * 不是黑盒 ML；因子与权重对齐计划书 §1.2（精力 1.5 / 时段偏好 1.2 /
 * 缓冲 0.8 / 交期 1.2 / 日内负荷 1.0）。
 *
 * ── 设计纪律 ────────────────────────────────────────────────
 * · **事后附加**：construct 组装末尾统一调用，分数只**描述**安排质量，
 *   不参与排程决策本身（避免「为分而排」的自指循环）。
 * · **纯函数**：不读时钟、不 fetch、不用随机；同输入必同输出（golden 可复现）。
 * · 交期因子暂为常数 0.5 中性项（逐块交期信息未进 TimeBlock 契约）；
 *   精力曲线暂用缺省分段常数（§2.3 精力曲线落地后由真实曲线替换）。
 * · course / meal / commute 是**既成事实**（课程/吃饭/路上），不评价顺势与否 → 0.5 中性；
 *   blank（留白）本身是好事 → 0.8 恒定。
 * · 验收硬指标（计划书 §1.2）：同一周内软块分数极差 ≥ 0.25 ——
 *   「全 0.5 恒定分」视为实现失败（反扁平红利：同叫自习，顺势与凑合要分得开）。
 */
import type { TimeBlock } from '@/types';
import { curveAt } from './energyCurve';

/** 因子权重（计划书 §1.2 公式；deadline 暂为中性常数项） */
const W = { energy: 1.5, timePref: 1.2, buffer: 0.8, deadline: 1.2, load: 1.0 } as const;
const W_SUM = W.energy + W.timePref + W.buffer + W.deadline + W.load;
const DEADLINE_NEUTRAL = 0.5;

/** 缺省日内精力曲线（分段常数；按块开始时刻取值） */
function energyAt(startMin: number): number {
  if (startMin < 8 * 60) return 0.55;   // 刚起床
  if (startMin < 12 * 60) return 1.0;   // 上午高峰
  if (startMin < 14 * 60) return 0.6;   // 午后低谷
  if (startMin < 17 * 60) return 0.85;  // 下午次峰
  if (startMin < 19 * 60) return 0.6;   // 傍晚
  if (startMin < 22 * 60) return 0.7;   // 晚间
  return 0.35;                          // 深夜
}

/** kind 常识时段偏好：自习偏上午、活动偏傍晚，其余中性 */
function timePrefOf(kind: TimeBlock['kind'], startMin: number): number {
  if (kind === 'study') {
    if (startMin < 12 * 60) return 1.0;
    if (startMin < 17 * 60) return 0.8;
    return 0.6;
  }
  if (kind === 'activity') {
    if (startMin >= 17 * 60) return 1.0;
    if (startMin >= 12 * 60) return 0.8;
    return 0.5;
  }
  return 0.5;
}

/** 缓冲充分度：与同日相邻块的最小间隙（无邻居 = 1.0） */
function bufferScore(gapBefore: number | null, gapAfter: number | null): number {
  const gaps = [gapBefore, gapAfter].filter((g): g is number => g != null);
  if (gaps.length === 0) return 1.0;
  const minGap = Math.min(...gaps);
  if (minGap >= 15) return 1.0;
  if (minGap >= 5) return 0.7;
  return 0.3;
}

/** 日内负荷健康度：占比 ≤0.7 从容 / ≤0.85 偏满 / 更高拥挤 */
function loadScore(dayBlocks: TimeBlock[], dayStartMin: number, dayEndMin: number): number {
  const span = Math.max(1, dayEndMin - dayStartMin);
  const busy = dayBlocks.reduce((s, b) => s + (b.endMin - b.startMin), 0);
  const ratio = busy / span;
  if (ratio <= 0.7) return 1.0;
  if (ratio <= 0.85) return 0.7;
  return 0.4;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface ScoreCtx {
  dayStartMin?: number;
  dayEndMin?: number;
  /**
   * 日内精力曲线（24 个小时锚点，§2.3）。
   * 给了就替换缺省分段常数（`energyCurve.ts::curveAt` 插值取值）；
   * 不给 = 走缺省曲线（golden 与无作息用户的行为不变）。
   */
  energyCurve?: number[];
}

/**
 * 给整周块打分。返回 `blockId → score`（0–1，两位小数）。
 * 传入前块应已排序、转场已标注（construct 末尾的口径）。
 */
export function scoreFor(blocks: TimeBlock[], ctx: ScoreCtx = {}): Record<string, number> {
  const dayStartMin = ctx.dayStartMin ?? 7 * 60;
  const dayEndMin = ctx.dayEndMin ?? 23 * 60;
  const curve = ctx.energyCurve;

  const byDay = new Map<number, TimeBlock[]>();
  for (const b of blocks) {
    const list = byDay.get(b.dayOfWeek);
    if (list) list.push(b);
    else byDay.set(b.dayOfWeek, [b]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id));
  }

  const out: Record<string, number> = {};
  for (const [day, list] of byDay) {
    const load = loadScore(list, dayStartMin, dayEndMin);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.kind === 'course' || b.kind === 'meal' || b.kind === 'commute') {
        out[b.id] = 0.5; // 既成事实：不评价
        continue;
      }
      if (b.kind === 'blank') {
        out[b.id] = 0.8; // 留白本身是好事
        continue;
      }
      const prev = i > 0 ? list[i - 1] : null;
      const next = i < list.length - 1 ? list[i + 1] : null;
      const gapBefore = prev ? b.startMin - prev.endMin : null;
      const gapAfter = next ? next.startMin - b.endMin : null;
      const energy = curveAt(curve, b.startMin) ?? energyAt(b.startMin);
      const score =
        (W.energy * energy
          + W.timePref * timePrefOf(b.kind, b.startMin)
          + W.buffer * bufferScore(gapBefore, gapAfter)
          + W.deadline * DEADLINE_NEUTRAL
          + W.load * load)
        / W_SUM;
      out[b.id] = round2(score);
    }
  }
  return out;
}
