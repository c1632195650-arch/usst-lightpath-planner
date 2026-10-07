import type { ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'red';
type Size = 'sm' | 'md';

interface Props {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  full?: boolean;
  type?: 'button' | 'submit';
  /** UI v2 §10.1 态 7：加载中——文字转透明、内嵌 15px spinner，宽高不变以防跳版。 */
  loading?: boolean;
  className?: string;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-sm hover:bg-brand-dark hover:brightness-110',
  secondary: 'border border-ink/10 bg-white text-ink hover:border-brand/20 hover:bg-brand-light/40',
  ghost: 'bg-transparent text-ink-soft hover:bg-white hover:text-ink',
  danger: 'border border-danger/15 bg-danger-light text-danger hover:bg-danger hover:text-white',
  /**
   * 上理红（UI v2 §10.2.1）：全站每页最多 1 个，且只能给「跟学校身份直接相关」的动作
   * （如「导出给辅导员」）。不是普通的危险操作——危险操作用 danger。
   */
  red: 'bg-school-red text-white hover:brightness-110',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-2 text-xs min-h-9',
  md: 'px-4 py-3 text-sm min-h-11',
};

/** 15px spinner（§10.1 态 7）；减少动效下由全局媒体查询冻结。 */
function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
      className="absolute left-1/2 top-1/2 -ml-[7.5px] -mt-[7.5px] [animation:ui-spin_1.1s_linear_infinite]"
    >
      <path d="M12 3.6a8.4 8.4 0 108.4 8.4" />
    </svg>
  );
}

export function Button({
  children, onClick, variant = 'primary', size = 'md',
  disabled = false, full = false, type = 'button', loading = false, className = '',
}: Props) {
  const busy = loading || false;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={[
        'relative rounded-xl font-semibold transition-[background-color,border-color,color,filter,transform]',
        'duration-fast ease-out',
        // §10.1 态 4 active：scale(.985)、90ms（instant），位移而不换色。
        'active:scale-[.985] active:duration-instant',
        // §10.1 态 3 focus-visible：2px 外环 + 2px 白色隔离圈（WCAG 2.4.13）。
        'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant], SIZES[size], full ? 'w-full' : '', className,
      ].join(' ')}
    >
      {/* 加载态宽高不变：children 原地转透明占位，spinner 绝对居中叠加。 */}
      <span className={`inline-flex items-center gap-1.5 ${busy ? 'text-transparent' : ''}`}>
        {children}
      </span>
      {busy && <Spinner />}
    </button>
  );
}
