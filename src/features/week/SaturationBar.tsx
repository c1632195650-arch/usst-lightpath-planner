import { SATURATION_STYLE, type DaySaturation } from './saturation';

// 满溢度纯模型在 ./saturation.ts（node --test 可直跑）；本文件只是 模型 → JSX 的薄映射。
export { daySaturation, type DaySaturation } from './saturation';

/**
 * WP7-E6：满溢度条 —— 每天列头的「这天排得多满」可视化。
 * 四档配色：<50% 绿 / 50-70% 黄 / 70-85% 橙 / ≥85% 红（口径见 saturation.ts）。
 */
export function SaturationBar({ sat }: { sat: DaySaturation }): JSX.Element {
  const pct = Math.round(sat.ratio * 100);
  const s = SATURATION_STYLE[sat.level];
  return (
    <span
      data-testid="saturation-bar"
      title={`这天已排 ${pct}%（${s.label}）—— 颜色越暖越该调整`}
      className={`inline-flex items-center gap-1 text-[10.5px] ${s.text}`}
    >
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-ink/10">
        <span className={`block h-full ${s.bar}`} style={{ width: `${Math.max(4, pct)}%` }} />
      </span>
      <span className="tabular-nums">{pct}%</span>
    </span>
  );
}
