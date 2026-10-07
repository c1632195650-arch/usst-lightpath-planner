/**
 * 目标骨架表 + 通用骨架（设计书 §6.10 / §16）
 * ============================================================
 * 纯数据，不含逻辑。由 `resolveSkeleton.ts` 的四级解析消费。
 *
 * 三个槽位（§6.10.1）：打底 / 主线 / 收口 —— 任何长期目标都套得上。
 * **骨架自带块型**（§6.9.3）：打底 → fragment · 主线 → deep · 收口 → sprint。
 *
 * 每个类别可覆盖槽位名称（如健康类 → 热身 / 主项 / 拉伸），
 * 覆盖的是**一张数据表**，不是一段代码。
 */

export type GoalBlockShape = 'deep' | 'fragment' | 'sprint';
export type SlotKind = 'base' | 'main' | 'close';

export interface SlotDef {
  slot: SlotKind;
  /** 用户看到的槽位名（类别可覆盖） */
  name: string;
  /** 权重 0–1，同目标内求和 = 1 */
  weight: number;
  /** 决定块长与打断容忍度 */
  shape: GoalBlockShape;
  /** 槽位动作短语（进 note，不进标题） */
  action: string;
}

/** 通用骨架 —— 任何目标都套得上 */
export const GENERIC_SKELETON: SlotDef[] = [
  { slot: 'base',  name: '打底', weight: 0.30, shape: 'fragment', action: '基础练习' },
  { slot: 'main',  name: '主线', weight: 0.50, shape: 'deep',     action: '核心推进' },
  { slot: 'close', name: '收口', weight: 0.20, shape: 'sprint',   action: '复盘整理' },
];

/** 类别骨架 —— 覆盖通用骨架的名称与权重（结构不变） */
export const CATEGORY_SKELETONS: Partial<Record<string, SlotDef[]>> = {
  contest: [
    { slot: 'base',  name: '学方法', weight: 0.25, shape: 'fragment', action: '学习方法' },
    { slot: 'main',  name: '练真题', weight: 0.45, shape: 'deep',     action: '真题练习' },
    { slot: 'close', name: '论文',   weight: 0.30, shape: 'deep',     action: '论文写作' },
  ],
  academic: [
    { slot: 'base',  name: '过教材', weight: 0.30, shape: 'fragment', action: '教材阅读' },
    { slot: 'main',  name: '做题',   weight: 0.50, shape: 'deep',     action: '专题练习' },
    { slot: 'close', name: '错题',   weight: 0.20, shape: 'sprint',   action: '错题复盘' },
  ],
  health: [
    { slot: 'base',  name: '热身',   weight: 0.15, shape: 'fragment', action: '热身活动' },
    { slot: 'main',  name: '主项',   weight: 0.60, shape: 'deep',     action: '主项训练' },
    { slot: 'close', name: '拉伸',   weight: 0.25, shape: 'sprint',   action: '拉伸整理' },
  ],
};

/** 目标模板的具名子领域（§6.10 四级解析的第②层） */
export interface TemplateSubArea {
  name: string;
  weight: number;
  shape: GoalBlockShape;
}

/** 考研（模板命中示例） */
export const KAOMAN_SUBAREAS: TemplateSubArea[] = [
  { name: '数学',   weight: 0.40, shape: 'deep' },
  { name: '英语',   weight: 0.30, shape: 'fragment' },
  { name: '政治',   weight: 0.15, shape: 'fragment' },
  { name: '专业课', weight: 0.15, shape: 'deep' },
];

export const MCM_SUBAREAS: TemplateSubArea[] = [
  { name: '建模',   weight: 0.40, shape: 'deep' },
  { name: '编程',   weight: 0.35, shape: 'deep' },
  { name: '论文',   weight: 0.25, shape: 'deep' },
];
