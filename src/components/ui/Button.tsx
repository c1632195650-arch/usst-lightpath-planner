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
  className?: string;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-sm hover:bg-brand-dark hover:brightness-110',
  secondary: 'border border-ink/10 bg-white text-ink hover:border-brand/20 hover:bg-brand-light/40',
  ghost: 'bg-transparent text-ink-soft hover:bg-white hover:text-ink',
  danger: 'border border-danger/15 bg-danger-light text-danger hover:bg-danger hover:text-white',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-2 text-xs',
  md: 'px-4 py-3 text-sm',
};

export function Button({
  children, onClick, variant = 'primary', size = 'md',
  disabled = false, full = false, type = 'button', className = '',
}: Props) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-xl font-semibold transition-all duration-300 ease-in-out active:scale-[.99]',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant], SIZES[size], full ? 'w-full' : '', className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
