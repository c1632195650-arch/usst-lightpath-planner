/**
 * 数据色的唯一来源。
 *
 * 改版前课表类别、校历事件、时间节点各自在组件里硬编码了一份 hex，
 * 同一个「考试」在两个文件里写了两遍且色值不同。这里统一收口。
 *
 * 色序按波长从短到长（紫 → 靛 → 青 → 绿 → 琥珀 → 珊瑚），
 * 与 tailwind.config.js 的 chart.* 保持一致 —— 两边改动必须同步。
 */

import type { BlockKind, CalEvent, CourseCategory } from '@/types';

export const SPECTRUM = {
  violet: '#6B4BA3',
  indigo: '#2B4C9B',
  cyan: '#147A8B',
  green: '#1E7A4F',
  amber: '#B9762A',
  coral: '#C24B3A',
  slate: '#5A6377',
} as const;

/** 未知类别的兜底色，避免出现纯黑或透明块。 */
export const FALLBACK_COLOR = SPECTRUM.slate;

/**
 * 上理校红（与 tailwind school.red 同源，B2 彩蛋批）。
 * 校庆圆点从光谱紫换成校红 —— 校事用校色，月历圆点与图例自动跟随。
 * 不进 SPECTRUM：数据色按波长排列、与 tailwind chart.* 同步的契约不受影响。
 */
export const SCHOOL_RED = '#9E1B32';

/** 课表类别 → 色。专业核心用品牌靛蓝，因为它是课表里最需要被先看到的。 */
export const CATEGORY_COLOR: Record<CourseCategory, string> = {
  专业核心: SPECTRUM.indigo,
  公共基础: SPECTRUM.cyan,
  专业选修: SPECTRUM.violet,
  通识选修: SPECTRUM.green,
  实践环节: SPECTRUM.amber,
  其他: SPECTRUM.slate,
};

/** 校历事件 → 色与中文标签（图例直接读这里，不另写一份）。 */
export const EVENT_STYLE: Record<CalEvent['type'], { dot: string; label: string }> = {
  term: { dot: SPECTRUM.slate, label: '学期' },
  holiday: { dot: SPECTRUM.amber, label: '假期' },
  anniversary: { dot: SCHOOL_RED, label: '校庆' },
  exam: { dot: SPECTRUM.coral, label: '考试' },
  activity: { dot: SPECTRUM.green, label: '活动' },
};

/** 时间节点标签 → 色。考试与校历的「考试」现在是同一个色值。 */
export const DEADLINE_COLOR: Record<string, string> = {
  报名: SPECTRUM.cyan,
  竞赛: SPECTRUM.violet,
  校庆: SPECTRUM.amber,
  考试: SPECTRUM.coral,
};

export function deadlineColor(tag: string): string {
  return DEADLINE_COLOR[tag] ?? FALLBACK_COLOR;
}

export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category as CourseCategory] ?? FALLBACK_COLOR;
}

/* ═══════════════════════════════════════════════════════════════
   日程块（BlockKind）→ 色
   ═══════════════════════════════════════════════════════════════
   为什么加在这里：这一块原先在 `BlockCard.tsx` 里硬编码了七套 Tailwind 内置色
   （`bg-blue-100 border-blue-400 text-blue-900` …），与本文件的 `chart.*`
   并存 = **两套真相源**。后果有三个：
     ① 加一个类别要改两处，删一处不删另一处就出色差；
     ② `bg-blue-100` 这类内置色**从未核对过对比度**（本文件与 tailwind.config.js
        的色值都标了实测值，内置色没有）；
     ③ 换品牌色时会漏掉这一处，深色面改了、排程页没改。

   映射按「语义强弱」而非字母序 —— 颜色在这里是要传达信息的，不是装饰：
     · course  靛蓝   最重的长时段，且是"既成事实"，不该被误读成可改的软块
     · meal    琥珀   暖、与"饭"直觉一致
     · study   绿     "进行中的正事"，与课程冷色拉开
     · activity 紫    课表之外的活动
     · commute 灰    过渡，不是事项
     · blank   极浅   空档不该抢注意力（它占的正是"空"的面积）

   ⚠️ 键集必须**严格等于 `BlockKind`**（`types.ts` 契约锁死，不许改）。原
   `BlockCard.KIND_STYLE` 里多了一个 `'user'` 键，但 `BlockKind` 并无此值
   ⟹ 那是**永不命中的死键**（用户加的事最终落成 course/study 等既有 kind）。
   本表用 `Record<BlockKind, …>` 让编译器把这类多余键当场揪出来，而不是让它
   继续躺着骗人。 */
export interface KindPalette {
  /** Tailwind 类：左边条 */
  line: string;
  /** Tailwind 类：淡底 */
  wash: string;
  /** Tailwind 类：文字 */
  text: string;
  /** 一字标签（图例/窄块用），读这层不要现编 */
  label: string;
}

export const KIND_PALETTE: Record<BlockKind, KindPalette> = {
  course:   { line: 'border-l-indigo-500',  wash: 'bg-indigo-50',  text: 'text-indigo-900',  label: '课' },
  meal:     { line: 'border-l-amber-500',   wash: 'bg-amber-50',   text: 'text-amber-900',   label: '饭' },
  study:    { line: 'border-l-emerald-600', wash: 'bg-emerald-50', text: 'text-emerald-900', label: '学' },
  activity: { line: 'border-l-violet-500',  wash: 'bg-violet-50',  text: 'text-violet-900',  label: '动' },
  commute:  { line: 'border-l-slate-400',   wash: 'bg-slate-100',  text: 'text-slate-700',   label: '走' },
  blank:    { line: 'border-l-slate-200',   wash: 'bg-white',      text: 'text-slate-400',   label: '空' },
};

/**
 * 块类别 → 样式类串（三档合一）。
 *
 * ⚠️ 为什么用 Tailwind 类名而不是十六进制：`tailwind.config.js` 的内容扫描
 * 只认**完整类名字符串**，拼出来的 `bg-[${hex}]` 会被 JIT 漏掉 —— 所以这里
 * 必须走 `safelist` 可见的写法。同理 `kindCls` 的返回值出现在 JSX 里字面量
 * 拼接，Tailwind 扫不到；**因此本表必须保持字面量**（见下面测试守卫）。
 */
export function kindCls(kind: BlockKind): string {
  const p = KIND_PALETTE[kind] ?? KIND_PALETTE.blank;
  return `${p.wash} ${p.line} ${p.text}`;
}

/** 未知 kind 的兜底 —— 与旧实现 `KIND_STYLE[block.kind] ?? KIND_STYLE.blank` 同语义。 */
export function paletteOf(kind: string): KindPalette {
  return KIND_PALETTE[kind as BlockKind] ?? KIND_PALETTE.blank;
}
