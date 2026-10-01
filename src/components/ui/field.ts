/**
 * 表单字段统一样式（「首次设置」两域共用）
 * ============================================================
 * 「基础信息」的字段由 `features/welcome/BasicInfoStep` 渲染，「住处 / 作息」
 * 由 `features/week/**` 渲染。两个域**不许互相 import**（架构护栏 AC-6·R5
 * 跨域冻结，`welcome -> week` 与 `week -> welcome` 都不在基线里）。
 *
 * 但 RAY 要求这两块在界面上是**同一套字段样式**（统一风格，不是各写各的）。
 * 于是把外观抽到这个中立层：`components/**` 谁都能 import（`Welcome`、`LoginPage`
 * 等早就在用 `@/components/**`），字段长相从此只有一个定义点。
 *
 * 纪律：本文件只放样式常量/纯函数，不 import react、不碰存储。
 */

/** 标签文字（字段标题同款） */
export const FIELD_LABEL = 'text-xs text-ink-faint';

/** 控件骨架（圆角/边框/底色/字号/聚焦环）—— 三种控件共用，只差尺寸与配错色 */
const CTRL_BASE =
  'rounded-xl border bg-paper text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:ring-2';
const CTRL_OK = 'border-ink/15 focus:border-brand focus:ring-brand/10';
const CTRL_BAD = 'border-warn focus:border-warn focus:ring-warn/10';

/**
 * 主字段输入控件：占满整格 + 与上方标签留 1.5 间距。
 * `err` 为真值（错误文案）时切 warn 配色，否则常态配色。
 */
export function fieldCls(err?: string | false): string {
  return `mt-1.5 min-h-11 w-full px-3 py-2 ${CTRL_BASE} ${err ? CTRL_BAD : CTRL_OK}`;
}

/**
 * 紧凑控件（住处 / 作息里的输入框与下拉）：不占满、不带自带外边距，
 * 宽度与排布交给调用方 —— 但它与主字段**共用同一套边框/圆角/底色/聚焦环**，
 * 这样「统一风格」是结构性成立的，不是靠两处抄同一串类名。
 */
export function fieldClsCompact(err?: string | false): string {
  return `min-h-10 px-3 py-2 ${CTRL_BASE} ${err ? CTRL_BAD : CTRL_OK}`;
}

/** 可选胶囊（快捷宿舍等），与表单字段同一套边框/圆角/选中配色 */
export function chipCls(active: boolean): string {
  return `rounded-xl border px-3 py-1.5 text-xs transition-colors ${
    active
      ? 'border-brand bg-brand text-white'
      : 'border-ink/15 bg-paper text-ink-soft hover:border-brand/40 hover:text-brand'
  }`;
}

/** 字段下方的辅助说明（统一的小字样式） */
export const FIELD_HINT = 'mt-1 block text-[11px] leading-5 text-ink-faint';
