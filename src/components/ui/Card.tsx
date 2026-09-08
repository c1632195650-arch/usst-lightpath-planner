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
        'bg-paper-card border-2 border-ink/10 rounded-card shadow-sticker',
        className,
      ].join(' ')}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
          <div>
            {title && <h3 className="font-bold text-[15.5px] text-ink">{title}</h3>}
            {subtitle && <p className="text-[12.5px] text-ink-faint mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'px-4 pb-4' : ''}>{children}</div>
    </section>
  );
}
