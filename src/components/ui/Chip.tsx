import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

/** 可选中选项胶囊，用于问卷/筛选 */
export function Chip({ children, active = false, onClick, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl border px-3 py-2 text-xs font-medium transition-all duration-300 ease-in-out',
        active
          ? 'border-brand bg-brand text-white shadow-sm'
          : 'border-ink/10 bg-white/80 text-ink-soft hover:border-brand/25 hover:text-brand',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
