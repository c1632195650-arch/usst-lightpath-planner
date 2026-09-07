import type { ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface Props {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  full?: boolean;
  type?: 'button' | 'submit';
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark active:scale-[.98]',
  secondary: 'bg-paper-card text-ink border border-paper-line hover:bg-paper active:scale-[.98]',
  ghost: 'bg-transparent text-ink-soft hover:bg-paper',
  danger: 'bg-danger-light text-danger border border-danger/20 hover:bg-danger hover:text-white',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[13px]',
  md: 'px-4 py-2.5 text-[14.5px]',
};

export function Button({
  children, onClick, variant = 'primary', size = 'md',
  disabled = false, full = false, type = 'button',
}: Props) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-lg font-semibold transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-brand/30',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant], SIZES[size], full ? 'w-full' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
