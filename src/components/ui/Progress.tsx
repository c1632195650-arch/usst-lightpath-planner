/**
 * 进度条 / 进度环（UI v2 §10.3.1）。
 * - 线性：label + 数值 + 轨道；分段时每段一色（语义色映射由调用方给）。
 * - 进行中 = 斜纹仍在推进；减少动效时斜纹静止但**保留**（不是消失）。
 * - 环形：数字写在中心，环只是背景——不要让人「目测弧长」去猜数值。
 */

interface BarProps {
  /** 0–100 */
  value: number;
  label?: string;
  /** 数值文案（如 62 / 100），tabular-nums */
  valueText?: string;
  /** 进行中：斜纹动画（reduced-motion 下静止保留） */
  indeterminate?: boolean;
  disabled?: boolean;
  /** 错误态：轨道转 danger */
  error?: boolean;
  /** 加载态：整条转骨架灰 */
  loading?: boolean;
  className?: string;
}

export function ProgressBar({ value, label, valueText, indeterminate = false, disabled = false, error = false, loading = false, className = '' }: BarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {(label || valueText) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && <span className="text-xs font-medium text-ink-soft">{label}</span>}
          {valueText && <span className="text-xs font-semibold text-ink tabular-nums">{valueText}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={loading || indeterminate ? undefined : pct}
        aria-disabled={disabled || undefined}
        className={`h-2 w-full overflow-hidden rounded-full ${loading || disabled ? 'bg-ink/10' : error ? 'bg-danger-light' : 'bg-paper'}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-base ease-out ${
            loading ? 'w-full bg-ink/15' : disabled ? 'bg-ink/25' : error ? 'bg-danger' : 'bg-brand'
          } ${indeterminate ? 'progress-stripes' : ''}`}
          style={{ width: loading ? '100%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** 斜纹（进行中）：reduced-motion 时全局查询会把动画时长压到 0.01ms——静止但保留。 */
export function ProgressRing({ value, size = 56, label, disabled = false, error = false, className = '' }: {
  value: number;
  size?: number;
  label?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const stroke = disabled ? '#C6CBDA' : error ? '#C24B3A' : '#2B4C9B';
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className={`relative inline-grid place-items-center rounded-full ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDEFF5" strokeWidth="6" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-[stroke-dashoffset] duration-base ease-out"
        />
      </svg>
      {/* 数字写在中心——环只是背景，不让人目测弧长猜数值 */}
      <span className="absolute text-sm font-semibold text-ink tabular-nums">{pct}%</span>
    </div>
  );
}
