import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  padded?: boolean;
}

export function Card({ children, title, subtitle, action, className = '', padded = true }: Props) {
  return (
    <section
      className={[
        'panel overflow-hidden',
        className,
      ].join(' ')}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            {title && <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>}
            {subtitle && <p className="mt-1 text-xs leading-5 text-ink-faint">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'px-5 pb-5' : ''}>{children}</div>
    </section>
  );
}
