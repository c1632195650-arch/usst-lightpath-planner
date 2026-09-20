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
 * 通用滑块控件
 *
 * ⚠️ 2026-09-15 定位修正：本组件原本被设计为「留白率滑块」，并自称"本产品最重要的一个交互控件"。
 * **该说法已作废** —— 留白率已移出产品核心，降为排程引擎的一个可调软参数（`blankDeficit`）。
 * 组件本身作为通用 UI 控件保留（当前**零引用**）；接入新用途前，先确认它服务的是哪一层
 * （见 `docs/project-core.md` §4 智能边界四层）。
 *
 * 文案语气保持中性：不要出现"拖延""效率低"这类词。
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
