import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClick?: () => void;
  /** 无障碍名：IconButton 只有图标没有文字，aria-label 必填（否则读屏读不出是什么）。 */
  label: string;
  /** 选中态（§10.2.1）：aria-pressed 表达 toggle；选中样式 = 底色 + 文字色 + 3px 左竖条三重差异。 */
  selected?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * 图标按钮（UI v2 §10.2.1）：图标 17px，命中区强制 44×44——
 * 图标小不等于能点的地方小（WCAG 2.5.8）。
 */
export function IconButton({ children, onClick, label, selected = false, disabled = false, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={[
        'relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-ink-soft',
        'transition-[background-color,border-color,color] duration-fast ease-out',
        'active:scale-[.985] active:duration-instant',
        'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
        'disabled:pointer-events-none disabled:opacity-40',
        selected
          ? 'border-brand bg-brand text-white [&::after]:content-[""] [&::after]:absolute [&::after]:left-0 [&::after]:top-1/2 [&::after]:h-5 [&::after]:w-[3px] [&::after]:-translate-y-1/2 [&::after]:rounded-full [&::after]:bg-white'
          : 'border-ink/10 bg-white hover:border-brand/30 hover:bg-brand-light hover:text-brand',
        className,
      ].join(' ')}
    >
      <span className="grid place-items-center [&>svg]:h-[17px] [&>svg]:w-[17px]" aria-hidden="true">
        {children}
      </span>
    </button>
  );
}
