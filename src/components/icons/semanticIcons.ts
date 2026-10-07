import type { BlockKind } from '@/types';
import type { IconName } from './Icon';

/**
 * 语义 → 图鉴映射（UI 收口批，2026-10-08）
 * ============================================================
 * 为什么有这一层：数据层保留了 `emoji` 字段（`Block.emoji`、`Deadline.emoji`、
 * `LifeMode.emoji`、`WeatherAdvice.emoji`）—— **本批一个字节都不改数据契约**，
 * 只把**渲染**换成 90 枚图鉴。理由（设计总成 §9.6 与 §4.3）：
 *   · §4.3 的块解剖是五层（色条 / 主标题 / 时间 / 地点 / 状态）—— 里面没有 emoji 层；
 *   · emoji 是彩色位图字形，各家系统渲染不同（Windows / Android / iOS 三套），
 *     同一块在不同机器上长得不一样，与「同一份路径数据」的图标纪律相反；
 *   · 彩色 emoji 与块自身的浅底 + 左色条抢注意力，块内第一眼应该是课程名。
 * 映射按**语义而非字形相似**；找不到对应语义的宁可回退到 `flag`，不新画一枚形似件。
 * 本批**不扩充图标清单**（90 枚是设计总成 §9.1 的契约，`tests/ui-icons.test.ts` 锁着）：
 * 在既有图鉴里挑语义最近的一枚，而不是为 emoji 补一枚形似件。
 */

/** 块种类 → 图鉴（§9.5 学业/生活族的落点）。blank 不给图标：空档不该抢注意力。 */
export const KIND_ICON: Record<BlockKind, IconName | null> = {
  course: 'cap',
  meal: 'utensils',
  study: 'book-open',
  activity: 'dumbbell',
  commute: 'bus',
  blank: null,
};

export function kindIcon(kind: string): IconName | null {
  return KIND_ICON[kind as BlockKind] ?? null;
}

/** 情景模式 → 图鉴（原 `data/usst.ts LIFE_MODES[].emoji`）。 */
const LIFE_MODE_ICON: Record<string, IconName> = {
  grind: 'flame',
  balance: 'gauge',
  faraway: 'globe',
  sport: 'dumbbell',
  snack: 'utensils',
  mine: 'user-round',
};

export function lifeModeIcon(id: string): IconName {
  return LIFE_MODE_ICON[id] ?? 'sparkle';
}

/** 节点标签 → 图鉴（原 `Deadline.emoji`）；标签是既有真源，不给未知标签编字形。 */
const DEADLINE_ICON: Record<string, IconName> = {
  报名: 'notebook-pen',
  竞赛: 'trophy',
  校庆: 'sparkle',
  考试: 'cap',
};

export function deadlineIcon(tag: string): IconName {
  return DEADLINE_ICON[tag] ?? 'flag';
}

/** 天气提醒 → 图鉴（原 `WeatherAdvice.emoji`）：语义只有「警示/提示」两档。 */
export function adviceIcon(severity: 'warn' | 'info'): IconName {
  return severity === 'warn' ? 'warn-tri' : 'info';
}
