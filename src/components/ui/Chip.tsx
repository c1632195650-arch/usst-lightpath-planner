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
        'px-3.5 py-2 rounded-full text-[13px] font-medium transition-all duration-150 border',
        'focus:outline-none focus:ring-2 focus:ring-brand/25',
        active
          ? 'bg-brand text-white border-brand shadow-sm'
          : 'bg-paper-card text-ink-soft border-paper-line hover:border-brand/40 hover:text-brand',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
