interface Props {
  /** 0–1 */
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  /** 右侧的数值说明，自己传，格式自己定 */
  display?: string;
  /** 辅助文案，会出现在滑块下方 */
  hint?: string;
}

/**
 * 留白率滑块 —— 本产品最重要的一个交互控件
 *
 * 它不是"设置"，它是**产品价值观的载体**：
 * 告诉用户可以光明正大地多留白，而不是羞耻地偷懒。
 * 文案语气请保持中性偏鼓励，不要出现"拖延""效率低"这类词。
 */
export function Slider({
  value, onChange, min = 0, max = 1, step = 0.05,
  label, display, hint,
}: Props) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="w-full">
      {(label || display) && (
        <div className="flex items-baseline justify-between mb-1.5">
          {label && <span className="text-sm font-semibold text-ink">{label}</span>}
          {display && <span className="text-sm font-semibold text-brand tabular-nums">{display}</span>}
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-brand"
        style={{
          background: `linear-gradient(to right, #2B4C9B 0%, #2B4C9B ${pct}%, #EDEFF5 ${pct}%, #EDEFF5 100%)`,
        }}
      />
      {hint && <p className="mt-2 text-xs leading-5 text-ink-faint">{hint}</p>}
    </div>
  );
}
