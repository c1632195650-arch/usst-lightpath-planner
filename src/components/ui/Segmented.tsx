import type { ReactNode } from 'react';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  /** 可选图标（17px，随 option 传 SVG） */
  icon?: ReactNode;
}

interface Props<V extends string> {
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V;
  onChange: (v: V) => void;
  /** 无障碍名（role="group" 的可读名） */
  label: string;
  disabled?: boolean;
  className?: string;
  /** 测试锚点（data-testid，落到 role=group 容器上） */
  testId?: string;
}

/**
 * 分段控件（UI v2 §10.2.2）：只用于「同一个东西的不同视图」（周↔日、单周↔双周）。
 * 两个选项如果是不同的东西（课表↔待办），用侧栏导航，不用分段控件。
 * 选项 ≤4 个；role="group" + aria-pressed 表达选中（读屏可达）。
 * 选中态三重差异：底色 + 文字色 + 3px 左竖条，不靠单一颜色。
 */
export function Segmented<V extends string>({ options, value, onChange, label, disabled = false, className = '', testId }: Props<V>) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className={`inline-flex rounded-xl border border-ink/10 bg-paper p-0.5 ${disabled ? 'opacity-40' : ''} ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={disabled ? undefined : () => onChange(opt.value)}
            disabled={disabled}
            aria-pressed={active}
            className={[
              'relative inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium',
              'transition-[background-color,color] duration-fast ease-out',
              'focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
              'disabled:pointer-events-none',
              active
                ? 'bg-white text-brand shadow-sm [&::after]:content-[""] [&::after]:absolute [&::after]:left-1 [&::after]:top-1/2 [&::after]:h-4 [&::after]:w-[3px] [&::after]:-translate-y-1/2 [&::after]:rounded-full [&::after]:bg-brand'
                : 'text-ink-soft hover:text-ink',
            ].join(' ')}
          >
            {opt.icon && (
              <span className="grid place-items-center [&>svg]:h-[17px] [&>svg]:w-[17px]" aria-hidden="true">
                {opt.icon}
              </span>
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
