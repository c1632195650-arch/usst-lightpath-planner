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
          {label && <span className="text-[13.5px] font-semibold text-ink">{label}</span>}
          {display && <span className="text-[15px] font-bold text-brand tabular-nums">{display}</span>}
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                   accent-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
        style={{
          background: `linear-gradient(to right, #c2410c 0%, #c2410c ${pct}%, #e7e2da ${pct}%, #e7e2da 100%)`,
        }}
      />
      {hint && <p className="text-[12px] text-ink-faint mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}
