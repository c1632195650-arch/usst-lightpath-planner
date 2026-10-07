import type { ReactNode } from 'react';

/**
 * 列表行（UI v2 §10.3.3）：左主文（标题+副文）右尾部（状态/动作）。
 * §10.5 矩阵必验：默认/悬停/聚焦/按下/选中。选中三重差异：底色 + 文字色 + 3px 左竖条。
 */

interface Props {
  title: ReactNode;
  /** 副文（时间·地点·类别），faint 一行 */
  subtitle?: ReactNode;
  /** 行尾：状态 Tag / 动作按钮 */
  trailing?: ReactNode;
  /** 行首：Avatar / 图标 */
  leading?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ListRow({ title, subtitle, trailing, leading, onClick, selected = false, disabled = false, className = '' }: Props) {
  const interactive = onClick != null && !disabled;
  return (
    <div
      {...(interactive ? { onClick, role: 'button', tabIndex: 0 } : {})}
      aria-selected={interactive ? selected : undefined}
      aria-disabled={disabled || undefined}
      className={[
        'relative flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left',
        'transition-[background-color,border-color,color] duration-fast ease-out',
        'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
        'active:duration-instant',
        disabled ? 'opacity-40' : '',
        selected
          ? 'border-brand/30 bg-brand-light text-brand [&::after]:content-[""] [&::after]:absolute [&::after]:left-0 [&::after]:top-1/2 [&::after]:h-6 [&::after]:w-[3px] [&::after]:-translate-y-1/2 [&::after]:rounded-full [&::after]:bg-brand'
          : 'border-ink/10 bg-white',
        interactive && !selected ? 'hover:border-brand/20 hover:bg-brand-light/30 active:scale-[.985]' : '',
        className,
      ].join(' ')}
    >
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${selected ? 'text-brand' : 'text-ink'}`}>{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-ink-faint">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </div>
  );
}
