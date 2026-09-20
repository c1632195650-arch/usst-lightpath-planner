/**
 * 数据色的唯一来源。
 *
 * 改版前课表类别、校历事件、时间节点各自在组件里硬编码了一份 hex，
 * 同一个「考试」在两个文件里写了两遍且色值不同。这里统一收口。
 *
 * 色序按波长从短到长（紫 → 靛 → 青 → 绿 → 琥珀 → 珊瑚），
 * 与 tailwind.config.js 的 chart.* 保持一致 —— 两边改动必须同步。
 */

import type { CalEvent, CourseCategory } from '@/types';

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
  anniversary: { dot: SPECTRUM.violet, label: '校庆' },
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
